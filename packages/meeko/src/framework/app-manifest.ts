import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { AppManifest, ClientAssets } from "../framework-server/app.js";
import type { AssetManifest } from "../framework-server/assets.js";
import { discoverServerManifest } from "../framework-server/manifest-discovery.js";
import { serializeJson } from "../server.js";
import { discoverConfiguredRoutes, loadConfiguredModules, resolveConfigSources } from "./config.js";
import { importSpecifier, pluginMode, pluginName } from "./module-loader.js";
import { discoverErrorPage } from "./routes-discovery.js";
import type { ErrorPageRecord, RouteRecord } from "./router.js";

export const frameworkClientEntry = ".meeko/generated/entry-client.ts";
export const frameworkServerEntry = ".meeko/generated/entry-server.ts";
export const frameworkNodeEntry = ".meeko/generated/entry-node.ts";
/** Written by `meeko build` between the client and server builds. */
export const buildDataFile = ".meeko/build/app-data.json";

/** Values only known after the client build; baked into the server bundle. */
export interface BuildAppData {
  readonly client: ClientAssets;
  readonly assets: AssetManifest;
  readonly node: { readonly host: string; readonly port: number };
}

/** Converts an absolute source file into the project-relative key used by bundles. */
export function moduleKey(root: string, file: string): string {
  const path = relative(root, file).replaceAll("\\", "/");
  if (!path || path === ".." || path.startsWith("../") || isAbsolute(path)) throw new Error(`Module outside Meeko project: ${file}`);
  return `/${path}`;
}

/**
 * Route records whose files are module keys instead of absolute paths.
 * `sidecars: "client"` keeps only the sidecars of `render: "client"` routes,
 * which are the only ones the browser may import.
 */
export function portableRoutes(root: string, routes: readonly RouteRecord[], options: { sidecars: boolean | "client" }): RouteRecord[] {
  const keepSidecar = (route: RouteRecord): boolean => options.sidecars === "client" ? route.render === "client" : options.sidecars;
  return routes.map((route) => ({
    id: route.id,
    file: moduleKey(root, route.file),
    layouts: route.layouts.map((layout) => moduleKey(root, layout)),
    ...(route.error ? { error: moduleKey(root, route.error) } : {}),
    ...(route.sidecar && keepSidecar(route) ? { sidecar: moduleKey(root, route.sidecar) } : {}),
    ...(route.render ? { render: route.render } : {}),
  }));
}

/** `app/error.meeko` of the project with module keys, or undefined without one. */
export async function portableErrorPage(projectRoot: string): Promise<ErrorPageRecord | undefined> {
  const root = resolve(projectRoot);
  const page = await discoverErrorPage(root);
  return page && { file: moduleKey(root, page.file), layouts: page.layouts.map((layout) => moduleKey(root, layout)) };
}

async function scripts(directory: string, exclude: RegExp): Promise<string[]> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const found: string[] = [];
  for (const entry of entries) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await scripts(file, exclude));
    else if (entry.isFile() && entry.name.endsWith(".ts") && !exclude.test(entry.name)) found.push(file);
  }
  return found;
}

const runtimeFiles = ["server/runtime.ts", "server/runtime.mts", "server/runtime.js", "server/runtime.mjs"];

/** Locates the optional application runtime module. */
export function findRuntimeFile(root: string): string | undefined {
  const found = runtimeFiles.map((file) => resolve(root, file)).filter((file) => existsSync(file));
  if (found.length > 1) throw new Error(`Multiple server runtime files: ${found.join(", ")}`);
  return found[0];
}

/** An app plugin in start order, with where it runs. */
export interface AppPluginRecord {
  readonly file: string;
  readonly mode: "client" | "server" | "universal";
  readonly options?: unknown;
  readonly name: string;
}

const pluginScript = /\.[cm]?[jt]s$/;
const excludedPluginScript = /\.(?:test|spec|d)\.[cm]?[jt]s$/;

/**
 * The app plugins in start order: those the modules add (in the order they add them), then the
 * `app/plugins` files of each layer and of the application, by file name. Only the files directly
 * inside `app/plugins` are plugins; subdirectories can hold their helpers.
 */
export async function discoverAppPlugins(projectRoot: string): Promise<AppPluginRecord[]> {
  const root = resolve(projectRoot);
  const { config, modules } = await loadConfiguredModules(root);
  const sources = await resolveConfigSources(root, config);
  const result: AppPluginRecord[] = modules.plugins.map((plugin) => ({
    file: plugin.file, mode: plugin.mode, name: `${plugin.module}: ${pluginName(root, plugin.file)}`,
    ...(plugin.options === undefined ? {} : { options: plugin.options }),
  }));
  for (const source of [...sources.slice(1), sources[0]!]) {
    const directory = join(source.root, "app", "plugins");
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    const files = entries.filter((entry) => entry.isFile() && pluginScript.test(entry.name) && !excludedPluginScript.test(entry.name))
      .map((entry) => entry.name).sort((left, right) => left.localeCompare(right));
    for (const name of files) {
      const file = join(directory, name);
      result.push({ file, mode: pluginMode(file, undefined), name: pluginName(root, file) });
    }
  }
  return result;
}

/** Module source that imports `plugins` statically and exports them as `PluginRegistration`s. */
function pluginRegistrations(root: string, plugins: readonly AppPluginRecord[]): { imports: string[]; list: string } {
  const imports = plugins.map((plugin, index) => `import plugin${index} from ${JSON.stringify(importSpecifier(root, plugin.file))};`);
  const entries = plugins.map((plugin, index) => `{ plugin: plugin${index}, name: ${JSON.stringify(plugin.name)}${plugin.options === undefined ? "" : `, options: ${serializeJson(plugin.options)}`} }`);
  return { imports, list: `[${entries.join(", ")}]` };
}

/** Source of `virtual:meeko-plugins/client`: the plugins that run in the browser, in start order. */
export async function clientPluginsSource(projectRoot: string): Promise<string> {
  const root = resolve(projectRoot);
  const plugins = (await discoverAppPlugins(root)).filter((plugin) => plugin.mode !== "server");
  const { imports, list } = pluginRegistrations(root, plugins);
  return [...imports, `export const plugins = ${list};`, ""].join("\n");
}

/** Discovers every module the server may load and returns the manifest with module keys. */
export async function discoverAppManifest(projectRoot: string, client: ClientAssets, assets?: AssetManifest): Promise<{ manifest: AppManifest; modules: string[]; runtime?: string }> {
  const root = resolve(projectRoot);
  const routes = portableRoutes(root, await discoverConfiguredRoutes(root), { sidecars: true });
  const server = await discoverServerManifest(root);
  const { modules: projectModules } = await loadConfiguredModules(root);
  const routeMiddleware = (await scripts(resolve(root, "app", "middleware"), /\.(?:test|spec|d|server|client)\.ts$/)).map((file) => moduleKey(root, file)).sort();
  // Module middleware runs first, in the order the modules add it.
  const serverMiddleware = [
    ...projectModules.serverMiddleware.map((file) => importSpecifier(root, file)),
    ...(await scripts(resolve(root, "server", "middleware"), /\.(?:test|spec|d|client)\.ts$/)).map((file) => moduleKey(root, file)).sort(),
  ];
  const serverHandlers = projectModules.serverHandlers.map(({ route, file }) => ({ route, file: importSpecifier(root, file) }));
  const errorPage = await portableErrorPage(root);
  const manifest: AppManifest = {
    version: 1,
    routes,
    ...(errorPage ? { errorPage } : {}),
    server: {
      api: server.api.map((endpoint) => ({ ...endpoint, file: moduleKey(root, endpoint.file) })),
      rpc: server.rpc.map((endpoint) => ({ ...endpoint, file: moduleKey(root, endpoint.file) })),
      socket: (server.socket ?? []).map((endpoint) => ({ ...endpoint, file: moduleKey(root, endpoint.file) })),
    },
    routeMiddleware,
    serverMiddleware,
    ...(serverHandlers.length ? { serverHandlers } : {}),
    client,
    ...(assets ? { assets } : {}),
  };
  const modules = new Set<string>();
  for (const route of routes) {
    for (const key of [route.file, ...route.layouts, ...(route.error ? [route.error] : []), ...(route.sidecar ? [route.sidecar] : [])]) modules.add(key);
  }
  if (errorPage) for (const key of [errorPage.file, ...errorPage.layouts]) modules.add(key);
  for (const endpoint of [...manifest.server.api, ...manifest.server.rpc, ...manifest.server.socket ?? []]) modules.add(endpoint.file);
  for (const key of [...routeMiddleware, ...serverMiddleware, ...serverHandlers.map((handler) => handler.file)]) modules.add(key);
  const runtimeFile = findRuntimeFile(root);
  return { manifest, modules: [...modules].sort(), ...(runtimeFile ? { runtime: moduleKey(root, runtimeFile) } : {}) };
}

/** Source of `virtual:meeko-server-app`: the baked manifest and a static module map. */
export async function serverAppSource(projectRoot: string, build: BuildAppData | undefined): Promise<string> {
  const client: ClientAssets = build?.client ?? { entry: `/${frameworkClientEntry}`, css: [], preload: [] };
  const { manifest, modules, runtime } = await discoverAppManifest(projectRoot, client, build?.assets);
  const entries = modules.map((key) => `  ${JSON.stringify(key)}: () => import(${JSON.stringify(key)})`).join(",\n");
  const root = resolve(projectRoot);
  const plugins = pluginRegistrations(root, (await discoverAppPlugins(root)).filter((plugin) => plugin.mode !== "client"));
  return [
    runtime ? `import runtimeModule from ${JSON.stringify(runtime)};` : "const runtimeModule = undefined;",
    ...plugins.imports,
    `export const manifest = ${serializeJson(manifest)};`,
    `export const runtime = runtimeModule;`,
    `export const plugins = ${plugins.list};`,
    `export const nodeServer = ${JSON.stringify(build?.node ?? { host: "127.0.0.1", port: 4173 })};`,
    `const modules = {\n${entries}\n};`,
    "export async function load(key) {",
    "  if (!Object.hasOwn(modules, key)) throw new Error(\"Meeko module missing from the build: \" + key);",
    "  return modules[key]();",
    "}",
    "",
  ].join("\n");
}

/** Source of `virtual:meeko-manifest/client`: routes and the application error page for client navigation. */
export async function clientRoutesSource(projectRoot: string): Promise<string> {
  const root = resolve(projectRoot);
  const routes = portableRoutes(root, await discoverConfiguredRoutes(root), { sidecars: "client" });
  const errorPage = await portableErrorPage(root);
  return `export const routes = ${serializeJson(routes)};\nexport const errorPage = ${errorPage ? serializeJson(errorPage) : "undefined"};\n`;
}

/**
 * Source of `virtual:meeko-client-routes`: lazy imports of `render: "client"`
 * sidecars only. They join the client graph, where the Vite boundary check
 * rejects server-only imports.
 */
export async function clientSidecarsSource(projectRoot: string): Promise<string> {
  const root = resolve(projectRoot);
  const routes = portableRoutes(root, await discoverConfiguredRoutes(root), { sidecars: "client" });
  const keys = [...new Set(routes.flatMap((route) => route.sidecar ? [route.sidecar] : []))].sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}: () => import(${JSON.stringify(key)})`);
  return `export const modules = {${entries.join(",")}};\n`;
}

/** Reads the client build data written by `meeko build`. */
export async function readBuildAppData(projectRoot: string): Promise<BuildAppData> {
  try { return JSON.parse(await readFile(resolve(projectRoot, buildDataFile), "utf8")) as BuildAppData; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Client build data is missing; run meeko build");
    throw error;
  }
}

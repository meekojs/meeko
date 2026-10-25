import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { AppManifest, ClientAssets } from "../framework-server/app.js";
import type { AssetManifest } from "../framework-server/assets.js";
import { discoverServerManifest } from "../framework-server/manifest-discovery.js";
import { serializeJson } from "../server.js";
import { discoverConfiguredRoutes } from "./config.js";
import type { RouteRecord } from "./router.js";

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

/** Discovers every module the server may load and returns the manifest with module keys. */
export async function discoverAppManifest(projectRoot: string, client: ClientAssets, assets?: AssetManifest): Promise<{ manifest: AppManifest; modules: string[]; runtime?: string }> {
  const root = resolve(projectRoot);
  const routes = portableRoutes(root, await discoverConfiguredRoutes(root), { sidecars: true });
  const server = await discoverServerManifest(root);
  const routeMiddleware = (await scripts(resolve(root, "app", "middleware"), /\.(?:test|spec|d|server|client)\.ts$/)).map((file) => moduleKey(root, file)).sort();
  const serverMiddleware = (await scripts(resolve(root, "server", "middleware"), /\.(?:test|spec|d|client)\.ts$/)).map((file) => moduleKey(root, file)).sort();
  const manifest: AppManifest = {
    version: 1,
    routes,
    server: {
      api: server.api.map((endpoint) => ({ ...endpoint, file: moduleKey(root, endpoint.file) })),
      rpc: server.rpc.map((endpoint) => ({ ...endpoint, file: moduleKey(root, endpoint.file) })),
      socket: (server.socket ?? []).map((endpoint) => ({ ...endpoint, file: moduleKey(root, endpoint.file) })),
    },
    routeMiddleware,
    serverMiddleware,
    client,
    ...(assets ? { assets } : {}),
  };
  const modules = new Set<string>();
  for (const route of routes) {
    for (const key of [route.file, ...route.layouts, ...(route.error ? [route.error] : []), ...(route.sidecar ? [route.sidecar] : [])]) modules.add(key);
  }
  for (const endpoint of [...manifest.server.api, ...manifest.server.rpc, ...manifest.server.socket ?? []]) modules.add(endpoint.file);
  for (const key of [...routeMiddleware, ...serverMiddleware]) modules.add(key);
  const runtimeFile = findRuntimeFile(root);
  return { manifest, modules: [...modules].sort(), ...(runtimeFile ? { runtime: moduleKey(root, runtimeFile) } : {}) };
}

/** Source of `virtual:meeko-server-app`: the baked manifest and a static module map. */
export async function serverAppSource(projectRoot: string, build: BuildAppData | undefined): Promise<string> {
  const client: ClientAssets = build?.client ?? { entry: `/${frameworkClientEntry}`, css: [], preload: [] };
  const { manifest, modules, runtime } = await discoverAppManifest(projectRoot, client, build?.assets);
  const entries = modules.map((key) => `  ${JSON.stringify(key)}: () => import(${JSON.stringify(key)})`).join(",\n");
  return [
    runtime ? `import runtimeModule from ${JSON.stringify(runtime)};` : "const runtimeModule = undefined;",
    `export const manifest = ${serializeJson(manifest)};`,
    `export const runtime = runtimeModule;`,
    `export const nodeServer = ${JSON.stringify(build?.node ?? { host: "127.0.0.1", port: 4173 })};`,
    `const modules = {\n${entries}\n};`,
    "export async function load(key) {",
    "  if (!Object.hasOwn(modules, key)) throw new Error(\"Meeko module missing from the build: \" + key);",
    "  return modules[key]();",
    "}",
    "",
  ].join("\n");
}

/** Source of `virtual:meeko-manifest/client`: routes for client navigation. */
export async function clientRoutesSource(projectRoot: string): Promise<string> {
  const root = resolve(projectRoot);
  const routes = portableRoutes(root, await discoverConfiguredRoutes(root), { sidecars: "client" });
  return `export const routes = ${serializeJson(routes)};\n`;
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

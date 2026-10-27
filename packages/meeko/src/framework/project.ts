import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { InlineConfig, ViteDevServer } from "vite";
import { escapeHtml } from "../server.js";
import { attachNodeWebSocketServer, toNodeListener } from "../node.js";
import type { ServerApp, ServerAppOptions } from "../framework-server/app.js";
import type { AssetManifest, AssetRecord } from "../framework-server/assets.js";
import { reportServerError } from "../framework-server/contracts.js";
import { buildDataFile, frameworkClientEntry, frameworkNodeEntry, frameworkServerEntry } from "./app-manifest.js";
import type { BuildAppData } from "./app-manifest.js";
import { discoverConfiguredRoutes, loadConfiguredModules, loadMeekoConfig, resolveConfigSources } from "./config.js";
import { setModuleDevelopmentMode } from "./module-loader.js";
import type { ResolvedModules } from "./module-loader.js";
import { createDevAppReloader, isDiscoverySource } from "./dev-watch.js";
import { supervisedHmrPortEnv, supervisedPortEnv } from "./dev-link.js";
import { devHmrHost, devPortInUse, resolveDevPorts } from "./dev-port.js";
import type { MeekoAdapterName } from "./config-type.js";
import { prerenderWithNodeBuild } from "./prerender.js";
import { bunEntrySource, cloudflareEntrySource, denoEntrySource } from "./adapter-templates.js";
import { cloudflareAssetsDirectory, cloudflarePrerenderDirectory, resolveWrangler, wranglerConfig, wranglerSource } from "./cloudflare-build.js";
import { editorBridgeHost, startEditorBridge } from "./editor-bridge.js";
import type { EditorBridge } from "./editor-bridge.js";
import { clientEntrySource, nodeEntrySource, serverEntrySource } from "./project-templates.js";
import { assertNoLegacySessionFile } from "./runtime-migration.js";
import { stylesheetLinks } from "./styles.js";

export { frameworkClientEntry, frameworkServerEntry } from "./app-manifest.js";

const clientOutput = ".meeko/output/client";
const nodeOutput = ".meeko/output/node";
/** Node server used only to prerender pages for adapters other than Node. */
const prerenderServer = ".meeko/build/node";
const adapters: readonly MeekoAdapterName[] = ["node", "cloudflare", "deno", "bun"];

/** Self-contained bundles for runtimes that do not read node_modules. */
const bundledAdapters = {
  bun: { entry: ".meeko/generated/entry-bun.ts", source: bunEntrySource, file: "index.js" },
  deno: { entry: ".meeko/generated/entry-deno.ts", source: denoEntrySource, file: "main.js" },
} as const;

/** Directory written by `meeko build` for an adapter. */
export function adapterOutput(adapter: MeekoAdapterName): string {
  return `.meeko/output/${adapter}`;
}

/** Single-file Worker bundle and its generated Wrangler configuration. */
const cloudflareAdapter = { entry: ".meeko/generated/entry-cloudflare.ts", file: "worker.js", config: "wrangler.jsonc" } as const;

/** Entry file of an adapter's build output, relative to the project. */
export function adapterEntry(adapter: MeekoAdapterName): string {
  const file = adapter === "node" ? "index.mjs" : adapter === "cloudflare" ? cloudflareAdapter.file : bundledAdapters[adapter].file;
  return `${adapterOutput(adapter)}/${file}`;
}

/** Writes framework-owned Vite entries; no application file is overwritten. */
export async function prepareProject(projectRoot: string): Promise<void> {
  const root = resolve(projectRoot);
  const generated = resolve(root, ".meeko/generated");
  await mkdir(generated, { recursive: true });
  await Promise.all([
    writeFile(resolve(root, frameworkClientEntry), clientEntrySource, "utf8"),
    writeFile(resolve(root, frameworkServerEntry), serverEntrySource, "utf8"),
    writeFile(resolve(root, frameworkNodeEntry), nodeEntrySource, "utf8"),
  ]);
}

const contentTypes: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon", ".wasm": "application/wasm",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".pdf": "application/pdf",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav",
};

async function listFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await listFiles(file));
    else if (entry.isFile()) found.push(file);
  }
  return found;
}

/**
 * URL pathname of a build file exactly as WHATWG URL serializes it, which is
 * what `new URL(request.url).pathname` yields for a browser request. `%`, `?`,
 * `#`, `\`, spaces and control characters in names are data, not URL syntax.
 */
export function assetKey(segments: readonly string[]): string {
  const escaped = segments.map((segment) => segment.replace(/[%?#\\ \u0000-\u001f\u007f]/g, (character) => encodeURIComponent(character)));
  return new URL(`/${escaped.join("/")}`, "http://meeko.invalid").pathname;
}

type ViteManifest = Record<string, { file?: string; css?: string[]; assets?: string[]; imports?: string[] }>;

/**
 * Lists the public client build, which already contains Vite's copy of
 * `public/`. Only files emitted by Vite (listed in its manifest, so content
 * hashed) are immutable; copied `public/` files keep the same URL across edits.
 */
export async function assetManifest(directory: string, viteManifest: ViteManifest): Promise<AssetManifest> {
  const hashed = new Set<string>();
  for (const chunk of Object.values(viteManifest)) {
    for (const file of [chunk.file, ...chunk.css ?? [], ...chunk.assets ?? []]) {
      if (file) hashed.add(assetKey(file.split("/")));
    }
  }
  const assets: Record<string, AssetRecord> = {};
  for (const file of (await listFiles(directory)).sort()) {
    const path = relative(directory, file).split(sep);
    if (path[0] === ".vite") continue;
    const content = await readFile(file);
    const key = assetKey(path);
    assets[key] = {
      type: contentTypes[extname(file).toLowerCase()] ?? "application/octet-stream",
      etag: `"${createHash("sha256").update(content).digest("base64url").slice(0, 27)}"`,
      size: content.byteLength,
      ...(hashed.has(key) ? { immutable: true } : {}),
    };
  }
  return assets;
}

async function readViteManifest(root: string): Promise<ViteManifest> {
  return JSON.parse(await readFile(resolve(root, clientOutput, ".vite/manifest.json"), "utf8")) as ViteManifest;
}

function clientAssets(manifest: ViteManifest): BuildAppData["client"] {
  const entry = manifest[frameworkClientEntry];
  if (!entry?.file) throw new Error(`Missing ${frameworkClientEntry} in the Vite client manifest`);
  const css = new Set(entry.css ?? []);
  const preload = new Set<string>();
  const visit = (key: string): void => {
    const chunk = manifest[key];
    if (!chunk?.file || preload.has(chunk.file)) return;
    preload.add(chunk.file);
    for (const file of chunk.css ?? []) css.add(file);
    for (const child of chunk.imports ?? []) visit(child);
  };
  for (const key of entry.imports ?? []) visit(key);
  const url = (file: string): string => assetKey(file.split("/"));
  return { entry: url(entry.file), css: [...css].map(url), preload: [...preload].map(url) };
}

/** Validates an adapter name. */
export function assertBuildAdapter(adapter: string): MeekoAdapterName {
  if (!adapters.includes(adapter as MeekoAdapterName)) throw new Error(`Adaptador desconocido: ${adapter}; usa node, cloudflare, deno o bun`);
  return adapter as MeekoAdapterName;
}

/**
 * Opciones de {@link buildProject}.
 *
 * @example
 * ```ts
 * import { buildProject } from "@meekojs/meeko/build";
 * import type { BuildProjectOptions } from "@meekojs/meeko/build";
 *
 * const options: BuildProjectOptions = { adapter: "deno" };
 * await buildProject(process.cwd(), options);
 * ```
 */
export interface BuildProjectOptions {
  /** Sustituye a `MeekoConfig.server.adapter`. */
  readonly adapter?: MeekoAdapterName;
}

/**
 * Resultado de {@link buildProject}.
 *
 * @example
 * ```ts
 * import { buildProject } from "@meekojs/meeko/build";
 *
 * const { adapter, output } = await buildProject(process.cwd());
 * console.log(`build ${adapter} en ${output}`);
 * ```
 */
export interface BuildProjectResult {
  /** Adaptador usado. */
  readonly adapter: MeekoAdapterName;
  /** Carpeta de salida, ejecutable sin las fuentes de la aplicación. */
  readonly output: string;
}

/**
 * Construye el proyecto como `meeko build`: el cliente, el bundle de servidor del adaptador y sus
 * páginas prerenderizadas, bajo `.meeko/output/<adapter>/`. El adaptador sale de `options`, de
 * `meeko.config.ts` o, por defecto, `node`. Necesita `vite` instalado.
 *
 * @param projectRoot Carpeta del proyecto.
 * @param options Adaptador que sustituye al de la configuración.
 * @returns El adaptador y la carpeta de salida.
 * @throws {Error} Si el adaptador no existe, el proyecto conserva `server/session.ts` o falla el build.
 * @example
 * ```ts
 * import { buildProject } from "@meekojs/meeko/build";
 *
 * const result = await buildProject(process.cwd(), { adapter: "cloudflare" });
 * // result.output: <proyecto>/.meeko/output/cloudflare
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#build-despliegue-y-verificación
 */
export async function buildProject(projectRoot: string, options: BuildProjectOptions = {}): Promise<BuildProjectResult> {
  const root = resolve(projectRoot);
  const { config, modules } = await loadConfiguredModules(root);
  const adapter = assertBuildAdapter(options.adapter ?? config.server?.adapter ?? "node");
  assertNoLegacySessionFile(root);
  const outputDirectory = adapterOutput(adapter);
  const output = resolve(root, outputDirectory);
  await modules.callHook("build:before", { adapter, output });
  await prepareProject(root);
  await modules.callHook("routes:resolved", { routes: await discoverConfiguredRoutes(root) });
  const vite = await import("vite");
  const { meeko } = await import("../vite.js");
  const build = (base: InlineConfig): ReturnType<typeof vite.build> => vite.build(withModules(modules, base, "build"));
  await build({
    root, configFile: false, plugins: [meeko()], logLevel: "warn",
    build: {
      outDir: clientOutput, manifest: true, emptyOutDir: true,
      rollupOptions: { input: frameworkClientEntry },
    },
  });
  // Module public files join the client build before its asset manifest is computed.
  await writeModulePublicFiles(resolve(root, clientOutput), modules);
  const server = config.server?.adapter === "node" ? config.server : undefined;
  const viteManifest = await readViteManifest(root);
  const data: BuildAppData = {
    client: clientAssets(viteManifest),
    assets: await assetManifest(resolve(root, clientOutput), viteManifest),
    node: { host: server?.host ?? "127.0.0.1", port: server?.port ?? 4173 },
  };
  await mkdir(resolve(root, ".meeko/build"), { recursive: true });
  await writeFile(resolve(root, buildDataFile), JSON.stringify(data, null, 2) + "\n", "utf8");
  // The Node server also renders prerendered pages for the other adapters.
  const nodeTarget = adapter === "node" ? nodeOutput : prerenderServer;
  await build({
    root, configFile: false, plugins: [meeko()], logLevel: "warn",
    ssr: { external: ["@meekojs/meeko"] },
    build: {
      ssr: frameworkNodeEntry,
      // public/ belongs to the client build, which the server reads from client/.
      outDir: nodeTarget, emptyOutDir: true, copyPublicDir: false,
      rollupOptions: { output: { entryFileNames: "index.mjs", chunkFileNames: "chunks/[name]-[hash].mjs" } },
    },
  });
  if (adapter === "bun" || adapter === "deno") {
    const target = bundledAdapters[adapter];
    await writeFile(resolve(root, target.entry), target.source, "utf8");
    await build({
      root, configFile: false, plugins: [meeko()], logLevel: "warn",
      // Bundle every dependency, including Meeko itself; only runtime built-ins stay external.
      ssr: {
        noExternal: true,
        resolve: { conditions: [adapter, "module", "node", "development|production"], externalConditions: [adapter, "node", "module-sync"] },
      },
      build: {
        ssr: target.entry,
        outDir: outputDirectory, emptyOutDir: true, copyPublicDir: false,
        rollupOptions: { output: { entryFileNames: target.file, chunkFileNames: "chunks/[name]-[hash].js" } },
      },
    });
  }
  const cloudflare = config.server?.adapter === "cloudflare" ? config.server : undefined;
  if (adapter === "cloudflare") {
    // The prerendered pages share the assets directory under a reserved prefix.
    if (existsSync(resolve(root, clientOutput, "_meeko"))) throw new Error("public/_meeko está reservado para la salida de Cloudflare de Meeko; cámbiale el nombre");
    const wrangler = await wranglerConfig(root, cloudflare);
    const className = (wrangler.durable_objects as { bindings: Array<{ class_name: string }> }).bindings[0]!.class_name;
    await writeFile(resolve(root, cloudflareAdapter.entry), cloudflareEntrySource(className), "utf8");
    await build({
      root, configFile: false, plugins: [meeko()], logLevel: "warn",
      // One self-contained module for workerd; only runtime modules stay external.
      ssr: {
        target: "webworker",
        noExternal: true,
        resolve: { conditions: ["workerd", "worker", "browser", "module", "development|production"], externalConditions: ["workerd", "worker"] },
      },
      build: {
        ssr: cloudflareAdapter.entry,
        // public/ is served from assets/ only; a copy next to worker.js would be uploaded with it.
        outDir: outputDirectory, emptyOutDir: true, copyPublicDir: false,
        rollupOptions: {
          external: [/^cloudflare:/, "node:async_hooks"],
          output: { entryFileNames: cloudflareAdapter.file, codeSplitting: false },
        },
      },
    });
    await writeFile(join(output, cloudflareAdapter.config), wranglerSource(wrangler), "utf8");
  }
  const publicFiles = adapter === "cloudflare" ? cloudflareAssetsDirectory : "client";
  await cp(resolve(root, clientOutput), join(output, publicFiles), {
    recursive: true,
    filter: (source) => relative(resolve(root, clientOutput), source).split(sep)[0] !== ".vite",
  });
  const prerenderOutput = adapter === "cloudflare" ? cloudflarePrerenderDirectory : "prerender";
  await prerenderWithNodeBuild(root, `${nodeTarget}/index.mjs`, `${outputDirectory}/${prerenderOutput}`);
  await modules.callHook("build:done", { adapter, output });
  return { adapter, output };
}

function safeDecode(pathname: string): string {
  try { return decodeURIComponent(pathname); }
  catch { return pathname; }
}

/**
 * The inline Vite configuration of a `meeko dev` or `meeko build` step with what the modules add:
 * their plugins after Meeko's, then each `extendViteConfig` in order.
 */
function withModules(modules: ResolvedModules, base: InlineConfig, command: "serve" | "build"): InlineConfig {
  let config: Record<string, any> = modules.vitePlugins.length ? { ...base, plugins: [...base.plugins ?? [], ...modules.vitePlugins] } : base;
  const ssr = Boolean((base.build as { ssr?: unknown } | undefined)?.ssr);
  for (const extend of modules.viteExtenders) config = extend(config, { command, ssr }) ?? config;
  return config as InlineConfig;
}

async function publicFileContents(contents: ResolvedModules["publicFiles"] extends ReadonlyMap<string, infer T> ? T : never): Promise<string | Uint8Array> {
  const value = typeof contents === "function" ? await contents() : contents;
  if (typeof value !== "string" && !(value instanceof Uint8Array)) throw new TypeError("A module public file must produce a string or bytes");
  return value;
}

/** Writes the public files of the modules into the client build; one that `public/` also has is an error. */
async function writeModulePublicFiles(directory: string, modules: ResolvedModules): Promise<void> {
  for (const [path, contents] of modules.publicFiles) {
    const target = join(directory, ...path.split("/"));
    if (existsSync(target)) throw new Error(`El archivo público ${path} de un módulo choca con public/${path}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await publicFileContents(contents));
  }
}

const runtimes = {
  bun: { command: "bun", args: (entry: string) => [entry], name: "Bun", install: "https://bun.sh" },
  deno: { command: "deno", args: (entry: string) => ["run", "-A", entry], name: "Deno", install: "https://deno.com" },
} as const;

/**
 * Runs a build output in its real runtime. Node runs in this process; Bun and
 * Deno run as a child process whose exit code becomes this process's.
 */
export async function previewProject(projectRoot: string, adapter?: MeekoAdapterName): Promise<void> {
  const root = resolve(projectRoot);
  const target = adapter ?? (await loadMeekoConfig(root)).server?.adapter ?? "node";
  if (target === "node") { await startProject(root, true); return; }
  let command: string;
  let args: string[];
  let runtime: { readonly name: string; readonly install: string };
  if (target === "cloudflare") {
    const config = resolve(root, adapterOutput(target), cloudflareAdapter.config);
    if (!existsSync(config)) throw new Error(`No hay build de producción en ${config}; ejecuta meeko build --adapter cloudflare`);
    const wrangler = resolveWrangler(root);
    if (!wrangler) throw new Error("Wrangler no está instalado; añádelo con pnpm add -D wrangler para previsualizar el build de cloudflare");
    // wrangler dev runs the bundled Worker in workerd with local bindings.
    command = process.execPath;
    args = [wrangler, "dev", "--config", config,
      ...(process.env.PORT ? ["--port", process.env.PORT] : []), ...(process.env.HOST ? ["--ip", process.env.HOST] : [])];
    runtime = { name: "Wrangler", install: "https://developers.cloudflare.com/workers/wrangler/install-and-update/" };
  } else {
    const entry = resolve(root, adapterEntry(target));
    if (!existsSync(entry)) throw new Error(`No hay build de producción en ${entry}; ejecuta meeko build --adapter ${target}`);
    runtime = runtimes[target];
    command = runtimes[target].command;
    args = runtimes[target].args(entry);
  }
  const child = spawn(command, args, { cwd: root, stdio: "inherit", windowsHide: true });
  const forward = (signal: NodeJS.Signals): void => { child.kill(signal); };
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  try {
    await new Promise<void>((done, fail) => {
      child.once("error", (error: NodeJS.ErrnoException) => {
        fail(error.code === "ENOENT"
          ? new Error(`${runtime.name} no está instalado o no está en el PATH; instálalo desde ${runtime.install} para previsualizar el build de ${target}`)
          : error);
      });
      child.once("exit", (code, signal) => {
        process.exitCode = code ?? (signal ? 1 : 0);
        done();
      });
    });
  } finally {
    process.off("SIGINT", forward);
    process.off("SIGTERM", forward);
  }
}

interface NodeStartModule { start(): Promise<{ readonly server: Server }> }

/** How each development server started by {@link startProject} closes, as on SIGINT. */
const developmentStops = new WeakMap<Server, () => Promise<void>>();

/**
 * Closes a development server started by {@link startProject} as SIGINT does: the editor bridge
 * and its descriptor, the Socket server, the HTTP server, the app and Vite. Idempotent; resolves
 * once everything closed. A production server is not affected.
 */
export function stopDevelopmentServer(server: Server): Promise<void> {
  return developmentStops.get(server)?.() ?? Promise.resolve();
}

/** HTTP and HMR ports of each development server started by {@link startProject}. */
const developmentPorts = new WeakMap<Server, { readonly port: number; readonly hmrPort: number }>();

/** HTTP and HMR ports of a development server started by {@link startProject}; `undefined` for any other server. */
export function developmentServerPorts(server: Server): { readonly port: number; readonly hmrPort: number } | undefined {
  return developmentPorts.get(server);
}

/** Starts the package-owned Node 24 HTTP host for development or the built Node output. */
export async function startProject(projectRoot: string, production: boolean): Promise<Server> {
  const root = resolve(projectRoot);
  if (production) {
    const entry = resolve(root, nodeOutput, "index.mjs");
    if (!existsSync(entry)) throw new Error(`No hay build de producción en ${entry}; ejecuta meeko build`);
    const output = await import(pathToFileURL(entry).href) as Partial<NodeStartModule>;
    if (typeof output.start !== "function") throw new Error(`${entry} no es un build de Node de Meeko; ejecuta meeko build`);
    return (await output.start()).server;
  }
  return startDevelopment(root);
}

async function startDevelopment(root: string): Promise<Server> {
  assertNoLegacySessionFile(root);
  // Every module resolution of this process (Vite plugin, autoimports, discovery) runs with dev: true.
  setModuleDevelopmentMode(true);
  const { config, modules } = await loadConfiguredModules(root);
  const server = config.server?.adapter === "node" ? config.server : undefined;
  const host = process.env.HOST || server?.host || "127.0.0.1";
  // A port named by PORT or server.port (or the one a supervisor's first server took) is kept, and
  // listening reports it when in use; otherwise dev takes the first free one from 4173 up.
  const named = process.env[supervisedPortEnv] || process.env.PORT || server?.port;
  const namedHmr = process.env[supervisedHmrPortEnv] || process.env.MEEKO_HMR_PORT;
  const { port, hmrPort, busy } = await resolveDevPorts({
    host, ...(named ? { port: Number(named) } : {}), ...(namedHmr ? { hmrPort: Number(namedHmr) } : {}),
  });
  if (busy !== undefined) process.stdout.write(`[meeko] El puerto ${busy} está en uso; meeko dev usa el ${port}\n`);
  await prepareProject(root);
  let vite: ViteDevServer | undefined;
  let app: ServerApp | undefined;
  let socketServer: ReturnType<typeof attachNodeWebSocketServer> | undefined;
  let bridge: EditorBridge | undefined;
  /** Rebuilds the app when a discovery source is added or removed; set once the app exists. */
  let onTreeChange: ((file: string) => void) | undefined;
  /** Runs a Vite restart once the app's work in flight drains, and rebuilds the app after it; set once the app exists. */
  let onRestart: ((start: () => Promise<void>) => Promise<void>) | undefined;
  const reportError = (error: unknown, requestId: string): void => {
    if (app) { app.reportError(error, requestId); return; }
    reportServerError(error, requestId, (failure, id) => {
      process.stderr.write(`[meeko] request error ${id} (${failure instanceof Error ? failure.name : "UnknownError"})\n`);
      console.error(failure);
    });
  };
  try {
    const { createServer: createViteServer, searchForWorkspaceRoot } = await import("vite");
    const { meeko } = await import("../vite.js");
    vite = await createViteServer(withModules(modules, {
      root, configFile: false,
      plugins: [meeko(), {
        name: "meeko:editor-bridge",
        // A restart (a changed `.env`, `server.restart()`) replaces `server.ws` and runs this
        // hook again for the new one. Its first client reaches it once `devServer.ws` points to
        // it: the bridge moves there before that client's first message.
        configureServer(server) { server.ws.on("connection", () => bridge?.refresh()); },
      }, {
        name: "meeko:dev-discovery",
        // A restart also replaces `server.watcher` and closes the old one with its listeners:
        // this hook subscribes each new watcher once.
        configureServer(server) {
          server.watcher.on("add", (file) => onTreeChange?.(file));
          server.watcher.on("unlink", (file) => onTreeChange?.(file));
        },
      }, {
        name: "meeko:dev-restart",
        // A restart also closes the module runner that loaded the app's entry: its pages,
        // layouts and server modules would fail to load ("Vite module runner has been
        // closed") until the app is created again on the new runner. Every restart (a
        // changed `.env` or config dependency, `server.restart()`) goes through
        // `server.restart`, and Vite copies the new server's properties, this wrapper
        // included, onto the instance this host holds; so this hook wraps each new server's
        // method once and the app follows every restart. The wrapper tells the app before
        // Vite closes anything: requests from then on wait for the new app, and the restart
        // itself waits for the requests and the app build still running on the old runner.
        configureServer(server) {
          const restart = server.restart;
          server.restart = (forceOptimize) => {
            const start = (): Promise<void> => restart.call(server, forceOptimize);
            return onRestart ? onRestart(start) : start();
          };
        },
      }],
      // One Meeko instance on the server, as in the build: a package linked
      // outside node_modules (pnpm link:, a workspace) would otherwise run
      // inlined in Vite's module runner beside the copy this host imported,
      // with separate reactivity and context state.
      ssr: { external: ["@meekojs/meeko"] },
      server: {
        middlewareMode: true,
        // Middleware mode opens a separate Vite WebSocket server, on a port derived
        // from the app port so concurrent projects do not share 24678.
        hmr: { host: devHmrHost, port: hmrPort },
        // Module files may live outside the workspace (a linked package); the browser loads their runtime files.
        ...(modules.ownedDirectories.length ? { fs: { allow: [searchForWorkspaceRoot(root), ...modules.ownedDirectories] } } : {}),
      },
      appType: "custom",
    }, "serve"));
    const globalCss = resolve(root, "app/styles/main.css");
    const devServer = vite;
    const publicOrigin = process.env.PUBLIC_ORIGIN || undefined;
    const createDevApp = async (): Promise<ServerApp> => {
      await modules.callHook("routes:resolved", { routes: await discoverConfiguredRoutes(root) });
      const entry = await devServer.ssrLoadModule(`/${frameworkServerEntry}`) as { createApp(options: Omit<ServerAppOptions, "manifest" | "load" | "runtime">): Promise<ServerApp> };
      return entry.createApp({
        production: false,
        platform: {
          name: "node", env: process.env,
          waitUntil(promise) { void Promise.resolve(promise).catch((error: unknown) => reportError(error, randomUUID())); },
        },
        ...(publicOrigin ? { publicOrigin } : {}),
        document: {
          // Vite's client and the unbundled global stylesheet replace the production manifest links.
          head: ({ nonce }) => `<script type="module"${nonce ? ` nonce="${escapeHtml(nonce)}"` : ""} src="/@vite/client"></script>`
            + (existsSync(globalCss) ? stylesheetLinks(["/app/styles/main.css?direct"]) : ""),
        },
      });
    };
    app = await createDevApp();
    const origin = app.publicOrigin;
    // Requests wait for a pending rebuild (`reloader`, below), so they never meet the old routes or a
    // closed module runner, and a restart waits for the requests in flight.
    const listener = toNodeListener((request) => reloader.use((running) => running.fetch(request)), { onError: reportError, ...(origin ? { publicOrigin: origin } : {}) });
    const httpServer = createServer((request, response) => {
      if (bridge?.handle(request, response)) return;
      // Vite cannot route a malformed target; the Meeko listener answers it with INVALID_URL.
      let pathname: string;
      try { pathname = new URL(request.url || "/", "http://localhost").pathname; }
      catch { listener(request, response); return; }
      // Public files of the modules, as the build writes them into the client output.
      const publicFile = modules.publicFiles.size && (request.method === "GET" || request.method === "HEAD")
        ? modules.publicFiles.get(safeDecode(pathname).replace(/^\/+/, "")) : undefined;
      if (publicFile !== undefined) {
        void publicFileContents(publicFile).then((body) => {
          response.writeHead(200, { "content-type": contentTypes[extname(pathname).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-cache" });
          response.end(request.method === "HEAD" ? undefined : body);
        }, (error: unknown) => {
          reportError(error, randomUUID());
          response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
          response.end("Internal Server Error");
        });
        return;
      }
      devServer.middlewares(request, response, () => listener(request, response));
    });
    const visibleHost = host === "0.0.0.0" ? "127.0.0.1" : host;
    const attachSocket = (running: ServerApp): ReturnType<typeof attachNodeWebSocketServer> | undefined => running.socket ? attachNodeWebSocketServer({
      server: httpServer, hub: running.socket.hub,
      publicOrigin: origin ?? `http://${visibleHost.includes(":") ? `[${visibleHost}]` : visibleHost}:${port}`,
      pathnamePrefix: running.socket.pathnamePrefix,
      ...(running.socket.maxMessageBytes === undefined ? {} : { maxMessageBytes: running.socket.maxMessageBytes }),
      onError: (error) => reportError(error, randomUUID()),
    }) : undefined;
    socketServer = attachSocket(app);
    // The app is built again from fresh discovery, on the module runner Vite has now, when
    // - a page, layout, middleware or server module is added or removed: that changes the
    //   manifest the app was created with;
    // - Vite restarts: that closes the module runner the app loads its modules through.
    // Requests wait for the new app, so the browser's full reload never meets the old routes.
    // The HTTP server, its public origin, Vite's middleware and the editor bridge stay; the
    // new app runs `server/runtime.ts` and the server modules again, so what they keep in
    // memory (sessions in a `MemorySessionStore`, caches, module state) starts empty, and
    // Socket connections close when the previous Socket server does.
    const sourceRoots = (await resolveConfigSources(root)).map((source) => source.root);
    const reloader = createDevAppReloader(app, async (prior, superseded) => {
      let next: ServerApp;
      try {
        devServer.moduleGraph.invalidateAll();
        next = await createDevApp();
      } catch (error) {
        // A broken tree (two root layouts, a bad route file) keeps the previous app until it is fixed.
        // When a restart began meanwhile, the app is built again after it, which reports what still fails.
        if (!superseded()) reportError(error, randomUUID());
        return prior;
      }
      app = next;
      const previousSocket = socketServer;
      socketServer = attachSocket(next);
      try { await previousSocket?.close(); await prior.close(); }
      catch (error) { reportError(error, randomUUID()); }
      return next;
    });
    onTreeChange = (file) => { if (isDiscoverySource(resolve(file), sourceRoots)) reloader.rebuild(); };
    onRestart = (start) => reloader.restart(start);
    await new Promise<void>((done, fail) => {
      const failed = (error: NodeJS.ErrnoException): void => fail(error.code === "EADDRINUSE" ? devPortInUse(port, host, error) : error);
      httpServer.once("error", failed);
      httpServer.listen(port, host, () => {
        httpServer.off("error", failed);
        done();
      });
    });
    // Live values for local editors, only in development and only when this server listens on loopback.
    const address = httpServer.address();
    const bridgeHost = address && typeof address !== "string" && process.env.MEEKO_EDITOR_BRIDGE !== "0" ? editorBridgeHost(address.address) : undefined;
    if (bridgeHost && address && typeof address !== "string") {
      try {
        bridge = await startEditorBridge({ root, origin: `http://${bridgeHost}:${address.port}`, hot: () => devServer.ws });
      } catch (error) {
        // The application keeps running without live values in the editor.
        process.stderr.write(`[meeko] editor bridge unavailable: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
    let stopped: Promise<void> | undefined;
    const shutdown = (): Promise<void> => {
      if (stopped) return stopped;
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      stopped = (async () => {
        const steps: Array<() => Promise<unknown>> = [
          // Its event streams would keep the HTTP server open.
          () => bridge?.close() ?? Promise.resolve(),
          () => socketServer?.close() ?? Promise.resolve(),
          () => new Promise<void>((done, fail) => httpServer.close((error) => error ? fail(error) : done())),
          async () => (await reloader.current).close(),
          () => devServer.close(),
        ];
        for (const close of steps) {
          try { await close(); }
          catch (error) { reportError(error, randomUUID()); }
        }
      })();
      return stopped;
    };
    developmentStops.set(httpServer, shutdown);
    developmentPorts.set(httpServer, { port: address && typeof address !== "string" ? address.port : port, hmrPort });
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    process.stdout.write(`http://${visibleHost.includes(":") ? `[${visibleHost}]` : visibleHost}:${port}\n`);
    return httpServer;
  } catch (error) {
    const cleanup = await Promise.allSettled([bridge?.close(), socketServer?.close(), app?.close(), vite?.close()]);
    for (const result of cleanup) {
      if (result.status === "rejected") reportError(result.reason, randomUUID());
    }
    throw error;
  }
}

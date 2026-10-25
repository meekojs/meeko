import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { ViteDevServer } from "vite";
import { escapeHtml } from "../server.js";
import { attachNodeWebSocketServer, toNodeListener } from "../node.js";
import type { ServerApp, ServerAppOptions } from "../framework-server/app.js";
import type { AssetManifest, AssetRecord } from "../framework-server/assets.js";
import { reportServerError } from "../framework-server/contracts.js";
import { buildDataFile, frameworkClientEntry, frameworkNodeEntry, frameworkServerEntry } from "./app-manifest.js";
import type { BuildAppData } from "./app-manifest.js";
import { loadMeekoConfig } from "./config.js";
import type { MeekoAdapterName } from "./config-type.js";
import { prerenderWithNodeBuild } from "./prerender.js";
import { bunEntrySource, cloudflareEntrySource, denoEntrySource } from "./adapter-templates.js";
import { cloudflareAssetsDirectory, cloudflarePrerenderDirectory, resolveWrangler, wranglerConfig, wranglerSource } from "./cloudflare-build.js";
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
  if (!adapters.includes(adapter as MeekoAdapterName)) throw new Error(`Unknown adapter ${adapter}; use node, cloudflare, deno or bun`);
  return adapter as MeekoAdapterName;
}

export interface BuildProjectOptions {
  /** Overrides `MeekoConfig.server.adapter`. */
  readonly adapter?: MeekoAdapterName;
}

export interface BuildProjectResult {
  readonly adapter: MeekoAdapterName;
  /** Directory runnable without the application's source tree. */
  readonly output: string;
}

/** Builds the client, the adapter server bundle and its prerendered pages. */
export async function buildProject(projectRoot: string, options: BuildProjectOptions = {}): Promise<BuildProjectResult> {
  const root = resolve(projectRoot);
  const config = await loadMeekoConfig(root);
  const adapter = assertBuildAdapter(options.adapter ?? config.server?.adapter ?? "node");
  assertNoLegacySessionFile(root);
  await prepareProject(root);
  const { build } = await import("vite");
  const { meeko } = await import("../vite.js");
  await build({
    root, configFile: false, plugins: [meeko()], logLevel: "warn",
    build: {
      outDir: clientOutput, manifest: true, emptyOutDir: true,
      rollupOptions: { input: frameworkClientEntry },
    },
  });
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
      outDir: nodeTarget, emptyOutDir: true,
      rollupOptions: { output: { entryFileNames: "index.mjs", chunkFileNames: "chunks/[name]-[hash].mjs" } },
    },
  });
  const outputDirectory = adapterOutput(adapter);
  const output = resolve(root, outputDirectory);
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
        outDir: outputDirectory, emptyOutDir: true,
        rollupOptions: { output: { entryFileNames: target.file, chunkFileNames: "chunks/[name]-[hash].js" } },
      },
    });
  }
  const cloudflare = config.server?.adapter === "cloudflare" ? config.server : undefined;
  if (adapter === "cloudflare") {
    // The prerendered pages share the assets directory under a reserved prefix.
    if (existsSync(resolve(root, clientOutput, "_meeko"))) throw new Error("public/_meeko is reserved for Meeko's Cloudflare output; rename it");
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
  return { adapter, output };
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
    if (!existsSync(config)) throw new Error(`Missing production build at ${config}; run meeko build --adapter cloudflare`);
    const wrangler = resolveWrangler(root);
    if (!wrangler) throw new Error("Wrangler is not installed; add it with pnpm add -D wrangler to preview the cloudflare build");
    // wrangler dev runs the bundled Worker in workerd with local bindings.
    command = process.execPath;
    args = [wrangler, "dev", "--config", config,
      ...(process.env.PORT ? ["--port", process.env.PORT] : []), ...(process.env.HOST ? ["--ip", process.env.HOST] : [])];
    runtime = { name: "Wrangler", install: "https://developers.cloudflare.com/workers/wrangler/install-and-update/" };
  } else {
    const entry = resolve(root, adapterEntry(target));
    if (!existsSync(entry)) throw new Error(`Missing production build at ${entry}; run meeko build --adapter ${target}`);
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
          ? new Error(`${runtime.name} is not installed or not on PATH; install it from ${runtime.install} to preview the ${target} build`)
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

/** Starts the package-owned Node 24 HTTP host for development or the built Node output. */
export async function startProject(projectRoot: string, production: boolean): Promise<Server> {
  const root = resolve(projectRoot);
  if (production) {
    const entry = resolve(root, nodeOutput, "index.mjs");
    if (!existsSync(entry)) throw new Error(`Missing production build at ${entry}; run meeko build`);
    const output = await import(pathToFileURL(entry).href) as Partial<NodeStartModule>;
    if (typeof output.start !== "function") throw new Error(`${entry} is not a Meeko Node build; run meeko build`);
    return (await output.start()).server;
  }
  return startDevelopment(root);
}

async function startDevelopment(root: string): Promise<Server> {
  assertNoLegacySessionFile(root);
  const config = await loadMeekoConfig(root);
  const server = config.server?.adapter === "node" ? config.server : undefined;
  const port = Number(process.env.PORT || server?.port || 4173);
  const host = process.env.HOST || server?.host || "127.0.0.1";
  await prepareProject(root);
  let vite: ViteDevServer | undefined;
  let app: ServerApp | undefined;
  let socketServer: ReturnType<typeof attachNodeWebSocketServer> | undefined;
  const reportError = (error: unknown, requestId: string): void => {
    if (app) { app.reportError(error, requestId); return; }
    reportServerError(error, requestId, (failure, id) => {
      process.stderr.write(`[meeko] request error ${id} (${failure instanceof Error ? failure.name : "UnknownError"})\n`);
      console.error(failure);
    });
  };
  try {
    const { createServer: createViteServer } = await import("vite");
    const { meeko } = await import("../vite.js");
    vite = await createViteServer({
      root, configFile: false, plugins: [meeko()],
      server: {
        middlewareMode: true,
        // Middleware mode opens a separate Vite WebSocket server. Derive its
        // port from the app port so concurrent projects do not share 24678.
        hmr: { host: "127.0.0.1", port: process.env.MEEKO_HMR_PORT
          ? Number(process.env.MEEKO_HMR_PORT)
          : ((port + 32767) % 65535) + 1 },
      },
      appType: "custom",
    });
    const globalCss = resolve(root, "app/styles/main.css");
    const entry = await vite.ssrLoadModule(`/${frameworkServerEntry}`) as { createApp(options: Omit<ServerAppOptions, "manifest" | "load" | "runtime">): Promise<ServerApp> };
    const publicOrigin = process.env.PUBLIC_ORIGIN || undefined;
    app = await entry.createApp({
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
    const running = app;
    const origin = running.publicOrigin;
    const listener = toNodeListener((request) => running.fetch(request), { onError: reportError, ...(origin ? { publicOrigin: origin } : {}) });
    const devServer = vite;
    const httpServer = createServer((request, response) => {
      // Vite cannot route a malformed target; the Meeko listener answers it with INVALID_URL.
      try { new URL(request.url || "/", "http://localhost"); }
      catch { listener(request, response); return; }
      devServer.middlewares(request, response, () => listener(request, response));
    });
    const visibleHost = host === "0.0.0.0" ? "127.0.0.1" : host;
    socketServer = running.socket ? attachNodeWebSocketServer({
      server: httpServer, hub: running.socket.hub,
      publicOrigin: origin ?? `http://${visibleHost.includes(":") ? `[${visibleHost}]` : visibleHost}:${port}`,
      pathnamePrefix: running.socket.pathnamePrefix,
      ...(running.socket.maxMessageBytes === undefined ? {} : { maxMessageBytes: running.socket.maxMessageBytes }),
      onError: (error) => reportError(error, randomUUID()),
    }) : undefined;
    await new Promise<void>((done, fail) => {
      httpServer.once("error", fail);
      httpServer.listen(port, host, () => {
        httpServer.off("error", fail);
        done();
      });
    });
    let stopping = false;
    const shutdown = () => {
      if (stopping) return;
      stopping = true;
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      void (async () => {
        const steps: Array<() => Promise<unknown>> = [
          () => socketServer?.close() ?? Promise.resolve(),
          () => new Promise<void>((done, fail) => httpServer.close((error) => error ? fail(error) : done())),
          () => running.close(),
          () => devServer.close(),
        ];
        for (const close of steps) {
          try { await close(); }
          catch (error) { reportError(error, randomUUID()); }
        }
      })();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    process.stdout.write(`http://${visibleHost.includes(":") ? `[${visibleHost}]` : visibleHost}:${port}\n`);
    return httpServer;
  } catch (error) {
    const cleanup = await Promise.allSettled([socketServer?.close(), app?.close(), vite?.close()]);
    for (const result of cleanup) {
      if (result.status === "rejected") reportError(result.reason, randomUUID());
    }
    throw error;
  }
}

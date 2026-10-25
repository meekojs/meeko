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
import { prerenderProject } from "./prerender.js";
import { clientEntrySource, nodeEntrySource, serverEntrySource } from "./project-templates.js";
import { assertNoLegacySessionFile } from "./runtime-migration.js";
import { stylesheetLinks } from "./styles.js";

export { frameworkClientEntry, frameworkServerEntry } from "./app-manifest.js";

const clientOutput = ".meeko/output/client";
const nodeOutput = ".meeko/output/node";
const adapters: readonly MeekoAdapterName[] = ["node", "cloudflare", "deno", "bun"];

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

/** Lists the public client build, which already contains Vite's copy of `public/`. */
async function assetManifest(directory: string): Promise<AssetManifest> {
  const assets: Record<string, AssetRecord> = {};
  for (const file of (await listFiles(directory)).sort()) {
    const path = relative(directory, file).split(sep);
    if (path[0] === ".vite") continue;
    const content = await readFile(file);
    const key = `/${path.map(encodeURIComponent).join("/")}`;
    assets[key] = {
      type: contentTypes[extname(file).toLowerCase()] ?? "application/octet-stream",
      etag: `"${createHash("sha256").update(content).digest("base64url").slice(0, 27)}"`,
      size: content.byteLength,
      ...(path[0] === "assets" ? { immutable: true } : {}),
    };
  }
  return assets;
}

type ViteManifest = Record<string, { file?: string; css?: string[]; imports?: string[] }>;

async function clientAssets(root: string): Promise<BuildAppData["client"]> {
  const manifest = JSON.parse(await readFile(resolve(root, clientOutput, ".vite/manifest.json"), "utf8")) as ViteManifest;
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
  return { entry: `/${entry.file}`, css: [...css].map((file) => `/${file}`), preload: [...preload].map((file) => `/${file}`) };
}

/** Validates an adapter name and confirms this version can build it. */
export function assertBuildAdapter(adapter: string): MeekoAdapterName {
  if (!adapters.includes(adapter as MeekoAdapterName)) throw new Error(`Unknown adapter ${adapter}; use node, cloudflare, deno or bun`);
  if (adapter !== "node") throw new Error(`The ${adapter} adapter cannot be built by this Meeko version; build with --adapter node`);
  return adapter;
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
  const data: BuildAppData = {
    client: await clientAssets(root),
    assets: await assetManifest(resolve(root, clientOutput)),
    node: { host: server?.host ?? "127.0.0.1", port: server?.port ?? 4173 },
  };
  await mkdir(resolve(root, ".meeko/build"), { recursive: true });
  await writeFile(resolve(root, buildDataFile), JSON.stringify(data, null, 2) + "\n", "utf8");
  const output = resolve(root, nodeOutput);
  await build({
    root, configFile: false, plugins: [meeko()], logLevel: "warn",
    ssr: { external: ["@meekojs/meeko"] },
    build: {
      ssr: frameworkNodeEntry,
      outDir: nodeOutput, emptyOutDir: true,
      rollupOptions: { output: { entryFileNames: "index.mjs", chunkFileNames: "chunks/[name]-[hash].mjs" } },
    },
  });
  await cp(resolve(root, clientOutput), join(output, "client"), {
    recursive: true,
    filter: (source) => relative(resolve(root, clientOutput), source).split(sep)[0] !== ".vite",
  });
  await prerenderProject(root);
  return { adapter, output };
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

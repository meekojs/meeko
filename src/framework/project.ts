import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { Server } from "node:http";
import type { ViteDevServer } from "vite";
import { serializeJson } from "../server.js";
import { attachNodeWebSocketServer, toNodeListener } from "../node.js";
import { errorResponse, reportServerError } from "../framework-server/contracts.js";
import { composeServerMiddleware } from "../framework-server/middleware.js";
import type { ServerMiddleware } from "../framework-server/middleware.js";
import { discoverConfiguredRoutes } from "./config.js";
import { prerenderProject } from "./prerender.js";
import { clientEntrySource, serverEntrySource } from "./project-templates.js";
import { stylesheetLinks } from "./styles.js";
import type { RouteRecord } from "./router.js";

export const frameworkClientEntry = ".meeko/generated/entry-client.ts";
export const frameworkServerEntry = ".meeko/generated/entry-server.ts";
const clientManifestFile = ".meeko/output/client/.vite/manifest.json";
const serverBundleFile = ".meeko/output/server/entry.js";

interface AppRuntime {
  readonly pageHandler: (request: Request) => Promise<Response>;
  readonly endpointHandler: (request: Request) => Promise<Response>;
  readonly socketHub: Parameters<typeof attachNodeWebSocketServer>[0]["hub"];
  readonly sessions: { close(): Promise<void> };
  readonly manifest: { readonly socket?: readonly unknown[] };
  readonly serverMiddleware: readonly ServerMiddleware[];
}

interface AppEntry {
  createAppRuntime(
    root: string,
    routes: readonly RouteRecord[],
    clientEntry: string,
    production: boolean,
    loadDevModule?: (file: string) => Promise<Record<string, unknown>>,
  ): Promise<AppRuntime>;
}

/** Writes framework-owned Vite entries; no application file is overwritten. */
export async function prepareProject(projectRoot: string): Promise<void> {
  const root = resolve(projectRoot);
  const generated = resolve(root, ".meeko/generated");
  await mkdir(generated, { recursive: true });
  await Promise.all([
    writeFile(resolve(root, frameworkClientEntry), clientEntrySource, "utf8"),
    writeFile(resolve(root, frameworkServerEntry), serverEntrySource, "utf8"),
  ]);
}

/** Builds both Vite targets and prerenders routes with the same generated entries. */
export async function buildProject(projectRoot: string): Promise<void> {
  const root = resolve(projectRoot);
  await prepareProject(root);
  const { build } = await import("vite");
  const { meeko } = await import("../vite.js");
  await build({
    root, configFile: false, plugins: [meeko()],
    build: {
      outDir: ".meeko/output/client", manifest: true,
      rollupOptions: { input: frameworkClientEntry },
    },
  });
  await build({
    root, configFile: false, plugins: [meeko()],
    ssr: { external: ["@meekojs/meeko"] },
    build: {
      ssr: frameworkServerEntry,
      outDir: ".meeko/output/server",
      rollupOptions: { output: { entryFileNames: "entry.js" } },
    },
  });
  await prerenderProject(root);
}

function portableRoutes(root: string, routes: readonly RouteRecord[]): unknown[] {
  const relativeFile = (file: string): string => {
    const path = relative(root, file);
    if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path) || resolve(file) === root) {
      throw new Error(`Route file escaped project: ${file}`);
    }
    return "/" + path.replaceAll("\\", "/");
  };
  return routes.map((route) => ({
    id: route.id,
    file: relativeFile(route.file),
    layouts: route.layouts.map(relativeFile),
    ...(route.error ? { error: relativeFile(route.error) } : {}),
  }));
}

async function readAsset(assetRoot: string, pathname: string): Promise<{ status: number; body?: Buffer } | null> {
  const file = resolve(assetRoot, "." + pathname);
  if (!file.startsWith(assetRoot + sep)) return { status: 403 };
  let actual: string;
  try { actual = await realpath(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const actualRoot = await realpath(assetRoot);
  if (!actual.startsWith(actualRoot + sep)) return { status: 403 };
  return { status: 200, body: await readFile(actual) };
}

/** Starts the package-owned Node 24 HTTP host for development or production. */
export async function startProject(projectRoot: string, production: boolean): Promise<Server> {
  const root = resolve(projectRoot);
  const port = Number(process.env.PORT || 4173);
  if (!production) await prepareProject(root);
  let vite: ViteDevServer | undefined;
  let runtime: AppRuntime | undefined;
  let socketServer: ReturnType<typeof attachNodeWebSocketServer> | undefined;
  const reportError = (error: unknown, requestId: string): void => {
    reportServerError(error, requestId, (failure, id) => {
      process.stderr.write(`[meeko] request error ${id} (${failure instanceof Error ? failure.name : "UnknownError"})\n`);
      if (!production) console.error(failure);
    });
  };
  try {
    if (!production) {
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
    }
    const clientRoot = resolve(root, ".meeko/output/client");
    const publicRoot = resolve(root, "public");
    const routes = await discoverConfiguredRoutes(root);
    let clientEntry = "/" + frameworkClientEntry;
    let productionStyles = "";
    if (production) {
      const manifest = JSON.parse(await readFile(resolve(root, clientManifestFile), "utf8")) as Record<string, { file?: string; css?: string[] }>;
      const entry = manifest[frameworkClientEntry];
      if (!entry?.file) throw new Error(`Missing ${frameworkClientEntry} in Vite client manifest`);
      clientEntry = "/" + entry.file;
      productionStyles = stylesheetLinks((entry.css ?? []).map((file) => "/" + file));
    }
    const globalCss = resolve(root, "app/styles/main.css");
    const serverEntry = production
      ? await import(pathToFileURL(resolve(root, serverBundleFile)).href) as AppEntry
      : await vite!.ssrLoadModule("/" + frameworkServerEntry) as AppEntry;
    const loadDevModule = vite
      ? (file: string) => vite!.ssrLoadModule("/" + relative(root, file).replaceAll("\\", "/")) as Promise<Record<string, unknown>>
      : undefined;
    const appRuntime = await serverEntry.createAppRuntime(root, routes, clientEntry, production, loadDevModule);
    runtime = appRuntime;
    const portable = portableRoutes(root, routes);
    const decorated = composeServerMiddleware(appRuntime.serverMiddleware, async (request: Request): Promise<Response> => {
      const pathname = new URL(request.url).pathname;
      if (pathname.startsWith("/api/") || pathname.startsWith("/_meeko/rpc/")) return appRuntime.endpointHandler(request);
      const result = await appRuntime.pageHandler(request);
      if (result.status !== 200 || !(result.headers.get("content-type") ?? "").includes("text/html")) return result;
      const developmentStyles = !production && (await stat(globalCss).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      }))?.isFile() ? stylesheetLinks(["/app/styles/main.css?direct"]) : "";
      let html = (await result.text())
        .replace("</head>", `${production ? productionStyles : developmentStyles}</head>`)
        .replace("</body>", `<script id="meeko-routes" type="application/json">${serializeJson(portable)}</script></body>`);
      if (vite) html = await vite.transformIndexHtml(pathname, html);
      return new Response(request.method === "HEAD" ? null : html, { status: result.status, headers: result.headers });
    });
    const pageListener = toNodeListener(decorated, { onError: reportError });
    const types: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
    const server = createServer((request, response) => {
      let pathname: string;
      try { pathname = new URL(request.url || "/", "http://localhost").pathname; }
      catch { pageListener(request, response); return; }
      if (production && /\.[a-z0-9]+$/i.test(pathname)) {
        void (async () => {
          const asset = await readAsset(clientRoot, pathname) ?? await readAsset(publicRoot, pathname);
          if (!asset || asset.status !== 200) { response.writeHead(asset?.status ?? 404); response.end(); return; }
          response.writeHead(200, { "content-type": types[extname(pathname)] || "application/octet-stream" });
          response.end(asset.body);
        })().catch(async (error: unknown) => {
          const requestId = randomUUID();
          reportError(error, requestId);
          const destroySafely = (cause: unknown, previous?: unknown): void => {
            try { response.destroy(cause instanceof Error ? cause : undefined); }
            catch (destroyError) {
              if (!Object.is(destroyError, error) && !Object.is(destroyError, cause) && !Object.is(destroyError, previous)) {
                reportError(destroyError, requestId);
              }
            }
          };
          try {
            if (response.headersSent) { destroySafely(error); return; }
            const failure = errorResponse(error, requestId);
            const failureHeaders: Record<string, string | string[]> = {};
            failure.headers.forEach((value, name) => { failureHeaders[name] = value; });
            const cookies = failure.headers.getSetCookie();
            if (cookies.length) failureHeaders["set-cookie"] = cookies;
            response.writeHead(failure.status, failureHeaders);
            response.end(await failure.text());
          } catch (failure) {
            if (!Object.is(failure, error)) reportError(failure, requestId);
            destroySafely(failure, error);
          }
        });
        return;
      }
      if (vite) {
        vite.middlewares(request, response, () => pageListener(request, response));
        return;
      }
      pageListener(request, response);
    });
    socketServer = appRuntime.manifest.socket?.length ? attachNodeWebSocketServer({
      server, hub: appRuntime.socketHub,
      publicOrigin: process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}`,
      onError: (error) => reportError(error, randomUUID()),
    }) : undefined;
    await new Promise<void>((done, fail) => {
      server.once("error", fail);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", fail);
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
          () => new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done())),
          () => appRuntime.sessions.close(),
          () => vite?.close() ?? Promise.resolve(),
        ];
        for (const close of steps) {
          try { await close(); }
          catch (error) { reportError(error, randomUUID()); }
        }
      })();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    process.stdout.write(`http://127.0.0.1:${port}\n`);
    return server;
  } catch (error) {
    const cleanup = await Promise.allSettled([socketServer?.close(), runtime?.sessions.close(), vite?.close()]);
    for (const result of cleanup) {
      if (result.status === "rejected") reportError(result.reason, randomUUID());
    }
    throw error;
  }
}

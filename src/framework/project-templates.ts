/** Vite entry modules generated for a framework application. */
export const clientEntrySource = `import { mountClientApp, type ClientComponent, type RouteMiddleware } from "@meekojs/meeko/framework";
import { modules as pages } from "virtual:meeko-client-pages";
import { routes } from "virtual:meeko-manifest/client";

const middlewareModules = import.meta.glob(["/app/middleware/**/*.ts", "!/app/middleware/**/*.test.ts", "!/app/middleware/**/*.spec.ts", "!/app/middleware/**/*.d.ts", "!/app/middleware/**/*.server.ts", "!/app/middleware/**/*.client.ts"], { eager: true });
const loadMiddleware = async (): Promise<RouteMiddleware[]> => Object.entries(middlewareModules)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([file, module]) => {
    const middleware = (module as { default?: unknown }).default;
    if (typeof middleware !== "function") throw new Error(file + ": route middleware requires a default function export");
    return middleware as RouteMiddleware;
  });

// Optional global stylesheet. Vite includes it in the client bundle when present.
import.meta.glob("/app/styles/main.css", { eager: true });

const root = document.getElementById("app");
const payload = document.getElementById("meeko-payload")?.textContent;
if (!root || !payload) throw new Error("Missing Meeko SSR data");

const hydrationStart = performance.now();
await mountClientApp({
  root, payload, routes, serverData: true, loadMiddleware,
  async loadPage(file) {
    const load = pages[file];
    if (!load) throw new Error("Page module missing: " + file);
    return await load() as ClientComponent;
  },
});
performance.measure("meeko-hydration", { start: hydrationStart, end: performance.now() });
`;

/** Adapter-neutral application entry: the baked manifest plus its module map. */
export const serverEntrySource = `import { createServerApp, type ServerApp, type ServerAppOptions } from "@meekojs/meeko/server";
import { load, manifest, runtime } from "virtual:meeko-server-app";

export { load, manifest };

export type AppHostOptions = Omit<ServerAppOptions, "manifest" | "load" | "runtime">;

export function createApp(options: AppHostOptions): Promise<ServerApp> {
  return createServerApp({ ...options, manifest, load, runtime });
}
`;

/** Node adapter entry; \`meeko build\` bundles it to .meeko/output/node/index.mjs. */
export const nodeEntrySource = `import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createNodeAssetReader, serveNode } from "@meekojs/meeko/node";
import type { PrerenderSource, PrerenderedPage } from "@meekojs/meeko/server";
import { nodeServer } from "virtual:meeko-server-app";
import { createApp, load, manifest } from "./entry-server.ts";

export { load, manifest };

const output = dirname(fileURLToPath(import.meta.url));

interface PrerenderIndex { readonly pages?: Record<string, { file: string; headOffset: number; etag: string; payload?: string }> }

async function prerenderSource(): Promise<PrerenderSource | undefined> {
  let index: PrerenderIndex;
  try { index = JSON.parse(await readFile(join(output, "prerender", "manifest.json"), "utf8")) as PrerenderIndex; }
  catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return undefined;
    throw error;
  }
  const pages = index.pages ?? {};
  const cache = new Map<string, Promise<PrerenderedPage>>();
  const read = (file: string) => readFile(join(output, "prerender", ...file.split("/")), "utf8");
  return {
    get(pathname) {
      if (!Object.hasOwn(pages, pathname)) return Promise.resolve(undefined);
      const cached = cache.get(pathname);
      if (cached) return cached;
      const entry = pages[pathname]!;
      const page = (async () => {
        const html = await read(entry.file);
        const payload = entry.payload ? await read(entry.payload) : undefined;
        return { html, headOffset: entry.headOffset, etag: entry.etag, ...(payload === undefined ? {} : { payload }) };
      })();
      cache.set(pathname, page);
      // A failed read is retried by the next request instead of being cached.
      page.catch(() => { if (cache.get(pathname) === page) cache.delete(pathname); });
      return page;
    },
  };
}

/** Creates the built application; \`prerendering\` is used by \`meeko build\`. */
export async function createNodeApp(options: { readonly prerendering?: boolean } = {}) {
  const prerender = options.prerendering ? undefined : await prerenderSource();
  return createApp({
    production: true,
    prerendering: options.prerendering === true,
    platform: {
      name: "node",
      env: process.env,
      // createServerApp tracks these tasks for close() and reports their failures.
      waitUntil() {},
    },
    assets: createNodeAssetReader({ root: join(output, "client"), assets: manifest.assets ?? {} }),
    ...(prerender ? { prerender } : {}),
    ...(process.env.PUBLIC_ORIGIN ? { publicOrigin: process.env.PUBLIC_ORIGIN } : {}),
  });
}

/** Serves the built application; HOST, PORT and PUBLIC_ORIGIN override the build configuration. */
export async function start() {
  const app = await createNodeApp();
  const server = await serveNode(app, {
    host: process.env.HOST || nodeServer.host,
    port: process.env.PORT ? Number(process.env.PORT) : nodeServer.port,
    handleSignals: true,
  });
  process.stdout.write(server.url + "\\n");
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await start();
`;

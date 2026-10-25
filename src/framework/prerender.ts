import { createHash } from "node:crypto";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { renderPage } from "../framework-server/app.js";
import type { InternalServerApp, ServerApp } from "../framework-server/app.js";
import { serializeJson } from "../server.js";
import { href, matchRoute } from "./router.js";
import type { RouteRecord } from "./router.js";
import { DOCUMENT_HEAD_PREFIX } from "./server.js";
import type { PageRoute } from "./server.js";

export interface PrerenderOptions {
  readonly routes: readonly RouteRecord[];
  /** Renders one page; it should not run server middleware, which runs again when the page is served. */
  readonly handler: (request: Request) => Promise<Response>;
  readonly loadRoute?: (file: string) => Promise<PageRoute>;
  readonly outputRoot: string;
  readonly origin?: string;
  readonly transformHtml?: (html: string) => string | Promise<string>;
}

/** Index written next to prerendered HTML and read by adapters at startup. */
export interface PrerenderIndex {
  readonly version: 1;
  readonly pages: Readonly<Record<string, { readonly file: string; readonly headOffset: number; readonly etag: string; readonly payload?: string }>>;
}

function hasParams(id: string): boolean {
  return /\[(?:\.\.\.)?[A-Za-z_$][\w$]*\]/.test(id);
}

function contentTag(value: string): string {
  return `"${createHash("sha256").update(value).digest("base64url").slice(0, 27)}"`;
}

/** Finds where the per-request CSRF meta tag belongs inside a stored document. */
function headOffset(pathname: string, html: string): number {
  if (html.startsWith(DOCUMENT_HEAD_PREFIX)) return DOCUMENT_HEAD_PREFIX.length;
  const close = html.search(/<\/head>/i);
  if (close < 0) throw new Error(`Prerendered ${pathname} has no <head>; the CSRF token cannot be inserted`);
  return close;
}

/** Writes only fully resolved, successful HTML responses to the prerender output. */
export async function prerenderRoutes(options: PrerenderOptions): Promise<string[]> {
  const outputRoot = resolve(options.outputRoot);
  const origin = options.origin ?? "http://meeko.local";
  const urls = new Map<string, string>();
  for (const route of options.routes) {
    const sidecar = route.sidecar && options.loadRoute ? await options.loadRoute(route.sidecar) : undefined;
    const render = route.render ?? sidecar?.render;
    if (render === "client" && sidecar?.prerenderEntries !== undefined) {
      throw new Error(`Route ${route.id} uses render: "client" and cannot be prerendered; remove prerenderEntries or use render: "prerender"`);
    }
    if (render !== "prerender") continue;
    const dynamic = hasParams(route.id);
    const entries = dynamic
      ? typeof sidecar?.prerenderEntries === "function" ? await sidecar.prerenderEntries() : sidecar?.prerenderEntries
      : [{}];
    if (!entries?.length) throw new Error(`Dynamic prerender route ${route.id} requires prerenderEntries`);
    for (const params of entries) {
      const pathname = href(options.routes, route.id, { params });
      if (matchRoute(options.routes, pathname)?.route !== route) {
        throw new Error(`Prerender URL ${pathname} is shadowed by another route`);
      }
      const previous = urls.get(pathname);
      if (previous) throw new Error(`Duplicate prerender URL ${pathname}: ${previous} and ${route.file}`);
      urls.set(pathname, route.file);
    }
  }
  const outputs: string[] = [];
  const pages: Record<string, PrerenderIndex["pages"][string]> = {};
  await mkdir(outputRoot, { recursive: true });
  for (const pathname of urls.keys()) {
    const response = await options.handler(new Request(new URL(pathname, origin)));
    if (response.status !== 200 || !(response.headers.get("content-type") ?? "").includes("text/html")) {
      throw new Error(`Prerender ${pathname} returned HTTP ${response.status} instead of HTML 200`);
    }
    const parts = pathname.split("/").filter(Boolean);
    const output = resolve(outputRoot, ...parts, "index.html");
    if (!output.startsWith(outputRoot + sep)) throw new Error(`Prerender path escaped output: ${pathname}`);
    await mkdir(resolve(output, ".."), { recursive: true });
    const rendered = await response.text();
    const html = options.transformHtml ? await options.transformHtml(rendered) : rendered;
    await writeFile(output, html, "utf8");
    outputs.push(output);
    const file = [...parts, "index.html"].join("/");
    const navigation = await options.handler(new Request(new URL(pathname, origin), { headers: { accept: "application/meeko+json" } }));
    let payload: string | undefined;
    if (navigation.status === 200 && (navigation.headers.get("content-type") ?? "").startsWith("application/meeko+json")) {
      payload = [...parts, "index.meeko.json"].join("/");
      await writeFile(resolve(outputRoot, ...parts, "index.meeko.json"), await navigation.text(), "utf8");
    } else await navigation.body?.cancel();
    pages[pathname] = { file, headOffset: headOffset(pathname, html), etag: contentTag(html), ...(payload ? { payload } : {}) };
  }
  const index: PrerenderIndex = { version: 1, pages };
  await writeFile(join(outputRoot, "manifest.json"), serializeJson(index) + "\n", "utf8");
  return outputs;
}

interface NodeOutputModule {
  createNodeApp(options: { prerendering: boolean }): Promise<ServerApp>;
  load(key: string): Promise<unknown>;
}

/** Imports the built Node application without serving it. */
export async function importNodeOutput(projectRoot: string, server = ".meeko/output/node/index.mjs"): Promise<NodeOutputModule> {
  const entry = resolve(projectRoot, server);
  try { await access(entry); }
  catch { throw new Error(`Missing production build at ${entry}; run meeko build`); }
  // A query keeps repeated builds in one process from reusing a cached entry.
  const output = await import(`${pathToFileURL(entry).href}?build=${Date.now()}`) as Partial<NodeOutputModule>;
  if (typeof output.createNodeApp !== "function" || typeof output.load !== "function") {
    throw new Error(`${entry} is not a Meeko Node build; run meeko build`);
  }
  return output as NodeOutputModule;
}

/** Renders `render: "prerender"` routes from the Node build into .meeko/output/node/prerender. */
export async function prerenderProject(projectRoot: string): Promise<string[]> {
  return prerenderWithNodeBuild(projectRoot, ".meeko/output/node/index.mjs", ".meeko/output/node/prerender");
}

/** Renders prerendered routes with a built Node server into an adapter's output directory. */
export async function prerenderWithNodeBuild(projectRoot: string, server: string, prerenderOutput: string): Promise<string[]> {
  const root = resolve(projectRoot);
  const output = await importNodeOutput(root, server);
  const app = await output.createNodeApp({ prerendering: true }) as InternalServerApp;
  const outputRoot = resolve(root, prerenderOutput);
  try {
    await rm(outputRoot, { recursive: true, force: true });
    return await prerenderRoutes({
      routes: app.manifest.routes,
      handler: (request) => app[renderPage](request),
      loadRoute: async (key) => {
        const module = await output.load(key) as Record<string, unknown>;
        return (module.route ?? module.default ?? module) as PageRoute;
      },
      outputRoot,
    });
  } finally {
    await app.close();
  }
}

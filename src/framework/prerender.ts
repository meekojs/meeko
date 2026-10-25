import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { serializeJson } from "../server.js";
import { href, matchRoute } from "./router.js";
import type { RouteRecord } from "./router.js";
import { createFrameworkHandler } from "./server.js";
import { discoverConfiguredRoutes } from "./config.js";
import { stylesheetLinks } from "./styles.js";
import type { PageModule, PageRoute } from "./server.js";

export interface PrerenderOptions {
  readonly routes: readonly RouteRecord[];
  readonly handler: (request: Request) => Promise<Response>;
  readonly loadRoute?: (file: string) => Promise<PageRoute>;
  readonly outputRoot: string;
  readonly origin?: string;
  readonly transformHtml?: (html: string) => string | Promise<string>;
}

function hasParams(id: string): boolean {
  return /\[(?:\.\.\.)?[A-Za-z_$][\w$]*\]/.test(id);
}

/** Writes only fully resolved, successful HTML responses to the prerender output. */
export async function prerenderRoutes(options: PrerenderOptions): Promise<string[]> {
  const outputRoot = resolve(options.outputRoot);
  const origin = options.origin ?? "http://meeko.local";
  const urls = new Map<string, string>();
  for (const route of options.routes) {
    const sidecar = route.sidecar && options.loadRoute ? await options.loadRoute(route.sidecar) : undefined;
    if (sidecar?.render !== "prerender") continue;
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
  await mkdir(outputRoot, { recursive: true });
  for (const pathname of urls.keys()) {
    const request = new Request(new URL(pathname, origin));
    const response = await options.handler(request);
    if (response.status !== 200 || !(response.headers.get("content-type") ?? "").includes("text/html")) {
      throw new Error(`Prerender ${pathname} returned HTTP ${response.status} instead of HTML 200`);
    }
    const parts = pathname.split("/").filter(Boolean);
    const output = resolve(outputRoot, ...parts, "index.html");
    if (!output.startsWith(outputRoot + sep)) throw new Error(`Prerender path escaped output: ${pathname}`);
    await mkdir(resolve(output, ".."), { recursive: true });
    const html = await response.text();
    await writeFile(output, options.transformHtml ? await options.transformHtml(html) : html, "utf8");
    outputs.push(output);
  }
  await writeFile(join(outputRoot, "manifest.json"), serializeJson({ paths: [...urls.keys()] }) + "\n", "utf8");
  return outputs;
}

/** Renders from the production server bundle and client manifest. */
export async function prerenderProject(projectRoot: string): Promise<string[]> {
  const root = resolve(projectRoot);
  const manifestFile = resolve(root, ".meeko/output/client/.vite/manifest.json");
  let manifest: Record<string, { file?: string; css?: string[] }>;
  try {
    manifest = JSON.parse(await readFile(manifestFile, "utf8")) as Record<string, { file?: string }>;
  } catch {
    throw new Error("Client build manifest is missing; run the client build before prerender");
  }
  const entry = manifest[".meeko/generated/entry-client.ts"]?.file
    ?? manifest["app/entry-client.ts"]?.file;
  if (!entry) throw new Error("Client build manifest has no Meeko client entry");
  const entryManifest = manifest[".meeko/generated/entry-client.ts"] ?? manifest["app/entry-client.ts"];
  const globalStyles = stylesheetLinks((entryManifest?.css ?? []).map((file) => "/" + file));
  const serverBundle = resolve(root, ".meeko/output/server/entry.js");
  let server: {
    loadPage(root: string, file: string): Promise<PageModule>;
    loadRoute(root: string, file: string): Promise<PageRoute>;
  };
  try {
    server = await import(pathToFileURL(serverBundle).href) as typeof server;
  } catch (error) {
    throw new Error(`Cannot load the server build at ${serverBundle}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (typeof server.loadPage !== "function" || typeof server.loadRoute !== "function") {
    throw new Error("Server build does not expose the Meeko prerender loaders");
  }
  const routes = await discoverConfiguredRoutes(root);
  const loadPage = (file: string) => server.loadPage(root, file);
  const loadRoute = (file: string) => server.loadRoute(root, file);
  const handler = createFrameworkHandler({ routes, loadPage, loadRoute, clientEntry: `/${entry}` });
  const portable = routes.map((route) => ({
    id: route.id,
    file: "/" + fileRelative(root, route.file),
    layouts: route.layouts.map((file) => "/" + fileRelative(root, file)),
    ...(route.error ? { error: "/" + fileRelative(root, route.error) } : {}),
  }));
  return await prerenderRoutes({
    routes, handler, loadRoute,
    outputRoot: resolve(root, ".meeko/output/prerender"),
    transformHtml: (html) => html
      .replace("</head>", `${globalStyles}</head>`)
      .replace("</body>", `<script id="meeko-routes" type="application/json">${serializeJson(portable)}</script></body>`),
  });
}

function fileRelative(root: string, file: string): string {
  const absolute = resolve(file);
  if (!absolute.startsWith(root + sep)) throw new Error(`Route file escaped project: ${file}`);
  return absolute.slice(root.length + 1).replaceAll("\\", "/");
}

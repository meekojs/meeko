import { createHash } from "node:crypto";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import { renderPage } from "../framework-server/app.js";
import type { InternalServerApp, ServerApp } from "../framework-server/app.js";
import { serializeJson } from "../server.js";
import { href, matchRoute } from "./router.js";
import type { RouteRecord } from "./router.js";
import { DOCUMENT_HEAD_PREFIX } from "./server.js";
import { loadConfiguredModules } from "./config.js";
import type { PageRoute } from "./server.js";
import { inlineScriptHashes, inlineStyleHashes } from "./script-hashes.js";

/**
 * Opciones de {@link prerenderRoutes}.
 *
 * @example
 * ```ts
 * import { prerenderRoutes } from "@meekojs/meeko/build";
 * import type { PrerenderOptions } from "@meekojs/meeko/build";
 *
 * const options: PrerenderOptions = {
 *   routes,
 *   handler: (request) => handler(request),
 *   loadRoute: (file) => import(file).then((module) => module.route),
 *   outputRoot: "dist/prerender",
 *   origin: "https://example.com",
 * };
 * await prerenderRoutes(options);
 * ```
 */
export interface PrerenderOptions {
  /** Manifiesto de rutas; sólo se renderizan las `render: "prerender"`. */
  readonly routes: readonly RouteRecord[];
  /** Renderiza una página. No debe ejecutar el middleware de servidor, que vuelve a ejecutarse al servirla. */
  readonly handler: (request: Request) => Promise<Response>;
  /** Carga las opciones de ruta de un sidecar, para leer `render` y `prerenderEntries`. */
  readonly loadRoute?: (file: string) => Promise<PageRoute>;
  /** Carpeta de salida del HTML, los payloads y `manifest.json`. */
  readonly outputRoot: string;
  /** Origen de las peticiones de render; por defecto, `http://meeko.local`. */
  readonly origin?: string;
  /** Transforma el HTML antes de guardarlo. */
  readonly transformHtml?: (html: string) => string | Promise<string>;
  /**
   * Recibe las URL (`pathname`) que se van a prerenderizar y puede añadir o quitar entradas; cada URL
   * que añade debe corresponder a una ruta. `meeko build` lo usa para el hook `prerender:routes`.
   * @since 1.2.0
   */
  readonly extendUrls?: (urls: string[]) => void | Promise<void>;
}

/**
 * Índice `manifest.json` que se escribe junto al HTML prerenderizado y que leen los adaptadores al
 * arrancar. `headOffset` se mide en unidades de código UTF-16 del HTML leído como texto, no en bytes.
 *
 * @example
 * ```ts
 * import { readFile } from "node:fs/promises";
 * import type { PrerenderIndex } from "@meekojs/meeko/build";
 *
 * const index = JSON.parse(await readFile(".meeko/output/node/prerender/manifest.json", "utf8")) as PrerenderIndex;
 * const home = index.pages["/"];
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#routing-layouts-y-ssr
 */
export interface PrerenderIndex {
  /** Versión del formato. */
  readonly version: 1;
  /**
   * Páginas por ruta: archivo HTML, posición donde se inserta la meta CSRF, `ETag`, si existe, el
   * payload de navegación `index.meeko.json` y, desde `1.3`, `scriptHashes`: las fuentes CSP
   * `'sha256-…'` de los scripts en línea que ejecuta la página (véase `inlineScriptHashes`), para
   * construir su `Content-Security-Policy` con `contentSecurityPolicy`. Un índice escrito por una
   * versión anterior no tiene `scriptHashes`. Desde `1.4`, `styleHashes` hace lo mismo con los
   * `<style>` en línea (véase `inlineStyleHashes`), como el del tema de `<MeekoThemeToggle>`.
   */
  readonly pages: Readonly<Record<string, {
    readonly file: string;
    readonly headOffset: number;
    readonly etag: string;
    readonly payload?: string;
    readonly scriptHashes?: readonly string[];
    readonly styleHashes?: readonly string[];
  }>>;
}

function hasParams(id: string): boolean {
  return /\[(?:\.\.\.)?[A-Za-z_$][\w$]*\]/.test(id);
}

function contentTag(value: string): string {
  return `"${createHash("sha256").update(value).digest("base64url").slice(0, 27)}"`;
}

/**
 * The start of a Meeko document: `<html>` with its escaped attributes, the charset and the
 * default viewport and icon tags that the application did not replace.
 */
const documentStart = /^<!doctype html><html(?: [^>]*)?><head><meta charset="utf-8">(?:<meta name="viewport" content="width=device-width,initial-scale=1">)?(?:<link rel="icon" href="data:,">)?/;

/** Finds where the per-request CSRF meta tag belongs inside a stored document. */
function headOffset(pathname: string, html: string): number {
  if (html.startsWith(DOCUMENT_HEAD_PREFIX)) return DOCUMENT_HEAD_PREFIX.length;
  const start = documentStart.exec(html);
  if (start) return start[0].length;
  const close = html.search(/<\/head>/i);
  if (close < 0) throw new Error(`Prerendered ${pathname} has no <head>; the CSRF token cannot be inserted`);
  return close;
}

/**
 * An error with its stack and the chain of its `cause`s, for a build failure that the developer
 * reads locally; the production runtime never prints this.
 */
function describeFailure(error: unknown): string {
  const lines: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 16 && !seen.has(current); depth++) {
    seen.add(current);
    if (!(current instanceof Error)) {
      let text: string;
      try { text = typeof current === "string" ? current : inspect(current, { depth: 2 }); }
      catch { text = typeof current; }
      lines.push(depth === 0 ? text : `Caused by: ${text}`);
      break;
    }
    const frames = (current.stack ?? "").split("\n").filter((line) => /^\s+at /.test(line));
    lines.push(`${depth === 0 ? "" : "Caused by: "}${current.name}: ${current.message}`, ...frames);
    if (current.cause === undefined) break;
    current = current.cause;
  }
  return lines.join("\n");
}

/** The navigation payload embedded in a Meeko document; `serializeJson` escapes every `<` inside it. */
const embeddedPayload = /<script id="meeko-payload" type="application\/json">([^<]*)<\/script>/;

/**
 * Prerenderiza las rutas `render: "prerender"`: genera sus URL (con `prerenderEntries` en las
 * dinámicas), las pide a `handler` y escribe sólo respuestas HTML `200` completas, con su payload de
 * navegación y el índice `manifest.json`.
 *
 * @param options Rutas, handler y carpeta de salida.
 * @returns Las rutas absolutas de los archivos HTML escritos.
 * @throws {Error} Si una ruta dinámica no tiene `prerenderEntries`, una URL se repite o la tapa otra
 * ruta, una página no responde HTML `200` o una ruta `render: "client"` declara `prerenderEntries`.
 * Si `handler` rechaza, el mensaje incluye la URL, el archivo de la ruta, el error con su pila y la
 * cadena de `cause`, y el error original queda en `cause`.
 * @example
 * ```ts
 * import { discoverRoutes, prerenderRoutes } from "@meekojs/meeko/build";
 *
 * const files = await prerenderRoutes({
 *   routes: await discoverRoutes(process.cwd()),
 *   handler: (request) => app.fetch(request),
 *   outputRoot: "dist/prerender",
 * });
 * ```
 */
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
  let pathnames = [...urls.keys()];
  if (options.extendUrls) {
    const extended = [...pathnames];
    await options.extendUrls(extended);
    for (const pathname of extended) {
      if (typeof pathname !== "string" || !pathname.startsWith("/")) throw new Error(`Invalid prerender URL ${String(pathname)}: use a pathname that starts with /`);
      if (!urls.has(pathname) && !matchRoute(options.routes, pathname)) throw new Error(`Prerender URL ${pathname} matches no route`);
    }
    pathnames = [...new Set(extended)];
  }
  const outputs: string[] = [];
  const pages: Record<string, PrerenderIndex["pages"][string]> = {};
  await mkdir(outputRoot, { recursive: true });
  const render = async (pathname: string, init?: RequestInit): Promise<Response> => {
    try { return await options.handler(new Request(new URL(pathname, origin), init)); }
    catch (error) {
      const file = urls.get(pathname) ?? matchRoute(options.routes, pathname)?.route.file;
      throw new Error(`Prerender ${pathname}${file ? ` (${file})` : ""} failed: ${describeFailure(error)}`, { cause: error });
    }
  };
  for (const pathname of pathnames) {
    const response = await render(pathname);
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
    // The payload of the stored document comes from the same loader run as its
    // HTML; only a document without one asks the handler a second time.
    let navigationPayload = rendered.match(embeddedPayload)?.[1];
    if (navigationPayload === undefined) {
      const navigation = await render(pathname, { headers: { accept: "application/meeko+json" } });
      if (navigation.status === 200 && (navigation.headers.get("content-type") ?? "").startsWith("application/meeko+json")) navigationPayload = await navigation.text();
      else await navigation.body?.cancel();
    }
    let payload: string | undefined;
    if (navigationPayload !== undefined) {
      payload = [...parts, "index.meeko.json"].join("/");
      await writeFile(resolve(outputRoot, ...parts, "index.meeko.json"), navigationPayload, "utf8");
    }
    pages[pathname] = {
      file, headOffset: headOffset(pathname, html), etag: contentTag(html), ...(payload ? { payload } : {}),
      scriptHashes: inlineScriptHashes(html).hashes,
      styleHashes: inlineStyleHashes(html),
    };
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

/**
 * Prerenderiza las rutas `render: "prerender"` con el build Node existente y las escribe en
 * `.meeko/output/node/prerender`. Es lo que hace `meeko prerender`; el runtime se crea con
 * `prerendering: true`.
 *
 * @param projectRoot Carpeta del proyecto con un build Node.
 * @returns Las rutas absolutas de los archivos HTML escritos.
 * @throws {Error} Si falta el build Node o una página no se puede prerenderizar.
 * @example
 * ```ts
 * import { buildProject, prerenderProject } from "@meekojs/meeko/build";
 *
 * await buildProject(process.cwd());
 * // Repite el prerender sobre el build existente.
 * const files = await prerenderProject(process.cwd());
 * ```
 */
export async function prerenderProject(projectRoot: string): Promise<string[]> {
  return prerenderWithNodeBuild(projectRoot, ".meeko/output/node/index.mjs", ".meeko/output/node/prerender");
}

/** Renders prerendered routes with a built Node server into an adapter's output directory. */
export async function prerenderWithNodeBuild(projectRoot: string, server: string, prerenderOutput: string): Promise<string[]> {
  const root = resolve(projectRoot);
  const { modules } = await loadConfiguredModules(root);
  const output = await importNodeOutput(root, server);
  const app = await output.createNodeApp({ prerendering: true }) as InternalServerApp;
  const outputRoot = resolve(root, prerenderOutput);
  try {
    await rm(outputRoot, { recursive: true, force: true });
    return await prerenderRoutes({
      extendUrls: (urls) => modules.callHook("prerender:routes", { urls }),
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

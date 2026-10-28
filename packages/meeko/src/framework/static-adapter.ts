import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { contentSecurityPolicy } from "../framework-server/csp.js";
import { meekoEnv } from "../framework-server/env.js";
import { renderNotFound } from "../framework-server/app.js";
import type { InternalServerApp } from "../framework-server/app.js";
import { discoverAppManifest } from "./app-manifest.js";
import type { MeekoServerConfig } from "./config-type.js";
import { contentTypes } from "./content-types.js";
import { importNodeOutput } from "./prerender.js";
import type { PrerenderIndex } from "./prerender.js";
import { inlineScriptHashes, inlineStyleHashes } from "./script-hashes.js";

type StaticConfig = Extract<MeekoServerConfig, { adapter: "static" }>;

/** Headers of every response of a static build, as `meeko preview` applies them. */
export const staticHeadersFile = ".meeko/build/static-headers.json";
/** The nginx include written for `headerFiles: ["nginx"]`, under the web root. */
export const nginxHeadersPath = "_meeko/headers.conf";

/**
 * Fails, before anything is built, when the application needs a server: a page that is not
 * `render: "prerender"`, API or RPC endpoints, Socket channels, server middleware or the server
 * handlers of modules. Route middleware only warns: it runs while prerendering and on client
 * navigation, never on the first load of a page.
 */
export async function assertStaticApp(projectRoot: string): Promise<void> {
  const root = resolve(projectRoot);
  const { manifest } = await discoverAppManifest(root, { entry: "/", css: [], preload: [] });
  const problems: string[] = [];
  const routes = manifest.routes.filter((route) => (route.render ?? "ssr") !== "prerender");
  if (routes.length) {
    problems.push(`páginas que no usan render: "prerender": ${routes.map((route) => `${route.id} (${route.file.slice(1)}, "${route.render ?? "ssr"}")`).join(", ")}`);
  }
  const list = (label: string, entries: readonly string[]): void => { if (entries.length) problems.push(`${label}: ${entries.join(", ")}`); };
  list("endpoints de API", manifest.server.api.map((endpoint) => `${endpoint.method.toUpperCase()} ${endpoint.pathname} (${endpoint.file.slice(1)})`));
  list("procedimientos RPC", manifest.server.rpc.map((endpoint) => `${endpoint.id} (${endpoint.file.slice(1)})`));
  list("canales Socket", (manifest.server.socket ?? []).map((endpoint) => `${endpoint.name} (${endpoint.file.slice(1)})`));
  list("middleware de servidor", manifest.serverMiddleware.map((file) => file.replace(/^\//, "")));
  list("handlers de servidor de módulos", (manifest.serverHandlers ?? []).map((handler) => handler.route));
  if (problems.length) {
    throw new Error(`El adaptador static genera un sitio sin servidor, pero la aplicación necesita uno:\n${problems.map((problem) => `- ${problem}`).join("\n")}\n`
      + "Usa render: \"prerender\" (con prerenderEntries en las rutas dinámicas) y quita lo que se ejecuta en el servidor, o elige otro adaptador.");
  }
  if (manifest.routeMiddleware.length) {
    process.stderr.write(`[meeko] Con el adaptador static, el middleware de ruta (${manifest.routeMiddleware.map((file) => file.slice(1)).join(", ")}) `
      + "se ejecuta al prerenderizar y al navegar en el cliente, pero no en la primera carga de una página.\n");
  }
}

async function htmlFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await htmlFiles(path));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) found.push(path);
  }
  return found;
}

/** The folders of a page's pathname, decoded as a static host decodes the request path. */
function pageFolders(pathname: string): string[] {
  return pathname.split("/").filter(Boolean).map((segment) => {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); }
    catch { throw new Error(`La URL prerenderizada ${pathname} no se puede escribir como carpeta: ${segment} no es una codificación válida`); }
    if (!decoded || decoded === "." || decoded === ".." || /[\\/\u0000]/.test(decoded)) {
      throw new Error(`La URL prerenderizada ${pathname} no se puede escribir como carpeta: ${JSON.stringify(decoded)}`);
    }
    return decoded;
  });
}

async function writeNew(target: string, contents: string | Uint8Array, conflict: string): Promise<void> {
  if (existsSync(target)) throw new Error(conflict);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}

/** Headers of every response: the CSP with the hashes of the pages' inline scripts and styles, then `headers`. */
async function staticHeaders(output: string, config: StaticConfig | undefined): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (config?.contentSecurityPolicy) {
    const hashes = new Set<string>();
    const styleHashes = new Set<string>();
    const problems: string[] = [];
    for (const file of await htmlFiles(output)) {
      const html = await readFile(file, "utf8");
      const report = inlineScriptHashes(html);
      for (const hash of report.hashes) hashes.add(hash);
      for (const hash of inlineStyleHashes(html)) styleHashes.add(hash);
      for (const item of report.unhashable) problems.push(`${relative(output, file).replaceAll("\\", "/")}: ${item}`);
    }
    if (problems.length) {
      throw new Error(`server.contentSecurityPolicy no puede permitir JavaScript en atributos on* ni en URL javascript: con hashes; muévelo a un script o a on: del componente:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
    }
    headers["Content-Security-Policy"] = contentSecurityPolicy(config.contentSecurityPolicy, [...hashes].sort(), [...styleHashes].sort());
  }
  return { ...headers, ...config?.headers };
}

/** `_headers` of Netlify and Cloudflare Pages: every path gets the headers. */
function netlifyHeaders(headers: Readonly<Record<string, string>>): string {
  return ["# Generado por meeko build --adapter static.", "/*", ...Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`), ""].join("\n");
}

/** nginx `add_header` lines; `always` also covers 404 and other errors. */
function nginxHeaders(headers: Readonly<Record<string, string>>): string {
  return [
    "# Generado por meeko build --adapter static; inclúyelo en cada location (un add_header de una location anula los del server).",
    ...Object.entries(headers).map(([name, value]) => {
      if (/["\\$]/.test(value)) throw new Error(`La cabecera ${name} no se puede escribir como cadena de nginx: contiene ", \\ o $`);
      return `add_header ${name} "${value}" always;`;
    }),
    "",
  ].join("\n");
}

export interface StaticOutputOptions {
  readonly root: string;
  /** `.meeko/output/static`, replaced as a whole. */
  readonly output: string;
  /** The client build with `public/` and the generated public files. */
  readonly clientDirectory: string;
  /** Where the prerender wrote its HTML, payloads and `manifest.json`. */
  readonly prerenderDirectory: string;
  /** The Node server that rendered the pages, relative to the project. */
  readonly nodeServer: string;
  readonly config: StaticConfig | undefined;
  /** Whether the app has app/error.meeko, the source of 404.html. */
  readonly errorPage: boolean;
}

/**
 * Writes the static site: the client build (assets and `public/`), each prerendered page as
 * `<path>/index.html` with its navigation payload `<path>/index.meeko.json`, `404.html` from
 * app/error.meeko and the header files that `headerFiles` asks for.
 */
export async function writeStaticOutput(options: StaticOutputOptions): Promise<{ readonly pages: number; readonly headers: Readonly<Record<string, string>> }> {
  const { output } = options;
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(options.clientDirectory, output, {
    recursive: true,
    filter: (source) => relative(options.clientDirectory, source).split(sep)[0] !== ".vite",
  });
  const index = JSON.parse(await readFile(join(options.prerenderDirectory, "manifest.json"), "utf8")) as PrerenderIndex;
  for (const [pathname, page] of Object.entries(index.pages)) {
    const folder = join(output, ...pageFolders(pathname));
    const conflict = (file: string): string => `La página prerenderizada ${pathname} choca con public/${relative(output, join(folder, file)).replaceAll("\\", "/")}`;
    await writeNew(join(folder, "index.html"), await readFile(join(options.prerenderDirectory, ...page.file.split("/"))), conflict("index.html"));
    if (page.payload !== undefined) {
      await writeNew(join(folder, "index.meeko.json"), await readFile(join(options.prerenderDirectory, ...page.payload.split("/"))), conflict("index.meeko.json"));
    }
  }
  if (options.errorPage) {
    const server = await importNodeOutput(options.root, options.nodeServer);
    const app = await server.createNodeApp({ prerendering: true }) as InternalServerApp;
    try {
      const response = await app[renderNotFound](new Request("http://meeko.local/404.html", { headers: { accept: "text/html" } }));
      if (response.status !== 404 || !(response.headers.get("content-type") ?? "").includes("text/html")) {
        await response.body?.cancel();
        throw new Error(`app/error.meeko respondió HTTP ${response.status} en lugar de la página 404`);
      }
      await writeNew(join(output, "404.html"), await response.text(), "public/404.html choca con la página 404 que genera el adaptador static desde app/error.meeko");
    } finally {
      await app.close();
    }
  } else {
    process.stderr.write("[meeko] Sin app/error.meeko, el adaptador static no genera 404.html; el hosting mostrará su propia página 404.\n");
  }
  const headers = await staticHeaders(output, options.config);
  for (const format of new Set(options.config?.headerFiles ?? [])) {
    if (format === "_headers") await writeNew(join(output, "_headers"), netlifyHeaders(headers), "public/_headers choca con el archivo de cabeceras de server.headerFiles");
    else await writeNew(join(output, ...nginxHeadersPath.split("/")), nginxHeaders(headers), `public/${nginxHeadersPath} choca con el archivo de cabeceras de server.headerFiles`);
  }
  await mkdir(dirname(resolve(options.root, staticHeadersFile)), { recursive: true });
  await writeFile(resolve(options.root, staticHeadersFile), `${JSON.stringify(headers, null, 2)}\n`, "utf8");
  return { pages: Object.keys(index.pages).length, headers };
}

async function fileAt(path: string): Promise<string | undefined> {
  try {
    const info = await stat(path);
    if (info.isFile()) return path;
    if (info.isDirectory()) {
      const page = join(path, "index.html");
      if ((await stat(page).catch(() => undefined))?.isFile()) return page;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ENOTDIR") throw error;
  }
  return undefined;
}

/**
 * Serves `.meeko/output/static` as a static host would: a file, or the `index.html` of a folder,
 * and `404.html` with status 404 for anything else, with the headers of the build. The header
 * files and `_meeko/` are not public.
 */
export async function previewStatic(projectRoot: string): Promise<Server> {
  const root = resolve(projectRoot);
  const output = resolve(root, ".meeko/output/static");
  if (!existsSync(join(output))) throw new Error(`No hay build estático en ${output}; ejecuta meeko build --adapter static`);
  let headers: Record<string, string> = {};
  try { headers = JSON.parse(await readFile(resolve(root, staticHeadersFile), "utf8")) as Record<string, string>; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const server = createServer((request, response) => {
    void (async () => {
      const send = async (status: number, file: string | undefined): Promise<void> => {
        const body = file ? await readFile(file) : Buffer.from("Not Found");
        response.writeHead(status, {
          ...headers,
          "content-type": file ? contentTypes[extname(file).toLowerCase()] ?? "application/octet-stream" : "text/plain; charset=utf-8",
          "content-length": String(body.byteLength),
          "cache-control": "no-cache",
        });
        response.end(request.method === "HEAD" ? undefined : body);
      };
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { ...headers, allow: "GET, HEAD" });
        response.end();
        return;
      }
      let segments: string[];
      try { segments = new URL(request.url ?? "/", "http://localhost").pathname.split("/").filter(Boolean).map(decodeURIComponent); }
      catch { segments = ["\u0000"]; }
      const path = resolve(output, ...segments);
      const hidden = segments[0] === "_headers" || segments[0] === "_meeko";
      const inside = path === output || path.startsWith(`${output}${sep}`);
      const file = inside && !hidden && !segments.some((segment) => /[\\/\u0000]/.test(segment)) ? await fileAt(path) : undefined;
      if (file) return send(200, file);
      const notFound = join(output, "404.html");
      return send(404, existsSync(notFound) ? notFound : undefined);
    })().catch((error: unknown) => {
      console.error(error);
      if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end("Internal Server Error");
    });
  });
  const host = meekoEnv(process.env, "HOST") || "127.0.0.1";
  const port = Number(meekoEnv(process.env, "PORT") || 4173);
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(port, host, () => { server.off("error", fail); done(); });
  });
  const address = server.address();
  const visible = host === "0.0.0.0" ? "127.0.0.1" : host;
  process.stdout.write(`http://${visible.includes(":") ? `[${visible}]` : visible}:${address && typeof address !== "string" ? address.port : port}\n`);
  const stop = (): void => { server.close(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  server.once("close", () => { process.off("SIGINT", stop); process.off("SIGTERM", stop); });
  return server;
}

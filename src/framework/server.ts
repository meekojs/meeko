import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { escapeHtml, serializeJson } from "../server.js";
import type { RequestContext } from "../framework-server/context.js";
import { withRequestContext } from "../framework-server/context.js";
import type { ServerFetch } from "../framework-server/context.js";
import { PageInputError, pageSearchObject, validatePageInputs } from "./page.js";
import type { PageSchema } from "./page.js";
import { StateStore, withStateStore } from "./state.js";
import { createRouteManifest, matchRoute } from "./router.js";
import type { RouteRecord } from "./router.js";

function routeId(relativeFile: string): string {
  const parts = relativeFile.slice(0, -".meeko".length).split(sep);
  if (parts.at(-1) === "index") parts.pop();
  const visible = parts.filter((part) => !/^\([^/()]+\)$/.test(part));
  return visible.length ? `/${visible.join("/")}` : "/";
}

/** Discovers pages once; the returned manifest is safe to serialize for the browser. */
export async function discoverRoutes(projectRoot: string): Promise<readonly RouteRecord[]> {
  const pagesRoot = resolve(projectRoot, "app", "pages");
  const files = new Set<string>();
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.add(path);
    }
  }
  await walk(pagesRoot);
  const appShell = resolve(projectRoot, "app", "app.meeko");
  let hasAppShell = false;
  try { hasAppShell = (await stat(appShell)).isFile(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const routes: RouteRecord[] = [];
  for (const file of files) {
    if (!file.endsWith(".meeko") || basename(file).startsWith("+")) continue;
    const directory = dirname(file);
    const layouts: string[] = hasAppShell ? [appShell] : [];
    let cursor = pagesRoot;
    const relativeDirectory = relative(pagesRoot, directory);
    if (files.has(join(cursor, "+layout.meeko"))) layouts.push(join(cursor, "+layout.meeko"));
    if (relativeDirectory) for (const segment of relativeDirectory.split(sep)) {
      cursor = join(cursor, segment);
      if (files.has(join(cursor, "+layout.meeko"))) layouts.push(join(cursor, "+layout.meeko"));
    }
    let error: string | undefined;
    let errorCursor = directory;
    while (errorCursor.startsWith(pagesRoot)) {
      const candidate = join(errorCursor, "+error.meeko");
      if (files.has(candidate)) { error = candidate; break; }
      if (errorCursor === pagesRoot) break;
      errorCursor = dirname(errorCursor);
    }
    const sidecar = file.slice(0, -".meeko".length) + ".route.ts";
    routes.push({
      id: routeId(relative(pagesRoot, file)),
      file,
      layouts,
      ...(error ? { error } : {}),
      ...(files.has(sidecar) ? { sidecar } : {}),
    });
  }
  return createRouteManifest(routes);
}

export interface PageModule {
  css?: string;
  renderWithState(props: Record<string, unknown>): { html: string; state: Record<string, unknown> };
  renderToString?(props: Record<string, unknown>): string;
}

export interface PageRoute {
  params?: PageSchema;
  search?: PageSchema;
  load?: (context: PageRequestContext) => Promise<unknown> | unknown;
  head?: (context: PageRequestContext & { data: unknown }) => { title?: string };
  render?: "ssr" | "prerender" | "client";
  prerenderEntries?: readonly Readonly<Record<string, string>>[] | (() => Promise<readonly Readonly<Record<string, string>>[]>);
}

export interface PageRequestContext {
  readonly request: Request;
  readonly params: Readonly<Record<string, unknown>>;
  readonly search: Readonly<Record<string, unknown>>;
  readonly searchParams: URLSearchParams;
  readonly signal: AbortSignal;
  /** Public state transferred from this request to its browser app instance. */
  readonly state: StateStore;
  /** Present when the host supplies a per-request context. */
  readonly context?: RequestContext;
}

export interface FrameworkHandlerOptions {
  readonly routes: readonly RouteRecord[];
  readonly loadPage: (file: string) => Promise<PageModule>;
  readonly loadRoute?: (file: string) => Promise<PageRoute>;
  readonly createContext?: (request: Request) => RequestContext | Promise<RequestContext>;
  /** Optional in-process dispatcher for automatic API/RPC calls during SSR. */
  readonly serverFetch?: ServerFetch;
  /** Optional host layout renderer; default composition uses <component is="props.outlet"/>. */
  readonly renderLayout?: (file: string, children: string, context: PageRequestContext) => Promise<string> | string;
  readonly clientEntry?: string;
}

/** Portable Fetch handler. Node adapters can pass their Request directly. */
export function createFrameworkHandler(options: FrameworkHandlerOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    const url = new URL(request.url);
    const match = matchRoute(options.routes, url.pathname);
    if (!match) return new Response("Not Found", { status: 404 });
    const stateStore = new StateStore();
    let requestContext: RequestContext | undefined;
    const finish = (response: Response): Response => {
      if (!requestContext) return response;
      const headers = new Headers(response.headers);
      headers.set("x-request-id", requestContext.requestId);
      headers.set("x-meeko-csrf-token", requestContext.session.current?.csrfToken ?? "");
      if (requestContext.session.cookieHeader) headers.append("set-cookie", requestContext.session.cookieHeader);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    };
    try {
    requestContext = await options.createContext?.(request);
    if (requestContext && requestContext.request !== request) throw new TypeError("Request context belongs to another request");
    const render = async (): Promise<Response> => {
    const sidecar = match.route.sidecar && options.loadRoute ? await options.loadRoute(match.route.sidecar) : undefined;
    const validated = await validatePageInputs(sidecar, match.params, pageSearchObject(url.searchParams));
    const context: PageRequestContext = {
      request, params: validated.params, search: validated.search, searchParams: url.searchParams, signal: request.signal, state: stateStore,
      ...(requestContext ? { context: requestContext } : {}),
    };
    const data = sidecar?.load ? await sidecar.load(context) : undefined;
    if (data instanceof Response) return finish(data);
    const props: Record<string, unknown> = {
      params: validated.params,
      search: validated.search,
      ...(data === undefined ? {} : { data }),
    };
    let module = await options.loadPage(match.route.file);
    const styles: string[] = [];
    if (module.css) styles.push(module.css);
    let input = props;
    let rendered: ReturnType<PageModule["renderWithState"]>;
    if (options.renderLayout) {
      rendered = withStateStore(stateStore, () => module.renderWithState(input));
      for (const layout of [...match.route.layouts].reverse()) {
        const layoutModule = await options.loadPage(layout);
        if (layoutModule.css) styles.unshift(layoutModule.css);
        rendered = { html: await options.renderLayout(layout, rendered.html, context), state: rendered.state };
      }
    } else {
      for (const layout of [...match.route.layouts].reverse()) {
        const child = module;
        const childInput = input;
        const outlet = {
          renderWithState: () => child.renderWithState(childInput),
          renderToString: () => child.renderToString?.(childInput) ?? child.renderWithState(childInput).html,
          hydrateScope: () => { throw new Error("Server outlet cannot hydrate"); },
        };
        module = await options.loadPage(layout);
        if (module.css) styles.unshift(module.css);
        input = { outlet };
      }
      rendered = withStateStore(stateStore, () => module.renderWithState(input));
    }
    const head = sidecar?.head?.({ ...context, data });
    const title = head?.title ? `<title>${escapeHtml(head.title)}</title>` : "";
    const styleTags = [...new Set(styles)].map((css) => `<style>${css.replaceAll("<", "\\3C ")}</style>`).join("");
    const payload = serializeJson({ route: match.route.id, props, state: rendered.state, sharedState: stateStore.snapshot() });
    if (request.headers.get("accept")?.split(",").some((value) => value.trim().startsWith("application/meeko+json"))) {
      return finish(new Response(request.method === "HEAD" ? null : payload, {
        status: 200, headers: { "content-type": "application/meeko+json; charset=utf-8", "cache-control": "no-store" },
      }));
    }
    const script = options.clientEntry ? `<script type="module" src="${escapeHtml(options.clientEntry)}"></script>` : "";
    const csrfMeta = requestContext?.session.current ? `<meta name="meeko-csrf-token" content="${escapeHtml(requestContext.session.current.csrfToken)}">` : "";
    const document = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">${csrfMeta}${styleTags}${title}</head><body><div id="app">${rendered.html}</div><script id="meeko-payload" type="application/json">${payload}</script>${script}</body></html>`;
    return finish(new Response(request.method === "HEAD" ? null : document, {
      status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    }));
    };
    return requestContext ? await withRequestContext(requestContext, options.serverFetch, render) : await render();
    } catch (error) {
      if (error instanceof Response) return finish(error);
      if (error instanceof PageInputError) return finish(new Response(error.code, {
        status: 400, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      }));
      if (match.route.error) {
        try {
          const errorPage = await options.loadPage(match.route.error);
          const errorRendered = withStateStore(stateStore, () => errorPage.renderWithState({
            status: 500, message: "Internal Server Error",
          }));
          const document = `<!doctype html><html><head><meta charset="utf-8"><title>Error</title></head><body><div id="app">${errorRendered.html}</div></body></html>`;
          return finish(new Response(request.method === "HEAD" ? null : document, {
            status: 500, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
          }));
        } catch {
          // The error route failed; keep private errors out of the response.
        }
      }
      return finish(new Response(request.method === "HEAD" ? null : "Internal Server Error", { status: 500 }));
    }
  };
}

import { escapeHtml, serializeJson } from "../server.js";
import type { RequestContext } from "../framework-server/context.js";
import { withRequestContext } from "../framework-server/context.js";
import type { ServerFetch } from "../framework-server/context.js";
import { ApiError, errorResponse, normalizeServerError, observeServerError } from "../framework-server/contracts.js";
import { etagMatches } from "../framework-server/assets.js";
import { PAYLOAD_VERSION, PageInputError, pageSearchObject, validatePageInputs } from "./page.js";
import { runRouteMiddleware } from "./middleware.js";
import type { RouteMiddleware } from "./middleware.js";
import type { PageHead, PageRender, PageSchema } from "./page.js";
import { StateStore, withStateStore } from "./state.js";
import { matchRoute } from "./router.js";
import type { RouteRecord } from "./router.js";

export interface PageModule {
  css?: string;
  renderWithState(props: Record<string, unknown>): { html: string; state: Record<string, unknown> };
  renderToString?(props: Record<string, unknown>): string;
}

export interface PageRoute {
  params?: PageSchema;
  search?: PageSchema;
  load?: (context: PageRequestContext) => Promise<unknown> | unknown;
  head?: (context: PageRequestContext & { data: unknown }) => PageHead;
  render?: PageRender;
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

export interface FrameworkHandlerOptions<Route = PageRoute> {
  readonly routes: readonly RouteRecord[];
  readonly loadPage: (file: string) => Promise<PageModule>;
  readonly loadRoute?: (file: string) => Promise<Route>;
  /** Isomorphic route middleware, evaluated before the route sidecar loader. */
  readonly loadMiddleware?: () => Promise<readonly RouteMiddleware[]>;
  readonly createContext?: (request: Request) => RequestContext | Promise<RequestContext>;
  /** Optional in-process dispatcher for automatic API/RPC calls during SSR. */
  readonly serverFetch?: ServerFetch;
  /** Receives internal page failures with the request ID; never sent to the browser. */
  readonly onError?: (error: unknown, requestId: string) => void;
  readonly clientEntry?: string;
  /** Host additions to every HTML document this handler renders. */
  readonly document?: DocumentOptions;
}

/** Trusted host markup, either fixed or derived from the request and its CSP nonce. */
export type DocumentMarkup = string | ((context: { readonly request: Request; readonly nonce: string | undefined }) => string);

export interface DocumentOptions {
  /** Trusted HTML appended to `<head>`, such as stylesheets and modulepreload links. */
  readonly head?: DocumentMarkup;
  /** Trusted HTML appended before `</body>`, after the client entry. */
  readonly bodyEnd?: DocumentMarkup;
  /** A per-request CSP nonce applied to Meeko's `<style>` tags and client entry script. */
  readonly nonce?: (request: Request) => string | undefined;
}

function documentParts(options: DocumentOptions | undefined, request: Request): { head: string; bodyEnd: string; nonceAttribute: string } {
  const nonce = options?.nonce?.(request);
  const markup = (value: DocumentMarkup | undefined): string => typeof value === "function" ? value({ request, nonce }) : value ?? "";
  return { head: markup(options?.head), bodyEnd: markup(options?.bodyEnd), nonceAttribute: nonce ? ` nonce="${escapeHtml(nonce)}"` : "" };
}

/** Every Meeko document starts with this markup; the CSRF meta tag follows it. */
export const DOCUMENT_HEAD_PREFIX = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">';

/** HTML produced at build time for one prerendered URL. */
export interface PrerenderedPage {
  readonly html: string;
  /**
   * Offset inside `<head>` where the per-request CSRF meta tag is inserted,
   * in UTF-16 code units of `html` (a JavaScript string index), never in bytes.
   */
  readonly headOffset: number;
  readonly etag: string;
  /** Navigation payload served to client-side navigations of the same URL. */
  readonly payload?: string;
}

/** Build output that a host reads by pathname; absent pages fall back to SSR. */
export interface PrerenderSource {
  get(pathname: string): Promise<PrerenderedPage | undefined>;
}

/** Internal handler options used by `createServerApp`. */
export interface PageHandlerOptions extends FrameworkHandlerOptions<unknown> {
  readonly prerendered?: PrerenderSource;
}

/** A typed sidecar may narrow callback arguments after its schemas validate them. */
type TypedPageRoute = Omit<PageRoute, "load" | "head"> & {
  load?: (context: never) => Promise<unknown> | unknown;
  head?: (context: never) => PageHead;
};

function wantsPayload(request: Request): boolean {
  return request.headers.get("accept")?.split(",").some((value) => value.trim().startsWith("application/meeko+json")) ?? false;
}

function routeRender(route: RouteRecord, sidecar: PageRoute | undefined): PageRender {
  if (route.render !== undefined && sidecar?.render !== undefined && route.render !== sidecar.render) {
    throw new Error(`Route ${route.id} declares render "${sidecar.render}" but its manifest says "${route.render}"; rebuild the application`);
  }
  return route.render ?? sidecar?.render ?? "ssr";
}

function prerenderedResponse(page: PrerenderedPage, request: Request, context: RequestContext | undefined): Response {
  const session = context?.session;
  const head = request.method === "HEAD";
  if (session?.current || session?.cookieHeader) {
    if (!Number.isSafeInteger(page.headOffset) || page.headOffset < 0 || page.headOffset > page.html.length) throw new Error("Invalid prerender head offset");
    const csrfMeta = session.current ? `<meta name="meeko-csrf-token" content="${escapeHtml(session.current.csrfToken)}">` : "";
    const html = page.html.slice(0, page.headOffset) + csrfMeta + page.html.slice(page.headOffset);
    return new Response(head ? null : html, {
      status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" },
    });
  }
  const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate", etag: page.etag, vary: "cookie" };
  if (etagMatches(request.headers.get("if-none-match"), page.etag)) return new Response(null, { status: 304, headers });
  return new Response(head ? null : page.html, { status: 200, headers });
}

/** Portable Fetch handler. Node adapters can pass their Request directly. */
export function createFrameworkHandler(options: FrameworkHandlerOptions): (request: Request) => Promise<Response>;
export function createFrameworkHandler<Route extends TypedPageRoute>(options: FrameworkHandlerOptions<Route>): (request: Request) => Promise<Response>;
export function createFrameworkHandler(options: FrameworkHandlerOptions<unknown>): (request: Request) => Promise<Response> {
  return createPageHandler(options);
}

export function createPageHandler(options: PageHandlerOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    const fallbackRequestId = crypto.randomUUID();
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, {
      status: 405, headers: { Allow: "GET, HEAD", "x-request-id": fallbackRequestId, "cache-control": "no-store" },
    });
    const stateStore = new StateStore();
    let errorRoute: string | undefined;
    let requestContext: RequestContext | undefined;
    const finish = (response: Response): Response => {
      const headers = new Headers(response.headers);
      headers.set("x-request-id", requestContext?.requestId ?? fallbackRequestId);
      if (requestContext) {
        headers.set("x-meeko-csrf-token", requestContext.session.current?.csrfToken ?? "");
        if (requestContext.session.cookieHeader) headers.append("set-cookie", requestContext.session.cookieHeader);
      }
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    };
    try {
    const url = new URL(request.url);
    const match = matchRoute(options.routes, url.pathname);
    if (!match) return finish(new Response("Not Found", {
      status: 404, headers: { "cache-control": "no-store" },
    }));
    errorRoute = match.route.error;
    requestContext = await options.createContext?.(request);
    if (requestContext && requestContext.request !== request) throw new TypeError("Request context belongs to another request");
    const render = async (): Promise<Response> => {
    const middlewareResponse = options.loadMiddleware && await runRouteMiddleware(await options.loadMiddleware(), {
      url, match, signal: request.signal, phase: "server", request,
    });
    if (middlewareResponse) return finish(middlewareResponse);
    if (options.prerendered && match.route.render === "prerender" && url.search === "" && !options.document?.nonce) {
      const page = await options.prerendered.get(url.pathname);
      if (page && !wantsPayload(request)) return finish(prerenderedResponse(page, request, requestContext));
      if (page?.payload !== undefined) return finish(new Response(request.method === "HEAD" ? null : page.payload, {
        status: 200, headers: { "content-type": "application/meeko+json; charset=utf-8", "cache-control": "no-store" },
      }));
    }
    const sidecar = match.route.sidecar && options.loadRoute ? await options.loadRoute(match.route.sidecar) as PageRoute : undefined;
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
    const rendered = withStateStore(stateStore, () => module.renderWithState(input));
    const head: PageHead = sidecar?.head?.({ ...context, data }) ?? {};
    const title = head.title === undefined ? "" : `<title>${escapeHtml(head.title)}</title>`;
    const host = documentParts(options.document, request);
    const nonceAttribute = host.nonceAttribute;
    const styleTags = [...new Set(styles)].map((css) => `<style${nonceAttribute}>${css.replaceAll("<", "\\3C ")}</style>`).join("");
    const payload = serializeJson({
      v: PAYLOAD_VERSION, route: match.route.id, render: routeRender(match.route, sidecar),
      props, state: rendered.state, sharedState: stateStore.snapshot(),
      head: head.title === undefined ? {} : { title: head.title },
    });
    if (wantsPayload(request)) {
      return finish(new Response(request.method === "HEAD" ? null : payload, {
        status: 200, headers: { "content-type": "application/meeko+json; charset=utf-8", "cache-control": "no-store" },
      }));
    }
    const script = options.clientEntry ? `<script type="module"${nonceAttribute} src="${escapeHtml(options.clientEntry)}"></script>` : "";
    const csrfMeta = requestContext?.session.current ? `<meta name="meeko-csrf-token" content="${escapeHtml(requestContext.session.current.csrfToken)}">` : "";
    const document = `${DOCUMENT_HEAD_PREFIX}${csrfMeta}${styleTags}${title}${host.head}</head><body><div id="app">${rendered.html}</div><script id="meeko-payload" type="application/json">${payload}</script>${script}${host.bodyEnd}</body></html>`;
    return finish(new Response(request.method === "HEAD" ? null : document, {
      status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    }));
    };
    return requestContext ? await withRequestContext(requestContext, options.serverFetch, render) : await render();
    } catch (error) {
      if (error instanceof Response) return finish(error);
      const known = error instanceof PageInputError ? new ApiError(error.code, 400) : normalizeServerError(error);
      const requestId = requestContext?.requestId ?? fallbackRequestId;
      const report = (failure: unknown): void => {
        observeServerError(failure, requestId, options.onError);
      };
      if (known.status >= 500) report(error);
      if (wantsPayload(request)) {
        return finish(errorResponse(known, requestId));
      }
      if (error instanceof PageInputError) return finish(new Response(error.code, {
        status: 400, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      }));
      const errorFile = errorRoute;
      if (errorFile) {
        try {
          const renderError = async (): Promise<Response> => {
            const errorPage = await options.loadPage(errorFile);
            const errorRendered = withStateStore(stateStore, () => errorPage.renderWithState({
              status: known.status, message: known.status >= 500 ? "Internal Server Error" : known.code,
            }));
            const host = documentParts(options.document, request);
            const document = `<!doctype html><html><head><meta charset="utf-8"><title>Error</title>${host.head}</head><body><div id="app">${errorRendered.html}</div>${host.bodyEnd}</body></html>`;
            return finish(new Response(request.method === "HEAD" ? null : document, {
              status: known.status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
            }));
          };
          return requestContext
            ? await withRequestContext(requestContext, options.serverFetch, renderError)
            : await renderError();
        } catch (failure) {
          report(failure);
          // The error route failed; keep private errors out of the response.
        }
      }
      return finish(new Response(request.method === "HEAD" ? null : known.status >= 500 ? "Internal Server Error" : known.code, {
        status: known.status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      }));
    }
  };
}

import { escapeHtml, serializeJson } from "../server.js";
import type { RequestContext } from "../framework-server/context.js";
import { withRequestContext } from "../framework-server/context.js";
import type { ServerFetch } from "../framework-server/context.js";
import { ApiError, errorResponse, normalizeServerError, observeServerError } from "../framework-server/contracts.js";
import { lockSessionCookie } from "../framework-server/sessions.js";
import { etagMatches } from "../framework-server/assets.js";
import { PAYLOAD_VERSION, PageInputError, pageSearchObject, validatePageInputs } from "./page.js";
import { runRouteMiddleware } from "./middleware.js";
import type { RouteMiddleware } from "./middleware.js";
import type { PageHead, PageRender, PageSchema } from "./page.js";
import { StateStore, withStateStore } from "./state.js";
import { deferredSettle, deferredSource, extractDeferred } from "./deferred.js";
import type { DeferredInternals, DeferredOutcome } from "./deferred.js";
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

/**
 * The manifest render is read from the sidecar at build time. A different
 * runtime value means the server runs a stale build, and a client page served
 * as SSR (or the reverse) would hydrate the wrong tree.
 */
function routeRender(route: RouteRecord, sidecar: PageRoute | undefined): PageRender {
  const declared = sidecar?.render;
  const stale = sidecar !== undefined && (route.render !== undefined
    ? (declared ?? "ssr") !== route.render
    : declared === "client");
  if (stale) {
    throw new Error(`Route ${route.id} declares render "${declared ?? "ssr"}" but its manifest says "${route.render ?? "ssr"}"; rebuild the application`);
  }
  return route.render ?? declared ?? "ssr";
}

/** Stream responses must reach the browser as written, never cached or buffered by a proxy. */
const streamHeaders = { "cache-control": "no-store", "x-accel-buffering": "no" } as const;

/** Server outcome of a deferred value; `failure` is the private cause of a rejection. */
type ServerOutcome =
  | { readonly status: "resolved"; readonly value?: unknown }
  | { readonly status: "rejected"; readonly error: { readonly code: string; readonly status: number }; readonly failure: unknown };

function rejectedOutcome(failure: unknown): ServerOutcome {
  const known = normalizeServerError(failure);
  return { status: "rejected", error: { code: known.code, status: known.status }, failure };
}

/** A resolved value must survive the payload serializer, or it becomes a 500. */
function resolvedOutcome(value: unknown): ServerOutcome {
  if (value === undefined) return { status: "resolved" };
  try { serializeJson(value); }
  catch (error) { return rejectedOutcome(error); }
  return { status: "resolved", value };
}

/** Public fields of an outcome, as sent in the payload and in deferred chunks. */
function publicOutcome(outcome: ServerOutcome): DeferredOutcome {
  if (outcome.status === "rejected") return { status: "rejected", error: outcome.error };
  return "value" in outcome ? { status: "resolved", value: outcome.value } : { status: "resolved" };
}

/** Wire form of a settled value: `{ value }`, `{}` for undefined, or `{ error: { code, status } }`. */
function wireOutcome(outcome: ServerOutcome): Record<string, unknown> {
  if (outcome.status === "rejected") return { error: outcome.error };
  return "value" in outcome ? { value: outcome.value } : {};
}

/**
 * Races a deferred value against its timeout and the request signal (client
 * disconnect, session revocation or an aborted response). A factory's signal
 * aborts with the same reason when either wins. Never rejects.
 */
function settleOnServer(deferred: DeferredInternals, signal: AbortSignal): Promise<ServerOutcome> {
  const source = deferred[deferredSource];
  if (!source) {
    if (deferred.status === "resolved") return Promise.resolve(resolvedOutcome(deferred.value));
    if (deferred.status === "rejected") return Promise.resolve({ status: "rejected", error: deferred.error!, failure: new ApiError(deferred.error!.code, deferred.error!.status) });
    return Promise.resolve(rejectedOutcome(new Error("A deferred value without a source cannot settle on the server; create it with defer()")));
  }
  return new Promise((resolve) => {
    let settled = false;
    const work = new AbortController();
    const finish = (outcome: ServerOutcome, abandoned?: { readonly reason: unknown }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (abandoned) work.abort(abandoned.reason);
      resolve(outcome);
    };
    const onAbort = (): void => finish(rejectedOutcome(signal.reason), { reason: signal.reason });
    const timer = setTimeout(() => {
      const timeout = new ApiError("DEFERRED_TIMEOUT", 504, `Deferred value did not settle within ${source.timeoutMs} ms`);
      finish(rejectedOutcome(timeout), { reason: timeout });
    }, source.timeoutMs);
    // Work that would never be sent is not started.
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    source.start(work.signal).then((value) => finish(resolvedOutcome(value)), (error: unknown) => finish(rejectedOutcome(error)));
  });
}

/**
 * Sends `first` at once, each piece as soon as it settles, then `last`. A
 * cancelled body (client gone, write failure in the adapter) or a failed piece
 * calls `abort`, which stops the remaining deferred work.
 */
function streamBody(first: string, pieces: readonly Promise<string>[], last: string, abort: (reason: unknown, failed: boolean) => void): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let open = true;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(first));
      void (async () => {
        try {
          await Promise.all(pieces.map(async (piece) => {
            const text = await piece;
            if (open) controller.enqueue(encoder.encode(text));
          }));
          if (!open) return;
          controller.enqueue(encoder.encode(last));
          open = false;
          controller.close();
        } catch (error) {
          if (!open) return;
          open = false;
          abort(error, true);
          try { controller.error(error); }
          catch { /* The consumer already released the stream. */ }
        }
      })();
    },
    cancel(reason) {
      if (!open) return;
      open = false;
      abort(reason, false);
    },
  });
}

/** Outlet of a `render: "client"` page during SSR: its region stays empty until the browser commits the page. */
const emptyOutlet: PageModule = {
  renderWithState: () => ({ html: "", state: {} }),
  renderToString: () => "",
};

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
    // Aborts timers and listeners of deferred values that will never be sent.
    const deferredWork = new AbortController();
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
    const renderMode = routeRender(match.route, sidecar);
    const clientPage = renderMode === "client";
    const validated = await validatePageInputs(sidecar, match.params, pageSearchObject(url.searchParams));
    // Client disconnect, session revocation, a cancelled stream or a HEAD
    // response: the loader and its deferred work stop being awaited.
    const driverSignal = AbortSignal.any([requestContext?.signal ?? request.signal, deferredWork.signal]);
    const context: PageRequestContext = {
      request, params: validated.params, search: validated.search, searchParams: url.searchParams, signal: driverSignal, state: stateStore,
      ...(requestContext ? { context: requestContext } : {}),
    };
    // A client page's loader and head run in the browser; the server only guards and validates.
    const data = !clientPage && sidecar?.load ? await sidecar.load(context) : undefined;
    if (data instanceof Response) return finish(data);
    const streaming = renderMode === "stream";
    const requestId = requestContext?.requestId ?? fallbackRequestId;
    // Deferred values replace themselves with null in the payload and travel by path.
    const extracted = data === undefined ? { value: undefined, found: [] } : extractDeferred(data, ["data"]);
    const outcomes = extracted.found.map(({ deferred }) => settleOnServer(deferred, driverSignal));
    const observeOutcome = (outcome: ServerOutcome): void => {
      if (outcome.status !== "rejected" || outcome.error.status < 500) return;
      // A client that left, or a HEAD request, is not a server failure.
      if (request.signal.aborted || deferredWork.signal.aborted) return;
      observeServerError(outcome.failure, requestId, options.onError);
    };
    let deferredEntries: Record<string, unknown>[];
    if (streaming) {
      deferredEntries = extracted.found.map(({ path }, id) => ({ id, path, status: "pending" }));
    } else {
      // ssr and prerender keep the full HTML: every deferred value settles before rendering.
      const settled = await Promise.all(outcomes);
      if (renderMode === "prerender") {
        // Stored HTML would keep a transient failure until the next build.
        const failed = settled.findIndex((outcome) => outcome.status === "rejected");
        const outcome = settled[failed];
        if (outcome?.status === "rejected") {
          throw new Error(`Prerendered route ${match.route.id} cannot store the rejected deferred value at ${extracted.found[failed]!.path.join(".")} (${outcome.error.code} ${outcome.error.status})`, { cause: outcome.failure });
        }
      }
      deferredEntries = settled.map((outcome, id) => {
        extracted.found[id]!.deferred[deferredSettle](outcome);
        observeOutcome(outcome);
        return { id, path: extracted.found[id]!.path, ...publicOutcome(outcome) };
      });
    }
    const props: Record<string, unknown> = {
      params: validated.params,
      search: validated.search,
      ...(data === undefined ? {} : { data }),
    };
    const payloadProps: Record<string, unknown> = {
      params: validated.params,
      search: validated.search,
      ...(data === undefined ? {} : { data: extracted.value }),
    };
    const styles: string[] = [];
    let module: PageModule = emptyOutlet;
    let input: Record<string, unknown> = {};
    if (!clientPage) {
      module = await options.loadPage(match.route.file);
      if (module.css) styles.push(module.css);
      input = props;
    }
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
    // head reads the state the render produced; anything it adds cannot change that render.
    const head: PageHead = clientPage ? {} : sidecar?.head?.({ ...context, data }) ?? {};
    // The payload below is the only copy of this state the browser receives.
    stateStore.seal();
    const payload = serializeJson({
      v: PAYLOAD_VERSION, route: match.route.id, render: renderMode,
      props: payloadProps, state: rendered.state, sharedState: stateStore.snapshot(),
      head: head.title === undefined ? {} : { title: head.title },
      ...(deferredEntries.length ? { deferred: deferredEntries } : {}),
    });
    // Status, headers and cookies are final from here on: session changes still
    // in flight finish first and later ones fail with SESSION_LOCKED. A session
    // revoked while the loader ran must not receive a 200 stream.
    if (streaming && requestContext) {
      await requestContext.session[lockSessionCookie]?.();
      await requestContext.session.verify();
    }
    const title = head.title === undefined ? "" : `<title>${escapeHtml(head.title)}</title>`;
    const host = documentParts(options.document, request);
    const nonceAttribute = host.nonceAttribute;
    const styleTags = [...new Set(styles)].map((css) => `<style${nonceAttribute}>${css.replaceAll("<", "\\3C ")}</style>`).join("");
    const headRequest = request.method === "HEAD";
    if (streaming) {
      const sentCookie = requestContext?.session.cookieHeader;
      let cookieChange = false;
      const line = async (id: number): Promise<string> => {
        let outcome = await outcomes[id]!;
        // Defense in depth for a session object without the lock: the first
        // value that settles after the change fails, the others still arrive.
        if (!cookieChange && requestContext && requestContext.session.cookieHeader !== sentCookie) {
          cookieChange = true;
          outcome = rejectedOutcome(new ApiError("SESSION_LOCKED", 500, "The session cookie changed after the response headers were sent; change the session in the loader, before any deferred work"));
        }
        observeOutcome(outcome);
        return serializeJson({ deferred: id, ...wireOutcome(outcome) });
      };
      const body = (first: string, piece: (text: string, id: number) => string, last: string): ReadableStream<Uint8Array> | null => {
        if (headRequest) {
          deferredWork.abort(new DOMException("A HEAD response has no body", "AbortError"));
          return null;
        }
        return streamBody(first, outcomes.map((_, id) => line(id).then((text) => piece(text, id))), last, (reason, failed) => {
          if (failed) observeServerError(reason, requestId, options.onError);
          deferredWork.abort(reason);
        });
      };
      if (wantsPayload(request)) {
        return finish(new Response(body(`${payload}\n`, (text) => `${text}\n`, ""), {
          status: 200, headers: { "content-type": "application/meeko+ndjson; charset=utf-8", ...streamHeaders },
        }));
      }
      const script = options.clientEntry ? `<script type="module" async${nonceAttribute} src="${escapeHtml(options.clientEntry)}"></script>` : "";
      const csrfMeta = requestContext?.session.current ? `<meta name="meeko-csrf-token" content="${escapeHtml(requestContext.session.current.csrfToken)}">` : "";
      const opening = `${DOCUMENT_HEAD_PREFIX}${csrfMeta}${styleTags}${title}${host.head}</head><body><div id="app">${rendered.html}</div><script id="meeko-payload" type="application/json">${payload}</script>${script}`;
      return finish(new Response(body(opening, (text, id) => `<script type="application/json" data-meeko-deferred="${id}">${text}</script>`, `${host.bodyEnd}</body></html>`), {
        status: 200, headers: { "content-type": "text/html; charset=utf-8", ...streamHeaders },
      }));
    }
    if (wantsPayload(request)) {
      return finish(new Response(headRequest ? null : payload, {
        status: 200, headers: { "content-type": "application/meeko+json; charset=utf-8", "cache-control": "no-store" },
      }));
    }
    const script = options.clientEntry ? `<script type="module"${nonceAttribute} src="${escapeHtml(options.clientEntry)}"></script>` : "";
    const csrfMeta = requestContext?.session.current ? `<meta name="meeko-csrf-token" content="${escapeHtml(requestContext.session.current.csrfToken)}">` : "";
    const document = `${DOCUMENT_HEAD_PREFIX}${csrfMeta}${styleTags}${title}${host.head}</head><body><div id="app">${rendered.html}</div><script id="meeko-payload" type="application/json">${payload}</script>${script}${host.bodyEnd}</body></html>`;
    return finish(new Response(headRequest ? null : document, {
      status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    }));
    };
    return requestContext ? await withRequestContext(requestContext, options.serverFetch, render) : await render();
    } catch (error) {
      deferredWork.abort(error);
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
            // A failure after the render sealed the page state still renders its error page.
            const errorRendered = withStateStore(stateStore.sealed ? new StateStore() : stateStore, () => errorPage.renderWithState({
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

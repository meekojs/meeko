import { AsyncLocalStorage } from "node:async_hooks";
import { escapeHtml, serializeJson } from "../server.js";
import type { RequestContext } from "../framework-server/context.js";
import { withRequestContext } from "../framework-server/context.js";
import type { ServerFetch } from "../framework-server/context.js";
import { ApiError, errorResponse, normalizeServerError, observeServerError } from "../framework-server/contracts.js";
import { lockSessionCookie } from "../framework-server/sessions.js";
import { etagMatches } from "../framework-server/assets.js";
import { ERROR_PAGE_TITLE, PAYLOAD_VERSION, PageInputError, pageSearchObject, payloadHead, validatePageInputs } from "./page.js";
import { runRouteMiddleware } from "./middleware.js";
import type { RouteMiddleware } from "./middleware.js";
import type { PageHead, PageRender, PageSchema } from "./page.js";
import { StateStore, withStateStore } from "./state.js";
import { ResourceScope, withResourceScope } from "./resources.js";
import { renderWithSuspense } from "../suspense.js";
import { collectStyles } from "../dom.js";
import { deferredSettle, deferredSource, extractDeferred } from "./deferred.js";
import type { DeferredInternals, DeferredOutcome } from "./deferred.js";
import { matchRoute, provideServerRouteManifest } from "./router.js";
import { providePageScope } from "./page-body.js";
import { fixedRoute, provideRoute, routeSnapshot } from "./navigation.js";
import type { RouteSnapshot } from "./navigation.js";
import type { PageRequest } from "./page-body.js";
import type { ErrorPageRecord, RouteRecord } from "./router.js";

/** Route manifest of the application handling the current request, for `href(id)`. */
const requestManifest = new AsyncLocalStorage<readonly RouteRecord[]>();
provideServerRouteManifest(() => requestManifest.getStore());

/** Page whose top-level `<script server>` code is running, for `usePage()`, `redirect()` and `notFound()`. */
const runningPage = new AsyncLocalStorage<PageRequest<unknown, unknown>>();
providePageScope({ run: (page, body) => runningPage.run(page, body), current: () => runningPage.getStore() });

/** Runs `run` with `routes` as the manifest of `href(id)`, across its async work. */
export function withRouteManifest<T>(routes: readonly RouteRecord[], run: () => T): T {
  return requestManifest.run(routes, run);
}

/**
 * Forma de un módulo `.meeko` compilado que el handler del servidor renderiza como página, layout o
 * página de error.
 *
 * @example
 * ```ts
 * import type { PageModule } from "@meekojs/meeko/server";
 *
 * const pages = import.meta.glob<PageModule>("/app/pages/*.meeko");
 * const loadPage = async (file: string): Promise<PageModule> => pages[file]!();
 * ```
 */
export interface PageModule {
  /** CSS con ámbito del componente. */
  css?: string;
  /** Renderiza el HTML y captura el estado que se transfiere al navegador. */
  renderWithState(props: Record<string, unknown>): { html: string; state: Record<string, unknown> };
  /** Renderiza sólo el HTML. */
  renderToString?(props: Record<string, unknown>): string;
}

/**
 * Opciones de ruta tal como las carga el servidor desde `<script server>` o un sidecar: la forma sin
 * tipos genéricos de `definePage`.
 *
 * @example
 * ```ts
 * import type { PageRoute } from "@meekojs/meeko/server";
 *
 * const loadRoute = async (file: string): Promise<PageRoute> => {
 *   const module = await import(file) as { route?: PageRoute; default?: PageRoute };
 *   return module.route ?? module.default ?? {};
 * };
 * ```
 */
export interface PageRoute {
  /** Schema de los parámetros de la ruta. */
  params?: PageSchema;
  /** Schema de los parámetros de búsqueda. */
  search?: PageSchema;
  /** Loader del servidor. */
  load?: (context: PageRequestContext) => Promise<unknown> | unknown;
  /** Calcula el `title` con los datos del loader. */
  head?: (context: PageRequestContext & { data: unknown }) => PageHead;
  /** Modo de render. */
  render?: PageRender;
  /** Parámetros de cada URL que se prerenderiza. */
  prerenderEntries?: readonly Readonly<Record<string, string>>[] | (() => Promise<readonly Readonly<Record<string, string>>[]>);
}

/**
 * Contexto que reciben `load` y `head` de una {@link PageRoute} en el servidor.
 *
 * @example
 * ```ts
 * import type { PageRequestContext } from "@meekojs/meeko/server";
 *
 * async function load({ params, searchParams, signal }: PageRequestContext) {
 *   const page = searchParams.get("page") ?? "1";
 *   return (await fetch(`https://api.example.com/posts/${String(params.id)}?page=${page}`, { signal })).json();
 * }
 * ```
 */
export interface PageRequestContext {
  /** Petición HTTP. */
  readonly request: Request;
  /** Parámetros de la ruta, validados por su schema. */
  readonly params: Readonly<Record<string, unknown>>;
  /** Parámetros de búsqueda, validados por su schema. */
  readonly search: Readonly<Record<string, unknown>>;
  /** Query string sin procesar. */
  readonly searchParams: URLSearchParams;
  /** Se aborta si el cliente se desconecta, se revoca la sesión o se cancela la respuesta. */
  readonly signal: AbortSignal;
  /** Estado público que se transfiere de esta petición a la aplicación del navegador. */
  readonly state: StateStore;
  /** Existe cuando el host proporciona un contexto por petición. */
  readonly context?: RequestContext;
}

/**
 * Opciones de {@link createFrameworkHandler}.
 *
 * @typeParam Route Tipo de las opciones de ruta que devuelve `loadRoute`.
 * @example
 * ```ts
 * import type { FrameworkHandlerOptions } from "@meekojs/meeko/server";
 *
 * const options: FrameworkHandlerOptions = {
 *   routes,
 *   errorPage,
 *   loadPage,
 *   loadRoute,
 *   clientEntry: "/assets/entry-client.js",
 *   onError: (error, requestId) => console.error(requestId, error),
 * };
 * ```
 */
export interface FrameworkHandlerOptions<Route = PageRoute> {
  /** Manifiesto de rutas. */
  readonly routes: readonly RouteRecord[];
  /**
   * Página de error de la aplicación (`app/error.meeko`) y sus layouts raíz. Una petición de página
   * sin ruta la renderiza con estado `404` y payload de hidratación; una ruta sin `error` que falla
   * la usa como página de error.
   * @since 1.1.0
   */
  readonly errorPage?: ErrorPageRecord | undefined;
  /** Carga el módulo compilado de una página, un layout o una página de error. */
  readonly loadPage: (file: string) => Promise<PageModule>;
  /** Carga las opciones de ruta de un sidecar o un bloque `<script server>`. */
  readonly loadRoute?: (file: string) => Promise<Route>;
  /** Middleware de ruta isomórfico, que se evalúa antes del loader. */
  readonly loadMiddleware?: () => Promise<readonly RouteMiddleware[]>;
  /** Crea el contexto de cada petición: sesión, servicios y plataforma. */
  readonly createContext?: (request: Request) => RequestContext | Promise<RequestContext>;
  /** Despachador local opcional para las llamadas automáticas a API y RPC durante SSR. */
  readonly serverFetch?: ServerFetch;
  /** Recibe los fallos internos de las páginas con el ID de la petición; nunca llegan al navegador. */
  readonly onError?: (error: unknown, requestId: string) => void;
  /** URL de la entrada del cliente que enlaza el documento. */
  readonly clientEntry?: string;
  /** Añadidos del host a cada documento HTML que renderiza el handler. */
  readonly document?: DocumentOptions;
}

/**
 * HTML de confianza del host: fijo o derivado de la petición y su nonce CSP. No se escapa.
 *
 * @example
 * ```ts
 * import type { DocumentMarkup } from "@meekojs/meeko/server";
 *
 * const analytics: DocumentMarkup = ({ nonce }) =>
 *   `<script${nonce ? ` nonce="${nonce}"` : ""} src="/analytics.js" defer></script>`;
 * ```
 */
export type DocumentMarkup = string | ((context: { readonly request: Request; readonly nonce: string | undefined }) => string);

/**
 * Añadidos del host al documento HTML que renderiza Meeko.
 *
 * @example
 * ```ts
 * import type { DocumentOptions } from "@meekojs/meeko/server";
 *
 * const document: DocumentOptions = {
 *   head: '<link rel="stylesheet" href="/fonts.css">',
 *   bodyEnd: ({ nonce }) => `<script nonce="${nonce ?? ""}">console.log("listo")</script>`,
 *   nonce: (request) => request.headers.get("x-csp-nonce") ?? undefined,
 * };
 * ```
 */
export interface DocumentOptions {
  /** HTML de confianza que se añade a `<head>`, como hojas de estilo y enlaces `modulepreload`. */
  readonly head?: DocumentMarkup;
  /** HTML de confianza que se añade antes de `</body>`, tras la entrada del cliente. */
  readonly bodyEnd?: DocumentMarkup;
  /** Nonce CSP por petición, que se aplica a las etiquetas `<style>` de Meeko y a la entrada del cliente. */
  readonly nonce?: (request: Request) => string | undefined;
}

function documentParts(options: DocumentOptions | undefined, request: Request): { head: string; bodyEnd: string; nonceAttribute: string } {
  const nonce = options?.nonce?.(request);
  const markup = (value: DocumentMarkup | undefined): string => typeof value === "function" ? value({ request, nonce }) : value ?? "";
  return { head: markup(options?.head), bodyEnd: markup(options?.bodyEnd), nonceAttribute: nonce ? ` nonce="${escapeHtml(nonce)}"` : "" };
}

/** Every Meeko document starts with this markup; the CSRF meta tag follows it. */
export const DOCUMENT_HEAD_PREFIX = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">';

/**
 * HTML generado en el build para una URL prerenderizada.
 *
 * @example
 * ```ts
 * import { readFile } from "node:fs/promises";
 * import type { PrerenderedPage } from "@meekojs/meeko/server";
 *
 * const entry = index.pages["/"]!;
 * const page: PrerenderedPage = {
 *   html: await readFile(`prerender/${entry.file}`, "utf8"),
 *   headOffset: entry.headOffset,
 *   etag: entry.etag,
 * };
 * ```
 */
export interface PrerenderedPage {
  /** Documento completo. */
  readonly html: string;
  /**
   * Posición dentro de `<head>` donde se inserta la meta CSRF de cada petición, en unidades de
   * código UTF-16 de `html` (un índice de cadena de JavaScript), nunca en bytes.
   */
  readonly headOffset: number;
  /** `ETag` del documento. */
  readonly etag: string;
  /** Payload de navegación que reciben las navegaciones de cliente a la misma URL. */
  readonly payload?: string;
}

/**
 * Salida del build que el host lee por ruta; las páginas que faltan se renderizan con SSR. Cada
 * adaptador tiene la suya, como `createCloudflarePrerenderSource`.
 *
 * @example
 * ```ts
 * import type { PrerenderSource } from "@meekojs/meeko/server";
 *
 * const prerender: PrerenderSource = {
 *   async get(pathname) {
 *     const entry = index.pages[pathname];
 *     if (!entry) return undefined;
 *     return { html: await read(entry.file), headOffset: entry.headOffset, etag: entry.etag };
 *   },
 * };
 * ```
 */
export interface PrerenderSource {
  /** Devuelve la página prerenderizada de una ruta, o `undefined` para renderizarla con SSR. */
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
 * A document or navigation payload request. API and internal endpoints, and
 * subresources such as scripts or images, keep the plain 404 of a URL without a route.
 */
function wantsPage(request: Request, pathname: string): boolean {
  if (/^\/(?:api|_meeko)(?:\/|$)/.test(pathname)) return false;
  if (wantsPayload(request)) return true;
  return request.headers.get("accept")?.split(",").some((value) => value.trim().toLowerCase().startsWith("text/html")) ?? false;
}

/** Wraps a page in its layouts (outermost first) and collects their CSS in document order. */
async function wrapInLayouts(
  loadPage: (file: string) => Promise<PageModule>,
  page: PageModule,
  props: Record<string, unknown>,
  layouts: readonly string[],
  styles: string[],
): Promise<{ module: PageModule; input: Record<string, unknown> }> {
  let module = page;
  let input = props;
  for (const layout of [...layouts].reverse()) {
    const child = module;
    const childInput = input;
    const outlet = {
      renderWithState: () => child.renderWithState(childInput),
      renderToString: () => child.renderToString?.(childInput) ?? child.renderWithState(childInput).html,
      hydrateScope: () => { throw new Error("Server outlet cannot hydrate"); },
    };
    module = await loadPage(layout);
    if (module.css) styles.unshift(module.css);
    input = { outlet };
  }
  return { module, input };
}

/**
 * Renders a page tree until its top-level data awaits have loaded. Each pass that suspends is
 * discarded with its roots and a fresh copy of the request state, so a retried setup starts from
 * the state the loader left. Returns the state of the pass that completed and the data it read.
 */
async function renderPageTree(
  module: PageModule,
  input: Record<string, unknown>,
  initial: StateStore,
  route: RouteSnapshot,
  signal?: AbortSignal,
): Promise<{ rendered: { html: string; state: Record<string, unknown> }; store: StateStore; resources: Record<string, unknown> | undefined; styles: string[] }> {
  const scope = new ResourceScope("collect", {}, signal);
  // useRoute() in the page, its layouts and app.meeko reads the route of this request.
  const routeState = fixedRoute(route);
  let baseline: Record<string, unknown> | undefined;
  let store = initial;
  // The CSS of the child components of the last pass, the one whose HTML the document sends.
  const styles = new Set<string>();
  const rendered = await renderWithSuspense((pass) => {
    if (pass > 1) store = new StateStore(baseline);
    else baseline = initial.snapshot();
    scope.beginPass();
    styles.clear();
    return collectStyles(styles, () => withResourceScope(scope, () => withStateStore(store, () => {
      provideRoute(routeState);
      return module.renderWithState(input);
    })));
  }, signal ? { signal } : {});
  const used = scope.usedData();
  return { rendered, store, resources: Object.keys(used).length ? used : undefined, styles: [...styles] };
}

/** Props of the application error page for a URL without a route. */
const notFoundProps = { status: 404, message: "NOT_FOUND" } as const;

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

/**
 * Stream responses must reach the browser as written, never cached or buffered
 * by a proxy. `no-transform` also turns off CDN compression and body rewriting,
 * such as Cloudflare's, which may hold part of the body before forwarding it.
 */
const streamHeaders = { "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } as const;

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

/**
 * Crea un handler Fetch portable que renderiza las páginas: middleware de ruta, validación, loader,
 * SSR (también `"stream"` y `"client"`), payload de navegación y páginas de error. Es la pieza de
 * páginas de `createServerApp` para hosts propios; no atiende API, RPC ni archivos.
 *
 * @param options Rutas, cargadores, contexto y documento.
 * @returns Un handler `(request) => Promise<Response>`.
 * @example
 * ```ts
 * import { createFrameworkHandler } from "@meekojs/meeko/server";
 *
 * const handlePage = createFrameworkHandler({
 *   routes,
 *   errorPage,
 *   loadPage: async (file) => pages[file]!(),
 *   loadRoute,
 *   createContext: async (request) => createRequestContext(request, {}, await sessions.load(request)),
 *   clientEntry: "/assets/entry-client.js",
 * });
 * const response = await handlePage(new Request("http://localhost/users/42", { headers: { accept: "text/html" } }));
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#routing-layouts-y-ssr
 */
export function createFrameworkHandler(options: FrameworkHandlerOptions): (request: Request) => Promise<Response>;
/**
 * Igual que la forma anterior, con opciones de ruta tipadas cuyos callbacks reciben los argumentos
 * ya validados por sus schemas.
 */
export function createFrameworkHandler<Route extends TypedPageRoute>(options: FrameworkHandlerOptions<Route>): (request: Request) => Promise<Response>;
export function createFrameworkHandler(options: FrameworkHandlerOptions<unknown>): (request: Request) => Promise<Response> {
  return createPageHandler(options);
}

export function createPageHandler(options: PageHandlerOptions): (request: Request) => Promise<Response> {
  const handle = async (request: Request): Promise<Response> => {
    const fallbackRequestId = crypto.randomUUID();
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, {
      status: 405, headers: { Allow: "GET, HEAD", "x-request-id": fallbackRequestId, "cache-control": "no-store" },
    });
    const stateStore = new StateStore();
    // Aborts timers and listeners of deferred values that will never be sent.
    const deferredWork = new AbortController();
    let errorRoute: string | undefined;
    let requestContext: RequestContext | undefined;
    /** The request state of the render that completed; a suspended pass replaces it. */
    let pageStore = stateStore;
    /** The route of `useRoute()`; validation replaces the raw parameters with the page's. */
    let route: RouteSnapshot | undefined;
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
    route = routeSnapshot(url, match?.route.id ?? null, match ? match.params : {}, pageSearchObject(url.searchParams), false);
    const errorPage = options.errorPage;
    if (!match && !(errorPage && wantsPage(request, url.pathname))) return finish(new Response("Not Found", {
      status: 404, headers: { "cache-control": "no-store" },
    }));
    // The nearest +error.meeko wins; app/error.meeko backs every other failure.
    errorRoute = match?.route.error ?? errorPage?.file;
    requestContext = await options.createContext?.(request);
    if (requestContext && requestContext.request !== request) throw new TypeError("Request context belongs to another request");
    if (!match) {
      // A URL without a route: app/error.meeko inside the root layouts, hydrated like a page.
      const renderNotFound = async (): Promise<Response> => {
        const styles: string[] = [];
        const page = await options.loadPage(errorPage!.file);
        if (page.css) styles.push(page.css);
        const { module, input } = await wrapInLayouts(options.loadPage, page, { ...notFoundProps }, errorPage!.layouts, styles);
        const { rendered, store, resources, styles: childStyles } = await renderPageTree(module, input, stateStore, route!, request.signal);
        styles.push(...childStyles);
        pageStore = store;
        store.seal();
        const payload = serializeJson({
          v: PAYLOAD_VERSION, error: true, render: "ssr",
          props: notFoundProps, state: rendered.state, sharedState: store.snapshot(), head: { title: ERROR_PAGE_TITLE },
          ...(resources ? { resources } : {}),
        });
        const headRequest = request.method === "HEAD";
        if (wantsPayload(request)) {
          return finish(new Response(headRequest ? null : payload, {
            status: 404, headers: { "content-type": "application/meeko+json; charset=utf-8", "cache-control": "no-store" },
          }));
        }
        const host = documentParts(options.document, request);
        const styleTags = [...new Set(styles)].map((css) => `<style${host.nonceAttribute}>${css.replaceAll("<", "\\3C ")}</style>`).join("");
        const script = options.clientEntry ? `<script type="module"${host.nonceAttribute} src="${escapeHtml(options.clientEntry)}"></script>` : "";
        const csrfMeta = requestContext?.session.current ? `<meta name="meeko-csrf-token" content="${escapeHtml(requestContext.session.current.csrfToken)}">` : "";
        // Titled like the error document of a matched route; the payload head carries the same
        // title, so hydration still finds the host <title> after it.
        const document = `${DOCUMENT_HEAD_PREFIX}${csrfMeta}${styleTags}<title>${ERROR_PAGE_TITLE}</title>${host.head}</head><body><div id="app">${rendered.html}</div><script id="meeko-payload" type="application/json">${payload}</script>${script}${host.bodyEnd}</body></html>`;
        return finish(new Response(headRequest ? null : document, {
          status: 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        }));
      };
      return requestContext ? await withRequestContext(requestContext, options.serverFetch, renderNotFound) : await renderNotFound();
    }
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
    route = routeSnapshot(url, match.route.id, validated.params, validated.search, false);
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
    let page: PageModule = emptyOutlet;
    if (!clientPage) {
      page = await options.loadPage(match.route.file);
      if (page.css) styles.push(page.css);
    }
    const { module, input } = await wrapInLayouts(options.loadPage, page, clientPage ? {} : props, match.route.layouts, styles);
    // Top-level data awaits load before the HTML, also before the first byte of a stream.
    const { rendered, store, resources, styles: childStyles } = await renderPageTree(module, input, stateStore, route, driverSignal);
    // Child components link their CSS in the document too, not only once the client bundle loads.
    styles.push(...childStyles);
    pageStore = store;
    // head reads the state the render produced; anything it adds cannot change that render.
    const head: PageHead = clientPage ? {} : sidecar?.head?.({ ...context, state: store, data }) ?? {};
    // The payload below is the only copy of this state the browser receives.
    store.seal();
    const payload = serializeJson({
      v: PAYLOAD_VERSION, route: match.route.id, render: renderMode,
      props: payloadProps, state: rendered.state, sharedState: store.snapshot(),
      head: payloadHead(head),
      ...(deferredEntries.length ? { deferred: deferredEntries } : {}),
      ...(resources ? { resources } : {}),
    });
    // Status, headers and cookies are final from here on: session changes still
    // in flight finish first and later ones fail with SESSION_LOCKED. A session
    // revoked while the loader ran must not receive a 200 stream.
    if (streaming && requestContext) {
      await requestContext.session[lockSessionCookie]?.();
      await requestContext.session.verify();
    }
    const title = (head.title === undefined ? "" : `<title>${escapeHtml(head.title)}</title>`)
      + (head.description === undefined ? "" : `<meta name="description" content="${escapeHtml(head.description)}">`);
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
            const { rendered: errorRendered } = await renderPageTree(errorPage, {
              status: known.status, message: known.status >= 500 ? "Internal Server Error" : known.code,
            }, pageStore.sealed ? new StateStore() : pageStore, route!, request.signal);
            const host = documentParts(options.document, request);
            const document = `<!doctype html><html><head><meta charset="utf-8"><title>${ERROR_PAGE_TITLE}</title>${host.head}</head><body><div id="app">${errorRendered.html}</div>${host.bodyEnd}</body></html>`;
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
  // href(id) in pages, layouts, loaders and head resolves against this handler's manifest.
  return (request) => withRouteManifest(options.routes, () => handle(request));
}

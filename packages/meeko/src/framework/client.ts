import { hasRegionRecoveryFailure, parseRegionHtml } from "../dom.js";
import type { Component, DomScope } from "../dom.js";
import { createAppErrorChannel, provideAppErrorChannel } from "../component-errors.js";
import type { ComponentErrorHandler } from "../component-errors.js";
import { batch, finishWithCleanup, runDry, signal } from "../reactivity.js";
import type { Signal } from "../reactivity.js";
import { ERROR_PAGE_TITLE, PAYLOAD_VERSION, PageInputError, pageSearchObject, payloadHead, validatePageInputs } from "./page.js";
import type { PageHead, PageRender, PageSchema } from "./page.js";
import { ClientError } from "./clients.js";
import { runRouteMiddleware } from "./middleware.js";
import { fixedRoute, liveRoute, provideNavigation, provideRoute, routeSnapshot } from "./navigation.js";
import type { LiveRoute, NavigationState, RouteState } from "./navigation.js";
import type { RouteMiddleware } from "./middleware.js";
import { activateRouteManifest, createAppNavigator, matchRoute, reportNavigationError, sameDocument } from "./router.js";
import type { ErrorPageRecord, NavigationContext, Navigator, RouteMatch, RouteRecord, UnmatchedNavigationContext } from "./router.js";
import { hydrateWithStateStore, StateStore, withStateStore } from "./state.js";
import { createDeferred, deferredSettle, deferredSource, extractDeferred, placeDeferred } from "./deferred.js";
import { provideResourceCache, ResourceCache, ResourceScope, withResourceScope } from "./resources.js";
import { provideBrowserWindow } from "./storage.js";
import { lateRender, mayAwaitData, renderWithSuspense } from "../suspense.js";
import { mountBatch } from "../lifecycle.js";
import { notifyPluginErrorHandlers, runPlugins } from "./plugin.js";
import type { PluginRegistration } from "./plugin.js";
import type { DeferredError, DeferredInternals, DeferredOutcome } from "./deferred.js";
import { BrowserHead, provideHead, routeHeadInput, withHeadLevel } from "./head.js";
import type { DocumentConfig, HeadInput } from "./head.js";

export { useNavigation, useRoute } from "./navigation.js";
export type { NavigationState, RouteState } from "./navigation.js";

/**
 * Forma pública de un módulo `.meeko` compilado que necesita `mountClientApp` para renderizar e
 * hidratar páginas y layouts.
 *
 * @example
 * ```ts
 * import type { ClientComponent } from "@meekojs/meeko/framework";
 * import { modules as pages } from "virtual:meeko-client-pages";
 *
 * async function loadPage(file: string): Promise<ClientComponent> {
 *   const load = pages[file];
 *   if (!load) throw new Error(`Page module missing: ${file}`);
 *   return await load() as ClientComponent;
 * }
 * ```
 */
export interface ClientComponent {
  /** Renderiza el HTML y captura el estado de sus señales. */
  renderWithState(props: Record<string, unknown>): { html: string; state: Record<string, unknown> };
  /** Renderiza el HTML, opcionalmente desde un estado capturado. */
  renderToString(props: Record<string, unknown>, state?: Record<string, unknown>): string;
  /** Hidrata el HTML existente dentro de `scope`; devuelve la función de liberación. */
  hydrateScope(scope: DomScope, props: Record<string, unknown>, state?: Record<string, unknown>): () => void;
}

/**
 * Opciones de ruta que se ejecutan en el navegador: las de una ruta `render: "client"` o las de un
 * host que usa `loadRoute`. Son públicas, así que no pueden contener secretos; un sidecar sólo de
 * servidor no debe pasarse a `loadRoute`.
 *
 * @example
 * ```ts
 * import type { ClientRoute } from "@meekojs/meeko/framework";
 *
 * export const route: ClientRoute = {
 *   load: async ({ params, signal }) => (await fetch(`/api/notes/${String(params.id)}`, { signal })).json(),
 *   head: ({ data }) => ({ title: (data as { title: string }).title }),
 * };
 * ```
 */
export interface ClientRoute {
  /** Schema de los parámetros de la ruta. */
  params?: PageSchema;
  /** Schema de los parámetros de búsqueda. */
  search?: PageSchema;
  /** Loader del navegador; recibe la navegación, `params`, `search` y el estado provisional. */
  load?: (context: ClientRouteContext) => Promise<unknown> | unknown;
  /** Calcula el `title` y la `description` con los datos del loader; se aplican al documento. */
  head?: (context: ClientRouteContext & { data: unknown }) => PageHead;
}

type ClientRouteContext = NavigationContext & {
  params: Readonly<Record<string, unknown>>;
  search: Readonly<Record<string, unknown>>;
  state: StateStore;
};

/**
 * Opciones de {@link mountClientApp}. La entrada cliente que genera Meeko las rellena a partir de
 * los módulos virtuales del plugin de Vite.
 *
 * @example
 * ```ts
 * import { mountClientApp } from "@meekojs/meeko/framework";
 * import type { ClientAppOptions, ClientComponent } from "@meekojs/meeko/framework";
 *
 * const options: ClientAppOptions = {
 *   root: document.getElementById("app")!,
 *   payload: document.getElementById("meeko-payload")?.textContent,
 *   routes,
 *   serverData: true,
 *   loadPage: async (file) => await pages[file]!() as ClientComponent,
 *   onError: (error, source) => console.error(source, error),
 * };
 * const app = await mountClientApp(options);
 * ```
 */
export interface ClientAppOptions {
  /** Manifiesto de rutas, el mismo que usa el servidor. */
  readonly routes: readonly RouteRecord[];
  /**
   * Página de error de la aplicación (`app/error.meeko`) y sus layouts raíz. Hidrata una página
   * `404` del servidor y respalda las rutas `render: "client"` sin `+error.meeko`.
   * @since 1.1.0
   */
  readonly errorPage?: ErrorPageRecord | undefined;
  /** Elemento raíz que contiene el HTML SSR (`#app`). */
  readonly root: Element;
  /** Payload de hidratación de `#meeko-payload`, como texto JSON o ya analizado. */
  readonly payload: string | unknown;
  /** Carga el módulo compilado de una página o un layout por su archivo. */
  readonly loadPage: (file: string) => Promise<ClientComponent>;
  /** Carga las opciones de ruta públicas de un sidecar para ejecutar su loader en el navegador. */
  readonly loadRoute?: (file: string) => Promise<ClientRoute>;
  /**
   * Carga el sidecar de navegador de una ruta `render: "client"`. Estas rutas siempre toman sus
   * datos de este loader, también con `serverData`; por defecto, `loadRoute`.
   */
  readonly loadClientRoute?: (file: string) => Promise<ClientRoute>;
  /** Carga el middleware de ruta, que se ejecuta como en SSR antes de pedir cada navegación. */
  readonly loadMiddleware?: () => Promise<readonly RouteMiddleware[]>;
  /** Pide al handler SSR los datos públicos del loader al navegar (`application/meeko+json`). */
  readonly serverData?: boolean;
  /** Implementación de `fetch` para las navegaciones; por defecto, la global. */
  readonly fetch?: typeof fetch;
  /** Observa los fallos de navegación por clic o historial; tiene prioridad sobre `onError`. */
  readonly onNavigationError?: (error: unknown) => void;
  /**
   * Observa los fallos de esta aplicación en el navegador: navegación, clientes Socket y eventos,
   * efectos o limpiezas de componentes sin un `provideErrorHandler` más cercano.
   */
  readonly onError?: ComponentErrorHandler;
  /** Ventana del navegador; por defecto, `window`. */
  readonly browser?: Window;
  /**
   * `document` de `meeko.config.ts`, el mismo que renderiza el servidor: la entrada cliente que
   * genera Meeko lo toma de `virtual:meeko-manifest/client`. `useHead` y la navegación lo usan para
   * aplicar `titleTemplate` y restaurar sus etiquetas.
   * @since 1.2.0
   */
  readonly document?: DocumentConfig | undefined;
  /**
   * Plugins de aplicación (`definePlugin`), que se ejecutan en orden antes de la hidratación. Sus
   * valores de `provide` llegan a todos los componentes, y sus observadores de `onError` reciben lo
   * mismo que `onError`. La entrada que genera Meeko pasa los de `app/plugins` y los módulos.
   * @since 1.2.0
   */
  readonly plugins?: readonly PluginRegistration[];
}

/**
 * Aplicación montada que devuelve {@link mountClientApp}.
 *
 * @example
 * ```ts
 * const app = await mountClientApp(options);
 * await app.navigate("/users/42");
 * const theme = app.state.get("theme", () => "light");
 * app.dispose();
 * ```
 */
export interface ClientApp {
  /** Navega dentro de la aplicación; rechaza con el error original si la navegación falla. */
  navigate: Navigator["navigate"];
  /** Estado de `useState` compartido por la aplicación. */
  readonly state: StateStore;
  /** Libera páginas, layouts, listeners y conexiones Socket de la aplicación. */
  dispose(): void;
}

interface HydrationPayload {
  /** Empty in an application error page payload (`error: true`), which has no route. */
  route: string;
  /** The payload renders `app/error.meeko` for a URL without a route; props are `{ status, message }`. */
  error: boolean;
  render: PageRender;
  props: Record<string, unknown>;
  state: Record<string, unknown>;
  sharedState: Record<string, unknown>;
  head: PageHead;
  deferred: readonly PayloadDeferred[];
  /** Data of the top-level data awaits that the server rendered, by request key. */
  resources: Record<string, unknown>;
}

const pageRenders: readonly string[] = ["ssr", "stream", "prerender", "client"] satisfies readonly PageRender[];

/** Outlet of a client page until its loader resolves; the server rendered it empty. */
const emptyOutlet: Component<Record<string, unknown>> = {
  renderWithState: () => ({ html: "", state: {} }),
  renderToString: () => "",
  hydrateScope: () => () => {},
};

/** A navigation to a route, or without `match` to a URL that renders the application error page. */
type RenderContext = UnmatchedNavigationContext & { readonly match?: RouteMatch };

/** Props of `+error.meeko`, with the same public messages as the server error page. */
function errorPageProps(error: unknown): { status: number; message: string } {
  if (error instanceof PageInputError) return { status: 400, message: error.code };
  if (error instanceof ClientError && error.status >= 400 && error.status < 500) return { status: error.status, message: error.code };
  return { status: 500, message: "Internal Server Error" };
}

interface LayoutInstance {
  file: string;
  outlet: Signal<Component<Record<string, unknown>>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPayload(value: unknown): HydrationPayload {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (isRecord(parsed) && parsed.v !== PAYLOAD_VERSION) {
    throw new TypeError(`Unsupported Meeko payload version ${String(parsed.v)}; the server and browser bundles must come from the same build`);
  }
  const error = isRecord(parsed) && parsed.error === true;
  if (!isRecord(parsed) || (!error && typeof parsed.route !== "string") || !isRecord(parsed.props) || !isRecord(parsed.state)) {
    throw new TypeError("Invalid Meeko hydration payload");
  }
  if (error) {
    if (typeof parsed.props.status !== "number" || !Number.isInteger(parsed.props.status) || typeof parsed.props.message !== "string") {
      throw new TypeError("Invalid Meeko error page props");
    }
  } else if (!isRecord(parsed.props.params) || !isRecord(parsed.props.search)) throw new TypeError("Invalid Meeko route props");
  if (parsed.sharedState !== undefined && !isRecord(parsed.sharedState)) throw new TypeError("Invalid Meeko shared state");
  if (parsed.resources !== undefined && !isRecord(parsed.resources)) throw new TypeError("Invalid Meeko page data");
  const render = parsed.render ?? "ssr";
  if (typeof render !== "string" || !pageRenders.includes(render) || (error && render !== "ssr")) throw new TypeError("Invalid Meeko page render mode");
  let head: PageHead;
  try { head = payloadHead((parsed.head ?? {}) as PageHead); }
  catch (cause) { throw new TypeError("Invalid Meeko page head", { cause }); }
  return {
    route: error ? "" : parsed.route as string, error, render: render as PageRender, props: parsed.props, state: parsed.state,
    sharedState: parsed.sharedState ?? {}, head,
    deferred: readDeferredEntries(parsed.deferred),
    resources: (parsed.resources as Record<string, unknown> | undefined) ?? {},
  };
}

/** A deferred value listed in the payload; `outcome` is absent while it is pending. */
interface PayloadDeferred {
  readonly id: number;
  readonly path: readonly (string | number)[];
  readonly outcome: DeferredOutcome | undefined;
}

/** One settled value from a streamed `<script data-meeko-deferred>` or ndjson line. */
interface DeferredLine {
  readonly id: number;
  readonly outcome: DeferredOutcome;
}

/** A stream that ended before sending a value, for example after a failed write on the server. */
const incompleteDeferred: DeferredError = { code: "DEFERRED_INCOMPLETE", status: 502 };

function readDeferredError(value: unknown): DeferredError {
  if (!isRecord(value) || typeof value.code !== "string" || typeof value.status !== "number" || !Number.isInteger(value.status)) {
    throw new TypeError("Invalid Meeko deferred error");
  }
  return { code: value.code, status: value.status };
}

function readDeferredEntries(value: unknown): PayloadDeferred[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError("Invalid Meeko deferred list");
  return value.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.id !== "number" || !Number.isSafeInteger(entry.id) || entry.id < 0 || !Array.isArray(entry.path)
      || !entry.path.every((key: unknown) => typeof key === "string" || (typeof key === "number" && Number.isSafeInteger(key)))) {
      throw new TypeError("Invalid Meeko deferred entry");
    }
    let outcome: DeferredOutcome | undefined;
    if (entry.status === "resolved") outcome = "value" in entry ? { status: "resolved", value: entry.value } : { status: "resolved" };
    else if (entry.status === "rejected") outcome = { status: "rejected", error: readDeferredError(entry.error) };
    else if (entry.status !== "pending") throw new TypeError("Invalid Meeko deferred status");
    return { id: entry.id, path: entry.path as (string | number)[], outcome };
  });
}

function readDeferredLine(value: unknown): DeferredLine {
  if (!isRecord(value) || typeof value.deferred !== "number" || !Number.isSafeInteger(value.deferred)) throw new TypeError("Invalid Meeko deferred chunk");
  const outcome: DeferredOutcome = "error" in value ? { status: "rejected", error: readDeferredError(value.error) }
    : "value" in value ? { status: "resolved", value: value.value } : { status: "resolved" };
  return { id: value.deferred, outcome };
}

/** Puts a deferred value at each payload path; settled entries arrive settled. */
function placePayloadDeferred(props: Record<string, unknown>, entries: readonly PayloadDeferred[]): Map<number, DeferredInternals> {
  const values = new Map<number, DeferredInternals>();
  for (const entry of entries) {
    if (values.has(entry.id)) throw new TypeError(`Duplicate Meeko deferred id ${entry.id}`);
    const value = createDeferred(entry.outcome);
    if (!placeDeferred(props, entry.path, value)) throw new TypeError(`Invalid Meeko deferred path ${JSON.stringify(entry.path)}`);
    values.set(entry.id, value);
  }
  return values;
}

/**
 * Collects streamed values and applies them only after `open()`, once the
 * page that reads them has hydrated or committed. `end()` rejects whatever
 * never arrived.
 */
function deferredReceiver(values: ReadonlyMap<number, DeferredInternals>, report: (error: unknown) => void) {
  let ready = false;
  let ended = false;
  const queue: DeferredLine[] = [];
  const settle = (value: DeferredInternals, outcome: DeferredOutcome): void => {
    try { value[deferredSettle](outcome); }
    catch (error) { report(error); }
  };
  const apply = (line: DeferredLine): void => {
    const target = values.get(line.id);
    if (!target) report(new TypeError(`Unknown Meeko deferred id ${line.id}`));
    else settle(target, line.outcome);
  };
  const finish = (): void => {
    for (const value of values.values()) if (value.status === "pending") settle(value, { status: "rejected", error: incompleteDeferred });
  };
  return {
    receive(line: DeferredLine): void {
      if (ready) apply(line);
      else queue.push(line);
    },
    open(): void {
      if (ready) return;
      ready = true;
      for (const line of queue.splice(0)) apply(line);
      if (ended) finish();
    },
    end(): void {
      ended = true;
      if (ready) finish();
    },
  };
}

type BrowserGlobals = Window & { MutationObserver: typeof MutationObserver };

/**
 * Reads `<script type="application/json" data-meeko-deferred>` chunks already
 * in the document and those the parser adds to `<body>` later. Only direct
 * children of `<body>` after `#meeko-payload` count: the server writes them
 * there, while page content (including injected markup) lives inside the app
 * root. A chunk whose text is still arriving is retried when it changes. The
 * parsed document ends at DOMContentLoaded; then `end` runs.
 */
function watchDeferredChunks(browser: Window, receive: (line: DeferredLine) => void, end: () => void, report: (error: unknown) => void): () => void {
  const document = browser.document;
  const Observer = (browser as BrowserGlobals).MutationObserver;
  const seen = new WeakSet<Element>();
  const waiting = new Map<Element, MutationObserver>();
  let stopped = false;
  const consume = (script: Element): void => {
    if (stopped || seen.has(script)) return;
    let parsed: unknown;
    try { parsed = JSON.parse(script.textContent ?? ""); }
    catch {
      if (!waiting.has(script)) {
        const observer = new Observer(() => consume(script));
        observer.observe(script, { childList: true, characterData: true, subtree: true });
        waiting.set(script, observer);
      }
      return;
    }
    seen.add(script);
    waiting.get(script)?.disconnect();
    waiting.delete(script);
    try { receive(readDeferredLine(parsed)); }
    catch (error) { report(error); }
  };
  const isChunk = (element: Element): boolean => element.tagName === "SCRIPT"
    && element.getAttribute("type") === "application/json" && element.hasAttribute("data-meeko-deferred");
  const scan = (): void => {
    let afterPayload = false;
    for (let element = document.body?.firstElementChild ?? null; element; element = element.nextElementSibling) {
      if (afterPayload) { if (isChunk(element)) consume(element); }
      else afterPayload = element.tagName === "SCRIPT" && element.id === "meeko-payload";
    }
  };
  const body = new Observer(scan);
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    body.disconnect();
    for (const observer of waiting.values()) observer.disconnect();
    waiting.clear();
    document.removeEventListener("DOMContentLoaded", complete);
  };
  const complete = (): void => {
    scan();
    if (stopped) return;
    for (const script of waiting.keys()) report(new TypeError(`Invalid Meeko deferred chunk ${script.getAttribute("data-meeko-deferred") ?? ""}`));
    stop();
    end();
  };
  body.observe(document.body ?? document.documentElement, { childList: true });
  scan();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", complete, { once: true });
  else complete();
  return stop;
}

/** Splits an ndjson body into lines; aborting `signal` cancels the read. */
async function* ndjsonLines(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const cancel = (): void => { void reader.cancel(signal.reason).catch(() => {}); };
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) break;
      buffer += decoder.decode(value, { stream: true });
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim()) yield line;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim() && !signal.aborted) yield buffer;
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!signal.aborted) void reader.cancel().catch(() => {});
  }
}

/** Public shape of a browser-side failure, as `{ code, status }`. */
function clientDeferredError(error: unknown): DeferredError {
  if (typeof error === "object" && error !== null) {
    const { code, status } = error as { code?: unknown; status?: unknown };
    if (typeof code === "string" && code && typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599) return { code, status };
  }
  return { code: "INTERNAL_ERROR", status: 500 };
}

/**
 * Settles deferred values returned by a loader that runs in the browser.
 * `signal` aborts when the route is left; a factory's signal also aborts on
 * its timeout.
 */
function driveClientDeferred(data: unknown, report: (error: unknown) => void, signal: AbortSignal): void {
  for (const { deferred } of extractDeferred(data).found) {
    const source = deferred[deferredSource];
    if (!source) continue;
    const work = new AbortController();
    let settled = false;
    const settle = (outcome: DeferredOutcome, abandoned?: { readonly reason: unknown }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (abandoned) work.abort(abandoned.reason);
      try { deferred[deferredSettle](outcome); }
      catch (error) { report(error); }
    };
    const onAbort = (): void => settle({ status: "rejected", error: clientDeferredError(signal.reason) }, { reason: signal.reason });
    const timer = setTimeout(() => settle(
      { status: "rejected", error: { code: "DEFERRED_TIMEOUT", status: 504 } },
      { reason: new DOMException(`Deferred value did not settle within ${source.timeoutMs} ms`, "TimeoutError") },
    ), source.timeoutMs);
    if (signal.aborted) { onAbort(); continue; }
    signal.addEventListener("abort", onAbort, { once: true });
    source.start(work.signal).then(
      (value) => settle(value === undefined ? { status: "resolved" } : { status: "resolved", value }),
      (error: unknown) => settle({ status: "rejected", error: clientDeferredError(error) }),
    );
  }
}

function applyCsrfToken(browser: Window, token: string): () => void {
  const meta = browser.document.querySelector<HTMLMetaElement>('meta[name="meeko-csrf-token"]');
  const previous = meta?.getAttribute("content") ?? null;
  let created: HTMLMetaElement | undefined;
  if (token && meta) meta.content = token;
  else if (token) {
    created = browser.document.createElement("meta");
    created.name = "meeko-csrf-token";
    created.content = token;
    browser.document.head.append(created);
  } else meta?.remove();
  return () => {
    if (meta) {
      if (!meta.isConnected) browser.document.head.append(meta);
      if (previous === null) meta.removeAttribute("content");
      else meta.setAttribute("content", previous);
    } else created?.remove();
  };
}

function bind(component: ClientComponent, props: Record<string, unknown>): Component<Record<string, unknown>> {
  return {
    renderWithState: () => component.renderWithState(props),
    renderToString: () => component.renderToString(props),
    hydrateScope: (scope, _unused, state) => component.hydrateScope(scope, props, state),
  };
}

async function createTree(
  chain: readonly string[],
  props: Record<string, unknown>,
  loadPage: ClientAppOptions["loadPage"],
  fromLayout: number,
  leaf: string | Component<Record<string, unknown>>,
): Promise<{ component: Component<Record<string, unknown>>; layouts: LayoutInstance[]; modules: unknown[] }> {
  const page = typeof leaf === "string" ? await loadPage(leaf) : undefined;
  // useHead of the page outranks its layouts', and a layout's outranks app.meeko's, as in SSR.
  let component = page ? withHeadLevel(bind(page, props), chain.length) : leaf as Component<Record<string, unknown>>;
  const layouts: LayoutInstance[] = [];
  /** The compiled modules that render the tree, for `mayAwaitData`; an empty outlet renders none. */
  const modules: unknown[] = page ? [page] : [];
  for (let index = chain.length - 1; index >= fromLayout; index--) {
    const file = chain[index]!;
    const outlet = signal(component);
    const layoutProps = Object.defineProperty({}, "outlet", {
      enumerable: true,
      get: () => outlet.value,
    }) as Record<string, unknown>;
    const layout = await loadPage(file);
    modules.push(layout);
    component = withHeadLevel(bind(layout, layoutProps), index);
    layouts.unshift({ file, outlet });
  }
  return { component, layouts, modules };
}

/**
 * Hidrata el árbol SSR de la aplicación y gestiona la navegación de cliente: historial, enlaces,
 * cancelación, middleware de ruta y limpieza. Al navegar sólo sustituye el primer outlet que
 * cambia; los layouts renderizan su outlet con `<component is="props.outlet">`. La navegación es
 * transaccional: si falla, la página anterior sigue visible.
 *
 * @param options Rutas, raíz, payload y cargadores de módulos.
 * @returns La aplicación montada.
 * @throws {TypeError} Si el payload no es válido o viene de otro build.
 * @throws {Error} Si la ruta o sus parámetros no coinciden con los del SSR, o falla la hidratación.
 * @example
 * ```ts
 * import { mountClientApp } from "@meekojs/meeko/framework";
 * import type { ClientComponent } from "@meekojs/meeko/framework";
 * import { modules as pages } from "virtual:meeko-client-pages";
 * import { errorPage, routes } from "virtual:meeko-manifest/client";
 *
 * const app = await mountClientApp({
 *   root: document.getElementById("app")!,
 *   payload: document.getElementById("meeko-payload")?.textContent,
 *   routes,
 *   errorPage,
 *   serverData: true,
 *   loadPage: async (file) => await pages[file]!() as ClientComponent,
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#routing-layouts-y-ssr
 */
export async function mountClientApp(options: ClientAppOptions): Promise<ClientApp> {
  const browser = options.browser ?? window;
  const payload = readPayload(options.payload);
  // Adopts the head that SSR wrote; a page without a title shows the host's, not the previous page's.
  const documentHead = new BrowserHead(browser.document, options.document);
  // An error page (notFound(), a loader or data failure, or app/error.meeko for a URL without
  // a route) has the title of its SSR error document.
  const routeHead = (head: PageHead, errorPage: boolean): HeadInput => routeHeadInput(head, errorPage ? ERROR_PAGE_TITLE : undefined);
  const appError = options.errorPage;
  const initial = matchRoute(options.routes, browser.location.pathname);
  if (payload.error) {
    // The server rendered app/error.meeko for a URL without a route.
    if (initial || !appError) throw new Error("Meeko route hydration mismatch");
  } else {
    if (!initial || initial.route.id !== payload.route) throw new Error("Meeko route hydration mismatch");
    if (JSON.stringify(initial.params) !== JSON.stringify(payload.props.params)) throw new Error("Meeko route parameters do not match SSR");
  }
  const stateStore = new StateStore(payload.sharedState);
  // The route of useRoute(): the server's values, so hydration matches; the fragment the server
  // never saw is applied right after hydration.
  const initialUrl = new URL(browser.location.href);
  let committedRoute: LiveRoute = liveRoute(payload.error
    ? routeSnapshot(initialUrl, null, {}, pageSearchObject(initialUrl.searchParams), false)
    : routeSnapshot(initialUrl, payload.route, payload.props.params as Record<string, unknown>, payload.props.search as Record<string, unknown>, false));
  const resourceCache = new ResourceCache();
  // The route of the plugins follows the committed route, also when a navigation replaces the
  // whole tree (and its live route): reading it also reads `routeGeneration`.
  const routeGeneration = signal(0);
  const followCommitted = <K extends keyof RouteState>(key: K): RouteState[K] => Object.freeze({
    get value() { void routeGeneration.value; return committedRoute.state[key].value; },
  }) as RouteState[K];
  const pluginRoute: RouteState = Object.freeze({
    url: followCommitted("url"), path: followCommitted("path"), id: followCommitted("id"),
    params: followCommitted("params"), search: followCommitted("search"),
  });
  // href(id) already resolves while the plugins start.
  const releasePluginManifest = activateRouteManifest(options.routes);
  let plugins: Awaited<ReturnType<typeof runPlugins>>;
  try { plugins = await runPlugins(options.plugins, { side: "client", route: pluginRoute }); }
  finally { releasePluginManifest(); }
  const pluginObserver: ComponentErrorHandler | undefined = plugins.errorHandlers.length
    ? (error, source) => notifyPluginErrorHandlers(plugins.errorHandlers, error, { side: "client", source })
    : undefined;
  const hostObserver = options.onError;
  const applicationObserver: ComponentErrorHandler | undefined = hostObserver && pluginObserver
    ? (error, source) => { try { hostObserver(error, source); } finally { pluginObserver(error, source); } }
    : hostObserver ?? pluginObserver;
  const errorChannel = createAppErrorChannel(applicationObserver);
  const observeNavigationError = options.onNavigationError ?? ((error: unknown) => {
    const handler = errorChannel.current();
    if (handler) return handler(error, "navigation");
    reportNavigationError(browser, error);
  });
  const pending = signal(false);
  const navigationState: NavigationState = { pending: { get value() { return pending.value; } } };
  const hydrateApp = (routeState: RouteState, hydrate: () => () => void) => hydrateWithStateStore(stateStore, () => {
    provideAppErrorChannel(errorChannel);
    provideNavigation(navigationState);
    provideRoute(routeState);
    provideResourceCache(resourceCache);
    provideBrowserWindow(browser);
    provideHead(documentHead);
    plugins.apply();
    return hydrate();
  });
  // A client page arrives with its layouts around an empty outlet; the page
  // itself commits below through the regular navigation path.
  const clientFirst = payload.render === "client";
  const reportDeferred = (error: unknown): void => reportNavigationError(browser, error, observeNavigationError);
  // Streamed values hydrate pending, exactly as the server rendered them, and
  // are applied only after hydrateScope returns.
  const initialDeferred = placePayloadDeferred(payload.props, payload.deferred);
  const initialReceiver = deferredReceiver(initialDeferred, reportDeferred);
  let stopChunks = (): void => {};
  if ([...initialDeferred.values()].some((value) => value.status === "pending")) {
    stopChunks = watchDeferredChunks(browser, initialReceiver.receive, initialReceiver.end, reportDeferred);
  }
  let first: Awaited<ReturnType<typeof createTree>>;
  let release: () => void;
  // href(id) resolves against this app's manifest from hydration until dispose.
  const releaseManifest = activateRouteManifest(options.routes);
  try {
    first = initial
      ? await createTree(initial.route.layouts, payload.props, options.loadPage, 0, clientFirst ? emptyOutlet : initial.route.file)
      : await createTree(appError!.layouts, payload.props, options.loadPage, 0, appError!.file);
    // Awaited data comes from the payload: hydration stays synchronous and never requests it again.
    const initialData = new ResourceScope("read", payload.resources);
    // onMounted callbacks run once the whole tree has hydrated. The head adopts the SSR tags once,
    // with every useHead of the hydrated tree registered.
    release = documentHead.hold(() => {
      documentHead.setRoute(routeHead(payload.head, payload.error));
      return withResourceScope(initialData, () => hydrateApp(committedRoute.state, () => mountBatch(() => first.component.hydrateScope({ root: options.root }, {}, payload.state))));
    });
    resourceCache.merge(initialData.loadedData());
  } catch (error) {
    stopChunks();
    releaseManifest();
    throw error;
  }
  let layouts = first.layouts;
  initialReceiver.open();
  /** The ndjson read of the committed stream route; the next commit cancels it. */
  let activeStream: AbortController | undefined;
  let disposed = false;
  let stableUrl = browser.location.href;
  /** A fragment-only change of the committed URL (history, a fragment link or `navigate("#x")`) updates `useRoute().url`. */
  const syncFragment = (url: URL): void => {
    if (disposed) return;
    const committed = committedRoute.current();
    const href = url.pathname + url.search;
    if (committed.url.split("#")[0] !== href || committed.url === href + url.hash) return;
    try { committedRoute.set({ ...committed, url: href + url.hash }); }
    catch (error) { reportNavigationError(browser, error, observeNavigationError); }
  };
  syncFragment(initialUrl);
  const recoverCommitFailure = (error: unknown): never => {
    // A failed outlet update or hydration can leave live scopes attached to a
    // partially replaced tree. Recreate the last committed route with SSR.
    try {
      browser.location.replace(stableUrl);
    } catch (recoveryError) {
      throw new AggregateError([error, recoveryError], "Meeko navigation failed and could not restore the previous route");
    }
    throw error;
  };
  // Server middleware already guarded the first load of a client page.
  let initialClientLoad = clientFirst;
  let navigationCount = 0;
  const consumeStream = (lines: AsyncGenerator<string> | undefined, values: ReadonlyMap<number, DeferredInternals>, signal: AbortSignal | undefined): void => {
    const receiver = deferredReceiver(values, reportDeferred);
    receiver.open();
    if (!lines || !signal) { receiver.end(); return; }
    void (async () => {
      try {
        for await (const text of lines) {
          let line: DeferredLine;
          try { line = readDeferredLine(JSON.parse(text)); }
          catch (error) {
            reportDeferred(error);
            continue;
          }
          receiver.receive(line);
        }
      } catch (error) {
        // The read failed mid-way (network, server write): what never arrived is incomplete.
        if (!signal.aborted) reportDeferred(error);
      }
      if (!signal.aborted) receiver.end();
    })();
  };
  const renderRoute = async (context: RenderContext, initialLoad: boolean): Promise<void | boolean> => {
    const stream: { control?: AbortController; committed?: boolean } = {};
    try { return await renderRouteData(context, initialLoad, stream); }
    finally { if (!stream.committed) stream.control?.abort(); }
  };
  const renderRouteData = async (context: RenderContext, initialLoad: boolean, stream: { control?: AbortController; committed?: boolean }): Promise<void | boolean> => {
    const match = context.match;
    if (match && options.loadMiddleware && !initialLoad) {
      const response = await runRouteMiddleware(await options.loadMiddleware(), {
        url: context.url, match, signal: context.signal, phase: "client",
      });
      if (context.signal.aborted || disposed) return false;
      if (response) {
        const location = response.headers.get("location");
        if (response.status >= 300 && response.status < 400 && location) {
          const target = new URL(location, context.url);
          if (target.href === context.url.href) throw new Error("Route middleware redirected to the same URL");
          browser.location.assign(target.href);
        } else reportNavigationError(browser, new Error(`Route middleware blocked navigation: HTTP ${response.status}`), observeNavigationError);
        return false;
      }
    }
    let props: Record<string, unknown> = {};
    let serverSharedState: Record<string, unknown> | undefined;
    let serverCsrfToken: string | null = null;
    let loaderDraft: ReturnType<StateStore["navigationDraft"]> | undefined;
    let head: PageHead = {};
    let errorPage: string | undefined;
    let lines: AsyncGenerator<string> | undefined;
    let navigationDeferred: ReadonlyMap<number, DeferredInternals> | undefined;
    let serverData: Record<string, unknown> = {};
    // useRoute() values of the target: the parameters the page receives once they are known.
    let routeParams: Readonly<Record<string, unknown>> = match?.params ?? {};
    let routeSearch: Readonly<Record<string, unknown>> = pageSearchObject(context.url.searchParams);
    const route = match?.route;
    /** Aborted when this navigation is superseded before its commit, or by the next commit or dispose. */
    const routeWork = (): AbortSignal => {
      if (!stream.control) {
        const control = new AbortController();
        stream.control = control;
        const supersede = (): void => control.abort(context.signal.reason);
        if (context.signal.aborted) supersede();
        else context.signal.addEventListener("abort", supersede, { once: true });
      }
      return stream.control.signal;
    };
    const runSidecar = async (sidecar: ClientRoute | undefined, onLoaderError?: (error: unknown) => void): Promise<void> => {
      const validated = await validatePageInputs(sidecar, match!.params, pageSearchObject(context.url.searchParams));
      routeParams = validated.params;
      routeSearch = validated.search;
      loaderDraft = sidecar?.load ? stateStore.navigationDraft() : undefined;
      const routeContext = { ...context, match: match!, ...validated, state: loaderDraft?.state ?? stateStore };
      try {
        const data = sidecar?.load ? await sidecar.load(routeContext) : undefined;
        if (data !== undefined) driveClientDeferred(data, reportDeferred, routeWork());
        props = {
          params: validated.params,
          search: validated.search,
          ...(data === undefined ? {} : { data }),
        };
        head = sidecar?.head?.({ ...routeContext, data }) ?? {};
      } catch (error) {
        if (!onLoaderError || context.signal.aborted || disposed) throw error;
        onLoaderError(error);
      }
    };
    if (!route) {
      // A URL without a route shows app/error.meeko inside the root layouts, as the server answers it.
      errorPage = appError!.file;
      props = { status: 404, message: "NOT_FOUND" };
      if (options.serverData && !options.loadRoute) {
        // Server middleware, files or redirects may own a URL without a page
        // route. Probing it with a fetch would run GET side effects twice and
        // break cross-origin redirects, so the browser loads it as a document;
        // the server answers app/error.meeko when nothing else does.
        if (context.signal.aborted || disposed) return false;
        browser.location.assign(context.url.href);
        return false;
      }
    } else if (route.render === "client") {
      const loadSidecar = options.loadClientRoute ?? options.loadRoute;
      if (!route.sidecar || !loadSidecar) throw new Error(`Route ${route.id} renders in the browser but its client sidecar cannot be loaded`);
      const sidecar = await loadSidecar(route.sidecar);
      if (context.signal.aborted || disposed) return;
      // A failed browser loader shows the nearest +error.meeko (or app/error.meeko) inside the route's layouts.
      const routeError = route.error ?? appError?.file;
      await runSidecar(sidecar, routeError ? (error) => {
        const failure = errorPageProps(error);
        if (failure.status >= 500) reportNavigationError(browser, error, observeNavigationError);
        loaderDraft = undefined;
        props = failure;
        head = {};
        errorPage = routeError;
      } : undefined);
    } else if (options.serverData && !options.loadRoute) {
      const response = await (options.fetch ?? fetch)(context.url.href, {
        headers: { accept: "application/meeko+json" }, credentials: "same-origin", signal: context.signal,
      });
      // A loader or middleware redirect: follow it instead of this navigation. A browser fetch
      // reports a followed redirect; a custom fetch may hand back the 3xx response itself.
      const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
      const redirect = response.redirected && response.url ? new URL(response.url) : location ? new URL(location, context.url) : undefined;
      if (redirect) {
        void response.body?.cancel().catch(() => {});
        if (context.signal.aborted || disposed) return false;
        if (redirect.href === context.url.href) throw new Error("Route data redirected to the same URL");
        if (redirect.origin === browser.location.origin && matchRoute(options.routes, redirect.pathname)) {
          queueMicrotask(() => {
            if (!disposed) navigator.navigate(redirect.href).catch((error: unknown) => reportNavigationError(browser, error, observeNavigationError));
          });
        } else browser.location.assign(redirect.href);
        return false;
      }
      // notFound() in top-level server code, or a loader's 404: the nearest error page, as in SSR.
      const notFoundPage = response.status === 404 ? route.error ?? appError?.file : undefined;
      if (notFoundPage) {
        // The public `{ code, status }` of the failure; the server document shows the same code.
        const failure = await response.json().catch(() => undefined) as { code?: unknown } | undefined;
        if (context.signal.aborted || disposed) return;
        serverCsrfToken = response.headers.get("x-meeko-csrf-token");
        props = { status: 404, message: typeof failure?.code === "string" && failure.code ? failure.code : "NOT_FOUND" };
        errorPage = notFoundPage;
      } else {
        if (!response.ok) throw new Error(`Route data request failed: HTTP ${response.status}`);
        // A server that does not speak Meeko's protocol (a static host serving the prerendered
        // index.html, a proxy or a CDN) answers with the document: load it instead of failing.
        if ((response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/html")) {
          void response.body?.cancel().catch(() => {});
          if (context.signal.aborted || disposed) return false;
          // History navigation already shows this URL: load it in place of its entry.
          if (browser.location.href === context.url.href) browser.location.replace(context.url.href);
          else browser.location.assign(context.url.href);
          return false;
        }
        serverCsrfToken = response.headers.get("x-meeko-csrf-token");
        let payload: HydrationPayload;
        // A stream route answers ndjson: the payload line commits, later lines settle deferred values.
        if ((response.headers.get("content-type") ?? "").startsWith("application/meeko+ndjson")) {
          if (!response.body) throw new Error("Empty Meeko navigation stream");
          // Superseded before the commit (navigation signal) or after it (next commit or dispose).
          lines = ndjsonLines(response.body, routeWork());
          const line = await lines.next();
          if (line.done) throw new Error("Empty Meeko navigation stream");
          payload = readPayload(line.value);
        } else payload = readPayload(await response.text());
        if (payload.route !== route.id) throw new Error("Meeko route data mismatch");
        if (context.signal.aborted || disposed) return;
        navigationDeferred = placePayloadDeferred(payload.props, payload.deferred);
        serverSharedState = payload.sharedState;
        serverData = payload.resources;
        props = payload.props;
        routeParams = payload.props.params as Record<string, unknown>;
        routeSearch = payload.props.search as Record<string, unknown>;
        head = payload.head;
      }
    } else {
      const sidecar = route.sidecar && options.loadRoute ? await options.loadRoute(route.sidecar) : undefined;
      await runSidecar(sidecar);
    }
    if (context.signal.aborted || disposed) return;
    const target = routeSnapshot(context.url, route?.id ?? null, routeParams, routeSearch, true);
    const retained = Math.min(context.retainedLayouts, layouts.length);
    let next = await createTree(route ? route.layouts : appError!.layouts, props, options.loadPage, retained, errorPage ?? route!.file);
    if (context.signal.aborted || disposed) return;
    // The new page and its components load their top-level data awaits before the commit, while
    // the previous page stays visible. These passes are dry, like SSR: a throwaway state keeps them
    // from touching the app, no effect runs, no socket connects and no onMounted or browser
    // continuation starts. A tree whose compiled modules have no data await skips them.
    const prepare = async (tree: typeof next): Promise<ResourceScope> => {
      const scope = new ResourceScope("collect", serverData, context.signal);
      if (!tree.modules.some((module) => mayAwaitData(module))) return scope;
      const preview = loaderDraft ? loaderDraft.state.snapshot() : { ...serverSharedState, ...stateStore.snapshot() };
      await renderWithSuspense(() => {
        scope.beginPass();
        return runDry(() => withResourceScope(scope, () => withStateStore(new StateStore(preview), () => {
          // The dry pass already sees the route it is loading, as the commit will.
          provideRoute(fixedRoute(target));
          provideBrowserWindow(browser);
          plugins.apply();
          return tree.component.renderWithState({});
        })));
      }, { signal: context.signal });
      return scope;
    };
    let pageData: ResourceScope;
    try {
      pageData = await prepare(next);
    } catch (error) {
      if (context.signal.aborted || disposed) return;
      // A failed data await shows the nearest +error.meeko (or app/error.meeko) inside the layouts, like a loader failure.
      const routeError = errorPage === undefined ? route?.error ?? appError?.file : undefined;
      if (!routeError) throw error;
      const failure = errorPageProps(error);
      if (failure.status >= 500) reportNavigationError(browser, error, observeNavigationError);
      loaderDraft = undefined;
      props = failure;
      head = {};
      errorPage = routeError;
      next = await createTree(route ? route.layouts : appError!.layouts, props, options.loadPage, retained, routeError);
      if (context.signal.aborted || disposed) return;
      pageData = await prepare(next);
    }
    if (context.signal.aborted || disposed) return;
    const committedData = new ResourceScope("read", Object.fromEntries(pageData.loadedData()));
    // A region that the loaded data does not cover, such as an if: that an onMounted shows, mounts once its own data loads.
    // onMounted callbacks of the new tree run once the commit has finished.
    const commit = () => withResourceScope(committedData, () => lateRender(() => mountBatch(commitTree)));
    const commitTree = () => {
      if (retained) {
        const outlet = layouts[retained - 1]!.outlet;
        const previous = outlet.value;
        const previousRoute = committedRoute.current();
        // One batch, outlet first: the outlet releases the previous page before any effect
        // that reads the route runs, and the new page renders with the new route.
        try {
          withStateStore(stateStore, () => batch(() => { outlet.value = next.component; committedRoute.set(target); }));
        } catch (error) {
          // The outlet binding restores and rehydrates its previous page; only
          // a failed restoration leaves a region that needs a full reload.
          if (hasRegionRecoveryFailure(error)) recoverCommitFailure(error);
          try { withStateStore(stateStore, () => batch(() => { outlet.value = previous; committedRoute.set(previousRoute); })); }
          catch (restoreError) { recoverCommitFailure(new AggregateError([error, restoreError], "Meeko navigation could not restore the previous outlet")); }
          throw error;
        }
        layouts = [...layouts.slice(0, retained), ...next.layouts];
        stableUrl = context.url.href;
        return;
      }
      // A new tree reads its own route; the previous one keeps its values until it is released.
      const nextRoute = liveRoute(target);
      const rendered = withStateStore(stateStore, () => {
        provideRoute(nextRoute.state);
        provideBrowserWindow(browser);
        plugins.apply();
        return next.component.renderWithState({});
      });
      // Hydrate the next view after the committed one, between private markers,
      // so a failure leaves the visible route and its bindings untouched.
      const document = options.root.ownerDocument;
      const start = document.createComment("meeko:navigation");
      const end = document.createComment("/meeko:navigation");
      options.root.append(start, end);
      let nextRelease: () => void;
      try {
        options.root.insertBefore(parseRegionHtml(options.root, rendered.html), end);
        nextRelease = hydrateApp(nextRoute.state, () => next.component.hydrateScope({ root: options.root, start, end }, {}, rendered.state));
      } catch (error) {
        for (let node: ChildNode | null = start; node;) {
          const following: ChildNode | null = node === end ? null : node.nextSibling;
          node.remove();
          node = following;
        }
        throw error;
      }
      const previousRelease = release;
      release = nextRelease;
      committedRoute = nextRoute;
      routeGeneration.value++;
      layouts = next.layouts;
      stableUrl = context.url.href;
      while (options.root.firstChild && options.root.firstChild !== start) options.root.firstChild.remove();
      // The new route is committed; a cleanup failure of the old one is observed, not rolled back.
      try { previousRelease(); }
      catch (error) { reportNavigationError(browser, error, observeNavigationError); }
    };
    // The head changes once per commit: the entries of the released page leave, the new page's
    // arrive and the route head is replaced.
    const commitWithToken = () => documentHead.hold(() => {
      const restoreToken = serverCsrfToken === null ? undefined : applyCsrfToken(browser, serverCsrfToken);
      try { commit(); }
      catch (error) {
        try { restoreToken?.(); }
        catch (restoreError) { throw new AggregateError([error, restoreError], "Meeko navigation and CSRF recovery failed"); }
        throw error;
      }
      documentHead.setRoute(routeHead(head, errorPage !== undefined));
    });
    if (serverSharedState) stateStore.seedForNavigation(serverSharedState, commitWithToken);
    else if (loaderDraft) loaderDraft.commit(commitWithToken);
    else commitWithToken();
    resourceCache.merge(pageData.loadedData());
    // The previous route is gone: stop reading its stream, then read this one's.
    stream.committed = true;
    activeStream?.abort();
    activeStream = stream.control;
    if (navigationDeferred) consumeStream(lines, navigationDeferred, stream.control?.signal);
  };
  const run = async (context: RenderContext): Promise<void | boolean> => {
    const token = ++navigationCount;
    const initialLoad = initialClientLoad;
    initialClientLoad = false;
    pending.value = true;
    try { return await renderRoute(context, initialLoad); }
    finally { if (token === navigationCount) pending.value = false; }
  };
  const navigator = createAppNavigator(options.routes, run, browser, observeNavigationError, appError ? { layouts: appError.layouts, render: run } : undefined, syncFragment);
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target;
    if (!target || !("closest" in target) || typeof target.closest !== "function") return;
    const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
    let url: URL;
    try { url = new URL(anchor.href, browser.location.href); }
    catch { return; }
    if (url.origin !== browser.location.origin) return;
    // A fragment of the current page (`#section`) is the browser's: it scrolls without a navigation.
    if (url.hash && sameDocument(url, new URL(browser.location.href))) return;
    if (!matchRoute(options.routes, url.pathname)) return;
    event.preventDefault();
    void navigator.navigate(url.href).catch((error: unknown) => reportNavigationError(browser, error, observeNavigationError));
  };
  browser.document.addEventListener("click", onClick);
  if (clientFirst) {
    // Every layout is retained, so the commit fills the deepest empty outlet
    // (or the empty root without layouts) exactly like a later navigation.
    try { await navigator.navigate(browser.location.href, { replace: true }); }
    catch (error) { reportNavigationError(browser, error, observeNavigationError); }
  }
  return {
    navigate: navigator.navigate,
    state: stateStore,
    dispose() {
      if (disposed) return;
      disposed = true;
      // The document keeps the head of the last page.
      documentHead.dispose();
      navigator.dispose();
      stopChunks();
      activeStream?.abort();
      browser.document.removeEventListener("click", onClick);
      releaseManifest();
      finishWithCleanup(release, () => errorChannel.clear());
    },
  };
}

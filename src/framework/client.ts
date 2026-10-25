import { hasRegionRecoveryFailure } from "../dom.js";
import type { Component, DomScope } from "../dom.js";
import { createAppErrorChannel, provideAppErrorChannel } from "../component-errors.js";
import type { ComponentErrorHandler } from "../component-errors.js";
import { finishWithCleanup, signal } from "../reactivity.js";
import type { Signal } from "../reactivity.js";
import { PAYLOAD_VERSION, PageInputError, pageSearchObject, validatePageInputs } from "./page.js";
import type { PageHead, PageRender, PageSchema } from "./page.js";
import { ClientError } from "./clients.js";
import { runRouteMiddleware } from "./middleware.js";
import { provideNavigation } from "./navigation.js";
import type { NavigationState } from "./navigation.js";
import type { RouteMiddleware } from "./middleware.js";
import { createNavigator, matchRoute, reportNavigationError } from "./router.js";
import type { NavigationContext, Navigator, RouteRecord } from "./router.js";
import { hydrateWithStateStore, StateStore, withStateStore } from "./state.js";
import { createDeferred, deferredSettle, deferredSource, extractDeferred, placeDeferred } from "./deferred.js";
import type { DeferredError, DeferredInternals, DeferredOutcome } from "./deferred.js";

export { useNavigation } from "./navigation.js";
export type { NavigationState } from "./navigation.js";

/** The public shape emitted by the .meeko compiler. */
export interface ClientComponent {
  renderWithState(props: Record<string, unknown>): { html: string; state: Record<string, unknown> };
  renderToString(props: Record<string, unknown>, state?: Record<string, unknown>): string;
  hydrateScope(scope: DomScope, props: Record<string, unknown>, state?: Record<string, unknown>): () => void;
}

export interface ClientRoute {
  /** Client-safe loader. Server-only sidecars must not be passed to loadRoute. */
  params?: PageSchema;
  search?: PageSchema;
  load?: (context: ClientRouteContext) => Promise<unknown> | unknown;
  head?: (context: ClientRouteContext & { data: unknown }) => PageHead;
}

type ClientRouteContext = NavigationContext & {
  params: Readonly<Record<string, unknown>>;
  search: Readonly<Record<string, unknown>>;
  state: StateStore;
};

export interface ClientAppOptions {
  readonly routes: readonly RouteRecord[];
  readonly root: Element;
  readonly payload: string | unknown;
  readonly loadPage: (file: string) => Promise<ClientComponent>;
  readonly loadRoute?: (file: string) => Promise<ClientRoute>;
  /**
   * Loads the browser sidecar of a `render: "client"` route. These routes
   * always take their data from this loader, also with `serverData`; it
   * defaults to `loadRoute`.
   */
  readonly loadClientRoute?: (file: string) => Promise<ClientRoute>;
  /** Runs the same route guards as SSR before a browser navigation fetch. */
  readonly loadMiddleware?: () => Promise<readonly RouteMiddleware[]>;
  /** Fetches public loader data from the SSR handler during browser navigation. */
  readonly serverData?: boolean;
  readonly fetch?: typeof fetch;
  readonly onNavigationError?: (error: unknown) => void;
  /**
   * Observes browser failures of this application: navigation, Socket clients,
   * and component events, effects or cleanups without a nearer `provideErrorHandler`.
   */
  readonly onError?: ComponentErrorHandler;
  readonly browser?: Window;
}

export interface ClientApp {
  navigate: Navigator["navigate"];
  readonly state: StateStore;
  dispose(): void;
}

interface HydrationPayload {
  route: string;
  render: PageRender;
  props: Record<string, unknown>;
  state: Record<string, unknown>;
  sharedState: Record<string, unknown>;
  head: PageHead;
  deferred: readonly PayloadDeferred[];
}

const pageRenders: readonly string[] = ["ssr", "stream", "prerender", "client"] satisfies readonly PageRender[];

/** Outlet of a client page until its loader resolves; the server rendered it empty. */
const emptyOutlet: Component<Record<string, unknown>> = {
  renderWithState: () => ({ html: "", state: {} }),
  renderToString: () => "",
  hydrateScope: () => () => {},
};

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
  if (!isRecord(parsed) || typeof parsed.route !== "string" || !isRecord(parsed.props) || !isRecord(parsed.state)) {
    throw new TypeError("Invalid Meeko hydration payload");
  }
  if (!isRecord(parsed.props.params) || !isRecord(parsed.props.search)) throw new TypeError("Invalid Meeko route props");
  if (parsed.sharedState !== undefined && !isRecord(parsed.sharedState)) throw new TypeError("Invalid Meeko shared state");
  const render = parsed.render ?? "ssr";
  if (typeof render !== "string" || !pageRenders.includes(render)) throw new TypeError("Invalid Meeko page render mode");
  const head = parsed.head ?? {};
  if (!isRecord(head) || (head.title !== undefined && typeof head.title !== "string")) throw new TypeError("Invalid Meeko page head");
  return {
    route: parsed.route, render: render as PageRender, props: parsed.props, state: parsed.state,
    sharedState: parsed.sharedState ?? {}, head: head.title === undefined ? {} : { title: head.title },
    deferred: readDeferredEntries(parsed.deferred),
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
  route: RouteRecord,
  props: Record<string, unknown>,
  loadPage: ClientAppOptions["loadPage"],
  fromLayout: number,
  leaf: string | Component<Record<string, unknown>> = route.file,
): Promise<{ component: Component<Record<string, unknown>>; layouts: LayoutInstance[] }> {
  let component = typeof leaf === "string" ? bind(await loadPage(leaf), props) : leaf;
  const layouts: LayoutInstance[] = [];
  for (let index = route.layouts.length - 1; index >= fromLayout; index--) {
    const file = route.layouts[index]!;
    const outlet = signal(component);
    const layoutProps = Object.defineProperty({}, "outlet", {
      enumerable: true,
      get: () => outlet.value,
    }) as Record<string, unknown>;
    component = bind(await loadPage(file), layoutProps);
    layouts.unshift({ file, outlet });
  }
  return { component, layouts };
}

/**
 * Hydrates the SSR tree and updates only the first changed outlet on navigation.
 * Layout templates render their outlet with <component is="props.outlet"/>.
 */
export async function mountClientApp(options: ClientAppOptions): Promise<ClientApp> {
  const browser = options.browser ?? window;
  const payload = readPayload(options.payload);
  const initial = matchRoute(options.routes, browser.location.pathname);
  if (!initial || initial.route.id !== payload.route) throw new Error("Meeko route hydration mismatch");
  if (JSON.stringify(initial.params) !== JSON.stringify(payload.props.params)) throw new Error("Meeko route parameters do not match SSR");
  const stateStore = new StateStore(payload.sharedState);
  const errorChannel = createAppErrorChannel(options.onError);
  const observeNavigationError = options.onNavigationError ?? ((error: unknown) => {
    const handler = errorChannel.current();
    if (handler) return handler(error, "navigation");
    reportNavigationError(browser, error);
  });
  const pending = signal(false);
  const navigationState: NavigationState = { pending: { get value() { return pending.value; } } };
  const hydrateApp = (hydrate: () => () => void) => hydrateWithStateStore(stateStore, () => {
    provideAppErrorChannel(errorChannel);
    provideNavigation(navigationState);
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
  try {
    first = await createTree(initial.route, payload.props, options.loadPage, 0, clientFirst ? emptyOutlet : initial.route.file);
    release = hydrateApp(() => first.component.hydrateScope({ root: options.root }, {}, payload.state));
  } catch (error) {
    stopChunks();
    throw error;
  }
  let layouts = first.layouts;
  initialReceiver.open();
  /** The ndjson read of the committed stream route; the next commit cancels it. */
  let activeStream: AbortController | undefined;
  let disposed = false;
  let stableUrl = browser.location.href;
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
  const renderRoute = async (context: NavigationContext, initialLoad: boolean): Promise<void | boolean> => {
    const stream: { control?: AbortController; committed?: boolean } = {};
    try { return await renderRouteData(context, initialLoad, stream); }
    finally { if (!stream.committed) stream.control?.abort(); }
  };
  const renderRouteData = async (context: NavigationContext, initialLoad: boolean, stream: { control?: AbortController; committed?: boolean }): Promise<void | boolean> => {
    if (options.loadMiddleware && !initialLoad) {
      const response = await runRouteMiddleware(await options.loadMiddleware(), {
        url: context.url, match: context.match, signal: context.signal, phase: "client",
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
    const route = context.match.route;
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
      const validated = await validatePageInputs(sidecar, context.match.params, pageSearchObject(context.url.searchParams));
      loaderDraft = sidecar?.load ? stateStore.navigationDraft() : undefined;
      const routeContext = { ...context, ...validated, state: loaderDraft?.state ?? stateStore };
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
    if (route.render === "client") {
      const loadSidecar = options.loadClientRoute ?? options.loadRoute;
      if (!route.sidecar || !loadSidecar) throw new Error(`Route ${route.id} renders in the browser but its client sidecar cannot be loaded`);
      const sidecar = await loadSidecar(route.sidecar);
      if (context.signal.aborted || disposed) return;
      // A failed browser loader shows the nearest +error.meeko inside the route's layouts.
      await runSidecar(sidecar, route.error ? (error) => {
        const failure = errorPageProps(error);
        if (failure.status >= 500) reportNavigationError(browser, error, observeNavigationError);
        loaderDraft = undefined;
        props = failure;
        head = {};
        errorPage = route.error;
      } : undefined);
    } else if (options.serverData && !options.loadRoute) {
      const response = await (options.fetch ?? fetch)(context.url.href, {
        headers: { accept: "application/meeko+json" }, credentials: "same-origin", signal: context.signal,
      });
      if (!response.ok) throw new Error(`Route data request failed: HTTP ${response.status}`);
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
      if (payload.route !== context.match.route.id) throw new Error("Meeko route data mismatch");
      if (context.signal.aborted || disposed) return;
      navigationDeferred = placePayloadDeferred(payload.props, payload.deferred);
      serverSharedState = payload.sharedState;
      props = payload.props;
      head = payload.head;
    } else {
      const sidecar = route.sidecar && options.loadRoute ? await options.loadRoute(route.sidecar) : undefined;
      await runSidecar(sidecar);
    }
    if (context.signal.aborted || disposed) return;
    const retained = Math.min(context.retainedLayouts, layouts.length);
    const next = await createTree(route, props, options.loadPage, retained, errorPage ?? route.file);
    if (context.signal.aborted || disposed) return;
    const commit = () => {
      if (retained) {
        const outlet = layouts[retained - 1]!.outlet;
        const previous = outlet.value;
        try {
          withStateStore(stateStore, () => { outlet.value = next.component; });
        } catch (error) {
          // The outlet binding restores and rehydrates its previous page; only
          // a failed restoration leaves a region that needs a full reload.
          if (hasRegionRecoveryFailure(error)) recoverCommitFailure(error);
          try { withStateStore(stateStore, () => { outlet.value = previous; }); }
          catch (restoreError) { recoverCommitFailure(new AggregateError([error, restoreError], "Meeko navigation could not restore the previous outlet")); }
          throw error;
        }
        layouts = [...layouts.slice(0, retained), ...next.layouts];
        stableUrl = context.url.href;
        return;
      }
      const rendered = withStateStore(stateStore, () => next.component.renderWithState({}));
      // Hydrate the next view after the committed one, between private markers,
      // so a failure leaves the visible route and its bindings untouched.
      const document = options.root.ownerDocument;
      const start = document.createComment("meeko:navigation");
      const end = document.createComment("/meeko:navigation");
      options.root.append(start, end);
      let nextRelease: () => void;
      try {
        const range = document.createRange();
        range.selectNodeContents(options.root);
        options.root.insertBefore(range.createContextualFragment(rendered.html), end);
        nextRelease = hydrateApp(() => next.component.hydrateScope({ root: options.root, start, end }, {}, rendered.state));
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
      layouts = next.layouts;
      stableUrl = context.url.href;
      while (options.root.firstChild && options.root.firstChild !== start) options.root.firstChild.remove();
      // The new route is committed; a cleanup failure of the old one is observed, not rolled back.
      try { previousRelease(); }
      catch (error) { reportNavigationError(browser, error, observeNavigationError); }
    };
    const commitWithToken = () => {
      const restoreToken = serverCsrfToken === null ? undefined : applyCsrfToken(browser, serverCsrfToken);
      try { commit(); }
      catch (error) {
        try { restoreToken?.(); }
        catch (restoreError) { throw new AggregateError([error, restoreError], "Meeko navigation and CSRF recovery failed"); }
        throw error;
      }
      if (head.title !== undefined) browser.document.title = head.title;
    };
    if (serverSharedState) stateStore.seedForNavigation(serverSharedState, commitWithToken);
    else if (loaderDraft) loaderDraft.commit(commitWithToken);
    else commitWithToken();
    // The previous route is gone: stop reading its stream, then read this one's.
    stream.committed = true;
    activeStream?.abort();
    activeStream = stream.control;
    if (navigationDeferred) consumeStream(lines, navigationDeferred, stream.control?.signal);
  };
  const navigator = createNavigator(options.routes, async (context) => {
    const token = ++navigationCount;
    const initialLoad = initialClientLoad;
    initialClientLoad = false;
    pending.value = true;
    try { return await renderRoute(context, initialLoad); }
    finally { if (token === navigationCount) pending.value = false; }
  }, browser, observeNavigationError);
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target;
    if (!target || !("closest" in target) || typeof target.closest !== "function") return;
    const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
    let url: URL;
    try { url = new URL(anchor.href, browser.location.href); }
    catch { return; }
    if (url.origin !== browser.location.origin || !matchRoute(options.routes, url.pathname)) return;
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
      navigator.dispose();
      stopChunks();
      activeStream?.abort();
      browser.document.removeEventListener("click", onClick);
      finishWithCleanup(release, () => errorChannel.clear());
    },
  };
}

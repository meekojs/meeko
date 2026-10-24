import type { Component, DomScope } from "../dom.js";
import { signal } from "../reactivity.js";
import type { Signal } from "../reactivity.js";
import { pageSearchObject, validatePageInputs } from "./page.js";
import type { PageSchema } from "./page.js";
import { createNavigator, matchRoute } from "./router.js";
import type { NavigationContext, Navigator, RouteRecord } from "./router.js";
import { hydrateWithStateStore, StateStore, withStateStore } from "./state.js";

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
  load?: (context: NavigationContext & {
    params: Readonly<Record<string, unknown>>;
    search: Readonly<Record<string, unknown>>;
    state: StateStore;
  }) => Promise<unknown> | unknown;
}

export interface ClientAppOptions {
  readonly routes: readonly RouteRecord[];
  readonly root: Element;
  readonly payload: string | unknown;
  readonly loadPage: (file: string) => Promise<ClientComponent>;
  readonly loadRoute?: (file: string) => Promise<ClientRoute>;
  /** Fetches public loader data from the SSR handler during browser navigation. */
  readonly serverData?: boolean;
  readonly fetch?: typeof fetch;
  readonly onNavigationError?: (error: unknown) => void;
  readonly browser?: Window;
}

export interface ClientApp {
  navigate: Navigator["navigate"];
  readonly state: StateStore;
  dispose(): void;
}

interface HydrationPayload {
  route: string;
  props: Record<string, unknown>;
  state: Record<string, unknown>;
  sharedState: Record<string, unknown>;
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
  if (!isRecord(parsed) || typeof parsed.route !== "string" || !isRecord(parsed.props) || !isRecord(parsed.state)) {
    throw new TypeError("Invalid Meeko hydration payload");
  }
  if (!isRecord(parsed.props.params) || !isRecord(parsed.props.search)) throw new TypeError("Invalid Meeko route props");
  if (parsed.sharedState !== undefined && !isRecord(parsed.sharedState)) throw new TypeError("Invalid Meeko shared state");
  return { route: parsed.route, props: parsed.props, state: parsed.state, sharedState: parsed.sharedState ?? {} };
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
): Promise<{ component: Component<Record<string, unknown>>; layouts: LayoutInstance[] }> {
  let component = bind(await loadPage(route.file), props);
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
  const first = await createTree(initial.route, payload.props, options.loadPage, 0);
  let layouts = first.layouts;
  let release = hydrateWithStateStore(stateStore, () => first.component.hydrateScope({ root: options.root }, {}, payload.state));
  let disposed = false;
  const navigator = createNavigator(options.routes, async (context) => {
    let props: Record<string, unknown>;
    if (options.serverData && !options.loadRoute) {
      const response = await (options.fetch ?? fetch)(context.url.href, {
        headers: { accept: "application/meeko+json" }, credentials: "same-origin", signal: context.signal,
      });
      if (!response.ok) throw new Error(`Route data request failed: HTTP ${response.status}`);
      const csrf = response.headers.get("x-meeko-csrf-token");
      if (csrf !== null) {
        const meta = browser.document.querySelector<HTMLMetaElement>('meta[name="meeko-csrf-token"]');
        if (csrf && meta) meta.content = csrf;
        else if (csrf) {
          const next = browser.document.createElement("meta");
          next.name = "meeko-csrf-token";
          next.content = csrf;
          browser.document.head.append(next);
        } else meta?.remove();
      }
      const payload = readPayload(await response.text());
      if (payload.route !== context.match.route.id) throw new Error("Meeko route data mismatch");
      if (context.signal.aborted || disposed) return;
      stateStore.seed(payload.sharedState);
      props = payload.props;
    } else {
      const sidecar = context.match.route.sidecar && options.loadRoute
        ? await options.loadRoute(context.match.route.sidecar)
        : undefined;
      const validated = await validatePageInputs(sidecar, context.match.params, pageSearchObject(context.url.searchParams));
      const data = sidecar?.load ? await sidecar.load({ ...context, ...validated, state: stateStore }) : undefined;
      props = {
        params: validated.params,
        search: validated.search,
        ...(data === undefined ? {} : { data }),
      };
    }
    if (context.signal.aborted || disposed) return;
    const retained = Math.min(context.retainedLayouts, layouts.length);
    const next = await createTree(context.match.route, props, options.loadPage, retained);
    if (context.signal.aborted || disposed) return;
    if (retained) {
      withStateStore(stateStore, () => { layouts[retained - 1]!.outlet.value = next.component; });
      layouts = [...layouts.slice(0, retained), ...next.layouts];
      return;
    }
    const rendered = withStateStore(stateStore, () => next.component.renderWithState({}));
    release();
    options.root.innerHTML = rendered.html;
    release = hydrateWithStateStore(stateStore, () => next.component.hydrateScope({ root: options.root }, {}, rendered.state));
    layouts = next.layouts;
  }, browser);
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target;
    if (!target || !("closest" in target) || typeof target.closest !== "function") return;
    const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
    const url = new URL(anchor.href, browser.location.href);
    if (url.origin !== browser.location.origin || !matchRoute(options.routes, url.pathname)) return;
    event.preventDefault();
    void navigator.navigate(url.href).catch((error: unknown) => { options.onNavigationError?.(error); });
  };
  browser.document.addEventListener("click", onClick);
  return {
    navigate: navigator.navigate,
    state: stateStore,
    dispose() {
      if (disposed) return;
      disposed = true;
      navigator.dispose();
      browser.document.removeEventListener("click", onClick);
      release();
    },
  };
}

import type { DocumentConfig, HeadInput } from "../../shared/head";
import type { PageHead, PageSchema } from "../definitions/define-page";
import type { PluginRegistration } from "../definitions/define-plugin";
import type { RouteMiddleware } from "../middleware/runtime";
import type { DeferredLine } from "./client-deferred";
import type { HydrationPayload } from "./client-payload";
import type { ComponentErrorHandler } from "./component-errors";
import type { DeferredInternals } from "./deferred";
import type { NavigationTrace } from "./devtools-activity";
import type { BrowserLayoutWriter, LayoutSlot } from "./layout";
import type { LiveRoute, NavigationState, RouteState } from "./navigation";
import type { Component, DomScope } from "./renderer";
import type { ErrorPageRecord, NamedLayoutRecord, NavigationContext, Navigator, RouteMatch, RouteRecord, UnmatchedNavigationContext } from "./router";

import { markingObserver } from "../../core/error-observer";
import { batch, finishWithCleanup, runDry, signal } from "../../core/reactivity";
import { ClientError } from "../../shared/clients";
import { routeHeadInput } from "../../shared/head";
import { resolveThemeConfig, THEME_STATE_KEY } from "../../shared/theme";
import { provideResourceCache, ResourceCache, ResourceScope, withResourceScope } from "../composables/resources/engine";
import { provideBrowserWindow } from "../composables/useStorage";
import { ERROR_PAGE_TITLE, PageInputError, pageSearchObject, validatePageInputs } from "../definitions/define-page";
import { notifyPluginErrorHandlers, runPlugins } from "../definitions/define-plugin";
import { hasRouteMiddleware, routeMiddlewareChain, runRouteMiddleware } from "../middleware/runtime";
import { deferredReceiver, driveClientDeferred, ndjsonLines, placePayloadDeferred, readDeferredLine, watchDeferredChunks } from "./client-deferred";
import { readPayload } from "./client-payload";
import { createAppErrorChannel, provideAppErrorChannel } from "./component-errors";
import { traceNavigation, traceResourceCacheHit } from "./devtools-activity";
import { watchGlobalErrors } from "./global-errors";
import { BrowserHead, provideHead, withHeadLevel } from "./head";
import { withIdRoot } from "./ids";
import { browserLayoutWriter, createLayoutSlot, resolveLayoutProps, withLayoutWriter } from "./layout";
import { mountBatch } from "./lifecycle";
import { fixedRoute, liveRoute, provideNavigation, provideRoute, routeIsActive, routeSnapshot } from "./navigation";
import { hasRegionRecoveryFailure, parseRegionHtml } from "./renderer";
import { activateRouteManifest, createAppNavigator, matchRoute, reportNavigationError, sameDocument } from "./router";
import { hydrateWithStateStore, StateStore, withStateStore } from "./state";
import { lateRender, mayAwaitData, renderWithSuspense } from "./suspense";
import { BrowserTheme, registerBrowserTheme } from "./theme-browser";
import { createViewTransitionController } from "./view-transitions";

export { useNavigation } from "../composables/useNavigation";
export { useRoute } from "../composables/useRoute";
export type { NavigationState, RouteState } from "./navigation";

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
  /**
   * Props del layout con nombre: un objeto o una función que las calcula con los datos del loader.
   * @since 1.5.0
   */
  layoutProps?: unknown;
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
  /** View Transitions nativas al confirmar una navegación; false por defecto. No anima la hidratación inicial. */
  readonly viewTransitions?: boolean;
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
  /** Carga el middleware de ruta global, que se ejecuta como en SSR antes de pedir cada navegación. */
  readonly loadMiddleware?: () => Promise<readonly RouteMiddleware[]>;
  /**
   * Carga un middleware con nombre de {@link RouteRecord.middleware} por su archivo, la primera vez
   * que se navega a una ruta que lo declara. Se ejecuta después de los globales, como en SSR; una
   * ruta con middleware con nombre y sin este cargador falla en lugar de saltárselo.
   * @since 1.6.0
   */
  readonly loadNamedMiddleware?: (file: string) => Promise<RouteMiddleware>;
  /**
   * Pide al servidor los datos públicos del loader al navegar. Con `true`, la misma URL con
   * `Accept: application/meeko+json`; desde `1.3`, con `"static"`, el archivo
   * `<ruta>/index.meeko.json` que escribe el adaptador `static`, para un hosting estático que no
   * negocia `Accept`.
   */
  readonly serverData?: boolean | "static";
  /** Implementación de `fetch` para las navegaciones; por defecto, la global. */
  readonly fetch?: typeof fetch;
  /** Observa los fallos de navegación por clic o historial; tiene prioridad sobre `onError`. */
  readonly onNavigationError?: (error: unknown) => void;
  /**
   * Observa los fallos de esta aplicación en el navegador: navegación, clientes Socket y eventos,
   * efectos o limpiezas de componentes sin un `provideErrorHandler` más cercano. Desde `1.3`,
   * también las excepciones no capturadas (`"uncaught"`) y las promesas rechazadas sin manejar
   * (`"rejection"`) de la página mientras la aplicación está montada; el navegador ya no las
   * repite en la consola. Sin `onError` ni `app.onError`, las recibe el primer
   * `provideErrorHandler` activo; sin ninguno, el navegador las muestra como siempre.
   */
  readonly onError?: ComponentErrorHandler;
  /** Ventana del navegador; por defecto, `window`. */
  readonly browser?: Window;
  /**
   * `document` de `meeko.config.ts`, el mismo que renderiza el servidor: la entrada cliente que
   * genera Meeko lo toma de `virtual:meeko-manifest/client`. `useHead` y la navegación lo usan para
   * aplicar `titleTemplate`, mostrar su `title` (sin plantilla) en las páginas sin título y
   * restaurar sus etiquetas, con la misma regla que el servidor.
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

/** Outlet of a client page until its loader resolves; the server rendered it empty. */
const emptyOutlet: Component<Record<string, unknown>> = {
  renderWithState: () => ({ html: "", state: {} }),
  renderToString: () => "",
  hydrateScope: () => () => {},
};

/**
 * The navigation payload file of a page on a static host: `index.meeko.json` in the page's folder,
 * next to its `index.html` (`/docs` → `/docs/index.meeko.json`, `/` → `/index.meeko.json`). The
 * query string and the fragment are not part of a stored page.
 */
function staticPayloadUrl(url: URL): string {
  const target = new URL(url.href);
  target.pathname = `${url.pathname.replace(/\/+$/, "")}/index.meeko.json`;
  target.search = "";
  target.hash = "";
  return target.href;
}

/**
 * The URL a document was rendered for: `rendered` (the path and query of the payload) on the
 * browser's origin, or the browser's URL when the payload does not say it. The path is set as it
 * came, never resolved against the origin, so `//x` stays a path.
 */
function renderedUrl(rendered: string | undefined, browserUrl: URL): URL {
  if (rendered === undefined) return browserUrl;
  const query = rendered.indexOf("?");
  const url = new URL(browserUrl.href);
  url.pathname = query < 0 ? rendered : rendered.slice(0, query);
  url.search = query < 0 ? "" : rendered.slice(query);
  url.hash = "";
  return url;
}

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
  outlet: { value: Component<Record<string, unknown>> };
  /** The props of a named layout, which the page writes with `useLayout()`. */
  slot?: LayoutSlot;
}

/** The named layout of a tree: its record and the props its page declares. */
interface TreeLayout {
  readonly record: NamedLayoutRecord | undefined;
  readonly declared: Record<string, unknown>;
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
  named: TreeLayout = { record: undefined, declared: {} },
  retainedLayouts: readonly LayoutInstance[] = [],
): Promise<{ component: Component<Record<string, unknown>>; layouts: LayoutInstance[]; modules: unknown[]; writer: BrowserLayoutWriter; declared: Record<string, unknown> }> {
  const page = typeof leaf === "string" ? await loadPage(leaf) : undefined;
  const namedIndex = named.record ? chain.indexOf(named.record.file) : -1;
  // A named layout that the navigation keeps receives the new page's props at the commit.
  const owner = {};
  const retainedSlot = namedIndex >= 0 && namedIndex < fromLayout ? retainedLayouts[namedIndex]?.slot : undefined;
  let writer = browserLayoutWriter(retainedSlot, owner);
  // useHead of the page outranks its layouts', and a layout's outranks app.meeko's, as in SSR.
  let component = page ? withHeadLevel(bind(page, props), chain.length) : leaf as Component<Record<string, unknown>>;
  // useLayout() reaches the page from what the named layout wraps, or from the page itself.
  if (namedIndex < 0 || namedIndex < fromLayout) component = withLayoutWriter(component, writer);
  const layouts: LayoutInstance[] = [];
  /** The compiled modules that render the tree, for `mayAwaitData`; an empty outlet renders none. */
  const modules: unknown[] = page ? [page] : [];
  for (let index = chain.length - 1; index >= fromLayout; index--) {
    const file = chain[index]!;
    const layout = await loadPage(file);
    modules.push(layout);
    if (index === namedIndex) {
      // The named layout's props are reactive: the page changes them without remounting it.
      const slot = createLayoutSlot(named.record!.name, named.declared, component, owner);
      writer = browserLayoutWriter(slot, owner);
      slot.outlet.value = withLayoutWriter(component, writer);
      component = withHeadLevel(bind(layout, slot.props), index);
      layouts.unshift({ file, outlet: slot.outlet, slot });
      continue;
    }
    const outlet = signal(component);
    const layoutProps = Object.defineProperty({}, "outlet", {
      enumerable: true,
      get: () => outlet.value,
    }) as Record<string, unknown>;
    component = withHeadLevel(bind(layout, layoutProps), index);
    layouts.unshift({ file, outlet });
  }
  return { component, layouts, modules, writer, declared: named.declared };
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
  const viewTransitions = createViewTransitionController(browser);
  const payload = readPayload(options.payload);
  // Adopts the head that SSR wrote; a page without a title shows the host's, not the previous page's.
  const documentHead = new BrowserHead(browser.document, options.document);
  const themeConfig = resolveThemeConfig(options.document?.theme, "document.theme");
  // An error page (notFound(), a loader or data failure, or app/error.meeko for a URL without
  // a route) has the title of its SSR error document.
  const routeHead = (head: PageHead, errorPage: boolean): HeadInput => routeHeadInput(head, errorPage ? ERROR_PAGE_TITLE : undefined);
  const appError = options.errorPage;
  const matched = matchRoute(options.routes, browser.location.pathname);
  // An error payload renders app/error.meeko, whatever the URL: a server answers it for a URL
  // without a route, and a static host's 404.html for any missing file, including a URL that
  // matches a dynamic route whose page was not prerendered.
  const initial = payload.error ? undefined : matched;
  if (payload.error) {
    if (!appError) throw new Error("Meeko route hydration mismatch");
  } else {
    if (!initial || initial.route.id !== payload.route) throw new Error("Meeko route hydration mismatch");
    if (JSON.stringify(initial.params) !== JSON.stringify(payload.props.params)) throw new Error("Meeko route parameters do not match SSR");
  }
  const stateStore = new StateStore(payload.sharedState);
  // The route of useRoute(): the server's values, so hydration matches, also when the document was
  // rendered for another URL (a static host serves 404.html for any missing file and a prerendered
  // page whatever the query). The browser's URL and its fragment arrive right after hydration.
  const initialUrl = new URL(browser.location.href);
  const serverUrl = renderedUrl(payload.url, initialUrl);
  let committedRoute: LiveRoute = liveRoute(payload.error
    ? routeSnapshot(serverUrl, null, {}, pageSearchObject(serverUrl.searchParams), false)
    : routeSnapshot(serverUrl, payload.route, payload.props.params as Record<string, unknown>, payload.props.search as Record<string, unknown>, false));
  const resourceCache = new ResourceCache(200, () => traceResourceCacheHit(browser));
  // The route of the plugins follows the committed route, also when a navigation replaces the
  // whole tree (and its live route): reading it also reads `routeGeneration`.
  const routeGeneration = signal(0);
  const followCommitted = <K extends Exclude<keyof RouteState, "isActive">>(key: K): RouteState[K] => Object.freeze({
    get value() { void routeGeneration.value; return committedRoute.state[key].value; },
  }) as RouteState[K];
  const pluginPath = followCommitted("path");
  const pluginRoute: RouteState = Object.freeze({
    url: followCommitted("url"), path: pluginPath, id: followCommitted("id"),
    params: followCommitted("params"), search: followCommitted("search"), isActive: routeIsActive(pluginPath),
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
  // What the host's navigation observer receives is not reported again if it escapes to `window`.
  const observeNavigationError = (options.onNavigationError && markingObserver(options.onNavigationError)) ?? ((error: unknown) => {
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
  // Uncaught exceptions and unhandled rejections of the page reach the application observer
  // from hydration until dispose.
  const releaseGlobalErrors = watchGlobalErrors(browser, () => errorChannel.current());
  // The theme of `<html>` follows the stored choice; components hydrate with the server's values
  // (the page state carries them) and receive the browser's once hydration ends.
  const theme = themeConfig ? new BrowserTheme(browser, themeConfig, documentHead, payload.sharedState[THEME_STATE_KEY]) : undefined;
  const releaseTheme = theme ? registerBrowserTheme(browser, theme) : () => {};
  try {
    // The named layout hydrates with the props the server rendered it with.
    const initialLayout = initial ? initial.route.layout : appError!.layout;
    const named: TreeLayout = { record: initialLayout, declared: payload.layoutProps ?? { ...initialLayout?.props } };
    first = initial
      ? await createTree(initial.route.layouts, payload.props, options.loadPage, 0, clientFirst ? emptyOutlet : initial.route.file, named)
      : await createTree(appError!.layouts, payload.props, options.loadPage, 0, appError!.file, named);
    // Awaited data comes from the payload: hydration stays synchronous and never requests it again.
    const initialData = new ResourceScope("read", payload.resources);
    // onMounted callbacks run once the whole tree has hydrated. The head adopts the SSR tags once,
    // with every useHead of the hydrated tree registered.
    release = documentHead.hold(() => {
      documentHead.setRoute(routeHead(payload.head, payload.error), payload.error ? undefined : initialUrl.pathname);
      return withResourceScope(initialData, () => hydrateApp(committedRoute.state, () => mountBatch(() => withIdRoot(options.document?.idPrefix, () => first.component.hydrateScope({ root: options.root }, {}, payload.state)))));
    });
    resourceCache.merge(initialData.loadedData());
    // What the page wrote with useLayout() while it hydrated; the server already rendered it.
    first.writer.activate();
    // Components that read the theme already settled at the end of the hydration batch.
    theme?.settle();
  } catch (error) {
    stopChunks();
    releaseManifest();
    releaseGlobalErrors();
    releaseTheme();
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
    viewTransitions.skip();
    const committed = committedRoute.current();
    const href = url.pathname + url.search;
    if (committed.url.split("#")[0] !== href || committed.url === href + url.hash) return;
    try { committedRoute.set({ ...committed, url: href + url.hash }); }
    catch (error) { reportNavigationError(browser, error, observeNavigationError); }
  };
  // A document rendered for another URL: once hydrated, useRoute() says the browser's. The page
  // keeps the parameters and search the server validated; an error page reads the query as SSR.
  const hydrated = committedRoute.current();
  if (hydrated.url !== initialUrl.pathname + initialUrl.search) {
    try {
      committedRoute.set({
        ...hydrated, url: initialUrl.pathname + initialUrl.search + initialUrl.hash, path: initialUrl.pathname,
        ...payload.error ? { search: pageSearchObject(initialUrl.searchParams) } : {},
      });
    } catch (error) { reportNavigationError(browser, error, observeNavigationError); }
  }
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
  const renderRoute = async (context: RenderContext, initialLoad: boolean, trace?: NavigationTrace): Promise<void | boolean> => {
    const source = context.match?.route.render === "client" || !options.serverData || options.loadRoute ? "client" : options.serverData === "static" ? "static" : "server";
    const stream: { control?: AbortController; committed?: boolean; data?: (phase: "ready" | "cancel" | "error") => void } = { ...(trace ? { data: trace.data(source) } : {}) };
    try {
      const result = await renderRouteData(context, initialLoad, stream);
      stream.data?.(context.signal.aborted || disposed || result === false ? "cancel" : "ready");
      return result;
    } catch (error) {
      stream.data?.(context.signal.aborted ? "cancel" : "error");
      throw error;
    }
    finally { if (!stream.committed) stream.control?.abort(); }
  };
  const renderRouteData = async (context: RenderContext, initialLoad: boolean, stream: { control?: AbortController; committed?: boolean; data?: (phase: "ready" | "cancel" | "error") => void }): Promise<void | boolean> => {
    const match = context.match;
    if (match && hasRouteMiddleware(match.route, options) && !initialLoad) {
      const response = await runRouteMiddleware(await routeMiddlewareChain(match.route, options), {
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
    // Props of the named layout: those of the +group.ts files until the page's arrive.
    const groupLayoutProps = (): Record<string, unknown> => ({ ...(route ? route.layout : appError?.layout)?.props });
    let layoutDeclared = groupLayoutProps();
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
        layoutDeclared = { ...groupLayoutProps(), ...resolveLayoutProps(sidecar?.layoutProps, { ...routeContext, data }) };
      } catch (error) {
        if (!onLoaderError || context.signal.aborted || disposed) throw error;
        stream.data?.("error");
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
        layoutDeclared = groupLayoutProps();
      } : undefined);
    } else if (options.serverData && !options.loadRoute) {
      // A static host serves each page's payload as a file next to its index.html.
      const response = options.serverData === "static"
        ? await (options.fetch ?? fetch)(staticPayloadUrl(context.url), { credentials: "same-origin", signal: context.signal })
        : await (options.fetch ?? fetch)(context.url.href, {
          headers: { accept: "application/meeko+json" }, credentials: "same-origin", signal: context.signal,
        });
      // A loader or middleware redirect: follow it instead of this navigation. A browser fetch
      // reports a followed redirect; a custom fetch may hand back the 3xx response itself.
      const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
      const redirect = response.redirected && response.url ? new URL(response.url) : location ? new URL(location, context.url) : undefined;
      // A static host redirects files, not pages: the browser loads the page itself instead.
      if (redirect && options.serverData === "static") {
        void response.body?.cancel().catch(() => {});
        if (context.signal.aborted || disposed) return false;
        browser.location.assign(context.url.href);
        return false;
      }
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
        layoutDeclared = groupLayoutProps();
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
        layoutDeclared = payload.layoutProps ?? groupLayoutProps();
      }
    } else {
      const sidecar = route.sidecar && options.loadRoute ? await options.loadRoute(route.sidecar) : undefined;
      await runSidecar(sidecar);
    }
    if (context.signal.aborted || disposed) return;
    const target = routeSnapshot(context.url, route?.id ?? null, routeParams, routeSearch, true);
    const retained = Math.min(context.retainedLayouts, layouts.length);
    const namedLayout = (): TreeLayout => ({ record: route ? route.layout : appError?.layout, declared: layoutDeclared });
    let next = await createTree(route ? route.layouts : appError!.layouts, props, options.loadPage, retained, errorPage ?? route!.file, namedLayout(), layouts);
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
          return withIdRoot(options.document?.idPrefix, () => tree.component.renderWithState({}));
        })));
      }, { signal: context.signal });
      return scope;
    };
    let pageData: ResourceScope;
    try {
      pageData = await prepare(next);
    } catch (error) {
      if (context.signal.aborted || disposed) return;
      stream.data?.("error");
      // A failed data await shows the nearest +error.meeko (or app/error.meeko) inside the layouts, like a loader failure.
      const routeError = errorPage === undefined ? route?.error ?? appError?.file : undefined;
      if (!routeError) throw error;
      const failure = errorPageProps(error);
      if (failure.status >= 500) reportNavigationError(browser, error, observeNavigationError);
      loaderDraft = undefined;
      props = failure;
      head = {};
      errorPage = routeError;
      layoutDeclared = groupLayoutProps();
      next = await createTree(route ? route.layouts : appError!.layouts, props, options.loadPage, retained, routeError, namedLayout(), layouts);
      if (context.signal.aborted || disposed) return;
      pageData = await prepare(next);
    }
    if (context.signal.aborted || disposed) return;
    stream.data?.("ready");
    const committedData = new ResourceScope("read", Object.fromEntries(pageData.loadedData()));
    // A region that the loaded data does not cover, such as an if: that an onMounted shows, mounts once its own data loads.
    // onMounted callbacks of the new tree run once the commit has finished.
    const commit = () => withResourceScope(committedData, () => lateRender(() => mountBatch(commitTree)));
    const commitTree = () => {
      if (retained) {
        const outlet = layouts[retained - 1]!.outlet;
        const previous = outlet.value;
        const previousRoute = committedRoute.current();
        // A named layout that stays receives the new page's props in the same batch: nothing of
        // the previous page's stays. One created by the new tree already has them.
        const keptSlot = next.writer.slot && !next.layouts.some((layout) => layout.slot === next.writer.slot) ? next.writer.slot : undefined;
        const restoreSlot = keptSlot?.save();
        // One batch, outlet first: the outlet releases the previous page before any effect
        // that reads the route runs, and the new page renders with the new route.
        try {
          withStateStore(stateStore, () => batch(() => {
            keptSlot?.reset(next.declared, next.writer.owner);
            outlet.value = next.component;
            committedRoute.set(target);
          }));
        } catch (error) {
          // The outlet binding restores and rehydrates its previous page; only
          // a failed restoration leaves a region that needs a full reload.
          if (hasRegionRecoveryFailure(error)) recoverCommitFailure(error);
          try { withStateStore(stateStore, () => batch(() => { restoreSlot?.(); outlet.value = previous; committedRoute.set(previousRoute); })); }
          catch (restoreError) { recoverCommitFailure(new AggregateError([error, restoreError], "Meeko navigation could not restore the previous outlet")); }
          throw error;
        }
        layouts = [...layouts.slice(0, retained), ...next.layouts];
        stableUrl = context.url.href;
        // What the new page wrote with useLayout() while it rendered.
        withStateStore(stateStore, () => next.writer.activate());
        return;
      }
      // A new tree reads its own route; the previous one keeps its values until it is released.
      const nextRoute = liveRoute(target);
      const rendered = withStateStore(stateStore, () => {
        provideRoute(nextRoute.state);
        provideBrowserWindow(browser);
        plugins.apply();
        return withIdRoot(options.document?.idPrefix, () => next.component.renderWithState({}));
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
        nextRelease = hydrateApp(nextRoute.state, () => withIdRoot(options.document?.idPrefix, () => next.component.hydrateScope({ root: options.root, start, end }, {}, rendered.state)));
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
      // The layout hydrated with the declared props; what the page wrote while it rendered applies now.
      withStateStore(stateStore, () => next.writer.activate());
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
      documentHead.setRoute(routeHead(head, errorPage !== undefined), errorPage === undefined ? context.url.pathname : undefined);
    });
    const committed = await viewTransitions.commit(() => {
      if (serverSharedState) stateStore.seedForNavigation(serverSharedState, commitWithToken);
      else if (loaderDraft) loaderDraft.commit(commitWithToken);
      else commitWithToken();
    }, context.signal, !initialLoad && (context.viewTransition ?? options.viewTransitions ?? false));
    if (!committed) return false;
    resourceCache.merge(pageData.loadedData());
    // The previous route is gone: stop reading its stream, then read this one's.
    stream.committed = true;
    activeStream?.abort();
    activeStream = stream.control;
    if (navigationDeferred) consumeStream(lines, navigationDeferred, stream.control?.signal);
  };
  const run = async (context: RenderContext): Promise<void | boolean> => {
    viewTransitions.skip();
    const trace = traceNavigation(browser, context.match?.route.id ?? null);
    const token = ++navigationCount;
    const initialLoad = initialClientLoad;
    initialClientLoad = false;
    pending.value = true;
    try {
      if (!initialLoad && !await plugins.beforeNavigate(context.url, context.match?.route.id ?? null)) {
        trace?.finish("cancel");
        return false;
      }
      const result = await renderRoute(context, initialLoad, trace);
      trace?.finish(context.signal.aborted || disposed || result === false ? "cancel" : "commit");
      return result;
    } catch (error) {
      trace?.finish(context.signal.aborted ? "cancel" : "error");
      throw error;
    }
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
    const transition = anchor.getAttribute("data-meeko-view-transition");
    void navigator.navigate(url.href, transition === "false" || transition === "true" ? { viewTransition: transition === "true" } : {}).catch((error: unknown) => reportNavigationError(browser, error, observeNavigationError));
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
      viewTransitions.skip();
      // The document keeps the head of the last page.
      documentHead.dispose();
      navigator.dispose();
      stopChunks();
      activeStream?.abort();
      browser.document.removeEventListener("click", onClick);
      releaseManifest();
      releaseGlobalErrors();
      releaseTheme();
      finishWithCleanup(release, () => errorChannel.clear());
    },
  };
}

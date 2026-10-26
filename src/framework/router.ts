import { observeCallback } from "../error-observer.js";
import type { PageRender } from "./page.js";

/**
 * Una ruta del manifiesto que comparten el renderizador del servidor y el navegador. Lo produce
 * `discoverRoutes` de `@meekojs/meeko/build`.
 *
 * @example
 * ```ts
 * import type { RouteRecord } from "@meekojs/meeko/framework";
 *
 * const route: RouteRecord = {
 *   id: "/users/[id]",
 *   file: "app/pages/users/[id].meeko",
 *   layouts: ["app/app.meeko", "app/layouts/default.meeko"],
 *   error: "app/pages/+error.meeko",
 * };
 * ```
 */
export interface RouteRecord {
  /** ID de la ruta: `/`, `/users/[id]` o `/docs/[...slug]`. */
  readonly id: string;
  /** Archivo `.meeko` de la página. */
  readonly file: string;
  /** Cadena de layouts, de fuera hacia dentro. */
  readonly layouts: readonly string[];
  /** `+error.meeko` más cercano, si existe. */
  readonly error?: string;
  /**
   * Módulo que exporta las opciones de ruta: un archivo `*.route.ts` o, en una página con
   * `<script server>`, el ID de módulo `<página>.meeko?meeko-route&lang.ts`, que sólo carga el
   * plugin de Vite de Meeko. No siempre es una ruta de archivo.
   */
  readonly sidecar?: string;
  /** Modo de render leído estáticamente del sidecar al descubrir la ruta; sin él, SSR. */
  readonly render?: PageRender;
}

/**
 * Resultado de {@link matchRoute}: la ruta y sus parámetros ya decodificados.
 *
 * @example
 * ```ts
 * import { matchRoute } from "@meekojs/meeko/framework";
 *
 * const match = matchRoute(routes, "/users/42");
 * if (match) console.log(match.route.id, match.params.id); // "/users/[id]" "42"
 * ```
 */
export interface RouteMatch {
  /** Ruta que coincide. */
  readonly route: RouteRecord;
  /** Parámetros de la URL por nombre; un catch-all une sus segmentos con `/`. */
  readonly params: Readonly<Record<string, string>>;
}

/**
 * Página de error de la aplicación (`app/error.meeko`) y los layouts raíz que la rodean. Renderiza
 * las URL sin ruta y respalda las rutas sin `+error.meeko`. La devuelve `discoverErrorPage` y la
 * reciben `errorPage` de `mountClientApp`, `createFrameworkHandler` y `AppManifest`.
 *
 * @since 1.1.0
 * @example
 * ```ts
 * import type { ErrorPageRecord } from "@meekojs/meeko/framework";
 *
 * const errorPage: ErrorPageRecord = {
 *   file: "app/error.meeko",
 *   layouts: ["app/app.meeko", "app/layouts/default.meeko"],
 * };
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#página-de-error-de-la-aplicación-apperrormeeko
 */
export interface ErrorPageRecord {
  /** Archivo `.meeko` de la página de error. */
  readonly file: string;
  /** Cadena de layouts raíz, de fuera hacia dentro: `app/app.meeko` y después el layout raíz. */
  readonly layouts: readonly string[];
}

/** Manifest of the request the server is rendering; registered by the page handler. */
let serverManifest: (() => readonly RouteRecord[] | undefined) | undefined;
/** Manifests of the mounted browser apps; the last mounted one is active. */
const browserManifests: (readonly RouteRecord[])[] = [];

/** Lets the server renderer supply the manifest of the current request. */
export function provideServerRouteManifest(source: () => readonly RouteRecord[] | undefined): void {
  serverManifest = source;
}

/** Makes `routes` the browser manifest of `href(id)` until the returned release runs. */
export function activateRouteManifest(routes: readonly RouteRecord[]): () => void {
  browserManifests.push(routes);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const index = browserManifests.lastIndexOf(routes);
    if (index >= 0) browserManifests.splice(index, 1);
  };
}

/** Manifest of the running application: the current server request, else the mounted browser app. */
export function activeRouteManifest(): readonly RouteRecord[] {
  const routes = serverManifest?.() ?? browserManifests[browserManifests.length - 1];
  if (!routes) {
    throw new Error("href(id) needs a running Meeko application (a server request or a mounted browser app); outside one, pass the manifest: href(routes, id)");
  }
  return routes;
}

type Segment = { kind: "static" | "param" | "rest"; value: string };

function segments(id: string): Segment[] {
  if (!id.startsWith("/")) throw new TypeError(`Route must start with /: ${id}`);
  return id.split("/").slice(1).filter(Boolean).map((part, index, all) => {
    if (/^\[\.\.\.[A-Za-z_$][\w$]*\]$/.test(part)) {
      if (index !== all.length - 1) throw new TypeError(`Catch-all must be final: ${id}`);
      return { kind: "rest", value: part.slice(4, -1) };
    }
    if (/^\[[A-Za-z_$][\w$]*\]$/.test(part)) return { kind: "param", value: part.slice(1, -1) };
    if (part.includes("[") || part.includes("]")) throw new TypeError(`Invalid route segment: ${part}`);
    return { kind: "static", value: part };
  });
}

function rank(id: string): number[] {
  return segments(id).map((part) => part.kind === "static" ? 3 : part.kind === "param" ? 2 : 1);
}

function compareRoute(a: RouteRecord, b: RouteRecord): number {
  const left = rank(a.id);
  const right = rank(b.id);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const score = (right[index] ?? 0) - (left[index] ?? 0);
    if (score) return score;
  }
  return a.id.localeCompare(b.id);
}

function collisionKey(id: string): string {
  return segments(id).map((part) => part.kind === "static" ? part.value : part.kind === "param" ? "[]" : "[...]").join("/");
}

function decodePart(part: string): string | undefined {
  try {
    const value = decodeURIComponent(part);
    return value.includes("/") || value.includes("\\") || value === "." || value === ".." ? undefined : value;
  } catch {
    return undefined;
  }
}

/**
 * Crea un manifiesto de rutas inmutable: comprueba que no haya dos rutas con la misma forma de URL
 * y ordena las estáticas antes que las de parámetros y los catch-all.
 *
 * @param routes Rutas descubiertas o declaradas a mano.
 * @returns El manifiesto ordenado y congelado.
 * @throws {Error} `Route collision` si dos rutas resuelven a la misma URL.
 * @throws {TypeError} Si un ID no empieza por `/`, tiene un segmento inválido o un catch-all que no es el último.
 * @example
 * ```ts
 * import { createRouteManifest, matchRoute } from "@meekojs/meeko/framework";
 *
 * const routes = createRouteManifest([
 *   { id: "/users/[id]", file: "app/pages/users/[id].meeko", layouts: [] },
 *   { id: "/users/new", file: "app/pages/users/new.meeko", layouts: [] },
 * ]);
 * matchRoute(routes, "/users/new")?.route.id; // "/users/new"
 * ```
 */
export function createRouteManifest(routes: readonly RouteRecord[]): readonly RouteRecord[] {
  const keys = new Map<string, string>();
  for (const route of routes) {
    const key = collisionKey(route.id);
    const previous = keys.get(key);
    if (previous) throw new Error(`Route collision: ${previous} and ${route.file} both resolve to ${key || "/"}`);
    keys.set(key, route.file);
  }
  return Object.freeze([...routes].sort(compareRoute));
}

/**
 * Busca la ruta de una URL en el mismo manifiesto que usan SSR y la navegación de cliente. Decodifica
 * cada segmento y rechaza los que contienen `/`, `\`, `.` o `..`.
 *
 * @param routes Manifiesto creado con {@link createRouteManifest}.
 * @param pathname Ruta de la URL, que empieza por `/`.
 * @returns La ruta y sus parámetros, o `undefined` si ninguna coincide.
 * @example
 * ```ts
 * import { matchRoute } from "@meekojs/meeko/framework";
 *
 * const match = matchRoute(routes, new URL(request.url).pathname);
 * if (!match) return new Response("Not Found", { status: 404 });
 * ```
 */
export function matchRoute(routes: readonly RouteRecord[], pathname: string): RouteMatch | undefined {
  if (!pathname.startsWith("/")) return undefined;
  const raw = pathname.split("/").slice(1).filter(Boolean);
  const path = raw.map(decodePart);
  if (path.some((part) => part === undefined)) return undefined;
  for (const route of routes) {
    const pattern = segments(route.id);
    const params: Record<string, string> = {};
    let index = 0;
    let matched = true;
    for (const part of pattern) {
      if (part.kind === "rest") {
        if (index === path.length) { matched = false; break; }
        params[part.value] = path.slice(index).join("/");
        index = path.length;
        break;
      }
      const value = path[index++];
      if (value === undefined || (part.kind === "static" && part.value !== value)) { matched = false; break; }
      if (part.kind === "param") params[part.value] = value;
    }
    if (matched && index === path.length) return { route, params };
  }
  return undefined;
}

/** Builds a URL from a manifest route and rejects absent or extra parameters. */
export function href(routes: readonly RouteRecord[], id: string, options: {
  params?: Readonly<Record<string, string>>;
  search?: Readonly<Record<string, string | number | boolean | null | undefined>>;
} = {}): string {
  if (!routes.some((route) => route.id === id)) throw new Error(`Unknown route: ${id}`);
  const params = options.params ?? {};
  const used = new Set<string>();
  const path = segments(id).map((part) => {
    if (part.kind === "static") return encodeURIComponent(part.value);
    const value = params[part.value];
    if (!value) throw new Error(`Missing route parameter: ${part.value}`);
    used.add(part.value);
    if (part.kind === "rest") {
      const pieces = value.split("/");
      if (pieces.some((piece) => !piece || piece === "." || piece === "..")) throw new Error(`Invalid catch-all parameter: ${part.value}`);
      return pieces.map(encodeURIComponent).join("/");
    }
    if (value.includes("/") || value === "." || value === "..") throw new Error(`Invalid route parameter: ${part.value}`);
    return encodeURIComponent(value);
  });
  for (const key of Object.keys(params)) if (!used.has(key)) throw new Error(`Unknown route parameter: ${key}`);
  const url = new URL(path.length ? `/${path.join("/")}` : "/", "http://meeko.local");
  for (const [key, value] of Object.entries(options.search ?? {})) if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
  return url.pathname + url.search;
}

/**
 * Lo que recibe el callback de render de {@link createNavigator} en cada navegación.
 *
 * @example
 * ```ts
 * import { createNavigator } from "@meekojs/meeko/framework";
 * import type { NavigationContext } from "@meekojs/meeko/framework";
 *
 * async function render({ url, match, signal, retainedLayouts }: NavigationContext): Promise<boolean> {
 *   const response = await fetch(url, { signal, headers: { accept: "application/meeko+json" } });
 *   if (signal.aborted) return false;
 *   console.log(match.route.id, retainedLayouts, await response.json());
 *   return true;
 * }
 * const navigator = createNavigator(routes, render);
 * ```
 */
export interface NavigationContext {
  /** URL de destino. */
  readonly url: URL;
  /** Ruta de destino y sus parámetros. */
  readonly match: RouteMatch;
  /** Se aborta cuando otra navegación sustituye a esta. */
  readonly signal: AbortSignal;
  /** Longitud del prefijo común con la cadena de layouts de la ruta anterior, que se conserva. */
  readonly retainedLayouts: number;
}

/**
 * Navegador de bajo nivel que devuelve {@link createNavigator}.
 *
 * @example
 * ```ts
 * const navigator = createNavigator(routes, render);
 * await navigator.navigate("/users/42");
 * await navigator.navigate("/users/43", { replace: true });
 * navigator.dispose();
 * ```
 */
export interface Navigator {
  /**
   * Navega a `to` dentro del mismo origen. Devuelve `false` si la URL no tiene ruta o la navegación
   * se canceló, y rechaza si falla el render o la URL es de otro origen.
   */
  navigate(to: string, options?: { replace?: boolean }): Promise<boolean>;
  /** Aborta la navegación pendiente y deja de escuchar `popstate`; después, `navigate` lanza. */
  dispose(): void;
}

/** Browser events cannot return a navigation promise, so surface failures safely. */
export function reportNavigationError(browser: Window, error: unknown, observer?: (error: unknown) => void): void {
  const logger = (browser as Window & { console?: { error(...args: unknown[]): void } }).console ?? console;
  const reportObserverFailure = (observerError: unknown) => {
    try { logger.error("Meeko navigation error observer failed", observerError, error); }
    catch { /* A broken console must not produce an unhandled rejection. */ }
  };
  if (observer) observeCallback(() => observer(error), reportObserverFailure);
  else observeCallback(() => logger.error("Meeko navigation failed", error), () => {});
}

/**
 * Crea un navegador de cliente para un host propio: actualiza el historial y atiende `popstate`,
 * pero no intercepta enlaces. El host renderiza el outlet en el DOM; su callback recibe la ruta y
 * cuántos layouts se conservan, para mantener las instancias comunes y liberar las que salen.
 * Devolver `false` cancela la navegación.
 *
 * @param routes Manifiesto de rutas.
 * @param render Callback que renderiza cada navegación.
 * @param browser Ventana del navegador; por defecto, `window`.
 * @param onError Observador de los fallos de las navegaciones por historial.
 * @returns El {@link Navigator}.
 * @example
 * ```ts
 * import { createNavigator } from "@meekojs/meeko/framework";
 *
 * const navigator = createNavigator(routes, async ({ match, signal }) => {
 *   const html = await (await fetch(`/fragments${match.route.id}`, { signal })).text();
 *   document.querySelector("#outlet")!.innerHTML = html;
 * }, window, (error) => console.error("navegación fallida", error));
 * ```
 */
export function createNavigator(routes: readonly RouteRecord[], render: (context: NavigationContext) => Promise<void | boolean> | void | boolean, browser: Window = window, onError?: (error: unknown) => void): Navigator {
  return createAppNavigator(routes, render, browser, onError);
}

/** Context of a navigation to a URL without a route. */
export type UnmatchedNavigationContext = Omit<NavigationContext, "match">;

/** Renders URLs without a route, such as the application error page, inside `layouts`. */
export interface UnmatchedNavigation {
  readonly layouts: readonly string[];
  render(context: UnmatchedNavigationContext): Promise<void | boolean> | void | boolean;
}

/** Whether two URLs name the same document and differ at most in their fragment. */
export function sameDocument(first: URL, second: URL): boolean {
  return first.origin === second.origin && first.pathname === second.pathname && first.search === second.search;
}

/**
 * Scrolls after a navigation like a document load: to the element that the fragment names or,
 * with `toTop`, to the top of the page. Hosts without a document or `scrollTo` are left alone.
 */
function scrollToFragment(browser: Window, url: URL, toTop: boolean): void {
  const document = (browser as Partial<Window>).document;
  let target: Element | null | undefined;
  if (url.hash.length > 1 && document) {
    let id = url.hash.slice(1);
    try { id = decodeURIComponent(id); }
    catch { /* A malformed escape keeps the raw fragment. */ }
    target = document.getElementById(id) ?? document.getElementsByName(id)[0];
  }
  // Instant, like a document load, even where the page sets `scroll-behavior: smooth`.
  if (target && typeof target.scrollIntoView === "function") target.scrollIntoView({ behavior: "instant" });
  else if (toTop && typeof browser.scrollTo === "function") browser.scrollTo({ top: 0, left: 0, behavior: "instant" });
}

/**
 * `createNavigator` plus an optional renderer for URLs without a route. Without
 * it such URLs are left to the browser, as `createNavigator` does.
 */
export function createAppNavigator(routes: readonly RouteRecord[], render: (context: NavigationContext) => Promise<void | boolean> | void | boolean, browser: Window = window, onError?: (error: unknown) => void, unmatched?: UnmatchedNavigation): Navigator {
  const initial = matchRoute(routes, browser.location.pathname);
  let currentLayouts: readonly string[] | undefined = initial ? initial.route.layouts : unmatched?.layouts;
  let currentUrl = browser.location.href;
  let pending: AbortController | undefined;
  let disposed = false;
  const navigate = async (to: string, options: { replace?: boolean } = {}): Promise<boolean> => {
    if (disposed) throw new Error("Navigator disposed");
    const url = new URL(to, browser.location.href);
    if (url.origin !== browser.location.origin) throw new TypeError("External navigation is not a Meeko route");
    // Only the fragment changes: the page stays as it is, like a fragment link in a document.
    if (url.hash && !options.replace && sameDocument(url, new URL(currentUrl))) {
      pending?.abort();
      pending = undefined;
      browser.history.pushState(null, "", url);
      currentUrl = url.href;
      scrollToFragment(browser, url, false);
      return true;
    }
    const match = matchRoute(routes, url.pathname);
    if (!match && !unmatched) {
      if (options.replace && browser.location.href === url.href) {
        try { browser.history.replaceState(null, "", currentUrl); }
        catch (historyError) {
          try { browser.location.replace(currentUrl); }
          catch (recoveryError) {
            throw new AggregateError([historyError, recoveryError], "Meeko history and URL recovery failed");
          }
          throw historyError;
        }
      }
      return false;
    }
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    const layouts = match ? match.route.layouts : unmatched!.layouts;
    let retainedLayouts = 0;
    if (currentLayouts) {
      while (currentLayouts[retainedLayouts] === layouts[retainedLayouts]
        && retainedLayouts < currentLayouts.length
        && retainedLayouts < layouts.length) retainedLayouts++;
    }
    let result: void | boolean;
    try {
      result = match
        ? await render({ url, match, signal: controller.signal, retainedLayouts })
        : await unmatched!.render({ url, signal: controller.signal, retainedLayouts });
    }
    catch (error) {
      if (pending === controller) pending = undefined;
      if (options.replace && !controller.signal.aborted && !disposed && browser.location.href === url.href) {
        try { browser.history.replaceState(null, "", currentUrl); }
        catch (historyError) {
          try { browser.location.replace(currentUrl); }
          catch (recoveryError) {
            throw new AggregateError([error, historyError, recoveryError], "Meeko navigation and URL recovery failed");
          }
          throw new AggregateError([error, historyError], "Meeko navigation and history recovery failed");
        }
      }
      throw error;
    }
    if (result === false) {
      if (pending === controller) pending = undefined;
      if (options.replace && !controller.signal.aborted && browser.location.href === url.href) {
        try { browser.history.replaceState(null, "", currentUrl); }
        catch (historyError) {
          try { browser.location.replace(currentUrl); }
          catch (recoveryError) {
            throw new AggregateError([historyError, recoveryError], "Meeko history and URL recovery failed");
          }
          throw historyError;
        }
      }
      return false;
    }
    if (controller.signal.aborted || disposed) return false;
    try {
      if (options.replace) browser.history.replaceState(null, "", url);
      else browser.history.pushState(null, "", url);
    } catch (error) {
      if (pending === controller) pending = undefined;
      try { browser.location.replace(currentUrl); }
      catch (recoveryError) {
        throw new AggregateError([error, recoveryError], "Meeko history update and navigation recovery failed");
      }
      throw error;
    }
    currentLayouts = layouts;
    currentUrl = url.href;
    pending = undefined;
    // A new entry starts at the top or at its fragment; history and replaced entries keep the
    // browser's scroll unless a fragment names an element.
    scrollToFragment(browser, url, !options.replace);
    return true;
  };
  const onPop = () => {
    // Moving between fragments of the same document: the browser restores the scroll itself.
    let url: URL | undefined;
    try { url = new URL(browser.location.href); }
    catch { url = undefined; }
    if (url && sameDocument(url, new URL(currentUrl))) {
      currentUrl = url.href;
      return;
    }
    void navigate(browser.location.href, { replace: true }).catch((error: unknown) => reportNavigationError(browser, error, onError));
  };
  browser.addEventListener("popstate", onPop);
  return {
    navigate,
    dispose() {
      disposed = true;
      pending?.abort();
      browser.removeEventListener("popstate", onPop);
    },
  };
}

import { batch, createContext, findContext, provide, signal } from "../reactivity.js";
import type { ReadonlySignal } from "../reactivity.js";

/**
 * Estado de navegación de la aplicación del navegador que renderiza un componente. Lo devuelve
 * {@link useNavigation}.
 *
 * @example
 * ```ts
 * import { useNavigation } from "@meekojs/meeko/framework";
 * import type { NavigationState } from "@meekojs/meeko/framework";
 *
 * const navigation: NavigationState = useNavigation();
 * const busy = navigation.pending.value;
 * ```
 */
export interface NavigationState {
  /** `true` desde que empieza una navegación hasta que su página se confirma, falla o se cancela. */
  readonly pending: ReadonlySignal<boolean>;
}

const navigationKey = /*#__PURE__*/ createContext<NavigationState>("Meeko navigation");

const idle: NavigationState = /*#__PURE__*/ Object.freeze({ pending: /*#__PURE__*/ Object.freeze({ value: false }) });

/**
 * Lee el estado de navegación de la aplicación actual. `pending` vale `true` mientras se carga una
 * página nueva, incluidos sus `await useApi`/`await useRpcQuery`. En SSR y fuera de
 * `mountClientApp` vale siempre `false`. Puede llamarse también desde código anidado.
 *
 * @returns El estado de navegación, con `pending` reactivo.
 * @example
 * ```html
 * <script lang="ts">
 * import { useNavigation } from "@meekojs/meeko/framework";
 * const navigation = useNavigation();
 * </script>
 * <template><p if:when="navigation.pending.value">Cargando…</p></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#estado-de-navegación
 */
export function useNavigation(): NavigationState {
  return findContext(navigationKey) ?? idle;
}

/** Makes an application's navigation status available to its component tree. */
export function provideNavigation(state: NavigationState): void {
  provide(navigationKey, state);
}

/**
 * Ruta confirmada que renderiza un componente: la de la petición en SSR y la de la última
 * navegación confirmada en el navegador. La devuelve {@link useRoute}; cada campo es una señal de
 * sólo lectura.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import { useRoute } from "@meekojs/meeko/framework";
 * import type { RouteState } from "@meekojs/meeko/framework";
 *
 * const route: RouteState = useRoute();
 * const onUsers = route.path.value.startsWith("/users");
 * ```
 */
export interface RouteState {
  /**
   * URL relativa al origen: `pathname`, `search` y, en el navegador, el fragmento (`/users/42?tab=a#bio`).
   * En SSR no hay fragmento, porque el navegador no lo envía: al hidratar vale lo mismo que en el
   * servidor y, si la dirección tiene `#fragmento`, se actualiza justo después de la hidratación.
   */
  readonly url: ReadonlySignal<string>;
  /** `pathname` de la URL, codificado como en `location.pathname` (`/users/42`). */
  readonly path: ReadonlySignal<string>;
  /** ID de la ruta en el manifiesto (`"/users/[id]"`), o `null` en la página `404` de `app/error.meeko`. */
  readonly id: ReadonlySignal<string | null>;
  /** Parámetros de la ruta, con la misma forma que recibe la página (validados por su schema). */
  readonly params: ReadonlySignal<Readonly<Record<string, unknown>>>;
  /** Parámetros de búsqueda, con la misma forma que recibe la página (validados por su schema). */
  readonly search: ReadonlySignal<Readonly<Record<string, unknown>>>;
}

/** Values of a committed route, as `RouteState` exposes them. */
export interface RouteSnapshot {
  readonly url: string;
  readonly path: string;
  readonly id: string | null;
  readonly params: Readonly<Record<string, unknown>>;
  readonly search: Readonly<Record<string, unknown>>;
}

const routeKey = /*#__PURE__*/ createContext<RouteState>("Meeko route");

/**
 * Lee la ruta confirmada de la aplicación actual: `url`, `path`, `id`, `params` y `search`. En SSR
 * son los de la petición, también en layouts, `app/app.meeko` y la página `404`; en el navegador
 * cambian sólo cuando una navegación se confirma (no mientras `useNavigation().pending` vale
 * `true`), también por el historial y al cambiar sólo el `#fragmento`. Se autoimporta y puede
 * llamarse también desde código anidado.
 *
 * @returns La ruta actual, con un campo reactivo por valor.
 * @throws {Error} Fuera de una aplicación de Meeko (un render SSR del framework o `mountClientApp`).
 * @since 1.2.0
 * @example
 * ```html
 * <!-- app/layouts/default.meeko -->
 * <script lang="ts">
 * import type { Component } from "@meekojs/meeko";
 * const props = defineProps<{ outlet: Component<Record<string, unknown>> }>();
 * const route = useRoute();
 * const current = (path: string) => route.path.value === path ? "page" : null;
 * </script>
 * <template>
 *   <nav>
 *     <a href="/users" bind:aria-current="current('/users')">Usuarios</a>
 *     <a href="/settings" bind:aria-current="current('/settings')">Ajustes</a>
 *   </nav>
 *   <main><component is="props.outlet"></component></main>
 * </template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#ruta-actual
 */
export function useRoute(): RouteState {
  const route = findContext(routeKey);
  if (!route) {
    throw new Error("useRoute() necesita una aplicación de Meeko en ejecución: sólo funciona en componentes que renderiza el servidor del framework o que monta mountClientApp. En una prueba unitaria, pasa la ruta al componente como prop.");
  }
  return route;
}

/** Makes a route available to the component tree of the active root. */
export function provideRoute(route: RouteState): void {
  provide(routeKey, route);
}

/** A route whose values never change: a server render or the dry pass of a navigation. */
export function fixedRoute(snapshot: RouteSnapshot): RouteState {
  const read = <T>(value: T): ReadonlySignal<T> => Object.freeze({ value });
  return Object.freeze({
    url: read(snapshot.url), path: read(snapshot.path), id: read(snapshot.id),
    params: read(snapshot.params), search: read(snapshot.search),
  });
}

/** The committed route of a browser tree. `set` changes every field in one batch. */
export interface LiveRoute {
  readonly state: RouteState;
  current(): RouteSnapshot;
  set(next: RouteSnapshot): void;
}

export function liveRoute(initial: RouteSnapshot): LiveRoute {
  const url = signal(initial.url);
  const path = signal(initial.path);
  const id = signal(initial.id);
  const params = signal(initial.params);
  const search = signal(initial.search);
  const read = <T>(source: { readonly value: T }): ReadonlySignal<T> => Object.freeze({ get value() { return source.value; } });
  let snapshot = initial;
  return {
    state: Object.freeze({ url: read(url), path: read(path), id: read(id), params: read(params), search: read(search) }),
    current: () => snapshot,
    set(next) {
      snapshot = next;
      batch(() => {
        url.value = next.url;
        path.value = next.path;
        id.value = next.id;
        params.value = next.params;
        search.value = next.search;
      });
    },
  };
}

/** Snapshot of `url` for a route: the hash only exists in the browser. */
export function routeSnapshot(url: URL, id: string | null, params: Readonly<Record<string, unknown>>, search: Readonly<Record<string, unknown>>, withHash: boolean): RouteSnapshot {
  return { url: url.pathname + url.search + (withHash ? url.hash : ""), path: url.pathname, id, params, search };
}

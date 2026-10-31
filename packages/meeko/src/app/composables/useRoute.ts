import type { RouteState } from "../runtime/navigation";

import { findContext } from "../../core/reactivity";
import { routeKey } from "../runtime/navigation";

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


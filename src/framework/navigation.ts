import { createContext, findContext, provide } from "../reactivity.js";
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

const navigationKey = createContext<NavigationState>("Meeko navigation");

const idle: NavigationState = Object.freeze({ pending: Object.freeze({ value: false }) });

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

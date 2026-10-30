import { findContext } from "../../core/reactivity.js";
import { navigationKey } from "../runtime/navigation.js";
import type { NavigationState } from "../runtime/navigation.js";

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


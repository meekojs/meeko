/**
 * Runtime and types behind `defineExpose(value)`.
 *
 * The compiler keeps the exposed value next to the setup bindings under `exposedKey`, a symbol,
 * so state snapshots, DevTools and destructuring never see it. `hydrateScope` returns it as
 * `exposed` on its release function, where the parent's template binding reads it.
 */

/** Key of the exposed value in the object that a component setup returns. */
export const exposedKey: unique symbol = Symbol("meeko.exposed");

/**
 * Implementación de la macro `defineExpose(value)`: en tiempo de ejecución es la identidad, y
 * `defineExpose<T>(value)` comprueba `value` contra `T`. El compilador guarda el valor bajo
 * `exposedKey`; el padre lo recibe con `ref:` y `useElementRef`.
 *
 * @since 1.1.0
 * @example
 * ```html
 * <script lang="ts">
 * const query = signal("");
 * defineExpose({ query, clear: () => { query.value = ""; } });
 * </script>
 * <template><input bind:value="query.value" /></template>
 * ```
 */
export function defineExpose<T>(value: T): T {
  return value;
}

/**
 * Value that a compiled component exposes to a parent `ref`: the type of its `defineExpose`
 * argument, or `null` when it has no `defineExpose`. A union of components gives a union.
 */
export type ExposedOf<Module> = Module extends { readonly hydrateScope: (...args: never[]) => infer Release }
  ? Release extends { readonly exposed?: infer Exposed } ? (unknown extends Exposed ? null : Exposed) : null
  : null;

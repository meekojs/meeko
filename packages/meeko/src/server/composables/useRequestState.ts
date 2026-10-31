import type { RequestContext } from "../runtime/request-context";

/**
 * Devuelve el valor de `key` en el estado de la petición y lo crea con `factory()` la primera vez.
 * Sirve para compartir un valor entre middleware, loaders y handlers de una misma petición, como
 * una caché por petición.
 *
 * @param context Contexto de la petición.
 * @param key Clave del valor.
 * @param factory Crea el valor si no existe.
 * @returns El valor de la petición.
 * @example
 * ```ts
 * import { defineRpc, useRequestState } from "@meekojs/meeko/server";
 *
 * export default defineRpc({
 *   input: userParams,
 *   output: userSchema,
 *   handler: ({ input, context }) => {
 *     const cache = useRequestState(context, "users", () => new Map<string, { id: string; name: string }>());
 *     return cache.get(input.id) ?? { id: input.id, name: "Ada" };
 *   },
 * });
 * ```
 */
export function useRequestState<T>(context: RequestContext, key: string, factory: () => T): T {
  if (!context.state.has(key)) context.state.set(key, factory());
  return context.state.get(key) as T;
}

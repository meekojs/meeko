import { inject } from "../../core/reactivity.js";
import type { Signal } from "../../core/reactivity.js";
import { stateKey } from "../runtime/state.js";

/**
 * Devuelve la señal de estado de la aplicación con clave `key`, creada con `factory()` la primera
 * vez. En SSR es por petición y se transfiere al navegador en el payload; en el navegador se
 * comparte entre los componentes de la aplicación. El valor debe ser serializable en JSON. Se
 * autoimporta y es la base de los stores de `app/stores`.
 *
 * @param key Clave única en la aplicación, como `"cart:items"`.
 * @param factory Valor inicial si la clave no existe todavía.
 * @returns La señal compartida de esa clave.
 * @throws {Error} Fuera de una aplicación de Meeko («Missing Meeko context»).
 * @throws {StateSealedError} `STATE_SEALED` al crear o escribir una clave después de enviar la página.
 * @example
 * ```ts
 * // app/stores/cart.ts
 * import { useState } from "@meekojs/meeko/framework";
 *
 * export function useCart() {
 *   const items = useState("cart:items", (): string[] => []);
 *   const add = (id: string): void => { items.value = [...items.value, id]; };
 *   return { items, add };
 * }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#autoimports-y-typescript
 */
export function useState<T>(key: string, factory: () => T): Signal<T> {
  return inject(stateKey).get(key, factory);
}


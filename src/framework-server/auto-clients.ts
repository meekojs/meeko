import { currentRequest } from "./context.js";
import type { ClientOptions } from "../framework/clients.js";

/**
 * Opciones de cliente para el servidor: leen la URL, las cookies, `authorization`, el token CSRF y
 * el despacho local de la petición en curso en cada llamada, así que un cliente creado a nivel de
 * módulo nunca retiene credenciales de otro usuario. Es lo que usan los clientes `api` y `rpc`
 * generados para SSR.
 *
 * @returns Opciones dinámicas ligadas a la petición activa.
 * @throws {Error} Desde cada llamada del cliente, fuera de una petición de Meeko.
 * @example
 * ```ts
 * import { createApiClient } from "@meekojs/meeko/framework";
 * import { createServerClientOptions } from "@meekojs/meeko/server";
 *
 * export const api = createApiClient<ApiContract>(manifest, createServerClientOptions());
 * ```
 */
export function createServerClientOptions(): ClientOptions {
  return {
    baseUrl: () => currentRequest().context.request.url,
    headers: () => {
      const request = currentRequest().context.request;
      const headers = new Headers();
      for (const name of ["cookie", "authorization"]) {
        const value = request.headers.get(name);
        if (value !== null) headers.set(name, value);
      }
      headers.set("origin", new URL(request.url).origin);
      return headers;
    },
    csrfToken: () => currentRequest().context.session.current?.csrfToken,
    fetch: async (input, init) => {
      const active = currentRequest();
      const request = new Request(input, init);
      if (active.serverFetch) return active.serverFetch(request, active.context);
      return fetch(request);
    },
  };
}

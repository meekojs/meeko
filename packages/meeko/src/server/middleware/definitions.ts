import type { ServerMiddleware } from "./index";

/**
 * Declara el middleware de servidor que exporta por defecto un archivo de `server/middleware/`.
 * Meeko los ejecuta por nombre de archivo, de fuera hacia dentro, antes de crear el contexto de
 * sesión. Puede continuar, modificar la respuesta o cortocircuitar.
 *
 * @param middleware Función que recibe la petición y `next`.
 * @returns El mismo middleware.
 * @example
 * ```ts
 * // server/middleware/10-request-header.ts
 * import { defineServerMiddleware } from "@meekojs/meeko/server";
 *
 * export default defineServerMiddleware(async (request, next) => {
 *   const response = await next();
 *   const headers = new Headers(response.headers);
 *   headers.set("x-content-type-options", "nosniff");
 *   return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#middleware-de-rutas-y-servidor
 */
export function defineServerMiddleware(middleware: ServerMiddleware): ServerMiddleware {
  return middleware;
}
import type { RouteMiddlewareOptions } from "../../app/middleware/runtime";
import type { ServerRouteMiddleware } from "./runtime";

/**
 * Declara el middleware de ruta de servidor que exporta por defecto un archivo
 * `app/middleware/*.server.ts` (se autoimporta en los `*.server.ts` y en `server/`); otro export por
 * defecto, o ninguno, detiene el descubrimiento. Sólo se ejecuta en el servidor, con la sesión de la
 * petición, y nunca llega al bundle del navegador: puede importar `server/` y `#server/…`.
 * Meeko lo ejecuta después del middleware de ruta isomórfico (`defineRouteMiddleware`) y antes del
 * `<script server>` o el `load` de la página, en la petición del documento y en la de los datos de
 * cada navegación del navegador. Sin opciones es global; con `{ global: false }` es un middleware con
 * nombre (`auth.server.ts` es `"auth"`), que las rutas piden con `middleware` en `definePage` o en un
 * `+group.ts`. No se ejecuta en las páginas `render: "client"` ni `render: "prerender"`, que no piden
 * sus datos al servidor en cada petición: pedir uno con nombre en ellas detiene el descubrimiento.
 * No protege `server/api` ni el RPC, que necesitan sus propias guardas.
 *
 * @param middleware Función que recibe el contexto de la petición.
 * @param options `{ global: false }` para un middleware con nombre; debe ser un objeto literal.
 * @returns El mismo middleware.
 * @since 1.6.0
 * @example
 * ```ts
 * // app/middleware/auth.server.ts
 * import { redirect } from "@meekojs/meeko/framework";
 *
 * export default defineServerRouteMiddleware(({ session, url }) => {
 *   if (!session.current) redirect(`/login?next=${encodeURIComponent(url.pathname)}`);
 * }, { global: false });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#middleware-de-ruta-de-servidor
 */
export function defineServerRouteMiddleware<TServices = unknown, TEnv = unknown>(
  middleware: ServerRouteMiddleware<TServices, TEnv>, options?: RouteMiddlewareOptions,
): ServerRouteMiddleware<TServices, TEnv> {
  void options;
  return middleware;
}

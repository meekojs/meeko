import type { RouteMiddleware, RouteMiddlewareOptions } from "../middleware/runtime";

/**
 * Declara el middleware de ruta que exporta por defecto un archivo de `app/middleware/`. Meeko
 * ejecuta los globales en todas las rutas, por nombre de archivo, antes del sidecar y el loader, en
 * SSR y al navegar. Desde `1.6`, `{ global: false }` lo convierte en un middleware con nombre (el del
 * archivo sin `.ts` ni prefijo numérico: `10-auth.ts` es `"auth"`), que sólo se ejecuta, después de
 * los globales, en las rutas que lo piden con `middleware` en `definePage` o en un `+group.ts`. Se
 * empaqueta también para el navegador: no sustituye a la autorización del loader, la API o el RPC.
 * Para comprobar la sesión en el servidor, usa {@link defineServerRouteMiddleware} en un `*.server.ts`.
 *
 * @param middleware Función que recibe el contexto de la ruta.
 * @param options Desde `1.6`, `{ global: false }` para un middleware con nombre; debe ser un objeto
 * literal.
 * @returns El mismo middleware.
 * @example
 * ```ts
 * // app/middleware/10-locale.ts
 * import { defineRouteMiddleware } from "@meekojs/meeko/framework";
 *
 * export default defineRouteMiddleware(({ url, match }) => {
 *   if (match.route.id !== "/dashboard") return;
 *   if (!url.searchParams.has("locale")) {
 *     const target = new URL(url);
 *     target.searchParams.set("locale", "es");
 *     return Response.redirect(target);
 *   }
 * });
 * ```
 * @example
 * ```ts
 * // app/middleware/auth.ts: sólo en las rutas que piden "auth"
 * import { defineRouteMiddleware } from "@meekojs/meeko/framework";
 *
 * export default defineRouteMiddleware(({ url, phase, request }) => {
 *   const cookies = phase === "server" ? request?.headers.get("cookie") ?? "" : document.cookie;
 *   if (!cookies.includes("signed-in=1")) return Response.redirect(new URL("/login", url));
 * }, { global: false });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#middleware-de-rutas-y-servidor
 */
export function defineRouteMiddleware(middleware: RouteMiddleware, options?: RouteMiddlewareOptions): RouteMiddleware {
  void options;
  return middleware;
}

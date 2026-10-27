import type { RouteMatch } from "./router.js";

/**
 * Contexto del middleware de ruta, que se ejecuta antes del loader en las peticiones SSR de una
 * página con ruta y en las navegaciones del navegador.
 *
 * @example
 * ```ts
 * import type { RouteMiddlewareContext } from "@meekojs/meeko/framework";
 *
 * function isAdminRoute({ match }: RouteMiddlewareContext): boolean {
 *   return match.route.id.startsWith("/admin");
 * }
 * ```
 */
export interface RouteMiddlewareContext {
  /** URL de destino. */
  readonly url: URL;
  /** Ruta de destino y sus parámetros. */
  readonly match: RouteMatch;
  /** Se aborta si la petición o la navegación se cancela. */
  readonly signal: AbortSignal;
  /** `"server"` en SSR y `"client"` al navegar en el navegador. */
  readonly phase: "server" | "client";
  /** Sólo existe en SSR. Nunca la serialice hacia el navegador. */
  readonly request?: Request;
}

/**
 * Middleware de ruta: devolver `undefined` continúa y devolver un `Response` detiene la ruta. Una
 * redirección durante una navegación del navegador carga la URL nueva con `location.assign`.
 *
 * @example
 * ```ts
 * import type { RouteMiddleware } from "@meekojs/meeko/framework";
 *
 * const requireLocale: RouteMiddleware = ({ url }) =>
 *   url.searchParams.has("locale") ? undefined : Response.redirect(new URL("?locale=es", url));
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#middleware-de-rutas-y-servidor
 */
export type RouteMiddleware = (context: RouteMiddlewareContext) => void | Response | Promise<void | Response>;

/**
 * Declara el middleware de ruta que exporta por defecto un archivo de `app/middleware/`. Meeko los
 * ejecuta por nombre de archivo antes del sidecar y el loader, en SSR y al navegar. Se empaqueta
 * también para el navegador: no sustituye a la autorización del loader, la API o el RPC.
 *
 * @param middleware Función que recibe el contexto de la ruta.
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
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#middleware-de-rutas-y-servidor
 */
export function defineRouteMiddleware(middleware: RouteMiddleware): RouteMiddleware {
  return middleware;
}

/** Stops at the first response; middleware files are supplied in filename order. */
export async function runRouteMiddleware(
  middlewares: readonly RouteMiddleware[],
  context: RouteMiddlewareContext,
): Promise<Response | undefined> {
  for (const middleware of middlewares) {
    const result = await middleware(context);
    if (result === undefined) continue;
    if (!(result instanceof Response)) throw new TypeError("Route middleware must return a Response or nothing");
    return result;
  }
  return undefined;
}

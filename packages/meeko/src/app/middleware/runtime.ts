import type { GeneratedRouteMiddleware } from "../../framework";
import type { RouteMatch, RouteRecord } from "../runtime/router";

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
 * Nombre de un middleware de ruta con nombre de la aplicación (`app/middleware/auth.ts` con
 * `{ global: false }` es `"auth"`): la unión que declara `.meeko/types/routes.d.ts` (`meeko check`,
 * `meeko dev`), o `string` sin esas declaraciones. Tipa `middleware` de `definePage` y `defineGroup`.
 *
 * @since 1.6.0
 * @example
 * ```ts
 * import type { RouteMiddlewareName } from "@meekojs/meeko/framework";
 *
 * const guards: readonly RouteMiddlewareName[] = ["auth", "admin"];
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#middleware-con-nombre
 */
export type RouteMiddlewareName = keyof GeneratedRouteMiddleware extends never ? string : Exclude<keyof GeneratedRouteMiddleware, "#none"> & string;

/**
 * The names of {@link RouteMiddlewareName} that a `render: "client"` page may ask for: the
 * isomorphic ones, without the server route middleware (`*.server.ts`).
 */
export type ClientRouteMiddlewareName = keyof GeneratedRouteMiddleware extends never ? string : {
  [K in keyof GeneratedRouteMiddleware]: GeneratedRouteMiddleware[K] extends `${string}.server.ts` ? never : K
}[Exclude<keyof GeneratedRouteMiddleware, "#none">] & string;

/**
 * Opciones de {@link defineRouteMiddleware}. Meeko las lee sin ejecutar el archivo, así que deben
 * ser un objeto literal.
 *
 * @since 1.6.0
 * @example
 * ```ts
 * import type { RouteMiddlewareOptions } from "@meekojs/meeko/framework";
 *
 * const options: RouteMiddlewareOptions = { global: false };
 * ```
 */
export interface RouteMiddlewareOptions {
  /**
   * `true` (por defecto) lo ejecuta en todas las rutas; `false` lo convierte en un middleware con
   * nombre, que sólo se ejecuta en las rutas que lo piden con `middleware` en `definePage` o en un
   * `+group.ts`. Debe ser el literal `true` o `false`.
   */
  readonly global?: boolean;
}

/** Where a page handler or a client app loads route middleware from. */
export interface RouteMiddlewareLoaders {
  readonly loadMiddleware?: (() => Promise<readonly RouteMiddleware[]>) | undefined;
  readonly loadNamedMiddleware?: ((file: string) => Promise<RouteMiddleware>) | undefined;
}

/** Whether `route` has any route middleware to run with `loaders`. */
export function hasRouteMiddleware(route: RouteRecord, loaders: RouteMiddlewareLoaders): boolean {
  return Boolean(loaders.loadMiddleware || route.middleware?.length);
}

/**
 * The global middleware, then the named middleware of `route` in its declared order. A route with
 * named middleware and no loader for it fails instead of skipping its guards.
 */
export async function routeMiddlewareChain(route: RouteRecord, loaders: RouteMiddlewareLoaders): Promise<readonly RouteMiddleware[]> {
  const files = route.middleware ?? [];
  const load = loaders.loadNamedMiddleware;
  if (files.length && !load) throw new Error(`Route ${route.id} has named middleware (${files.join(", ")}) but no loadNamedMiddleware to load it`);
  const [global, named] = await Promise.all([
    loaders.loadMiddleware ? loaders.loadMiddleware() : [],
    Promise.all(files.map((file) => load!(file))),
  ]);
  return named.length ? [...global, ...named] : global;
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

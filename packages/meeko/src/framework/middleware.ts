import type { GeneratedRouteMiddleware } from "../framework.js";
import type { RequestContext } from "../framework-server/context.js";
import type { ServerPlatform } from "../framework-server/platform.js";
import type { ContextServices } from "../framework-server/runtime.js";
import type { RouteMatch, RouteRecord } from "./router.js";

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

/**
 * Contexto del middleware de ruta de servidor (`app/middleware/*.server.ts`): el de `usePage()` en el
 * `<script server>` de la página, con la sesión, los servicios y la plataforma de la petición a mano.
 * `params` y `search` son los de la URL, sin validar todavía con los schemas de la página, porque el
 * middleware se ejecuta antes que su `<script server>` o su `load`.
 *
 * @typeParam TServices Tipo de `services`.
 * @typeParam TEnv Tipo del entorno de la plataforma.
 * @since 1.6.0
 * @example
 * ```ts
 * import type { ServerRouteMiddlewareContext } from "@meekojs/meeko/framework";
 *
 * function signedIn({ session }: ServerRouteMiddlewareContext): boolean {
 *   return session.current !== undefined;
 * }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#middleware-de-ruta-de-servidor
 */
export interface ServerRouteMiddlewareContext<TServices = unknown, TEnv = unknown> {
  /** URL de la petición. */
  readonly url: URL;
  /** Ruta de destino y sus parámetros. */
  readonly match: RouteMatch;
  /** Parámetros de la ruta, sin validar. */
  readonly params: Readonly<Record<string, string>>;
  /** Parámetros de búsqueda, sin validar. */
  readonly search: Readonly<Record<string, string | string[]>>;
  /** Petición HTTP: la del documento en SSR o la de los datos de la página al navegar. */
  readonly request: Request;
  /** Se aborta si el cliente se desconecta o se revoca la sesión. */
  readonly signal: AbortSignal;
  /**
   * Contexto de la petición, el mismo que `usePage().context`. Con `createFrameworkHandler` sin
   * `createContext`, leerlo (o `session`, `services`, `platform` y `requestId`) lanza un error.
   */
  readonly context: RequestContext<TServices, TEnv>;
  /** Sesión de la petición, como `context.session`. */
  readonly session: RequestContext<TServices, TEnv>["session"];
  /** Servicios de `server/runtime.ts`, como `context.services`; desde `1.7`, `AppServices` sin `TServices`. */
  readonly services: ContextServices<TServices>;
  /** Runtime que atiende la petición, como `context.platform`. */
  readonly platform: ServerPlatform<TEnv>;
  /** ID de la petición, como `context.requestId`. */
  readonly requestId: string;
}

/**
 * Middleware de ruta de servidor: devolver `undefined` continúa y devolver un `Response` detiene la
 * ruta; `redirect()`, `notFound()` y un error la detienen como en el `<script server>`.
 *
 * @typeParam TServices Tipo de `services`.
 * @typeParam TEnv Tipo del entorno de la plataforma.
 * @since 1.6.0
 * @example
 * ```ts
 * import type { ServerRouteMiddleware } from "@meekojs/meeko/framework";
 *
 * const staffOnly: ServerRouteMiddleware = ({ session }) =>
 *   session.current ? undefined : new Response("Forbidden", { status: 403 });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#middleware-de-ruta-de-servidor
 */
export type ServerRouteMiddleware<TServices = unknown, TEnv = unknown> =
  (context: ServerRouteMiddlewareContext<TServices, TEnv>) => void | Response | Promise<void | Response>;

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

/** Where a page handler loads server route middleware from. */
export interface ServerRouteMiddlewareLoaders {
  readonly loadServerMiddleware?: ((file: string) => Promise<ServerRouteMiddleware>) | undefined;
}

/** Render modes whose pages never ask the server for their data per request. */
const withoutServerData = new Set(["client", "prerender"]);

/**
 * The server middleware of `route`: its manifest lists the whole chain, the global ones and then
 * the named ones in declared order, so that a host without a loader fails instead of skipping a
 * guard. `render: "client"` and `render: "prerender"` routes run none and list none; a hand-written
 * manifest that lists one there fails here instead.
 */
export async function serverRouteMiddlewareChain(route: RouteRecord, loaders: ServerRouteMiddlewareLoaders): Promise<readonly ServerRouteMiddleware[]> {
  const files = route.serverMiddleware ?? [];
  if (route.render && withoutServerData.has(route.render)) {
    if (files.length) throw new Error(`Route ${route.id} renders "${route.render}" but has server route middleware (${files.join(", ")}), which needs a page that asks the server for its data`);
    return [];
  }
  if (!files.length) return [];
  const load = loaders.loadServerMiddleware;
  if (!load) throw new Error(`Route ${route.id} has server route middleware (${files.join(", ")}) but no loadServerMiddleware to load it`);
  return Promise.all(files.map((file) => load(file)));
}

/** Stops at the first response, like {@link runRouteMiddleware}. */
export async function runServerRouteMiddleware(
  middlewares: readonly ServerRouteMiddleware[],
  context: ServerRouteMiddlewareContext,
): Promise<Response | undefined> {
  for (const middleware of middlewares) {
    const result = await middleware(context);
    if (result === undefined) continue;
    if (!(result instanceof Response)) throw new TypeError("Server route middleware must return a Response or nothing");
    return result;
  }
  return undefined;
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

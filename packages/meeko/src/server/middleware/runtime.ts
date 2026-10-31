import type { RequestContext } from "../runtime/request-context";
import type { ServerPlatform } from "../runtime/platform";
import type { ContextServices } from "../runtime/definition";
import type { RouteMatch, RouteRecord } from "../../app/runtime/router";

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

/** Stops at the first response, like the isomorphic route middleware runner. */
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


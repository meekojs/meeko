import { copySocketAddress } from "./env.js";

/**
 * Middleware de servidor: envuelve las peticiones HTTP de páginas, API y RPC antes de que Meeko cree
 * su contexto. Recibe la petición y `next(request?)`, que sólo se puede llamar una vez, y devuelve
 * un `Response`.
 *
 * @example
 * ```ts
 * import type { ServerMiddleware } from "@meekojs/meeko/server";
 *
 * const timing: ServerMiddleware = async (request, next) => {
 *   const start = performance.now();
 *   const response = await next();
 *   console.log(request.method, new URL(request.url).pathname, Math.round(performance.now() - start), "ms");
 *   return response;
 * };
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#middleware-de-rutas-y-servidor
 */
export type ServerMiddleware = (
  request: Request,
  next: (request?: Request) => Promise<Response>,
) => Response | Promise<Response>;

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

/**
 * Compone una lista de middleware de servidor alrededor de un handler, en orden de fuera hacia
 * dentro. Espera el tramo siguiente aunque un middleware olvide esperar `next()`; si fallan ambos,
 * conserva los dos errores en un `AggregateError`.
 *
 * @param middlewares Middleware en orden de ejecución.
 * @param handler Handler final.
 * @returns Un handler que ejecuta la cadena.
 * @throws {Error} Desde el handler devuelto, si un middleware llama a `next()` más de una vez.
 * @example
 * ```ts
 * import { composeServerMiddleware } from "@meekojs/meeko/server";
 *
 * const handle = composeServerMiddleware([timing, securityHeaders], (request) => app.fetch(request));
 * const response = await handle(new Request("http://localhost/"));
 * ```
 */
export function composeServerMiddleware(
  middlewares: readonly ServerMiddleware[],
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  const run = async (index: number, request: Request): Promise<Response> => {
    const middleware = middlewares[index];
    if (!middleware) return handler(request);
    let called = false;
    let downstream: Promise<Response> | undefined;
    let result: Response | undefined;
    let middlewareError: unknown;
    let middlewareFailed = false;
    try {
      result = await middleware(request, (nextRequest = request) => {
        if (called) throw new Error("Server middleware called next() more than once");
        called = true;
        if (!(nextRequest instanceof Request)) throw new TypeError("Server middleware next() requires a Request");
        // A replaced request keeps the client's connection address, so rateLimit still counts per client.
        downstream = run(index + 1, copySocketAddress(request, nextRequest));
        // A middleware may forget to await next(). Keep its failure observed
        // until this frame can propagate it to the HTTP response path.
        void downstream.catch(() => {});
        return downstream;
      });
    } catch (error) {
      middlewareFailed = true;
      middlewareError = error;
    }
    let downstreamError: unknown;
    let downstreamFailed = false;
    if (downstream) {
      try { await downstream; }
      catch (error) { downstreamFailed = true; downstreamError = error; }
    }
    if (middlewareFailed && downstreamFailed && !Object.is(middlewareError, downstreamError)) {
      throw new AggregateError([middlewareError, downstreamError], "Server middleware and downstream failed");
    }
    if (middlewareFailed) throw middlewareError;
    if (downstreamFailed) throw downstreamError;
    if (!(result instanceof Response)) throw new TypeError("Server middleware must return a Response");
    return result;
  };
  return (request) => run(0, request);
}

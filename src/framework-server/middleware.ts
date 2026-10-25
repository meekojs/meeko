/** Wraps page and API/RPC HTTP requests before Meeko creates their context. */
export type ServerMiddleware = (
  request: Request,
  next: (request?: Request) => Promise<Response>,
) => Response | Promise<Response>;

export function defineServerMiddleware(middleware: ServerMiddleware): ServerMiddleware {
  return middleware;
}

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
        downstream = run(index + 1, nextRequest);
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

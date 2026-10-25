import type { RouteMatch } from "./router.js";

/** Runs for matched page requests and browser navigations before the loader. */
export interface RouteMiddlewareContext {
  readonly url: URL;
  readonly match: RouteMatch;
  readonly signal: AbortSignal;
  readonly phase: "server" | "client";
  /** Only present during SSR. Never serialize this request to the browser. */
  readonly request?: Request;
}

export type RouteMiddleware = (context: RouteMiddlewareContext) => void | Response | Promise<void | Response>;

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

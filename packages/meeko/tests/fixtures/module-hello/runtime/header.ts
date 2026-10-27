import { defineServerMiddleware } from "@meekojs/meeko/server";

/** Server middleware added by the module: marks every response it wraps. */
export default defineServerMiddleware(async (_request, next) => {
  const response = await next();
  const headers = new Headers(response.headers);
  headers.set("x-hello-module", "1");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
});

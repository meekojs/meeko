import { defineServerMiddleware } from "@meekojs/meeko/server";

export default defineServerMiddleware(async (_request, next) => {
  const response = await next();
  const headers = new Headers(response.headers);
  headers.set("x-meeko-fixture-middleware", "active");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});

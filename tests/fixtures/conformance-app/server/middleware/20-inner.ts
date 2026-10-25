import { defineServerMiddleware } from "@meekojs/meeko/server";

export default defineServerMiddleware(async (request, next) => {
  const headers = new Headers(request.headers);
  headers.set("x-conformance-trace", `${request.headers.get("x-conformance-trace") ?? "none"},inner`);
  const response = await next(new Request(request, { headers }));
  const result = new Response(response.body, response);
  result.headers.append("x-conformance-order", "inner");
  return result;
});

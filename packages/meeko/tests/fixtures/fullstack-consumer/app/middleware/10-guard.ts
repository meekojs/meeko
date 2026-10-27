import { defineRouteMiddleware } from "@meekojs/meeko/framework";

export default defineRouteMiddleware(({ url, match }) => {
  if (match.route.id === "/users" && url.searchParams.has("deny")) {
    return new Response("Route denied", { status: 403 });
  }
});

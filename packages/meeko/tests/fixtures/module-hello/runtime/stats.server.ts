import { definePlugin } from "@meekojs/meeko/framework";
import { stats } from "./state.server.ts";

/** Server plugin: runs on the server once per page request, before the render. */
export default definePlugin((app) => {
  stats.runs += 1;
  stats.lastRoute = app.route.path.value;
  stats.side = app.side;
  stats.request = app.request instanceof Request;
});

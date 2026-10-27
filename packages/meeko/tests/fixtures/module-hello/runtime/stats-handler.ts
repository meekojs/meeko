import { stats } from "./state.server.ts";

/** Server handler for /__hello/stats. */
export default (request: Request): Response => Response.json({ ...stats, method: request.method });

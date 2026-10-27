import { defineApiRoute } from "@meekojs/meeko/server";
import { trace } from "../../shared/schemas.js";

export default defineApiRoute({
  response: trace,
  handler: ({ context }) => ({
    trace: context.request.headers.get("x-conformance-trace") ?? "none",
    platform: context.platform.name,
  }),
});

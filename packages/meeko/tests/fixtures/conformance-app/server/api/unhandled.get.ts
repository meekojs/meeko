import { defineApiRoute } from "@meekojs/meeko/server";

// A promise nobody awaits, inside the request: it must reach onError of server/runtime.ts and the
// output must keep serving.
export default defineApiRoute({
  contentType: "response",
  handler: ({ context }) => {
    void Promise.resolve().then(() => { throw new Error("conformance unhandled rejection"); });
    return Response.json({ requestId: context.requestId });
  },
});

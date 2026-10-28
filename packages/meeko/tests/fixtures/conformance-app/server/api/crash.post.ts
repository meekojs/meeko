import { defineApiRoute } from "@meekojs/meeko/server";

// An exception in a timer: the output reports it and closes in order with code 1. The suite calls
// it last, and never on Workers, which have no process to close.
export default defineApiRoute({
  contentType: "response",
  handler: () => {
    setTimeout(() => { throw new Error("conformance uncaught exception"); }, 10);
    return new Response("scheduled");
  },
});

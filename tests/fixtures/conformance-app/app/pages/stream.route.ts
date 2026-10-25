import { defer, definePage } from "@meekojs/meeko/framework";

// `?delay=` (milliseconds, at most 5 s) holds the deferred value back, so the
// suite can tell a streamed response from a buffered one.
export const route = definePage({
  render: "stream",
  load: ({ search }) => {
    const requested = Number(Array.isArray(search.delay) ? search.delay[0] : search.delay ?? 0);
    const delay = Number.isFinite(requested) ? Math.min(Math.max(requested, 0), 5_000) : 0;
    return {
      title: "Stream conformance",
      slow: defer(new Promise<{ text: string }>((resolve) => setTimeout(() => resolve({ text: "Deferred done" }), delay))),
    };
  },
});

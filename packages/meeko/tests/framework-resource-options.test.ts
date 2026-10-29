import assert from "node:assert/strict";
import test from "node:test";
import { createUseApi, createUseRpcQuery, ResourceScope, withResourceScope } from "../src/framework/resources.ts";
import type { DataResource } from "../src/framework/resources.ts";
import { collectMounted, runMounted } from "../src/lifecycle.ts";
import { createRoot, signal } from "../src/index.ts";
import { awaitData, renderWithSuspense } from "../src/suspense.ts";

/** A fake transport: every call waits until the test settles it, and its signal is kept. */
function transport() {
  const calls: { input: unknown; signal: AbortSignal | undefined; resolve: () => void }[] = [];
  const fetch = ((_url: string, init: RequestInit) => {
    const input = JSON.parse(String(init.body)) as unknown;
    return new Promise<Response>((resolve, reject) => {
      const call = { input, signal: init.signal ?? undefined, resolve: () => resolve(Response.json({ hits: [JSON.stringify(input)] })) };
      init.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      calls.push(call);
    });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

const manifest = { version: 1, api: [], rpc: [{ id: "search", pathname: "/_meeko/rpc/search" }] } as const;
type Search = (procedure: string, input?: unknown, options?: unknown) => DataResource<{ hits: string[] }>;

/** Lets microtasks, the fake transport and the response bodies settle (never a timer). */
const settle = async (): Promise<void> => {
  for (let index = 0; index < 10; index++) await new Promise((resolve) => setImmediate(resolve));
};

/** Mounts `setup` as a component script in the browser would run it. */
function mount<T>(setup: () => T): { value: T; dispose: () => void } {
  const mounted: Array<() => void> = [];
  let dispose!: () => void;
  const value = createRoot((release) => { dispose = release; return collectMounted(mounted, setup); });
  runMounted(mounted);
  return { value, dispose };
}

test("debounceMs: a burst of input changes makes one request with the last input, after the wait", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { calls, fetch } = transport();
  const useRpcQuery = createUseRpcQuery(manifest, { baseUrl: "https://example.test", fetch }) as unknown as Search;
  const q = signal("a");
  const { value: search, dispose } = mount(() => useRpcQuery("search", () => ({ q: q.value }), { debounceMs: 200 }));
  // The first load is not delayed.
  assert.equal(calls.length, 1);
  calls[0]!.resolve();
  await settle();
  assert.deepEqual(search.data.value, { hits: ['{"q":"a"}'] });
  q.value = "ab";
  t.mock.timers.tick(100);
  q.value = "abc";
  t.mock.timers.tick(150);
  q.value = "abcd";
  await settle();
  assert.equal(calls.length, 1, "no request while the input keeps changing");
  assert.equal(search.pending.value, true, "the wait is already a load");
  assert.equal(search.refreshing.value, true);
  t.mock.timers.tick(199);
  await settle();
  assert.equal(calls.length, 1);
  t.mock.timers.tick(1);
  await settle();
  assert.equal(calls.length, 2, "one request for the whole burst");
  assert.deepEqual(calls[1]!.input, { q: "abcd" });
  calls[1]!.resolve();
  await settle();
  assert.deepEqual(search.data.value, { hits: ['{"q":"abcd"}'] });
  assert.equal(search.pending.value, false);
  // refresh() is never delayed.
  void search.refresh();
  assert.equal(calls.length, 3);
  dispose();
});

test("debounceMs: a new input cancels the request in flight, whose late result is ignored", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { calls, fetch } = transport();
  const useRpcQuery = createUseRpcQuery(manifest, { baseUrl: "https://example.test", fetch }) as unknown as Search;
  const q = signal("a");
  const { value: search, dispose } = mount(() => useRpcQuery("search", () => ({ q: q.value }), { debounceMs: 50 }));
  calls[0]!.resolve();
  await settle();
  q.value = "b";
  t.mock.timers.tick(50);
  await settle();
  const inFlight = calls[1]!;
  assert.deepEqual(inFlight.input, { q: "b" });
  q.value = "c";
  assert.equal(inFlight.signal?.aborted, true, "the change cancels the request of the previous input");
  t.mock.timers.tick(50);
  await settle();
  assert.deepEqual(calls[2]!.input, { q: "c" });
  calls[2]!.resolve();
  await settle();
  assert.deepEqual(search.data.value, { hits: ['{"q":"c"}'] });
  assert.equal(search.error.value, null, "an aborted request is not an error");
  // Unmounting during a wait sends nothing.
  q.value = "d";
  dispose();
  t.mock.timers.tick(50);
  await settle();
  assert.equal(calls.length, 3);
});

test("enabled: false requests nothing, keeps the data and stops a load; true again loads the current input", async () => {
  const { calls, fetch } = transport();
  const useRpcQuery = createUseRpcQuery(manifest, { baseUrl: "https://example.test", fetch }) as unknown as Search;
  const q = signal("a");
  const { value: search, dispose } = mount(() => useRpcQuery("search", () => ({ q: q.value }), { enabled: () => q.value.length >= 2 }));
  await settle();
  assert.equal(calls.length, 0, "disabled when mounted: no request");
  assert.equal(search.pending.value, false, "nothing is loading");
  assert.equal(search.data.value, null);
  await search.refresh();
  assert.equal(calls.length, 0, "refresh() does not request while disabled");
  q.value = "ab";
  assert.equal(calls.length, 1);
  calls[0]!.resolve();
  await settle();
  assert.deepEqual(search.data.value, { hits: ['{"q":"ab"}'] });
  q.value = "abc";
  const stopped = calls[1]!;
  q.value = "a";
  assert.equal(stopped.signal?.aborted, true, "disabling cancels the request in flight");
  assert.equal(search.pending.value, false);
  assert.equal(search.refreshing.value, false);
  assert.deepEqual(search.data.value, { hits: ['{"q":"ab"}'] }, "the last result stays");
  q.value = "ab";
  assert.equal(calls.length, 2, "enabled again with the input of the data shown: nothing to load");
  q.value = "abd";
  assert.equal(calls.length, 3);
  assert.throws(() => mount(() => useRpcQuery("search", {}, { enabled: "yes" })), /enabled must be a boolean/);
  assert.throws(() => mount(() => useRpcQuery("search", {}, { debounceMs: -1 })), /debounceMs must be a number/);
  dispose();
});

test("enabled also takes a signal and a boolean in useApi", async () => {
  const requested: string[] = [];
  const fetch = (async (url: string) => { requested.push(String(url)); return Response.json(["x"]); }) as unknown as typeof globalThis.fetch;
  const useApi = createUseApi({ api: [{ clientKey: "items", pathname: "/api/items", method: "GET" }] } as const, { baseUrl: "https://example.test", fetch }) as unknown as (path: string, input: unknown, options?: unknown) => DataResource<string[]>;
  const on = signal(false);
  const { value: [bySignal, off], dispose } = mount(() => [useApi("/api/items", {}, { enabled: on }), useApi("/api/items", { query: { q: "off" } }, { enabled: false })] as const);
  await settle();
  assert.deepEqual(requested, []);
  on.value = true;
  await settle();
  assert.deepEqual(requested, ["https://example.test/api/items"]);
  assert.deepEqual(bySignal.data.value, ["x"]);
  assert.equal(off.pending.value, false);
  dispose();
});

test("SSR: an awaited resource requests at once, without the debounce; a disabled one cannot be awaited", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { calls, fetch } = transport();
  const useRpcQuery = createUseRpcQuery(manifest, { baseUrl: "https://example.test", fetch }) as unknown as Search;
  const scope = new ResourceScope("collect");
  const rendered = renderWithSuspense(() => {
    scope.beginPass();
    return withResourceScope(scope, () => createRoot((dispose) => {
      try {
        return collectMounted(null, () => awaitData(useRpcQuery("search", { q: "ssr" }, { debounceMs: 10_000 })).data.value);
      } finally { dispose(); }
    }));
  });
  await settle();
  assert.equal(calls.length, 1, "the server requests without waiting for the debounce");
  calls[0]!.resolve();
  assert.deepEqual(await rendered, { hits: ['{"q":"ssr"}'] });
  assert.deepEqual({ ...scope.usedData() }, { 'RPC search {"q":"ssr"}': { hits: ['{"q":"ssr"}'] } }, "the data goes to the payload to hydrate");
  assert.throws(() => withResourceScope(new ResourceScope("collect"), () => createRoot(() =>
    collectMounted(null, () => awaitData(useRpcQuery("search", { q: "x" }, { enabled: false }))))), /is disabled \(enabled is false\)/);
  assert.equal(calls.length, 1);
});

test("keepPrevious: the data stays during the debounce wait, or empties at once with keepPrevious: false", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { calls, fetch } = transport();
  const useRpcQuery = createUseRpcQuery(manifest, { baseUrl: "https://example.test", fetch }) as unknown as Search;
  const q = signal("a");
  const { value: [kept, strict], dispose } = mount(() => [
    useRpcQuery("search", () => ({ q: q.value }), { debounceMs: 100 }),
    useRpcQuery("search", () => ({ q: q.value, strict: true }), { debounceMs: 100, keepPrevious: false }),
  ] as const);
  for (const call of calls) call.resolve();
  await settle();
  q.value = "b";
  t.mock.timers.tick(50);
  await settle();
  assert.equal(calls.length, 2, "still waiting: no request for the new input yet");
  assert.deepEqual(kept.data.value, { hits: ['{"q":"a"}'] }, "keepPrevious (the default) keeps the previous result while waiting");
  assert.equal(kept.refreshing.value, true);
  assert.equal(strict.data.value, null, "keepPrevious: false empties it as soon as the input changes");
  assert.equal(strict.pending.value, true);
  assert.equal(strict.refreshing.value, false, "a first load, not a reload");
  t.mock.timers.tick(50);
  await settle();
  for (const call of calls.slice(2)) call.resolve();
  await settle();
  assert.deepEqual(kept.data.value, { hits: ['{"q":"b"}'] });
  assert.deepEqual(strict.data.value, { hits: ['{"q":"b","strict":true}'] });
  dispose();
});

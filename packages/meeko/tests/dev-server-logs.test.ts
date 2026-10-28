import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { setSocketAddress } from "../src/framework-server/env.ts";
import { createDevServerLogs, jsonForHtml, serializeLogArguments, serverLogLimits, serverLogsAttribute, serverLogsClientUrl, serverLogsConsoleUrl, serverLogsEvent } from "../src/framework/dev-server-logs.ts";
import type { ServerLogBatch } from "../src/framework/dev-server-logs.ts";
import { printServerLogs, serverLogArguments, startServerLogs } from "../src/framework/dev-server-logs-client.ts";

const levels = ["log", "info", "warn", "error", "debug"] as const;
/** The browser globals `startServerLogs` reads, which happy-dom provides. */
type BrowserScope = NonNullable<Parameters<typeof startServerLogs>[1]>;

/** Replaces the terminal `console` methods with recorders while `run` runs, then restores them. */
async function withTerminal<T>(run: (written: Array<[string, unknown[]]>) => Promise<T>): Promise<T> {
  const written: Array<[string, unknown[]]> = [];
  const originals = levels.map((level) => [level, console[level]] as const);
  for (const level of levels) console[level] = (...args: unknown[]) => { written.push([level, args]); };
  try { return await run(written); }
  finally { for (const [level, original] of originals) console[level] = original; }
}

/** A console that records what the browser module prints. */
function recordingConsole(): { console: Console; calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = [];
  const record = (name: string) => (...args: unknown[]) => { calls.push([name, args]); };
  const target = Object.fromEntries(["log", "info", "warn", "error", "debug", "group", "groupEnd"].map((name) => [name, record(name)]));
  return { console: target as unknown as Console, calls };
}

function localRequest(url: string, init?: RequestInit, address = "127.0.0.1"): Request {
  return setSocketAddress(new Request(url, init), address);
}

function blocks(html: string): ServerLogBatch[] {
  return [...html.matchAll(new RegExp(`<script type="application/json" ${serverLogsAttribute}>(.*?)</script>`, "g"))].map((match) => JSON.parse(match[1]!) as ServerLogBatch);
}

const tick = () => new Promise<void>((done) => setImmediate(done));

test("serialized log values survive cycles, errors, collections and unusual primitives", () => {
  const circular: Record<string, unknown> = { name: "loop" };
  circular.self = circular;
  const cause = new TypeError("root");
  const error = Object.assign(new Error("top", { cause }), { code: "E_TOP" });
  class User { constructor(readonly id: number) {} }
  const [wire] = serializeLogArguments([{
    circular, error, total: 10n, symbol: Symbol("tag"), fn: function named() {}, klass: User, user: new User(1),
    map: new Map([["key", { value: 1 }]]), set: new Set(["a"]), nothing: undefined, nan: Number.NaN, negative: -0,
    date: new Date(0), pattern: /x+/gi, bytes: new Uint8Array([1, 2, 3]), nullProto: Object.create(null) as object,
  }]);
  const json = JSON.parse(JSON.stringify(wire)) as { entries: Array<[string, Record<string, unknown>]> };
  const field = (name: string) => json.entries.find(([key]) => key === name)![1];
  assert.deepEqual(field("circular"), { $: "object", id: 1, entries: [["name", "loop"], ["self", { $: "ref", id: 1 }]] });
  const encodedError = field("error");
  assert.equal(encodedError.$, "error");
  assert.equal(encodedError.message, "top");
  assert.match(String(encodedError.stack), /^Error: top\n\s+at /);
  assert.equal((encodedError.cause as Record<string, unknown>).name, "TypeError");
  assert.deepEqual(encodedError.entries, [["code", "E_TOP"]]);
  assert.deepEqual(field("total"), { $: "bigint", v: "10" });
  assert.deepEqual(field("symbol"), { $: "symbol", v: "tag" });
  assert.deepEqual(field("fn"), { $: "function", name: "named" });
  assert.deepEqual(field("klass"), { $: "function", name: "User", class: true });
  assert.equal(field("user").ctor, "User");
  assert.equal(field("map").$, "map");
  assert.equal(field("set").$, "set");
  assert.deepEqual(field("set").items, ["a"]);
  assert.deepEqual(field("nothing"), { $: "undefined" });
  assert.deepEqual(field("nan"), { $: "number", v: "NaN" });
  assert.deepEqual(field("negative"), { $: "number", v: "-0" });
  assert.deepEqual(field("date"), { $: "date", v: "1970-01-01T00:00:00.000Z" });
  assert.deepEqual(field("pattern"), { $: "regexp", source: "x+", flags: "gi" });
  assert.equal(field("bytes").$, "text");
  assert.equal(field("nullProto").ctor, null);
});

test("serializing never runs getters or proxy traps and bounds depth, width and length", () => {
  let touched = 0;
  const watched = { get secret() { touched++; throw new Error("getter ran"); } };
  const proxy = new Proxy({ visible: 1 }, { get() { touched++; return 1; }, ownKeys() { touched++; return []; } });
  const revocable = Proxy.revocable({}, {});
  revocable.revoke();
  let deep: Record<string, unknown> = { leaf: true };
  for (let level = 0; level < 20; level++) deep = { deep };
  const wide = Object.fromEntries(Array.from({ length: serverLogLimits.items + 5 }, (_, index) => [`k${index}`, index]));
  const [encoded] = serializeLogArguments([{ watched, proxy, revoked: revocable.proxy, deep, wide, long: "x".repeat(serverLogLimits.string + 7) }]);
  assert.equal(touched, 0);
  const text = JSON.stringify(encoded);
  assert.match(text, /"\[Getter\]"/);
  assert.match(text, /\[Object\]/, "the nesting below the depth limit is summarized");
  assert.match(text, /"more":5/);
  assert.match(text, /\(\+7 caracteres\)/);
});

test("log JSON embedded in HTML cannot close its script element", () => {
  const html = jsonForHtml({ text: "</script><!--   & >" });
  assert.ok(!html.includes("</script>") && !html.includes("<!--") && !html.includes(" "));
  assert.deepEqual(JSON.parse(html), { text: "</script><!--   & >" });
});

test("the browser revives server values as expandable objects and errors with the server stack", () => {
  const circular: Record<string, unknown> = { name: "loop" };
  circular.self = circular;
  const cause = new TypeError("root");
  const failure = new Error("top", { cause });
  const wire = JSON.parse(JSON.stringify(serializeLogArguments(["value %s", "x", circular, failure, 10n, new Map([["k", 1]]), new Set([1])]))) as unknown[];
  const args = serverLogArguments(wire);
  assert.equal(args[0], "%cserver%c value %s");
  assert.equal(args[3], "x");
  const revived = args[4] as Record<string, unknown>;
  assert.equal(revived.self, revived, "the cycle is a real cycle again");
  const error = args[5] as Error & { cause?: Error };
  assert.ok(error instanceof Error);
  assert.equal(error.stack, failure.stack, "DevTools prints the server's stack");
  assert.equal(error.cause?.name, "TypeError");
  assert.equal(error.cause?.stack, cause.stack);
  assert.equal(args[6], 10n);
  assert.deepEqual([...(args[7] as Map<string, number>)], [["k", 1]]);
  assert.deepEqual([...(args[8] as Set<number>)], [1]);
  // A first argument that is not a string keeps the badge as its own format string.
  assert.deepEqual(serverLogArguments([{ $: "undefined" }]).slice(0, 1), ["%cserver"]);
});

test("a batch prints as one console group labelled with its request", () => {
  const { console: target, calls } = recordingConsole();
  printServerLogs({ requestId: "0123456789", method: "GET", path: "/users?page=2", phase: "late", entries: [{ level: "warn", args: ["careful"] }, { level: "bogus", args: [1] }], omitted: 3 }, target);
  assert.deepEqual(calls.map(([name]) => name), ["group", "warn", "log", "warn", "groupEnd"]);
  assert.match(String(calls[0]![1][0]), /GET \/users\?page=2%c 01234567 \(después de la respuesta\)$/);
  printServerLogs({ nonsense: true }, target);
  assert.equal(calls.length, 5, "anything that is not a batch is ignored");
});

test("the browser module prints document blocks, streamed blocks, HMR batches and navigation payloads", async () => {
  const window = new Window({ url: "http://127.0.0.1:4173/" });
  try {
    const { console: target, calls } = recordingConsole();
    const batch = (path: string): ServerLogBatch => ({ method: "GET", path, phase: "request", entries: [{ level: "log", args: [path] }] });
    window.document.head.innerHTML = `<script type="application/json" ${serverLogsAttribute}>${jsonForHtml(batch("/head"))}</script>`;
    window.document.body.innerHTML = '<div id="app"></div>';
    // The module runs while a streamed document is still arriving.
    Object.defineProperty(window.document, "readyState", { value: "loading", configurable: true });
    const payload = { v: 2, route: "/next", devServerLogs: batch("/next") };
    const fetched: string[] = [];
    let cancelled: unknown;
    (window as unknown as { fetch: typeof fetch }).fetch = async (input) => {
      fetched.push(String(input));
      if (String(input) === "/stream") {
        const encoder = new TextEncoder();
        const lines = [`{"v":2,"devServerLogs":${JSON.stringify(batch("/stream"))}}\n`, `{"deferred":0,"value":1,"devServerLogs":${JSON.stringify(batch("/stream#deferred"))}}\n`];
        return new Response(new ReadableStream<Uint8Array>({
          pull(controller) {
            const next = lines.shift();
            if (next) controller.enqueue(encoder.encode(next));
          },
          cancel(reason) { cancelled = reason; },
        }), { headers: { "content-type": "application/meeko+ndjson; charset=utf-8" } });
      }
      return new Response(JSON.stringify(payload), { headers: { "content-type": "application/meeko+json; charset=utf-8" } });
    };
    const listeners = new Map<string, (data: unknown) => void>();
    startServerLogs({ on: (event, listener) => listeners.set(event, listener) }, window as unknown as BrowserScope, target);
    const printed = () => calls.filter(([name]) => name === "log").map(([, args]) => String(args[0]).replace("%cserver%c ", ""));
    assert.deepEqual(printed(), ["/head"]);
    // The parser adds a later block in two steps: the element, then its text.
    const late = window.document.createElement("script");
    late.setAttribute("type", "application/json");
    late.setAttribute(serverLogsAttribute, "");
    const json = jsonForHtml(batch("/streamed"));
    late.textContent = json.slice(0, 10);
    window.document.body.appendChild(late);
    await tick();
    assert.deepEqual(printed(), ["/head"], "an incomplete block waits");
    late.textContent = json;
    await tick();
    assert.deepEqual(printed(), ["/head", "/streamed"]);
    Object.defineProperty(window.document, "readyState", { value: "interactive", configurable: true });
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
    const after = window.document.createElement("script");
    after.setAttribute("type", "application/json");
    after.setAttribute(serverLogsAttribute, "");
    after.textContent = jsonForHtml(batch("/ignored"));
    window.document.body.appendChild(after);
    await tick();
    assert.deepEqual(printed(), ["/head", "/streamed"], "the observer stops with the parser");
    listeners.get(serverLogsEvent)!(batch("/api/ping"));
    const response = await (window as unknown as { fetch: typeof fetch }).fetch("/next", { headers: { accept: "application/meeko+json" } });
    assert.deepEqual(await response.json(), payload, "the router still reads the whole payload");
    assert.deepEqual(fetched, ["/next"]);
    assert.deepEqual(printed().slice(-2), ["/api/ping", "/next"]);
    // A streamed navigation prints each line's logs as the router reads it, and a cancellation
    // still reaches the server's stream.
    const stream = await (window as unknown as { fetch: typeof fetch }).fetch("/stream");
    const reader = stream.body!.getReader();
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /^\{"v":2/);
    assert.equal(printed().at(-1), "/stream");
    await reader.read();
    assert.equal(printed().at(-1), "/stream#deferred");
    await reader.cancel("left the route");
    assert.equal(cancelled, "left the route");
    // Starting twice (a second copy of the module) does not print twice.
    startServerLogs(undefined, window as unknown as BrowserScope, target);
    assert.equal(printed().filter((path) => path === "/head").length, 1);
  } finally {
    await window.happyDOM.close();
  }
});

test("each request keeps its own logs, also when requests overlap", async () => {
  await withTerminal(async (written) => {
    const sent: Array<[string, unknown]> = [];
    const logs = createDevServerLogs({ hot: () => ({ send: (event, payload) => sent.push([event, payload]) }) });
    try {
      const page = (tag: string, delay: number) => logs.handle(localRequest(`http://127.0.0.1/slow?tag=${tag}`), async () => {
        console.log(`start ${tag}`);
        await new Promise((done) => setTimeout(done, delay));
        console.warn(`end ${tag}`, { tag });
        return new Response(`<!doctype html><html><head><title>${tag}</title></head><body><p>${tag}</p></body></html>`, {
          headers: { "content-type": "text/html; charset=utf-8", "x-request-id": `id-${tag}`, "content-length": "999" },
        });
      });
      const [first, second] = await Promise.all([page("a", 40), page("b", 5)]);
      assert.equal(first.headers.get("content-length"), null);
      for (const [response, tag] of [[first, "a"], [second, "b"]] as const) {
        const html = await response.text();
        const [batch, ...rest] = blocks(html);
        assert.deepEqual(rest, []);
        assert.equal(batch!.requestId, `id-${tag}`);
        assert.equal(batch!.path, `/slow?tag=${tag}`);
        assert.deepEqual(batch!.entries.map((entry) => [entry.level, entry.args[0]]), [["log", `start ${tag}`], ["warn", `end ${tag}`]]);
        const consoleScript = html.indexOf(`<script src="${serverLogsConsoleUrl}">`);
        const clientScript = html.indexOf(`<script type="module" async src="${serverLogsClientUrl}">`);
        assert.ok(consoleScript >= 0 && consoleScript < clientScript && clientScript < html.indexOf("</head>"), html);
      }
      // The terminal still gets every call, unchanged.
      assert.deepEqual(written.map(([level, args]) => `${level} ${String(args[0])}`).sort(), ["log start a", "log start b", "warn end a", "warn end b"]);
      assert.deepEqual(sent, [], "nothing was left for HMR");
    } finally {
      logs.close();
    }
  });
});

test("logs of streamed chunks, navigation payloads, API calls and late work reach the browser once", async () => {
  await withTerminal(async () => {
    const sent: ServerLogBatch[] = [];
    const logs = createDevServerLogs({ hot: () => ({ send: (event, payload) => { if (event === serverLogsEvent) sent.push(payload as ServerLogBatch); } }) });
    try {
      // A stream: the head, a deferred chunk and the end, with a log before each.
      let release!: () => void;
      const deferred = new Promise<void>((done) => { release = done; });
      const stream = await logs.handle(localRequest("http://localhost/stream"), async () => {
        console.log("critical");
        const encoder = new TextEncoder();
        return new Response(new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(encoder.encode('<!doctype html><html><head></head><body><div id="app"></div><script id="meeko-payload" type="application/json">{}</script>'));
            await deferred;
            console.log("deferred");
            controller.enqueue(encoder.encode('<script type="application/json" data-meeko-deferred="0">{}</script>'));
            console.log("closing");
            controller.enqueue(encoder.encode("</body></html>"));
            controller.close();
          },
        }), { headers: { "content-type": "text/html; charset=utf-8", "x-request-id": "stream-id" } });
      });
      const reading = stream.text();
      release();
      const html = await reading;
      const streamed = blocks(html).map((batch) => batch.entries.map((entry) => entry.args[0]));
      assert.deepEqual(streamed[0], ["critical"], "the head carries the logs of the render");
      assert.deepEqual(streamed.flat(), ["critical", "deferred", "closing"]);
      assert.ok(html.indexOf('data-meeko-deferred="0"') < html.lastIndexOf(serverLogsAttribute), "a later block follows the chunk it belongs to");
      assert.ok(html.lastIndexOf(serverLogsAttribute) < html.indexOf("</body>"));
      // A navigation payload carries its logs in `devServerLogs`.
      const payload = await logs.handle(localRequest("http://127.0.0.1/next", { headers: { accept: "application/meeko+json" } }), async () => {
        console.info("payload");
        return new Response('{"v":2,"route":"/next"}', { headers: { "content-type": "application/meeko+json; charset=utf-8", "x-request-id": "next-id" } });
      });
      const parsed = await payload.json() as { v: number; devServerLogs: ServerLogBatch };
      assert.equal(parsed.v, 2);
      assert.equal(parsed.devServerLogs.requestId, "next-id");
      assert.deepEqual(parsed.devServerLogs.entries, [{ level: "info", args: ["payload"] }]);
      // ndjson: each line carries what was logged before it.
      let open!: () => void;
      const gate = new Promise<void>((done) => { open = done; });
      const ndjson = await logs.handle(localRequest("http://127.0.0.1/next"), async () => {
        console.log("first");
        const encoder = new TextEncoder();
        return new Response(new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(encoder.encode('{"v":2}\n'));
            await gate;
            console.log("second");
            controller.enqueue(encoder.encode('{"deferred":0,"value":1}\n'));
            controller.close();
          },
        }), { headers: { "content-type": "application/meeko+ndjson; charset=utf-8" } });
      });
      const body = ndjson.text();
      // The first line goes out before the producer writes the next one.
      await tick();
      open();
      const lines = (await body).trim().split("\n").map((line) => JSON.parse(line) as { devServerLogs?: ServerLogBatch });
      assert.deepEqual(lines.map((line) => line.devServerLogs?.entries.map((entry) => entry.args[0])), [["first"], ["second"]]);
      assert.equal(sent.length, 0);
      // An API response goes over HMR, and so does work that logs after the response.
      const api = await logs.handle(localRequest("http://127.0.0.1/api/ping"), async () => {
        console.log("api", 1n);
        setTimeout(() => console.error("after"), 5);
        return Response.json({ ok: true }, { headers: { "x-request-id": "api-id" } });
      });
      assert.deepEqual(await api.json(), { ok: true });
      assert.equal(sent.length, 1);
      assert.deepEqual(sent[0], { requestId: "api-id", method: "GET", path: "/api/ping", phase: "request", entries: [{ level: "log", args: ["api", { $: "bigint", v: "1" }] }] });
      await new Promise((done) => setTimeout(done, 30));
      assert.deepEqual(sent.slice(1).map((batch) => [batch.phase, batch.entries.map((entry) => entry.args[0])]), [["late", ["after"]]]);
    } finally {
      logs.close();
    }
  });
});

test("a streamed log never lands inside #app, which the browser hydrates, even when a chunk ends with a script of the page", async () => {
  await withTerminal(async () => {
    const logs = createDevServerLogs({ hot: () => undefined });
    try {
      const gates = [0, 1, 2].map(() => { let open!: () => void; const promise = new Promise<void>((done) => { open = done; }); return { promise, open }; });
      const response = await logs.handle(localRequest("http://localhost/stream"), async () => {
        const encoder = new TextEncoder();
        return new Response(new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(encoder.encode('<!doctype html><html><head></head><body><div id="app"><p>a</p>'));
            await gates[0]!.promise;
            console.log("inside");
            // The page's own structured data ends this chunk, still inside #app.
            controller.enqueue(encoder.encode('<script type="application/ld+json">{"@type":"Thing"}</script>'));
            await gates[1]!.promise;
            controller.enqueue(encoder.encode('</div><script id="meeko-payload" type="application/json">{"a":'));
            controller.enqueue(encoder.encode('1}</script>'));
            await gates[2]!.promise;
            console.log("deferred");
            controller.enqueue(encoder.encode('<script type="application/json" data-meeko-deferred="0">{}</script>'));
            controller.enqueue(encoder.encode("</body></html>"));
            controller.close();
          },
        }), { headers: { "content-type": "text/html; charset=utf-8" } });
      });
      const reading = response.text();
      for (const gate of gates) { await tick(); gate.open(); }
      const html = await reading;
      const app = html.slice(html.indexOf('<div id="app">'), html.indexOf('<script id="meeko-payload"'));
      assert.ok(!app.includes(serverLogsAttribute), app);
      const delivered = blocks(html).flatMap((batch) => batch.entries.map((entry) => entry.args[0]));
      assert.deepEqual(delivered, ["inside", "deferred"]);
    } finally {
      logs.close();
    }
  });
});

test("the injected scripts carry the document's nonce, from its CSP or its own scripts", async () => {
  await withTerminal(async () => {
    const logs = createDevServerLogs({ hot: () => undefined });
    const injected = (html: string): string[] => [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g)]
      .filter((match) => match[1] === serverLogsConsoleUrl || match[1] === serverLogsClientUrl).map((match) => match[0]);
    const serve = async (headers: Record<string, string>, head: string): Promise<string[]> => injected(await (await logs.handle(localRequest("http://localhost/"), () => {
      console.log("x");
      return Promise.resolve(new Response(`<html><head>${head}</head><body></body></html>`, { headers: { "content-type": "text/html", ...headers } }));
    })).text());
    try {
      const fromPolicy = await serve({ "content-security-policy": "default-src 'self'; script-src 'nonce-abc+/=' 'strict-dynamic'" }, "");
      assert.equal(fromPolicy.length, 2);
      for (const tag of fromPolicy) assert.match(tag, / nonce="abc\+\/="/);
      const fromDocument = await serve({}, '<script type="module" nonce="n&amp;1" src="/@vite/client"></script>');
      assert.equal(fromDocument.length, 2);
      for (const tag of fromDocument) assert.match(tag, / nonce="n&#38;1"/);
      for (const tag of await serve({}, "")) assert.doesNotMatch(tag, /nonce/);
    } finally {
      logs.close();
    }
  });
});

test("only the developer's own browser gets logs in the response", async () => {
  await withTerminal(async () => {
    const sent: ServerLogBatch[] = [];
    const logs = createDevServerLogs({ hot: () => ({ send: (_event, payload) => sent.push(payload as ServerLogBatch) }) });
    const document = () => {
      console.log("private");
      return Promise.resolve(new Response("<html><head></head><body></body></html>", { headers: { "content-type": "text/html" } }));
    };
    try {
      for (const [request, inline] of [
        [localRequest("http://192.168.1.20:4173/", undefined, "192.168.1.30"), false],
        [localRequest("http://evil.example:4173/", undefined, "127.0.0.1"), false],
        [localRequest("http://localhost:4173/", undefined, "::ffff:127.0.0.1"), true],
        [localRequest("http://app.localhost:4173/", undefined, "::1"), true],
        // A tunnel (ngrok, cloudflared, dev tunnels) reaches the server from loopback: the host it
        // publishes, the public origin's included, is never trusted, nor are its forwarding headers.
        [localRequest("http://dev.example.test:4173/", undefined, "127.0.0.1"), false],
        [localRequest("http://localhost:4173/", { headers: { host: "abc.ngrok.app" } }), false],
        [localRequest("http://localhost:4173/", { headers: { "x-forwarded-for": "203.0.113.9" } }), false],
        [localRequest("http://localhost:4173/", { headers: { "x-forwarded-host": "abc.trycloudflare.com" } }), false],
        [localRequest("http://localhost:4173/", { headers: { "cf-connecting-ip": "203.0.113.9" } }), false],
        [localRequest("http://localhost:4173/", { headers: { forwarded: "for=203.0.113.9" } }), false],
        [localRequest("http://localhost:4173/", { headers: { "x-real-ip": "203.0.113.9" } }), false],
        // With MEEKO_PUBLIC_ORIGIN the URL carries the public host; the Host the browser sent decides.
        [localRequest("https://dev.example.test/", { headers: { host: "localhost:4173" } }), true],
        [localRequest("https://dev.example.test/", { headers: { host: "dev.example.test" } }), false],
        [localRequest("http://127.0.0.1:4173/", { method: "HEAD" }), false],
      ] as const) {
        const before = sent.length;
        const html = await (await logs.handle(request, document)).text();
        assert.equal(html.includes(serverLogsAttribute), inline, request.url);
        assert.equal(html.includes(serverLogsClientUrl), inline, request.url);
        assert.equal(sent.length - before, inline ? 0 : 1, `${request.url}: the logs go over HMR, which only listens on loopback`);
      }
    } finally {
      logs.close();
    }
  });
});

test("the console capture never breaks a log or a response and is removed on close", async () => {
  await withTerminal(async (written) => {
    const terminal = console.log;
    const logs = createDevServerLogs({ hot: () => undefined });
    const second = createDevServerLogs({ hot: () => undefined });
    assert.notEqual(console.log, terminal);
    try {
      const hostile = new Proxy({}, { ownKeys() { throw new Error("trap"); } });
      const throwing = { get value() { throw new Error("getter"); } };
      const response = await logs.handle(localRequest("http://127.0.0.1/"), async () => {
        console.log("hostile", hostile, throwing);
        return new Response("<html><head></head><body></body></html>", { headers: { "content-type": "text/html" } });
      });
      assert.equal(response.status, 200);
      assert.equal(blocks(await response.text())[0]!.entries.length, 1);
      // Outside a request a call only reaches the terminal.
      console.log("outside");
      assert.deepEqual(written.map(([, args]) => args[0]), ["hostile", "outside"]);
    } finally {
      logs.close();
      assert.notEqual(console.log, terminal, "another dev server still uses the capture");
      second.close();
      second.close();
    }
    assert.equal(console.log, terminal);
  });
});

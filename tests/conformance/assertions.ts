import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { after, before, describe, it } from "node:test";
import WebSocket from "ws";
import { missingRuntime, runtimeVersion, startConformanceOutput } from "./harness.ts";
import type { ConformanceAdapter, RunningOutput } from "./harness.ts";

/** Sends a raw request target, bypassing the URL normalization of fetch. */
function rawGet(origin: string, path: string): Promise<{ status: number; body: string }> {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: url.hostname, port: url.port, path, method: "GET" }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });
}

export interface Message { event: string; payload: Record<string, unknown> }

function socketUrl(origin: string, channel: string, room?: string): string {
  return `${origin.replace(/^http/, "ws")}/_meeko/socket/${channel}${room === undefined ? "" : `?room=${encodeURIComponent(room)}`}`;
}

export function connect(origin: string, channel: string, options: { room?: string; origin?: string; cookie?: string } = {}): WebSocket {
  return new WebSocket(socketUrl(origin, channel, options.room), {
    headers: { origin: options.origin ?? origin, ...(options.cookie ? { cookie: options.cookie } : {}) },
  });
}

/** Resolves with the HTTP status of a refused handshake. */
function refusal(peer: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    peer.once("unexpected-response", (_request, response) => { response.resume(); resolve(response.statusCode ?? 0); });
    peer.once("open", () => reject(new Error("Socket handshake unexpectedly succeeded")));
    peer.once("error", (error) => reject(error));
  });
}

/**
 * Resolves with the close of an auth refusal: the server completes the upgrade and closes at once
 * with 4401/4403, which a browser can read. A message sent meanwhile never reaches a handler, and
 * the server sends none.
 */
function denial(peer: WebSocket): Promise<{ code: number; messages: number }> {
  let received = 0;
  peer.on("message", () => { received++; });
  return new Promise((resolve, reject) => {
    peer.once("unexpected-response", (_request, response) => { response.resume(); reject(new Error(`Socket handshake answered HTTP ${response.statusCode}`)); });
    peer.once("open", () => peer.send(JSON.stringify({ event: "say", payload: { text: "early" } })));
    peer.once("close", (code: number) => resolve({ code, messages: received }));
    peer.once("error", (error) => reject(error));
  });
}

export async function opened(peer: WebSocket): Promise<WebSocket> {
  await once(peer, "open");
  return peer;
}

export function closed(peer: WebSocket): Promise<number> {
  return new Promise((resolve) => peer.once("close", (code: number) => resolve(code)));
}

/** Collects parsed messages until `count` arrive. */
export function messages(peer: WebSocket, count: number, timeoutMs = 10_000): Promise<Message[]> {
  return new Promise((resolve, reject) => {
    const received: Message[] = [];
    const timer = setTimeout(() => reject(new Error(`Received ${received.length} of ${count} socket messages: ${JSON.stringify(received)}`)), timeoutMs);
    const listener = (data: WebSocket.RawData) => {
      received.push(JSON.parse(String(data)) as Message);
      if (received.length === count) {
        clearTimeout(timer);
        peer.off("message", listener);
        resolve(received);
      }
    };
    peer.on("message", listener);
  });
}

export function send(peer: WebSocket, event: string, payload: unknown): void {
  peer.send(JSON.stringify({ event, payload }));
}

/** The running output and login of a suite, for adapter-specific tests. */
export interface ConformanceContext {
  server(): RunningOutput;
  /** Session cookie (`name=value`) and CSRF token created before the suite. */
  session(): { readonly cookie: string; readonly csrf: string };
  /** Registers a WebSocket so it is terminated after the suite. */
  track(peer: WebSocket): WebSocket;
}

/**
 * Registers the shared conformance suite for one adapter. Every adapter must
 * answer these requests identically; only `platform` names the runtime.
 * `extra` registers adapter-specific tests against the same running output.
 */
export function conformanceSuite(adapter: ConformanceAdapter, extra?: (suite: ConformanceContext) => void): void {
  // The workerd variant runs the cloudflare adapter.
  const platform = adapter === "workerd" ? "cloudflare" : adapter;
  const skip = missingRuntime(adapter);
  if (skip) console.log(`# skipping ${adapter} conformance: ${skip}`);
  else console.log(`# ${adapter} conformance runs on ${runtimeVersion(adapter)}`);
  describe(`${adapter} adapter conformance`, { skip: skip ?? false, timeout: 240_000 }, () => {
    let server: RunningOutput;
    let origin = "";
    let cookie = "";
    let csrf = "";
    const sockets: WebSocket[] = [];
    const track = (peer: WebSocket): WebSocket => { sockets.push(peer); return peer; };

    before(async () => {
      server = await startConformanceOutput(adapter);
      origin = server.origin;
      const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { origin } });
      assert.equal(login.status, 200, server.logs());
      cookie = login.headers.get("set-cookie")!.split(";")[0]!;
      csrf = ((await login.json()) as { csrf: string }).csrf;
    }, { timeout: 180_000 });

    after(async () => {
      for (const peer of sockets) peer.terminate();
      await server?.stop();
    });

    it("renders SSR pages through the loader, middleware and platform", async () => {
      const response = await fetch(`${origin}/about`);
      assert.equal(response.status, 200, server.logs());
      assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
      assert.equal(response.headers.get("x-conformance-order"), "inner, outer");
      const html = await response.text();
      assert.match(html, /About conformance/);
      // Text bindings carry hydration markers around the value.
      assert.match(html, new RegExp(`<p id="platform">(?:<!--meeko:text:\\d+-->)?${platform}(?:<!--/meeko:text:\\d+-->)?</p>`));
      assert.match(html, /<script type="module" src="\/assets\/[^"]+\.js"><\/script>/);
    });

    it("runs server middleware in file order on the way in and reverse order on the way out", async () => {
      const response = await fetch(`${origin}/api/trace`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-conformance-order"), "inner, outer");
      assert.deepEqual(await response.json(), { trace: "outer,inner", platform });
    });

    it("serves API and RPC with JSON contracts", async () => {
      const echo = await fetch(`${origin}/api/echo`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ text: "hi" }) });
      assert.equal(echo.status, 200);
      assert.deepEqual(await echo.json(), { text: "hi", platform });
      const invalid = await fetch(`${origin}/api/echo`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ text: 1 }) });
      assert.equal(invalid.status, 400);
      assert.equal(((await invalid.json()) as { code: string }).code, "INVALID_BODY");
      const rpc = await fetch(`${origin}/_meeko/rpc/math/add`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ a: 2, b: 3 }) });
      assert.equal(rpc.status, 200);
      assert.deepEqual(await rpc.json(), { total: 5 });
    });

    it("requires Origin and CSRF token for authenticated mutations", async () => {
      const body = JSON.stringify({ text: "secure" });
      const headers = { "content-type": "application/json", cookie };
      const noToken = await fetch(`${origin}/api/echo`, { method: "POST", headers: { ...headers, origin }, body });
      assert.equal(noToken.status, 403);
      assert.equal(((await noToken.json()) as { code: string }).code, "INVALID_CSRF");
      const foreign = await fetch(`${origin}/api/echo`, { method: "POST", headers: { ...headers, origin: "http://evil.test", "x-meeko-csrf": csrf }, body });
      assert.equal(foreign.status, 403);
      assert.equal(((await foreign.json()) as { code: string }).code, "INVALID_ORIGIN");
      const allowed = await fetch(`${origin}/api/echo`, { method: "POST", headers: { ...headers, origin, "x-meeko-csrf": csrf }, body });
      assert.equal(allowed.status, 200);
      const rpc = await fetch(`${origin}/_meeko/rpc/math/add`, { method: "POST", headers: { ...headers, origin }, body: JSON.stringify({ a: 1, b: 1 }) });
      assert.equal(rpc.status, 403);
    });

    it("answers 404 and 405 with the documented status and Allow header", async () => {
      const page = await fetch(`${origin}/missing-page`);
      assert.equal(page.status, 404);
      await page.body?.cancel();
      const api = await fetch(`${origin}/api/missing`);
      assert.equal(api.status, 404);
      assert.equal(((await api.json()) as { code: string }).code, "NOT_FOUND");
      const method = await fetch(`${origin}/api/echo`);
      assert.equal(method.status, 405);
      assert.equal(method.headers.get("allow"), "POST");
      await method.body?.cancel();
      const rpc = await fetch(`${origin}/_meeko/rpc/math/add`);
      assert.equal(rpc.status, 405);
      await rpc.body?.cancel();
    });

    it("renders app/error.meeko inside the layouts for a page without a route", async () => {
      const page = await fetch(`${origin}/missing-page`, { headers: { accept: "text/html" } });
      assert.equal(page.status, 404, server.logs());
      assert.match(page.headers.get("content-type") ?? "", /^text\/html/);
      const html = await page.text();
      assert.match(html, /<div class="site-root">.*<div class="app-shell"[^>]*>.*<section id="app-error">/s);
      assert.match(html, /Error (?:<!--meeko:text:\d+-->)?404/);
      assert.match(html, /<script id="meeko-payload" type="application\/json">\{[^<]*"error":true/);
      assert.match(html, /<script type="module" src="\/assets\/[^"]+\.js"><\/script>/);
      const navigation = await fetch(`${origin}/missing-page`, { headers: { accept: "application/meeko+json" } });
      assert.equal(navigation.status, 404);
      assert.deepEqual(((await navigation.json()) as { props: unknown }).props, { status: 404, message: "NOT_FOUND" });
      const api = await fetch(`${origin}/api/missing`, { headers: { accept: "text/html" } });
      assert.equal(api.status, 404);
      assert.equal(((await api.json()) as { code: string }).code, "NOT_FOUND");
    });

    it("answers HEAD without a body", async () => {
      const page = await fetch(`${origin}/about`, { method: "HEAD" });
      assert.equal(page.status, 200);
      assert.equal(await page.text(), "");
      const asset = await fetch(`${origin}/robots.txt`, { method: "HEAD" });
      assert.equal(asset.status, 200);
      assert.equal(asset.headers.get("content-length"), String("User-agent: *\nDisallow:\n".length));
      assert.equal(await asset.text(), "");
    });

    it("serves listed static assets with validators and cache policy", async () => {
      const robots = await fetch(`${origin}/robots.txt`);
      assert.equal(robots.status, 200);
      assert.equal(await robots.text(), "User-agent: *\nDisallow:\n");
      assert.equal(robots.headers.get("cache-control"), "public, max-age=0, must-revalidate");
      const etag = robots.headers.get("etag");
      assert.ok(etag);
      const cached = await fetch(`${origin}/robots.txt`, { headers: { "if-none-match": etag } });
      assert.equal(cached.status, 304);
      assert.equal(await cached.text(), "");
      const html = await (await fetch(`${origin}/about`)).text();
      const entry = html.match(/<script type="module" src="(\/assets\/[^"]+\.js)"><\/script>/)?.[1];
      assert.ok(entry);
      const script = await fetch(`${origin}${entry}`);
      assert.equal(script.status, 200);
      assert.match(script.headers.get("content-type") ?? "", /^text\/javascript/);
      assert.equal(script.headers.get("cache-control"), "public, max-age=31536000, immutable");
      await script.body?.cancel();
    });

    it("never serves files outside the asset manifest", async () => {
      const attempts = [
        "/.vite/manifest.json",
        "/../package.json",
        "/assets/../../package.json",
        "/assets/..%2f..%2fpackage.json",
        "/..%2f..%2fmeeko.config.ts",
        "/%2e%2e/%2e%2e/package.json",
        "/assets/%2e%2e%5c%2e%2e%5cpackage.json",
        "/client/robots.txt",
        "/prerender/manifest.json",
        "/index.mjs",
        "/index.js",
        "/main.js",
        "/worker.js",
        "/wrangler.jsonc",
        "/_meeko/prerender/manifest.json",
        "/_meeko/prerender/index.html",
        "/assets/_meeko/prerender/manifest.json",
      ];
      for (const path of attempts) {
        const response = await rawGet(origin, path);
        assert.ok(response.status === 404 || response.status === 400, `${path} answered ${response.status}`);
        assert.doesNotMatch(response.body, /"name": "@meekojs\/meeko"|"version": 1, "pages"|"pages":|createServerApp|defineMeekoConfig/, path);
      }
    });

    it("serves prerendered pages with a per-session CSRF meta tag", async () => {
      const anonymous = await fetch(origin);
      assert.equal(anonymous.status, 200);
      assert.equal(anonymous.headers.get("cache-control"), "public, max-age=0, must-revalidate");
      assert.equal(anonymous.headers.get("x-conformance-order"), "inner, outer");
      const etag = anonymous.headers.get("etag");
      assert.ok(etag);
      const html = await anonymous.text();
      assert.match(html, /Welcome to Meeko/);
      assert.doesNotMatch(html, /meeko-csrf-token/);
      assert.equal((await fetch(origin, { headers: { "if-none-match": etag } })).status, 304);
      const personal = await fetch(origin, { headers: { cookie } });
      assert.equal(personal.headers.get("cache-control"), "private, no-store");
      assert.ok((await personal.text()).includes(`<meta name="meeko-csrf-token" content="${csrf}">`));
    });

    it("checks Socket path, Origin and authentication before opening a session", async () => {
      // A foreign Origin never completes an upgrade, even toward a channel that would refuse it later.
      assert.equal(await refusal(track(connect(origin, "room", { room: "a", origin: "http://evil.test" }))), 403);
      assert.equal(await refusal(track(connect(origin, "private", { origin: "http://evil.test" }))), 403);
      assert.deepEqual(await denial(track(connect(origin, "private"))), { code: 4401, messages: 0 });
      assert.deepEqual(await denial(track(connect(origin, "forbidden", { cookie }))), { code: 4403, messages: 0 });
      assert.equal(await refusal(track(connect(origin, "missing"))), 404);
      assert.equal(await refusal(track(connect(origin, "bad.name"))), 400);
      const peer = await opened(track(connect(origin, "private", { cookie })));
      const reply = messages(peer, 1);
      send(peer, "say", { text: "private hello" });
      assert.deepEqual(await reply, [{ event: "said", payload: { text: "private hello" } }]);
    });

    it("enforces Socket message limits and validation", async () => {
      const large = await opened(track(connect(origin, "room", { room: "limits" })));
      const largeClosed = closed(large);
      large.send(JSON.stringify({ event: "say", payload: { text: "x".repeat(2048) } }));
      assert.equal(await largeClosed, 1009);
      const invalid = await opened(track(connect(origin, "room", { room: "limits" })));
      const invalidClosed = closed(invalid);
      send(invalid, "say", { text: 4 });
      assert.equal(await invalidClosed, 1008);
      const binary = await opened(track(connect(origin, "room", { room: "limits" })));
      const binaryClosed = closed(binary);
      binary.send(Buffer.from("{}"));
      assert.equal(await binaryClosed, 1003);
    });

    it("processes Socket messages from one peer in arrival order", async () => {
      const peer = await opened(track(connect(origin, "room", { room: "order" })));
      const replies = messages(peer, 5);
      for (const [n, delay] of [[0, 80], [1, 40], [2, 0], [3, 30], [4, 0]] as const) send(peer, "seq", { n, delay });
      assert.deepEqual((await replies).map((message) => message.payload.n), [0, 1, 2, 3, 4]);
    });

    it("broadcasts to every connection in a room and not to other rooms", async () => {
      const first = await opened(track(connect(origin, "room", { room: "lobby" })));
      const second = await opened(track(connect(origin, "room", { room: "lobby" })));
      const other = await opened(track(connect(origin, "room", { room: "elsewhere" })));
      let leaked = 0;
      other.on("message", () => { leaked++; });
      const firstReceived = messages(first, 2);
      const secondReceived = messages(second, 2);
      send(first, "say", { text: "from socket" });
      // Publish from HTTP only after the Socket message arrived, so the order is fixed.
      await messages(second, 1);
      const response = await fetch(`${origin}/api/broadcast`, {
        method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ room: "lobby", text: "from api" }),
      });
      assert.equal(response.status, 200);
      const expected = [{ event: "said", payload: { text: "from socket" } }, { event: "said", payload: { text: "from api" } }];
      assert.deepEqual(await firstReceived, expected);
      assert.deepEqual(await secondReceived, expected);
      assert.equal(leaked, 0);
    });

    it("streams render: stream pages without buffering: the first byte precedes the deferred value", async () => {
      const delay = 1_500;
      const started = performance.now();
      // Measures the server's own streaming. Wrangler's local runtime emulates
      // Cloudflare's text/html compression without honouring no-transform, and
      // its gzip encoder only writes when the body ends, so a negotiated
      // encoding would measure that emulation instead (docs/framework.md, Cloudflare).
      const response = await fetch(`${origin}/stream?delay=${delay}`, { headers: { "accept-encoding": "identity" } });
      assert.equal(response.status, 200, server.logs());
      assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
      assert.equal(response.headers.get("cache-control"), "no-store, no-transform");
      assert.equal(response.headers.get("x-accel-buffering"), "no");
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let html = "";
      let firstByte: number | undefined;
      let payloadAt: number | undefined;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        firstByte ??= performance.now() - started;
        html += decoder.decode(value, { stream: true });
        if (payloadAt === undefined && html.includes('id="meeko-payload"')) {
          payloadAt = performance.now() - started;
          assert.doesNotMatch(html, /data-meeko-deferred/, "the deferred chunk arrived with the document");
        }
      }
      const total = performance.now() - started;
      assert.ok(firstByte !== undefined && firstByte < delay, `time to first byte ${firstByte} ms is not below the ${delay} ms deferred delay`);
      assert.ok(payloadAt !== undefined && payloadAt < delay, `the payload arrived after ${payloadAt} ms`);
      assert.ok(total >= delay - 50, `the response ended after ${total} ms, before the deferred value`);
      assert.match(html, /<script type="module" async src="\/assets\/[^"]+\.js"><\/script>/);
      assert.match(html, /<script type="application\/json" data-meeko-deferred="0">\{"deferred":0,"value":\{"text":"Deferred done"\}\}<\/script>/);
      assert.ok(html.endsWith("</body></html>"));
    });

    it("answers stream navigations with application/meeko+ndjson", async () => {
      const response = await fetch(`${origin}/stream?delay=10`, { headers: { accept: "application/meeko+json" } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/meeko+ndjson; charset=utf-8");
      const lines = (await response.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
      assert.equal(lines[0]!.render, "stream");
      assert.deepEqual(lines[0]!.deferred, [{ id: 0, path: ["data", "slow"], status: "pending" }]);
      assert.deepEqual(lines.slice(1), [{ deferred: 0, value: { text: "Deferred done" } }]);
    });
    extra?.({ server: () => server, session: () => ({ cookie, csrf }), track });
  });
}

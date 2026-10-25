import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { connect } from "node:net";
import test from "node:test";
import { ApiError, toNodeListener } from "../src/node.js";

test("Node listener normalizes uncaught HTTP errors without leaking private details", async () => {
  const observed: { error: unknown; requestId: string }[] = [];
  const server = createServer(toNodeListener(async (request) => {
    if (new URL(request.url).pathname === "/forbidden") throw new ApiError("FORBIDDEN", 403, "private policy details");
    throw new Error("private storage details");
  }, { onError(error, requestId) { observed.push({ error, requestId }); } }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    for (const [path, code, status] of [["/forbidden", "FORBIDDEN", 403], ["/unknown", "INTERNAL_ERROR", 500]] as const) {
      const response: Response = await fetch(`http://127.0.0.1:${address.port}${path}`);
      assert.equal(response.status, status);
      const body = await response.json() as { code: string; status: number; requestId: string };
      assert.equal(body.code, code);
      assert.equal(body.status, status);
      assert.match(body.requestId, /^[0-9a-f-]{36}$/);
      assert.equal(response.headers.get("x-request-id"), body.requestId);
      assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
      assert.doesNotMatch(JSON.stringify(body), /private/);
      assert.equal(observed.at(-1)?.requestId, body.requestId);
      assert.ok(observed.at(-1)?.error instanceof Error);
    }
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("Node listener rejects a malformed request target with a correlated 400", async () => {
  const server = createServer(toNodeListener(() => new Response("unexpected")));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = connect(address.port, "127.0.0.1", () =>
        socket.write("GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"));
      let response = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => { response += chunk; });
      socket.once("end", () => resolve(response));
      socket.once("error", reject);
    });
    assert.match(raw, /^HTTP\/1\.1 400 Bad Request/);
    assert.match(raw, /"code":"INVALID_URL","status":400,"requestId":"[0-9a-f-]{36}"/);
    assert.match(raw, /x-request-id: [0-9a-f-]{36}/i);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("Node listener contains a rejected asynchronous error observer", async () => {
  const server = createServer(toNodeListener(() => { throw new Error("handler failed"); }, {
    onError: async () => { throw new Error("observer failed"); },
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.equal(response.status, 500);
    assert.equal((await response.json() as { code: string }).code, "INTERNAL_ERROR");
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("Node listener preserves multiple Set-Cookie headers", async () => {
  const server = createServer(toNodeListener(() => {
    const headers = new Headers();
    headers.append("set-cookie", "session=one; HttpOnly; Path=/");
    headers.append("set-cookie", "preference=dark; Path=/");
    return new Response("ok", { headers });
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.deepEqual(response.headers.getSetCookie(), [
      "session=one; HttpOnly; Path=/",
      "preference=dark; Path=/",
    ]);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("Node listener stops pulling a response stream after the client closes", async () => {
  const incoming = Object.assign(new EventEmitter(), {
    headers: { host: "example.test" }, method: "GET", url: "/", socket: {},
  }) as unknown as IncomingMessage;
  const writes: string[] = [];
  const outgoingEmitter = new EventEmitter();
  const outgoing = Object.assign(outgoingEmitter, {
    destroyed: false,
    headersSent: false,
    writeHead() { this.headersSent = true; },
    write(chunk: Uint8Array) {
      writes.push(new TextDecoder().decode(chunk));
      if (writes.length === 1) { this.destroyed = true; outgoingEmitter.emit("close"); }
      return true;
    },
    end() {},
    destroy() { this.destroyed = true; },
  }) as unknown as ServerResponse;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const text of ["first", "second", "third"]) controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  toNodeListener(() => new Response(stream))(incoming, outgoing);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, ["first"]);
});

test("Node listener reports a response stream failure with its sent request ID", async () => {
  const requestId = "11111111-1111-4111-8111-111111111111";
  const failure = new Error("response stream failed");
  const incoming = Object.assign(new EventEmitter(), {
    headers: { host: "example.test" }, method: "GET", url: "/", socket: {},
  }) as unknown as IncomingMessage;
  let sentRequestId: string | string[] | undefined;
  const outgoing = Object.assign(new EventEmitter(), {
    destroyed: false,
    headersSent: false,
    writeHead(_status: number, headers: Record<string, string | string[]>) {
      this.headersSent = true;
      sentRequestId = headers["x-request-id"];
    },
    write() { return true; },
    end() {},
    destroy() { this.destroyed = true; },
  }) as unknown as ServerResponse;
  const reported = new Promise<{ error: unknown; id: string }>((resolve) => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(failure); } });
    toNodeListener(() => new Response(stream, { headers: { "x-request-id": requestId } }), {
      onError(error, id) { resolve({ error, id }); },
    })(incoming, outgoing);
  });
  const observation = await reported;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(sentRequestId, requestId);
  assert.equal(observation.id, requestId);
  assert.equal(observation.error, failure);
  assert.equal(outgoing.destroyed, true);
});

test("Node listener reports response fallback and destroy failures with one request ID", async () => {
  const original = new Error("handler failed");
  const fallback = new Error("error response write failed");
  const destroy = new Error("response destroy failed");
  const incoming = Object.assign(new EventEmitter(), {
    headers: { host: "example.test" }, method: "GET", url: "/", socket: {},
  }) as unknown as IncomingMessage;
  const outgoing = Object.assign(new EventEmitter(), {
    destroyed: false,
    headersSent: false,
    writeHead() { throw fallback; },
    end() {},
    destroy() { throw destroy; },
  }) as unknown as ServerResponse;
  const observed: Array<{ error: unknown; requestId: string }> = [];
  toNodeListener(() => { throw original; }, {
    onError(error, requestId) { observed.push({ error, requestId }); },
  })(incoming, outgoing);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(observed.map(({ error }) => error), [original, fallback, destroy]);
  assert.equal(new Set(observed.map(({ requestId }) => requestId)).size, 1);
});

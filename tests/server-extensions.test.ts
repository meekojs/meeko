import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createNodeSocketUpgradeHandler, createSocketHub, defineApiRoute, defineRpc, defineSocketChannel, generateOpenApi, MemorySessionStore, SessionManager } from "../src/framework-server.ts";
import type { Schema, ServerManifest } from "../src/framework-server.ts";

const stringSchema: Schema<string> = { "~standard": { version: 1, validate(value) { return typeof value === "string" ? { value } : { issues: [{}] }; } } };
const paramsSchema: Schema<{ id: string }> = { "~standard": { version: 1, validate(value) { return value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string" ? { value: value as { id: string } } : { issues: [{}] }; } } };
const json = new Map<Schema, Record<string, unknown>>([
  [stringSchema, { type: "string" }],
  [paramsSchema, { type: "object", properties: { id: { type: "string" } }, required: ["id"] }],
]);

test("OpenAPI includes public schema contracts and rejects private or unrepresentable ones", async () => {
  const manifest: ServerManifest = {
    api: [{ kind: "api", file: "get.ts", pathname: "/api/users/[id]", method: "GET", clientKey: "users.byId" }],
    rpc: [{ kind: "rpc", file: "rpc.ts", pathname: "/_meeko/rpc/users/get", id: "users.get" }],
  };
  const modules = new Map<string, unknown>([
    ["get.ts", { default: defineApiRoute({ params: paramsSchema, response: stringSchema, auth: "required", handler: () => "user" }) }],
    ["rpc.ts", { default: defineRpc({ input: paramsSchema, output: stringSchema, handler: () => "user" }) }],
  ]);
  const base = { manifest, info: { title: "Meeko", version: "1" }, publicSchemas: { paramsSchema, stringSchema }, toJsonSchema: (schema: Schema) => json.get(schema), load: async (file: string) => modules.get(file) };
  const document = await generateOpenApi(base);
  assert.equal(document.openapi, "3.1.0");
  const paths = document.paths as Record<string, Record<string, unknown>>;
  assert.ok(paths["/api/users/{id}"]?.get);
  assert.ok(paths["/_meeko/rpc/users/get"]?.post);
  assert.deepEqual((paths["/api/users/{id}"]!.get as { parameters: unknown[] }).parameters, [{ in: "path", name: "id", required: true, schema: { type: "string" } }]);
  await assert.rejects(generateOpenApi({ ...base, publicSchemas: { stringSchema } }), /outside publicSchemas/);
  await assert.rejects(generateOpenApi({ ...base, toJsonSchema: () => undefined }), /not representable/);
  await assert.rejects(generateOpenApi({ ...base, manifest: { api: [{ ...manifest.api[0]!, pathname: "/api/[...slug]" }], rpc: [] } }), /catch-all/);
});

test("Node upgrade preflights before transport and bridges messages without protocol parsing", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const hub = createSocketHub({
    channels: { chat: defineSocketChannel({ clientToServer: { message: stringSchema }, serverToClient: { message: stringSchema }, handlers: { message: ({ payload, emit }) => emit("message", payload) } }) },
    sessions, services: {},
  });
  let upgrades = 0;
  const rejected: number[] = [];
  const sent: string[] = [];
  let deliver: ((data: string) => void) | undefined;
  const handler = createNodeSocketUpgradeHandler({
    hub, publicOrigin: "https://example.test",
    reject: (_request, _socket, status) => { rejected.push(status); },
    upgrade: () => {
      upgrades++;
      return { peer: { send: (message: string) => { sent.push(message); }, close: () => {} }, onMessage: (listener: (message: string | Uint8Array) => void) => { deliver = listener; }, onClose: () => {} };
    },
  });
  const incoming = (origin: string): IncomingMessage => ({ method: "GET", url: "/_meeko/socket/chat?room=r", headers: { origin, upgrade: "websocket" } }) as unknown as IncomingMessage;
  const socket = new PassThrough();
  assert.equal(await handler(incoming("https://evil.test"), socket, Buffer.alloc(0)), true);
  assert.deepEqual(rejected, [403]);
  assert.equal(upgrades, 0);
  assert.equal(await handler(incoming("https://example.test"), socket, Buffer.alloc(0)), true);
  assert.equal(upgrades, 1);
  deliver?.('{"event":"message","payload":"hello"}');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(sent[0]!) as unknown, { event: "message", payload: "hello" });
});

test("Node upgrade reports a connection close failure without throwing from the transport listener", async () => {
  const failure = new Error("connection close failed");
  const observed: unknown[] = [];
  let disconnected: (() => void) | undefined;
  const hub: Parameters<typeof createNodeSocketUpgradeHandler>[0]["hub"] = {
    async preflight() {},
    async accept() {
      return { async receive() {}, async emit() {}, close() { throw failure; } };
    },
    async broadcast() {},
  };
  const handler = createNodeSocketUpgradeHandler({
    hub,
    publicOrigin: "https://example.test",
    upgrade: () => ({
      peer: { send() {}, close() {} },
      onMessage() {},
      onClose(listener) { disconnected = listener; },
    }),
    onError(error) { observed.push(error); },
  });
  const incoming = { method: "GET", url: "/_meeko/socket/chat", headers: { origin: "https://example.test", upgrade: "websocket" } } as IncomingMessage;
  assert.equal(await handler(incoming, new PassThrough(), Buffer.alloc(0)), true);
  assert.ok(disconnected);
  assert.doesNotThrow(() => disconnected?.());
  assert.deepEqual(observed, [failure]);
});

test("Node upgrade contains a rejected asynchronous error observer", async () => {
  let disconnected: (() => void) | undefined;
  const hub: Parameters<typeof createNodeSocketUpgradeHandler>[0]["hub"] = {
    async preflight() {},
    async accept() { return { async receive() {}, async emit() {}, close() { throw new Error("close failed"); } }; },
    async broadcast() {},
  };
  const handler = createNodeSocketUpgradeHandler({
    hub,
    publicOrigin: "https://example.test",
    upgrade: () => ({
      peer: { send() {}, close() {} },
      onMessage() {},
      onClose(listener) { disconnected = listener; },
    }),
    onError: async () => { throw new Error("observer failed"); },
  });
  const incoming = { method: "GET", url: "/_meeko/socket/chat", headers: { origin: "https://example.test", upgrade: "websocket" } } as IncomingMessage;
  assert.equal(await handler(incoming, new PassThrough(), Buffer.alloc(0)), true);
  disconnected?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
});

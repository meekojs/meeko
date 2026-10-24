import assert from "node:assert/strict";
import test from "node:test";
import { createRequestContext, defineApiRoute, defineRpc, dispatchApiRoute, dispatchRpc, MemorySessionStore, SessionManager, useRequestState } from "../src/framework-server.ts";
import type { Schema } from "../src/framework-server.ts";

function schema<T>(accept: (input: unknown) => input is T): Schema<T> {
  return { "~standard": { version: 1, validate(value) { return accept(value) ? { value } : { issues: [{}] }; } } };
}

const stringSchema = schema((input): input is string => typeof input === "string");
const inputSchema = schema((input): input is { name: string } => typeof input === "object" && input !== null && typeof (input as { name?: unknown }).name === "string");

test("session IDs are opaque, rotate and revoke; memory storage is refused in production", async () => {
  const store = new MemorySessionStore<{ userId: string }>();
  assert.throws(() => new SessionManager({ store, production: true }), /Persistent/);
  const sessions = new SessionManager({ store, secure: false });
  const handle = await sessions.load(new Request("http://localhost/"));
  const created = await handle.create({ userId: "a" });
  assert.match(created.id, /^[A-Za-z0-9_-]{43}$/);
  assert.match(handle.cookieHeader ?? "", /HttpOnly; SameSite=Lax/);
  const loaded = await sessions.load(new Request("http://localhost/", { headers: { cookie: `meeko.sid=${created.id}` } }));
  assert.equal(loaded.current?.data.userId, "a");
  const rotated = await loaded.rotate();
  assert.notEqual(rotated.id, created.id);
  assert.equal(await store.get(created.id), undefined);
  await loaded.revoke();
  assert.equal(await store.get(rotated.id), undefined);
});

test("API validates input, authentication, CSRF and output without leaking private errors", async () => {
  const store = new MemorySessionStore<{ userId: string }>();
  const sessions = new SessionManager({ store, secure: false });
  const initial = await sessions.load(new Request("http://localhost/api/name"));
  const record = await initial.create({ userId: "u1" });
  const route = defineApiRoute({
    body: inputSchema,
    response: stringSchema,
    auth: "required",
    handler: ({ body }) => body.name,
  });
  const request = (headers: Record<string, string>, body = '{"name":"Meeko"}') => new Request("http://localhost/api/name", { method: "POST", headers: { cookie: `meeko.sid=${record.id}`, "content-type": "application/json", ...headers }, body });
  const missingOrigin = request({ "x-meeko-csrf": record.csrfToken });
  assert.equal((await dispatchApiRoute(route, createRequestContext(missingOrigin, {}, await sessions.load(missingOrigin)), sessions)).status, 403);
  const missingToken = request({ origin: "http://localhost" });
  assert.equal((await dispatchApiRoute(route, createRequestContext(missingToken, {}, await sessions.load(missingToken)), sessions)).status, 403);
  const valid = request({ origin: "http://localhost", "x-meeko-csrf": record.csrfToken });
  const response = await dispatchApiRoute(route, createRequestContext(valid, {}, await sessions.load(valid)), sessions);
  assert.equal(response.status, 200);
  assert.equal(await response.json(), "Meeko");
  const invalid = request({ origin: "http://localhost", "x-meeko-csrf": record.csrfToken }, '{"name":42}');
  const rejected = await dispatchApiRoute(route, createRequestContext(invalid, {}, await sessions.load(invalid)), sessions);
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json() as { code: string }).code, "INVALID_BODY");
  assert.ok(rejected.headers.get("x-request-id"));
});

test("RPC and request state use the same isolated request context", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const rpc = defineRpc({ input: inputSchema, output: stringSchema, handler: ({ input, context }) => `${input.name}:${useRequestState(context, "counter", () => 1)}` });
  const make = () => new Request("http://localhost/_meeko/rpc/name", { method: "POST", headers: { "content-type": "application/json" }, body: '{"name":"A"}' });
  const request1 = make();
  const request2 = make();
  const context1 = createRequestContext(request1, {}, await sessions.load(request1));
  const context2 = createRequestContext(request2, {}, await sessions.load(request2));
  assert.equal(await (await dispatchRpc(rpc, context1, sessions)).json(), "A:1");
  assert.equal(await (await dispatchRpc(rpc, context2, sessions)).json(), "A:1");
  assert.notEqual(context1.state, context2.state);
});

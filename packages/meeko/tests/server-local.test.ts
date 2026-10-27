import assert from "node:assert/strict";
import test from "node:test";
import { createLocalCalls, createRequestContext, createServerDispatcher, defineApiRoute, defineRpc, MemorySessionStore, SessionManager, useRequestState } from "../src/framework-server.ts";
import type { Schema, ServerManifest } from "../src/framework-server.ts";
import { setSocketAddress } from "../src/framework-server/env.ts";

const paramsSchema: Schema<{ id: string }> = { "~standard": { version: 1, validate(value) { return value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string" ? { value: value as { id: string } } : { issues: [{}] }; } } };
const inputSchema: Schema<{ value: string }> = { "~standard": { version: 1, validate(value) { return value && typeof value === "object" && typeof (value as { value?: unknown }).value === "string" ? { value: value as { value: string } } : { issues: [{}] }; } } };
const outputSchema: Schema<string> = { "~standard": { version: 1, validate(value) { return typeof value === "string" ? { value } : { issues: [{}] }; } } };

test("HTTP and local API/RPC share auth, CSRF, validation, and per-request state", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const handle = await sessions.load(new Request("https://example.test/"));
  const record = await handle.create({ user: "alice" });
  const manifest: ServerManifest = {
    api: [{ kind: "api", file: "api.ts", pathname: "/api/users/[id]", method: "POST", clientKey: "users.byId" }],
    rpc: [{ kind: "rpc", file: "rpc.ts", pathname: "/_meeko/rpc/users/get", id: "users.get" }],
  };
  const modules = new Map<string, unknown>([
    ["api.ts", { default: defineApiRoute({ params: paramsSchema, body: inputSchema, response: outputSchema, auth: "required", handler: ({ params, body, context }) => {
      const count = useRequestState(context, "counter", () => ({ value: 0 }));
      return `${params.id}:${body.value}:${++count.value}`;
    } }) }],
    ["rpc.ts", { default: defineRpc({ input: inputSchema, output: outputSchema, auth: "required", handler: ({ input }) => input.value }) }],
  ]);
  const load = async (file: string) => modules.get(file);
  const http = createServerDispatcher({ manifest, sessions, services: {}, load });
  const local = async (headers: Record<string, string> = {}) => {
    const request = new Request("https://example.test/page", { headers });
    return createLocalCalls({ manifest, sessions, context: createRequestContext(request, {}, await sessions.load(request)), load });
  };
  const headers = (csrf = true) => ({ cookie: `meeko.sid=${record.id}`, origin: "https://example.test", ...(csrf ? { "x-meeko-csrf": record.csrfToken } : {}) });
  const apiRequest = (body: unknown, extra: Record<string, string> = {}) => new Request("https://example.test/api/users/42", { method: "POST", headers: { "content-type": "application/json", ...extra }, body: JSON.stringify(body) });
  const rpcRequest = (body: unknown, extra: Record<string, string> = {}) => new Request("https://example.test/_meeko/rpc/users/get", { method: "POST", headers: { "content-type": "application/json", ...extra }, body: JSON.stringify(body) });
  const pair = async (body: unknown, extra: Record<string, string>, expected: number) => {
    const calls = await local(extra);
    const [httpApi, localApi, httpRpc, localRpc] = await Promise.all([
      http(apiRequest(body, extra)), calls.api("users.byId", "POST", { params: { id: "42" }, body }),
      http(rpcRequest(body, extra)), calls.rpc("users.get", body),
    ]);
    for (const response of [httpApi, localApi, httpRpc, localRpc]) assert.equal(response.status, expected);
    assert.equal((await httpApi.json() as { code?: string }).code, (await localApi.json() as { code?: string }).code);
    assert.equal((await httpRpc.json() as { code?: string }).code, (await localRpc.json() as { code?: string }).code);
  };
  await pair({ value: "x" }, {}, 401);
  await pair({ value: "x" }, headers(false), 403);
  await pair({ value: 3 }, headers(), 400);
  const calls = await local(headers());
  const [api, rpc] = await Promise.all([calls.api("users.byId", "POST", { params: { id: "42" }, body: { value: "ok" } }), calls.rpc("users.get", { value: "ok" })]);
  assert.equal(await api.json(), "42:ok:1");
  assert.equal(await rpc.json(), "ok");
  assert.equal(await (await calls.api("users.byId", "POST", { params: { id: "42" }, body: { value: "again" } })).json(), "42:again:2");
});

test("local calls share the HTTP dispatcher's rateLimit counter and count per client address", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const manifest: ServerManifest = {
    api: [{ kind: "api", file: "api.ts", pathname: "/api/items/[id]", method: "GET", clientKey: "items.byId" }],
    rpc: [{ kind: "rpc", file: "rpc.ts", pathname: "/_meeko/rpc/items/get", id: "items.get" }],
  };
  const modules = new Map<string, unknown>([
    ["api.ts", { default: defineApiRoute({ params: paramsSchema, response: outputSchema, rateLimit: { limit: 2, window: "1m" }, handler: ({ params }) => params.id }) }],
    ["rpc.ts", { default: defineRpc({ input: inputSchema, output: outputSchema, rateLimit: { limit: 1, window: "1m" }, handler: ({ input }) => input.value }) }],
  ]);
  const load = async (file: string) => modules.get(file);
  const http = createServerDispatcher({ manifest, sessions, services: {}, load });
  const local = async (address: string) => {
    const request = setSocketAddress(new Request("https://example.test/page"), address);
    return createLocalCalls({ manifest, sessions, context: createRequestContext(request, {}, await sessions.load(request)), load });
  };
  const ada = await local("203.0.113.7");
  assert.equal((await http(setSocketAddress(new Request("https://example.test/api/items/1"), "203.0.113.7"))).status, 200);
  assert.equal((await ada.api("items.byId", "GET", { params: { id: "2" } })).status, 200);
  assert.equal((await ada.api("items.byId", "GET", { params: { id: "3" } })).status, 429, "one counter for HTTP and local calls");
  const grace = await local("198.51.100.1");
  assert.equal((await grace.api("items.byId", "GET", { params: { id: "1" } })).status, 200, "another client has its own counter");
  assert.equal((await ada.rpc("items.get", { value: "a" })).status, 200);
  assert.equal((await ada.rpc("items.get", { value: "a" })).status, 429);
  assert.equal((await grace.rpc("items.get", { value: "a" })).status, 200);
});

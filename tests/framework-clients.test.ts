import assert from "node:assert/strict";
import test from "node:test";
import { ClientError, createApiClient, createPublicServerManifest, createRpcClient } from "../src/framework/clients.ts";
import type { ApiOperation, RpcOperation } from "../src/framework/clients.ts";

type ApiContract = {
  "users.byId": { get: ApiOperation<{ id: string }, { tab?: string }, undefined, { id: string }> };
  users: { post: ApiOperation<undefined, undefined, { name: string }, { id: string }> };
};
type RpcContract = { "users.get": RpcOperation<{ id: string }, { id: string }> };

test("API and RPC clients use only public paths and preserve params, query, body and CSRF", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return Response.json({ id: String(calls.length) });
  };
  const manifest = {
    api: [
      { clientKey: "users.byId", pathname: "/api/users/[id]", method: "GET" as const },
      { clientKey: "users", pathname: "/api/users", method: "POST" as const },
    ],
    rpc: [{ id: "users.get", pathname: "/_meeko/rpc/users/get" }],
  };
  const publicManifest = createPublicServerManifest({
    api: manifest.api.map((endpoint) => ({ ...endpoint, file: "server/api/private.ts" })),
    rpc: manifest.rpc.map((endpoint) => ({ ...endpoint, file: "server/rpc/private.ts" })),
  });
  assert.doesNotMatch(JSON.stringify(publicManifest), /private\.ts|"file"/);
  const options = { baseUrl: "https://example.test", fetch: fetcher, csrfToken: () => "token" };
  const api = createApiClient<ApiContract>(publicManifest, options);
  const rpc = createRpcClient<RpcContract>(publicManifest, options);
  if (false) {
    // @ts-expect-error dynamic endpoint requires params
    void api.users.byId.get({ query: {} });
    // @ts-expect-error body follows the public contract
    void api.users.post({ body: { invalid: true } });
    // @ts-expect-error RPC input follows the public contract
    void rpc.users.get({ id: 42 });
  }
  assert.deepEqual(await api.users.byId.get({ params: { id: "a b" }, query: { tab: "profile" } }), { id: "1" });
  assert.deepEqual(await api.users.post({ body: { name: "Ada" } }), { id: "2" });
  assert.deepEqual(await rpc.users.get({ id: "123" }), { id: "3" });
  assert.equal(calls[0]?.url, "https://example.test/api/users/a%20b?tab=profile");
  assert.equal(calls[1]?.url, "https://example.test/api/users");
  assert.equal(calls[2]?.url, "https://example.test/_meeko/rpc/users/get");
  assert.equal(calls[0]?.init.method, "GET");
  assert.equal(calls[1]?.init.method, "POST");
  assert.equal(calls[1]?.init.body, JSON.stringify({ name: "Ada" }));
  assert.equal(calls[2]?.init.body, JSON.stringify({ id: "123" }));
  assert.equal(new Headers(calls[0]?.init.headers).has("x-meeko-csrf"), false);
  assert.equal(new Headers(calls[1]?.init.headers).get("x-meeko-csrf"), "token");
  assert.equal(new Headers(calls[2]?.init.headers).get("x-meeko-csrf"), "token");
  await assert.rejects(api.users.byId.get({ params: { id: "a/b" }, query: {} }), /Invalid route parameter/);
  assert.equal(calls.length, 3);
});

test("clients normalize server errors and malformed responses", async () => {
  const manifest = { api: [{ clientKey: "users.byId", pathname: "/api/users/[id]", method: "GET" as const }] };
  const api = createApiClient<ApiContract>(manifest, {
    fetch: async () => Response.json({ code: "UNAUTHENTICATED", status: 401, requestId: "req-1" }, { status: 401 }),
  });
  await assert.rejects(api.users.byId.get({ params: { id: "1" }, query: {} }), (error: unknown) =>
    error instanceof ClientError && error.code === "UNAUTHENTICATED" && error.status === 401 && error.requestId === "req-1");
  const malformed = createApiClient<ApiContract>(manifest, { fetch: async () => new Response("no json", { status: 200 }) });
  await assert.rejects(malformed.users.byId.get({ params: { id: "1" }, query: {} }), (error: unknown) =>
    error instanceof ClientError && error.code === "INVALID_RESPONSE");
});

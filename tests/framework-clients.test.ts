import assert from "node:assert/strict";
import test from "node:test";
import { ClientError, createApiClient, createPublicServerManifest, createRpcClient } from "../src/framework/clients.ts";
import type { ApiOperation, RpcOperation } from "../src/framework/clients.ts";
import { createUseApi, createUseRpcMutation, createUseRpcQuery } from "../src/framework/resources.ts";

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
  assert.equal(await api.users.byId.get({ params: { id: "1" }, query: {} }).catch((error: unknown) => (error as ClientError).issues), undefined);
  const malformed = createApiClient<ApiContract>(manifest, { fetch: async () => new Response("no json", { status: 200 }) });
  await assert.rejects(malformed.users.byId.get({ params: { id: "1" }, query: {} }), (error: unknown) =>
    error instanceof ClientError && error.code === "INVALID_RESPONSE");
});

type EmailLogin = { method: "email"; email: string; password: string };
type StaffLogin = { method: "staff"; restaurant: string; username: string; password: string };
type Login = EmailLogin | StaffLogin;
type Search = { kind: "text"; text: string } | { kind: "tag"; tag: string };
type UnionApiContract = {
  session: { post: ApiOperation<undefined, undefined, Login, { ok: boolean }> };
  search: { get: ApiOperation<undefined, Search, undefined, string[]> };
  "items.byId": { get: ApiOperation<{ id: string }, Search, undefined, string[]> };
  listing: { get: ApiOperation<undefined, { page?: string }, undefined, string[]> };
  plain: { get: ApiOperation<undefined, undefined, undefined, string[]> };
  note: { post: ApiOperation<undefined, undefined, { text: string } | undefined, { ok: boolean }> };
  raw: { post: ApiOperation<undefined, undefined, unknown, { ok: boolean }> };
};
type UnionRpcContract = {
  "session.start": RpcOperation<Login, { ok: boolean }>;
  "stats.get": RpcOperation<{ range?: string }, number>;
};

test("clients and composables accept union-typed body, query and input values", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return Response.json({ ok: true });
  };
  const manifest = {
    api: [
      { clientKey: "session", pathname: "/api/session", method: "POST" },
      { clientKey: "search", pathname: "/api/search", method: "GET" },
      { clientKey: "items.byId", pathname: "/api/items/[id]", method: "GET" },
      { clientKey: "listing", pathname: "/api/listing", method: "GET" },
      { clientKey: "plain", pathname: "/api/plain", method: "GET" },
      { clientKey: "note", pathname: "/api/note", method: "POST" },
      { clientKey: "raw", pathname: "/api/raw", method: "POST" },
    ],
    rpc: [
      { id: "session.start", pathname: "/_meeko/rpc/session/start" },
      { id: "stats.get", pathname: "/_meeko/rpc/stats/get" },
    ],
  } as const;
  const options = { baseUrl: "https://example.test", fetch: fetcher, csrfToken: () => "token" };
  const api = createApiClient<UnionApiContract>(manifest, options);
  const rpc = createRpcClient<UnionRpcContract>(manifest, options);
  const useApi = createUseApi<UnionApiContract, typeof manifest>(manifest, options);
  const useRpcQuery = createUseRpcQuery<UnionRpcContract>(manifest, options);
  const useRpcMutation = createUseRpcMutation<UnionRpcContract>(manifest, options);
  // Values typed as the whole union, as a form or a parsed payload produces them.
  const body = JSON.parse('{"method":"staff","restaurant":"r1","username":"ada","password":"x"}') as Login;
  const search = JSON.parse('{"kind":"tag","tag":"new"}') as Search;
  if (false) {
    void api.session.post({ body });
    void api.session.post({ body: { method: "email", email: "a@b.c", password: "x" } });
    void api.search.get({ query: search });
    void api.items.byId.get({ params: { id: "1" }, query: search });
    void rpc.session.start(body);
    void useApi("/api/search", { query: search });
    void useApi("/api/search", () => ({ query: search }));
    void useApi("/api/items/[id]", { params: { id: "1" }, query: search });
    void useRpcQuery("session.start", body);
    void useRpcQuery("session.start", () => body);
    void useRpcMutation("session.start").mutate(body);
    // Arguments stay optional when the contract requires nothing.
    void api.listing.get();
    void api.plain.get();
    void api.listing.get({ query: { page: "2" } });
    void useApi("/api/listing");
    void useApi("/api/plain");
    void useRpcQuery("stats.get");
    // A body schema that accepts undefined may be left out; an unknown body is still a key.
    void api.note.post({});
    void api.note.post({ body: { text: "x" } });
    void api.raw.post({ body: 1 });
    // @ts-expect-error an optional body still follows the contract
    void api.note.post({ body: { text: 1 } });
    // @ts-expect-error an unknown body must be given
    void api.raw.post({});
    // @ts-expect-error a union body is still required
    void api.session.post();
    // @ts-expect-error the body must be a member of the union
    void api.session.post({ body: { method: "staff", email: "a@b.c", password: "x" } });
    // @ts-expect-error a union query is still required
    void api.search.get();
    // @ts-expect-error the query must be a member of the union
    void api.search.get({ query: { kind: "text", tag: "new" } });
    // @ts-expect-error params are still required next to a union query
    void api.items.byId.get({ query: search });
    // @ts-expect-error the RPC input must be a member of the union
    void rpc.session.start({ method: "email", username: "ada", password: "x" });
    // @ts-expect-error a union query is still required by useApi
    void useApi("/api/search");
    // @ts-expect-error the useApi query must be a member of the union
    void useApi("/api/search", { query: { kind: "tag", text: "new" } });
    // @ts-expect-error a union input is still required by useRpcQuery
    void useRpcQuery("session.start");
    // @ts-expect-error the useRpcQuery input must be a member of the union
    void useRpcQuery("session.start", { method: "staff", email: "a@b.c", password: "x" });
    // @ts-expect-error the mutate input must be a member of the union
    void useRpcMutation("session.start").mutate({ method: "staff", email: "a@b.c", password: "x" });
    // @ts-expect-error a body is not accepted without a body contract
    void api.plain.get({ body: {} });
  }
  assert.deepEqual(await api.session.post({ body }), { ok: true });
  assert.deepEqual(await api.search.get({ query: search }), { ok: true });
  assert.deepEqual(await rpc.session.start(body), { ok: true });
  assert.equal(calls[0]?.init.body, JSON.stringify(body));
  assert.equal(calls[1]?.url, "https://example.test/api/search?kind=tag&tag=new");
  assert.equal(calls[2]?.init.body, JSON.stringify(body));
});

test("clients expose the schema issues of a rejected input as readonly ClientError.issues", async () => {
  const issues = [
    { path: "name", message: "Escribe tu nombre." },
    { path: "", message: "Entrada no válida." },
    { path: 3, message: "not a string path" },
    "not an issue",
  ];
  const fetcher: typeof fetch = async () => Response.json({ code: "INVALID_INPUT", status: 400, requestId: "req-2", issues }, { status: 400 });
  const rpc = createRpcClient<RpcContract>({ rpc: [{ id: "users.get", pathname: "/_meeko/rpc/users/get" }] }, { fetch: fetcher });
  const error = await rpc.users.get({ id: "" }).then(() => undefined, (failure: unknown) => failure);
  assert.ok(error instanceof ClientError);
  assert.equal(error.code, "INVALID_INPUT");
  assert.equal(error.requestId, "req-2");
  assert.deepEqual(error.issues, [{ path: "name", message: "Escribe tu nombre." }, { path: "", message: "Entrada no válida." }]);
  assert.ok(Object.isFrozen(error.issues) && Object.isFrozen(error.issues?.[0]));
  if (false) {
    // @ts-expect-error issues are readonly
    error.issues![0]!.message = "changed";
  }
  const api = createApiClient<ApiContract>({ api: [{ clientKey: "users", pathname: "/api/users", method: "POST" }] }, {
    fetch: async () => Response.json({ code: "INVALID_BODY", status: 400, issues: "bad" }, { status: 400 }),
  });
  await assert.rejects(api.users.post({ body: { name: "" } }), (failure: unknown) =>
    failure instanceof ClientError && failure.code === "INVALID_BODY" && failure.issues === undefined);
});

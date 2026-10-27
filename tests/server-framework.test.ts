import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createLocalServerFetch, createRequestContext, createServerClientOptions, defineApiRoute, defineRpc, dispatchApiRoute, dispatchRpc, MemorySessionStore, SessionManager, useRequestState } from "../src/framework-server.ts";
import type { Schema, ServerManifest } from "../src/framework-server.ts";
import { withRequestContext } from "../src/framework-server/context.ts";
import { createApiClient, createRpcClient } from "../src/framework/clients.ts";
import type { ApiOperation, RpcOperation } from "../src/framework/clients.ts";

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

test("API preserves a safe error code and request ID across Vite module graphs", async () => {
  class ApiError extends Error {
    readonly code = "FORBIDDEN";
    readonly status = 403;
  }
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const request = new Request("http://localhost/api/private");
  const context = createRequestContext(request, {}, await sessions.load(request));
  const route = defineApiRoute({ response: stringSchema, handler() { throw new ApiError("private details"); } });
  const response = await dispatchApiRoute(route, context, sessions);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { code: "FORBIDDEN", status: 403, requestId: context.requestId });
  assert.equal(response.headers.get("x-request-id"), context.requestId);

  const unknown = defineApiRoute({ response: stringSchema, handler() { throw new Error("private details"); } });
  const sanitized = await dispatchApiRoute(unknown, context, sessions);
  assert.equal(sanitized.status, 500);
  assert.deepEqual(await sanitized.json(), { code: "INTERNAL_ERROR", status: 500, requestId: context.requestId });
});

test("API preserves an immutable redirect response and adds request metadata", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const request = new Request("http://localhost/api/redirect");
  const session = await sessions.load(request);
  const record = await session.create({ userId: "redirect-user" });
  const context = createRequestContext(request, {}, session);
  const route = defineApiRoute({
    contentType: "response",
    handler: () => Response.redirect("http://localhost/destination", 302),
  });
  const response = await dispatchApiRoute(route, context, sessions);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "http://localhost/destination");
  assert.equal(response.headers.get("x-request-id"), context.requestId);
  assert.match(response.headers.get("set-cookie") ?? "", new RegExp(`meeko\\.sid=${record.id}`));
  assert.equal(response.headers.get("x-meeko-csrf-token"), record.csrfToken);
});

test("a rejected API error observer does not escape after a sanitized response", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const request = new Request("http://localhost/api/failure");
  const context = createRequestContext(request, {}, await sessions.load(request));
  const route = defineApiRoute({ response: stringSchema, handler() { throw new Error("private failure"); } });
  const response = await dispatchApiRoute(route, context, sessions, {}, async () => { throw new Error("observer failure"); });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { code: "INTERNAL_ERROR", status: 500, requestId: context.requestId });
  await new Promise<void>((resolve) => setImmediate(resolve));
});

test("production fallback records observer failure without private error details", async () => {
  const previousEnvironment = process.env.NODE_ENV;
  const previousLogger = console.error;
  const logged: unknown[][] = [];
  process.env.NODE_ENV = "production";
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
    const request = new Request("http://localhost/api/failure");
    const context = createRequestContext(request, {}, await sessions.load(request));
    const route = defineApiRoute({ response: stringSchema, handler() { throw new Error("private database password"); } });
    const response = await dispatchApiRoute(route, context, sessions, {}, async () => { throw new Error("private observer token"); });
    assert.equal(response.status, 500);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.match(String(logged[0]?.[0]), /Meeko server error observer failed/);
    assert.match(String(logged[0]?.[0]), new RegExp(context.requestId));
    assert.deepEqual(logged[0]?.[1], { original: "Error", observer: "Error" });
    assert.doesNotMatch(JSON.stringify(logged), /private database password|private observer token/);
  } finally {
    console.error = previousLogger;
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  }
});

/** A Standard Schema that rejects like Valibot: object path segments with `key`, and its own message. */
function issuesSchema<T>(issues: readonly unknown[]): Schema<T> {
  return { "~standard": { version: 1, validate() { return { issues }; } } };
}

test("origin: required rejects anonymous mutations without an allowed Origin before validation", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false, allowedOrigins: ["https://admin.example.test"] });
  let handled = 0;
  let validated = 0;
  const counting = schema((input): input is { name: string } => {
    validated++;
    return typeof input === "object" && input !== null && typeof (input as { name?: unknown }).name === "string";
  });
  const login = defineApiRoute({ origin: "required", body: counting, response: stringSchema, handler: ({ body }) => { handled++; return body.name; } });
  const post = (headers: Record<string, string>) => new Request("http://localhost/api/login", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: '{"name":"Ada"}' });
  const send = async (request: Request) => dispatchApiRoute(login, createRequestContext(request, {}, await sessions.load(request)), sessions);
  for (const headers of [{}, { origin: "https://evil.example.test" }, { origin: "null" }]) {
    const response = await send(post(headers));
    assert.equal(response.status, 403);
    assert.equal((await response.json() as { code: string }).code, "INVALID_ORIGIN");
  }
  assert.equal(validated, 0);
  assert.equal(handled, 0);
  assert.equal((await send(post({ origin: "http://localhost" }))).status, 200);
  assert.equal((await send(post({ origin: "https://admin.example.test" }))).status, 200);
  assert.equal(handled, 2);

  // Safe methods are not checked, and routes without the option keep the 1.1 behavior.
  const read = defineApiRoute({ origin: "required", response: stringSchema, handler: () => "ok" });
  const get = new Request("http://localhost/api/read");
  assert.equal((await dispatchApiRoute(read, createRequestContext(get, {}, await sessions.load(get)), sessions)).status, 200);
  const open = defineApiRoute({ body: inputSchema, response: stringSchema, handler: ({ body }) => body.name });
  const anonymous = post({});
  assert.equal((await dispatchApiRoute(open, createRequestContext(anonymous, {}, await sessions.load(anonymous)), sessions)).status, 200);

  const rpc = defineRpc({ input: inputSchema, output: stringSchema, origin: "required", handler: ({ input }) => input.name });
  const call = (headers: Record<string, string>) => new Request("http://localhost/_meeko/rpc/auth/login", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: '{"name":"Ada"}' });
  const missing = call({});
  const refused = await dispatchRpc(rpc, createRequestContext(missing, {}, await sessions.load(missing)), sessions);
  assert.equal(refused.status, 403);
  assert.equal((await refused.json() as { code: string }).code, "INVALID_ORIGIN");
  const allowed = call({ origin: "http://localhost" });
  assert.equal(await (await dispatchRpc(rpc, createRequestContext(allowed, {}, await sessions.load(allowed)), sessions)).json(), "Ada");
});

test("origin: required lets SSR clients call through local dispatch", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const manifest: ServerManifest = { api: [], rpc: [{ kind: "rpc", file: "login.ts", pathname: "/_meeko/rpc/auth/login", id: "auth.login" }] };
  const login = defineRpc({ input: inputSchema, output: stringSchema, origin: "required", handler: ({ input }) => input.name });
  const serverFetch = createLocalServerFetch({ manifest, sessions, load: async () => ({ default: login }) });
  // A document request carries no Origin; the server clients send the request's own.
  const page = new Request("http://localhost/login");
  const context = createRequestContext(page, {}, await sessions.load(page));
  const rpc = createRpcClient<{ "auth.login": RpcOperation<{ name: string }, string> }>(manifest, createServerClientOptions());
  assert.equal(await withRequestContext(context, serverFetch, () => rpc.auth.login({ name: "Ada" })), "Ada");
});

test("invalid input responds with the schema's issues; invalid output stays a bare 500", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const body = issuesSchema<{ email: string; password: string }>([
    { message: "Escribe tu contraseña.", path: [{ type: "object", origin: "value", input: { password: "" }, key: "password", value: "" }], input: "", expected: "!0", received: "0" },
    { message: "Revisa el correo.", path: ["contact", { key: 0 }, "email"] },
    { message: "Entrada no válida." },
    { path: ["ignored"] },
    "not an issue",
  ]);
  const route = defineApiRoute({ body, response: stringSchema, handler: () => "unreachable" });
  const request = new Request("http://localhost/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: '{"password":"secret-value"}' });
  const context = createRequestContext(request, {}, await sessions.load(request));
  const response = await dispatchApiRoute(route, context, sessions);
  assert.equal(response.status, 400);
  const payload = await response.json() as Record<string, unknown>;
  assert.deepEqual(payload, {
    code: "INVALID_BODY", status: 400, requestId: context.requestId,
    issues: [
      { path: "password", message: "Escribe tu contraseña." },
      { path: "contact.0.email", message: "Revisa el correo." },
      { path: "", message: "Entrada no válida." },
    ],
  });
  assert.doesNotMatch(JSON.stringify(payload), /secret-value|expected|received/);

  const many = issuesSchema<{ q: string }>(Array.from({ length: 30 }, (_, index) => ({ message: `m${index}`, path: [`f${index}`] })));
  const search = defineApiRoute({ query: many, response: stringSchema, handler: () => "unreachable" });
  const get = new Request("http://localhost/api/search?q=1");
  const capped = await (await dispatchApiRoute(search, createRequestContext(get, {}, await sessions.load(get)), sessions)).json() as { code: string; issues: unknown[] };
  assert.equal(capped.code, "INVALID_QUERY");
  assert.equal(capped.issues.length, 20);

  // Issues without a schema message produce no `issues` field.
  const params = defineApiRoute({ params: issuesSchema<{ id: string }>([{}]), response: stringSchema, handler: () => "x" });
  const silent = await dispatchApiRoute(params, createRequestContext(get, {}, await sessions.load(get)), sessions);
  const silentPayload = await silent.json() as { code: string };
  assert.equal(silentPayload.code, "INVALID_PARAMS");
  assert.deepEqual(Object.keys(silentPayload), ["code", "status", "requestId"]);

  const rpc = defineRpc({ input: issuesSchema<{ name: string }>([{ message: "Escribe un nombre.", path: [{ key: "name" }] }]), output: stringSchema, handler: () => "x" });
  const call = new Request("http://localhost/_meeko/rpc/users/rename", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const invalidInput = await (await dispatchRpc(rpc, createRequestContext(call, {}, await sessions.load(call)), sessions)).json() as { code: string; issues?: unknown };
  assert.equal(invalidInput.code, "INVALID_INPUT");
  assert.deepEqual(invalidInput.issues, [{ path: "name", message: "Escribe un nombre." }]);

  const badOutput = defineRpc({ input: inputSchema, output: issuesSchema<string>([{ message: "private output detail", path: [{ key: "x" }] }]), handler: () => "x" });
  const call2 = new Request("http://localhost/_meeko/rpc/users/get", { method: "POST", headers: { "content-type": "application/json" }, body: '{"name":"A"}' });
  const output = await dispatchRpc(badOutput, createRequestContext(call2, {}, await sessions.load(call2)), sessions);
  assert.equal(output.status, 500);
  assert.deepEqual(Object.keys(await output.json() as object), ["code", "status", "requestId"]);
  const badResponse = defineApiRoute({ response: issuesSchema<string>([{ message: "private response detail" }]), handler: () => "x" });
  const response500 = await dispatchApiRoute(badResponse, createRequestContext(get, {}, await sessions.load(get)), sessions);
  assert.equal(response500.status, 500);
  assert.doesNotMatch(await response500.text(), /private response detail|issues/);
});

test("locals run after guards and validation and reach the handler typed", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore<{ userId: string }>(), secure: false });
  const order: string[] = [];
  const route = defineApiRoute({
    body: inputSchema,
    response: stringSchema,
    authorize: () => { order.push("authorize"); return true; },
    locals: async (context) => {
      order.push("locals");
      if (context.request.headers.get("x-role") === "guest") throw new ApiError("FORBIDDEN", 403);
      return { user: { name: "Ada", visits: 3 } };
    },
    handler: ({ body, locals }) => {
      order.push("handler");
      const visits: number = locals.user.visits;
      // @ts-expect-error locals is typed from the locals function
      void locals.user.missing;
      return `${body.name}:${locals.user.name}:${visits}`;
    },
  });
  const post = (body: string, headers: Record<string, string> = {}) => new Request("http://localhost/api/orders", { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
  const send = async (request: Request) => dispatchApiRoute(route, createRequestContext(request, {}, await sessions.load(request)), sessions);
  assert.equal(await (await send(post('{"name":"order"}'))).json(), "order:Ada:3");
  assert.deepEqual(order, ["authorize", "locals", "handler"]);
  order.length = 0;
  assert.equal((await send(post('{"name":42}'))).status, 400);
  assert.deepEqual(order, ["authorize"]);
  order.length = 0;
  const forbidden = await send(post('{"name":"order"}', { "x-role": "guest" }));
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json() as { code: string }).code, "FORBIDDEN");
  assert.deepEqual(order, ["authorize", "locals"]);

  const plain = defineApiRoute({ response: stringSchema, handler: ({ locals }) => {
    const nothing: undefined = locals;
    return String(nothing);
  } });
  const get = new Request("http://localhost/api/plain");
  assert.equal(await (await dispatchApiRoute(plain, createRequestContext(get, {}, await sessions.load(get)), sessions)).json(), "undefined");

  const rpc = defineRpc({
    input: inputSchema,
    output: stringSchema,
    auth: "required",
    locals: ({ session }) => ({ userId: (session.current?.data as { userId: string }).userId }),
    handler: ({ input, locals }) => `${input.name}:${locals.userId}`,
  });
  const anonymous = new Request("http://localhost/_meeko/rpc/orders/create", { method: "POST", headers: { "content-type": "application/json" }, body: '{"name":"A"}' });
  assert.equal((await dispatchRpc(rpc, createRequestContext(anonymous, {}, await sessions.load(anonymous)), sessions)).status, 401);
  const handle = await sessions.load(new Request("http://localhost/"));
  const record = await handle.create({ userId: "u1" });
  const signed = new Request("http://localhost/_meeko/rpc/orders/create", {
    method: "POST", body: '{"name":"A"}',
    headers: { "content-type": "application/json", cookie: `meeko.sid=${record.id}`, origin: "http://localhost", "x-meeko-csrf": record.csrfToken },
  });
  assert.equal(await (await dispatchRpc(rpc, createRequestContext(signed, {}, await sessions.load(signed)), sessions)).json(), "A:u1");
});

test("status chooses 201, 202 or 204 for JSON endpoints and generated clients read them", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const created = defineApiRoute({ body: inputSchema, response: stringSchema, status: 201, handler: ({ body }) => `created:${body.name}` });
  const accepted = defineApiRoute({ response: stringSchema, status: 202, handler: () => "queued" });
  const removed = defineApiRoute({ status: 204, handler: async () => {} });
  // @ts-expect-error a 204 handler returns nothing
  defineApiRoute({ status: 204, handler: () => "body" });
  // @ts-expect-error only 200, 201, 202 and 204 are success statuses
  defineApiRoute({ response: stringSchema, status: 203, handler: () => "x" });
  const contextFor = async (request: Request) => createRequestContext(request, {}, await sessions.load(request));
  const post = () => new Request("http://localhost/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: '{"name":"Ada"}' });

  const createdResponse = await dispatchApiRoute(created, await contextFor(post()), sessions);
  assert.equal(createdResponse.status, 201);
  assert.match(createdResponse.headers.get("content-type") ?? "", /application\/json/);
  assert.ok(createdResponse.headers.get("x-request-id"));
  assert.equal(await createdResponse.json(), "created:Ada");
  assert.equal((await dispatchApiRoute(accepted, await contextFor(new Request("http://localhost/api/jobs")), sessions)).status, 202);
  const removedResponse = await dispatchApiRoute(removed, await contextFor(new Request("http://localhost/api/orders/1", { method: "DELETE" })), sessions);
  assert.equal(removedResponse.status, 204);
  assert.equal(await removedResponse.text(), "");
  assert.equal(removedResponse.headers.get("content-type"), null);

  // Input and response validation keep working with a custom status.
  const invalidBody = await dispatchApiRoute(created, await contextFor(new Request("http://localhost/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: '{"name":1}' })), sessions);
  assert.equal(invalidBody.status, 400);
  const brokenOutput = defineApiRoute({ response: stringSchema, status: 201, handler: () => 42 as unknown as string });
  assert.equal((await (await dispatchApiRoute(brokenOutput, await contextFor(new Request("http://localhost/api/broken")), sessions)).json() as { code: string }).code, "INVALID_RESPONSE");
  const bodyOn204 = defineApiRoute({ status: 204, handler: () => "body" as unknown as undefined });
  assert.equal((await (await dispatchApiRoute(bodyOn204, await contextFor(new Request("http://localhost/api/broken")), sessions)).json() as { code: string }).code, "INVALID_RESPONSE");

  // Misdeclared statuses fail as server faults before the handler runs.
  let ran = false;
  const misdeclared = [
    { status: 203, response: stringSchema },
    { status: 201, contentType: "response" },
    { status: 204, response: stringSchema },
  ];
  for (const fields of misdeclared) {
    const definition = { ...fields, handler: () => { ran = true; return "x"; } } as never;
    const response = await dispatchApiRoute(definition, await contextFor(new Request("http://localhost/api/misdeclared")), sessions);
    assert.equal(response.status, 500);
    assert.equal((await response.json() as { code: string }).code, "INVALID_RESPONSE_STATUS");
  }
  assert.equal(ran, false);

  const manifest = { api: [
    { clientKey: "orders", pathname: "/api/orders", method: "POST" as const },
    { clientKey: "orders.byId", pathname: "/api/orders/[id]", method: "DELETE" as const },
  ] };
  const api = createApiClient<{
    orders: { post: ApiOperation<undefined, undefined, { name: string }, string> };
    "orders.byId": { delete: ApiOperation<{ id: string }, undefined, undefined, undefined> };
  }>(manifest, { baseUrl: "http://localhost", fetch: async (input, init) => {
    const request = new Request(input, init);
    return request.method === "POST" ? dispatchApiRoute(created, await contextFor(request), sessions) : dispatchApiRoute(removed, await contextFor(request), sessions);
  } });
  assert.equal(await api.orders.post({ body: { name: "Lin" } }), "created:Lin");
  const nothing: undefined = await api.orders({ id: "1" }).delete();
  assert.equal(nothing, undefined);
});

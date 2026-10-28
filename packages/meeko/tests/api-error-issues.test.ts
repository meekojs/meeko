import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createRequestContext, defineApiRoute, defineRpc, dispatchApiRoute, dispatchRpc, errorResponse, MemorySessionStore, SessionManager } from "../src/framework-server.ts";
import type { ApiErrorIssue, Schema } from "../src/framework-server.ts";
import { normalizeServerError } from "../src/framework-server/contracts.ts";
import { ClientError, createRpcClient, useForm } from "../src/framework.ts";
import type { RpcOperation } from "../src/framework.ts";

const anything: Schema<{ email: string }> = { "~standard": { version: 1, validate: (value) => ({ value: value as { email: string } }) } };
const text: Schema<string> = { "~standard": { version: 1, validate: (value) => ({ value: value as string }) } };
const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });

test("an ApiError with issues sends them like the issues of a 400, and keeps its message private", async () => {
  const route = defineApiRoute({
    body: anything,
    response: text,
    handler: ({ body }) => {
      throw new ApiError("EMAIL_TAKEN", 409, { message: `duplicate key ${body.email}`, issues: [{ path: "email", message: "Ese correo ya tiene una cuenta." }] });
    },
  });
  const request = new Request("http://localhost/api/signup", { method: "POST", headers: { "content-type": "application/json" }, body: '{"email":"ada@example.com"}' });
  const context = createRequestContext(request, {}, await sessions.load(request));
  const response = await dispatchApiRoute(route, context, sessions);
  assert.equal(response.status, 409);
  const payload = await response.json() as Record<string, unknown>;
  assert.deepEqual(payload, { code: "EMAIL_TAKEN", status: 409, requestId: context.requestId, issues: [{ path: "email", message: "Ese correo ya tiene una cuenta." }] });
  assert.doesNotMatch(JSON.stringify(payload), /duplicate key|ada@example/);

  const rpc = defineRpc({ input: anything, output: text, handler: () => { throw new ApiError("EMAIL_TAKEN", 409, { issues: [{ path: "email", message: "Ya existe." }] }); } });
  const call = new Request("http://localhost/_meeko/rpc/users/create", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const rpcPayload = await (await dispatchRpc(rpc, createRequestContext(call, {}, await sessions.load(call)), sessions)).json() as { issues?: unknown };
  assert.deepEqual(rpcPayload.issues, [{ path: "email", message: "Ya existe." }]);
});

test("ApiError issues: the old message argument, checked shapes, the 20 limit and no issues on a 5xx", async () => {
  const plain = new ApiError("NOT_FOUND", 404, "private detail");
  assert.equal(plain.message, "private detail");
  assert.equal(plain.issues, undefined);
  assert.equal(new ApiError("NOT_FOUND", 404).message, "NOT_FOUND");
  assert.equal(new ApiError("X", 409, { issues: [] }).message, "X");
  assert.throws(() => new ApiError("X", 409, { issues: [{ path: "email" }] as unknown as ApiErrorIssue[] }), TypeError);
  assert.throws(() => new ApiError("X", 409, { issues: "email" as unknown as ApiErrorIssue[] }), TypeError);

  const many = new ApiError("BAD", 422, { issues: Array.from({ length: 30 }, (_, index) => ({ path: `f${index}`, message: `m${index}` })) });
  const capped = await errorResponse(many, "r").json() as { issues: unknown[] };
  assert.equal(capped.issues.length, 20);

  const server = await errorResponse(new ApiError("BROKEN", 503, { issues: [{ path: "email", message: "internal hint" }] }), "r").json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(server), ["code", "status", "requestId"]);
  assert.deepEqual(Object.keys(await errorResponse(new ApiError("EMPTY", 409, { issues: [] }), "r").json() as object), ["code", "status", "requestId"]);
});

test("an ApiError of another module graph keeps its issues through the normalization", () => {
  /** The ApiError of another copy of Meeko: same name, same mark. */
  class ApiErrorCopy extends Error {
    constructor(readonly code: string, readonly status: number, readonly issues?: unknown) {
      super(code);
      this.name = "ApiError";
      Object.defineProperty(this, Symbol.for("meeko.apiError"), { value: true });
    }
  }
  const copied = normalizeServerError(new ApiErrorCopy("EMAIL_TAKEN", 409, [{ path: "email", message: "Ya existe." }]));
  assert.deepEqual([copied.code, copied.status, copied.issues], ["EMAIL_TAKEN", 409, [{ path: "email", message: "Ya existe." }]]);
  const malformed = normalizeServerError(new ApiErrorCopy("EMAIL_TAKEN", 409, [{ path: 1 }]));
  assert.deepEqual([malformed.code, malformed.issues], ["EMAIL_TAKEN", undefined], "malformed issues of a copy are dropped, the error is kept");
  assert.equal((new ApiError("X", 400) as unknown as Record<symbol, unknown>)[Symbol.for("meeko.apiError")], true);
});

test("issues only travel from a real ApiError, not from another error with its shape", () => {
  // An SDK whose error is also called ApiError, with issues of its own service.
  class ForeignApiError extends Error {
    constructor(readonly code: string, readonly status: number, readonly issues: unknown) {
      super(code);
      this.name = "ApiError";
    }
  }
  const foreign = normalizeServerError(new ForeignApiError("EMAIL_TAKEN", 409, [{ path: "email", message: "De otro servicio." }]));
  assert.deepEqual([foreign.code, foreign.status, foreign.issues], ["EMAIL_TAKEN", 409, undefined]);
  // A ClientError of another Meeko service that escapes the handler stays internal.
  const escaped = normalizeServerError(new ClientError("INVALID_INPUT", 400, "req-1", [{ path: "email", message: "Correo no válido." }]));
  assert.deepEqual([escaped.code, escaped.status, escaped.issues], ["INTERNAL_ERROR", 500, undefined]);
});

test("the issues of a 409 reach ClientError and useForm puts them on the field", async () => {
  const signup = defineRpc({
    input: anything,
    output: text,
    handler: () => { throw new ApiError("EMAIL_TAKEN", 409, { issues: [{ path: "email", message: "Ese correo ya tiene una cuenta." }] }); },
  });
  const rpc = createRpcClient<{ "users.signup": RpcOperation<{ email: string }, string> }>({ rpc: [{ id: "users.signup", pathname: "/_meeko/rpc/users.signup" }] }, {
    baseUrl: "http://localhost",
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      return dispatchRpc(signup, createRequestContext(request, {}, await sessions.load(request)), sessions);
    }) as typeof fetch,
  });
  const form = useForm({ initial: { email: "ada@example.com" }, submit: (values) => rpc.users.signup(values) });
  const outcome = await form.trySubmit();
  assert.equal(outcome.ok, false);
  assert.equal(!outcome.ok && outcome.reason, "invalid");
  assert.deepEqual(form.errors.value, { email: "Ese correo ya tiene una cuenta." });
  assert.equal(form.error.value, null);
  assert.ok(form.failure.value instanceof ClientError);
  assert.equal((form.failure.value as ClientError).status, 409);
});

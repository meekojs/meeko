import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import test from "node:test";
import { createServerDispatcher, defineApiRoute, defineRpc, discoverServerManifest, MemorySessionStore, SessionManager } from "../src/framework-server.ts";
import type { Schema } from "../src/framework-server.ts";

const textSchema: Schema<string> = { "~standard": { version: 1, validate(value) { return typeof value === "string" ? { value } : { issues: [{}] }; } } };
const objectSchema: Schema<{ value: string }> = { "~standard": { version: 1, validate(value) { return value && typeof value === "object" && typeof (value as { value?: unknown }).value === "string" ? { value: value as { value: string } } : { issues: [{}] }; } } };
const idSchema: Schema<{ id: string }> = { "~standard": { version: 1, validate(value) { return value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string" ? { value: value as { id: string } } : { issues: [{}] }; } } };

async function fixture(t: { after: (fn: () => Promise<void>) => void }, paths: string[]): Promise<{ root: string; files: string[] }> {
  await mkdir(join(process.cwd(), ".meeko"), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), ".meeko", "server-discovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files: string[] = [];
  for (const path of paths) {
    const file = join(root, "server", path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, "export default {};\n", "utf8");
    files.push(file);
  }
  return { root, files };
}

test("discovers API methods and RPC procedures and dispatches path parameters", async (t) => {
  const { root, files } = await fixture(t, ["api/users/index.get.ts", "api/users/[id].get.ts", "api/users/index.post.ts", "rpc/users/get.ts"]);
  const manifest = await discoverServerManifest(root);
  assert.deepEqual(manifest.api.map((entry) => `${entry.method} ${entry.pathname}`), ["GET /api/users/[id]", "GET /api/users", "POST /api/users"]);
  assert.deepEqual(manifest.rpc.map((entry) => entry.id), ["users.get"]);
  const definitions = new Map<string, unknown>([
    [files[0]!, { default: defineApiRoute({ response: textSchema, handler: () => "list" }) }],
    [files[1]!, { default: defineApiRoute({ params: idSchema, response: textSchema, handler: ({ params }) => params.id }) }],
    [files[2]!, { default: defineApiRoute({ response: textSchema, handler: () => "created" }) }],
    [files[3]!, { default: defineRpc({ input: objectSchema, output: textSchema, handler: ({ input }) => input.value }) }],
  ]);
  const dispatcher = createServerDispatcher({ manifest, sessions: new SessionManager({ store: new MemorySessionStore(), secure: false }), services: {}, load: async (file) => definitions.get(file) });
  assert.equal(await (await dispatcher(new Request("http://localhost/api/users"))).json(), "list");
  assert.equal(await (await dispatcher(new Request("http://localhost/api/users/a%20b"))).json(), "a b");
  assert.equal((await dispatcher(new Request("http://localhost/api/users", { method: "DELETE" }))).headers.get("allow"), "GET, POST");
  assert.equal(await (await dispatcher(new Request("http://localhost/_meeko/rpc/users/get", { method: "POST", headers: { "content-type": "application/json" }, body: '{"value":"rpc"}' }))).json(), "rpc");
  assert.equal((await dispatcher(new Request("http://localhost/_meeko/rpc/users/get"))).status, 405);
  assert.equal((await dispatcher(new Request("http://localhost/api/absent"))).status, 404);
});

test("rejects ambiguous API URL and generated client names", async (t) => {
  const rootApi = await fixture(t, ["api/index.get.ts"]);
  await assert.rejects(discoverServerManifest(rootApi.root), (error: unknown) => {
    assert.match(String(error), /cannot target \/api/);
    assert.match(String(error), /api[\\/]index\.get\.ts/);
    return true;
  });
  const ambiguous = await fixture(t, ["api/users/[id].get.ts", "api/users/[slug].get.ts"]);
  await assert.rejects(discoverServerManifest(ambiguous.root), /API route collision/);
  const client = await fixture(t, ["api/users/[id].get.ts", "api/users/byId.get.ts"]);
  await assert.rejects(discoverServerManifest(client.root), /API client name collision/);
  const nestedApi = await fixture(t, ["api/users/index.get.ts", "api/users/get.post.ts"]);
  await assert.rejects(discoverServerManifest(nestedApi.root), (error: unknown) => {
    assert.match(String(error), /API client name collision/);
    assert.match(String(error), /users[\\/]index\.get\.ts/);
    assert.match(String(error), /users[\\/]get\.post\.ts/);
    assert.match(String(error), /users\.get(?:\.post)?/);
    return true;
  });
  const nestedRpc = await fixture(t, ["rpc/users.ts", "rpc/users/get.ts"]);
  await assert.rejects(discoverServerManifest(nestedRpc.root), (error: unknown) => {
    assert.match(String(error), /RPC collision/);
    assert.match(String(error), /rpc[\\/]users\.ts/);
    assert.match(String(error), /rpc[\\/]users[\\/]get\.ts/);
    assert.match(String(error), /users(?:\.get)?/);
    return true;
  });
});

test("HTTP dispatcher reports internal API and RPC failures with their public request IDs", async () => {
  const observed: { error: unknown; requestId: string }[] = [];
  const manifest = {
    api: [{ kind: "api" as const, file: "api.ts", pathname: "/api/broken", method: "GET" as const, clientKey: "broken" }],
    rpc: [{ kind: "rpc" as const, file: "rpc.ts", pathname: "/_meeko/rpc/broken", id: "broken" }],
  };
  const dispatcher = createServerDispatcher({
    manifest,
    sessions: new SessionManager({ store: new MemorySessionStore(), secure: false }),
    services: {},
    load: async (file) => file === "api.ts"
      ? { default: defineApiRoute({ response: textSchema, handler() { throw new Error("private API detail"); } }) }
      : { default: defineRpc({ input: textSchema, output: textSchema, handler() { throw new Error("private RPC detail"); } }) },
    onError(error, requestId) { observed.push({ error, requestId }); },
  });
  const api = await dispatcher(new Request("http://localhost/api/broken"));
  const rpc = await dispatcher(new Request("http://localhost/_meeko/rpc/broken", {
    method: "POST", headers: { "content-type": "application/json" }, body: '"hello"',
  }));
  for (const [index, response] of [api, rpc].entries()) {
    assert.equal(response.status, 500);
    const body = await response.json() as { code: string; status: number; requestId: string };
    assert.deepEqual({ code: body.code, status: body.status }, { code: "INTERNAL_ERROR", status: 500 });
    assert.equal(response.headers.get("x-request-id"), body.requestId);
    assert.equal(observed[index]?.requestId, body.requestId);
    assert.ok(observed[index]?.error instanceof Error);
    assert.doesNotMatch(JSON.stringify(body), /private/);
  }
  const missing = await dispatcher(new Request("http://localhost/api/missing"));
  assert.equal(missing.status, 404);
  assert.equal(observed.length, 2);
});

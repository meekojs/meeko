import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { Window } from "happy-dom";
import { applyAutoImports, discoverAutoImports, discoverAutoImportsSync } from "../src/autoimports.ts";
import { generateAutoImportTypes } from "../src/autoimports-ts.ts";
import { generateServerContracts } from "../src/framework/contracts-generate.ts";
import { createApiClient, createBrowserClientOptions, createRpcClient } from "../src/framework/clients.ts";
import { createRequestContext, withRequestContext } from "../src/framework-server/context.ts";
import { createServerClientOptions } from "../src/framework-server/auto-clients.ts";
import { MemorySessionStore, SessionManager } from "../src/framework-server/sessions.ts";
import { createLocalServerFetch } from "../src/framework-server/discovery.ts";
import { defineApiRoute, defineRpc } from "../src/framework-server/contracts.ts";
import type { Schema, ServerManifest } from "../src/framework-server.ts";

const execFileAsync = promisify(execFile);

test("generated API/RPC autoimports use public descriptors and separate client/server ESM files", async () => {
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(resolve(".meeko/automatic-clients-"));
  try {
    const files = {
      "shared/schemas/user.ts": `const schema = <T>() => ({ "~standard": { version: 1 as const, types: undefined as unknown as { input: T; output: T }, validate: (value: unknown) => ({ value: value as T }) } });
export const user = schema<{ id: string }>();`,
      "server/api/users/index.get.ts": `import { user } from "../../../shared/schemas/user.js";
export default defineApiRoute({ response: user, handler: async () => ({ id: "1" }) });`,
      "server/rpc/users/get.ts": `import { user } from "../../../shared/schemas/user.js";
export default defineRpc({ input: user, output: user, handler: async ({ input }) => input });`,
      "server/socket/chat.ts": `import { user } from "../../shared/schemas/user.js";
export default defineSocketChannel({ clientToServer: { message: user }, serverToClient: { message: user } });`,
      "server/services/private.ts": `export const privateService = () => "private";`,
      "layers/base/app/pages/layer-demo.meeko": `<script lang="ts">const label = layerGreeting();</script><template><p>{label}</p></template>`,
      "layers/base/app/utils/greeting.ts": `export const layerGreeting = () => "from layer";`,
      "app/pages/index.meeko": `<script lang="ts">const data = api.users.get();</script><template><p>ok</p></template>`,
      "meeko.config.ts": `export default { extends: ["./layers/base"], imports: { serverDirs: ["server/services"] } };`,
    };
    for (const [name, source] of Object.entries(files)) {
      const file = join(root, name);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, source);
    }
    await generateServerContracts(root);
    const registry = await discoverAutoImports(root);
    assert.equal(registry.filter((entry) => entry.name === "api").length, 2);
    assert.equal(registry.filter((entry) => entry.name === "socket").length, 2);
    assert.equal(registry.find((entry) => entry.name === "privateService")?.scope, "server");
    assert.equal(registry.find((entry) => entry.name === "layerGreeting")?.scope, "client");
    assert.equal(discoverAutoImportsSync(root).find((entry) => entry.name === "layerGreeting")?.scope, "client");
    const clientImport = applyAutoImports("const users = api.users.get(); const result = rpc.users.get({ id: '1' });", join(root, "app", "pages", "index.meeko"), registry, "client");
    assert.match(clientImport, /clients\.client\.js/);
    assert.doesNotMatch(clientImport, /clients\.server\.js|server\/services/);
    const serverImport = applyAutoImports("const users = api.users.get(); const service = privateService();", join(root, "server", "entry.ts"), registry, "server");
    assert.match(serverImport, /clients\.server\.js/);
    assert.match(serverImport, /privateService/);
    assert.throws(() => applyAutoImports("privateService()", join(root, "app", "entry-client.ts"), registry, "client"), /unavailable in client scope/);
    const clientFile = await readFile(join(root, ".meeko/generated/clients.client.ts"), "utf8");
    assert.doesNotMatch(clientFile, /@meekojs\/meeko\/server|server\/api|server\/rpc|server\/services/);
    assert.match(await readFile(join(root, ".meeko/generated/clients.server.ts"), "utf8"), /createServerClientOptions/);
    assert.match(clientFile, /socketContracts|createSocketRegistry|useSocketChannel/);
    const types = await generateAutoImportTypes(root);
    assert.match(await readFile(types.client, "utf8"), /const api:/);
    assert.match(await readFile(types.server, "utf8"), /const rpc:/);
    const clientsFile = join(root, ".meeko/generated/clients.client.ts");
    const before = [(await stat(clientsFile)).mtimeMs, (await stat(types.client)).mtimeMs];
    await generateServerContracts(root);
    await generateAutoImportTypes(root);
    assert.deepEqual([(await stat(clientsFile)).mtimeMs, (await stat(types.client)).mtimeMs], before);
    await writeFile(join(root, "app", "feature.ts"), `
const users: Promise<{ id: string }> = api.users.get();
const user: Promise<{ id: string }> = rpc.users.get({ id: "1" });
const chat = useSocket("chat");
chat.on("message", (message) => { const id: string = message.id; void id; });
void chat.emit("message", { id: "1" });
void socket.chat.emit("message", { id: "2" });
void users; void user;
// @ts-expect-error RPC input is inferred from shared schema
rpc.users.get({ id: 1 });
// @ts-expect-error Socket input is inferred from shared schema
socket.chat.emit("message", { id: 1 });
// @ts-expect-error server-only symbol is unavailable to app code
privateService();
`);
    await writeFile(join(root, "tsconfig.app.json"), JSON.stringify({ compilerOptions: {
      target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, skipLibCheck: true,
    }, include: ["app/feature.ts", ".meeko/types/autoimports/client.d.ts"] }));
    await execFileAsync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", join(root, "tsconfig.app.json")]);
    const duplicate = join(root, "app", "utils", "duplicate.ts");
    await mkdir(dirname(duplicate), { recursive: true });
    await writeFile(duplicate, `export const layerGreeting = () => "collision";`);
    await assert.rejects(generateAutoImportTypes(root), /Ambiguous autoimport layerGreeting/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("automatic SSR clients bind headers and local dispatch independently for concurrent requests", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const manifest = {
    api: [{ clientKey: "users", pathname: "/api/users", method: "GET" as const }],
    rpc: [{ id: "users.get", pathname: "/_meeko/rpc/users/get" }],
  };
  const options = createServerClientOptions();
  const api = createApiClient<{ users: { get: { params: undefined; query: undefined; body: undefined; output: { cookie: string } } } }>(manifest, options);
  const rpc = createRpcClient<{ "users.get": { input: { id: string }; output: { cookie: string } } }>(manifest, options);
  const seen: Array<{ cookie: string | null; requestId: string; pathname: string; origin: string | null }> = [];
  const run = async (user: string) => {
    const request = new Request(`https://meeko.test/dashboard?user=${user}`, { headers: {
      cookie: `meeko.sid=${user}`, authorization: `Bearer ${user}`, origin: "https://meeko.test", "x-meeko-csrf": user,
    } });
    const session = await sessions.load(request);
    const context = createRequestContext(request, { user }, session);
    return withRequestContext(context, async (incoming, active) => {
      await new Promise((resolve) => setTimeout(resolve, user === "alice" ? 8 : 1));
      seen.push({ cookie: incoming.headers.get("cookie"), requestId: active.requestId, pathname: new URL(incoming.url).pathname, origin: incoming.headers.get("origin") });
      return Response.json({ cookie: incoming.headers.get("cookie") });
    }, async () => {
      const users = await api.users.get();
      const result = await rpc.users.get({ id: user });
      return { users, result, requestId: context.requestId };
    });
  };
  const [alice, bob] = await Promise.all([run("alice"), run("bob")]);
  assert.deepEqual(alice.users, { cookie: "meeko.sid=alice" });
  assert.deepEqual(alice.result, { cookie: "meeko.sid=alice" });
  assert.deepEqual(bob.users, { cookie: "meeko.sid=bob" });
  assert.deepEqual(bob.result, { cookie: "meeko.sid=bob" });
  assert.notEqual(alice.requestId, bob.requestId);
  assert.equal(seen.length, 4);
  assert.ok(seen.every((entry) => entry.origin === "https://meeko.test"));
  assert.deepEqual(new Set(seen.map((entry) => entry.pathname)), new Set(["/api/users", "/_meeko/rpc/users/get"]));
  await assert.rejects(api.users.get(), /active Meeko request context/);
});

test("browser automatic clients use the current CSRF meta token for authenticated mutations", async () => {
  const previous = globalThis.document;
  const previousFetch = globalThis.fetch;
  const window = new Window({ url: "https://meeko.test/" });
  globalThis.document = window.document as unknown as Document;
  try {
    window.document.head.innerHTML = '<meta name="meeko-csrf-token" content="first">';
    const tokens: Array<string | null> = [];
    globalThis.fetch = async (_input, init) => {
      tokens.push(new Headers(init?.headers).get("x-meeko-csrf"));
      return Response.json("pong", { headers: { "x-meeko-csrf-token": "second" } });
    };
    const rpc = createRpcClient<{ ping: { input: string; output: string } }>({ rpc: [{ id: "ping", pathname: "/_meeko/rpc/ping" }] }, createBrowserClientOptions());
    assert.equal(await rpc.ping("first"), "pong");
    assert.equal(window.document.querySelector('meta[name="meeko-csrf-token"]')?.getAttribute("content"), "second");
    assert.equal(await rpc.ping("second"), "pong");
    assert.deepEqual(tokens, ["first", "second"]);
  } finally {
    globalThis.document = previous;
    globalThis.fetch = previousFetch;
    await window.happyDOM.close();
  }
});

test("in-process automatic clients use the HTTP contract pipeline and original SSR session", async () => {
  const stringSchema: Schema<string> = { "~standard": { version: 1, validate(value) {
    return typeof value === "string" ? { value } : { issues: [{}] };
  } } };
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const anonymous = await sessions.load(new Request("https://meeko.test/"));
  const record = await anonymous.create({ user: "alice" });
  const source = new Request("https://meeko.test/dashboard", { headers: {
    cookie: `meeko.sid=${record.id}`,
  } });
  const context = createRequestContext(source, { owner: "alice" }, await sessions.load(source));
  const manifest: ServerManifest = {
    api: [{ kind: "api", file: "api.ts", pathname: "/api/users", clientKey: "users", method: "POST" }],
    rpc: [{ kind: "rpc", file: "rpc.ts", pathname: "/_meeko/rpc/users/get", id: "users.get" }],
  };
  const modules = new Map<string, unknown>([
    ["api.ts", { default: defineApiRoute({ body: stringSchema, response: stringSchema, auth: "required", handler: ({ body, context: current }) => {
      assert.equal(current.requestId, context.requestId);
      assert.equal(current.services, context.services);
      assert.equal(current.state, context.state);
      return body;
    } }) }],
    ["rpc.ts", { default: defineRpc({ input: stringSchema, output: stringSchema, auth: "required", handler: ({ input }) => input }) }],
  ]);
  const serverFetch = createLocalServerFetch({ manifest, sessions, load: async (file) => modules.get(file) });
  const options = createServerClientOptions();
  const api = createApiClient<{ users: { post: { params: undefined; query: undefined; body: string; output: string } } }>(manifest, options);
  const rpc = createRpcClient<{ "users.get": { input: string; output: string } }>(manifest, options);
  await withRequestContext(context, serverFetch, async () => {
    assert.equal(await api.users.post({ body: "ok" }), "ok");
    assert.equal(await rpc.users.get("rpc"), "rpc");
    await assert.rejects(api.users.post({ body: 42 as never }), (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_BODY");
  });
  const validHeaders = new Headers(source.headers);
  validHeaders.set("content-type", "application/json");
  validHeaders.set("origin", "https://meeko.test");
  validHeaders.set("x-meeko-csrf", record.csrfToken);
  const valid = new Request("https://meeko.test/api/users", { method: "POST", headers: validHeaders, body: JSON.stringify("ok") });
  assert.equal((await serverFetch(valid, context)).headers.get("x-meeko-csrf-token"), record.csrfToken);
  const forged = new Request("https://meeko.test/api/users", { method: "POST", headers: { cookie: "meeko.sid=forged" }, body: JSON.stringify("x") });
  assert.equal((await serverFetch(forged, context)).status, 403);
});

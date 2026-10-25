import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  createCloudflareAssetReader, createCloudflarePrerenderSource, createWorker, D1SessionDriver, DurableObjectSocketPubSub, socketRoomName,
} from "../src/cloudflare.ts";
import type { CloudflareExecutionContext, D1DatabaseLike, D1PreparedStatementLike, DurableObjectNamespaceLike } from "../src/cloudflare.ts";
import { createServerApp, defineServerRuntime, defineSocketChannel, MemorySessionStore, SessionManager, SqlSessionStore } from "../src/framework-server.ts";
import type { AppManifest, Schema, ServerApp, SocketMessage } from "../src/framework-server.ts";
import { assertBuildAdapter } from "../src/framework/project.ts";
import { cloudflareCompatibilityDate, wranglerConfig } from "../src/framework/cloudflare-build.ts";

/** D1's prepared statement surface over node:sqlite, enough for the session driver. */
function sqliteD1(database = new DatabaseSync(":memory:")): D1DatabaseLike & { readonly sqlite: DatabaseSync } {
  const statement = (query: string, values: unknown[] = []): D1PreparedStatementLike => ({
    bind: (...next: unknown[]) => statement(query, next),
    async first<T>() { return (database.prepare(query).get(...values as never[]) ?? null) as T | null; },
    async run() {
      const result = database.prepare(query).run(...values as never[]);
      return { success: true, meta: { changes: Number(result.changes) } };
    },
  });
  return { sqlite: database, prepare: (query) => statement(query) };
}

function record(id: string, familyId: string, expiresAt = Date.now() + 60_000) {
  return { id, familyId, csrfToken: `csrf-${id}`, data: { user: id }, createdAt: Date.now(), expiresAt };
}

test("D1SessionDriver stores, rotates atomically and revokes a family", async () => {
  const db = sqliteD1();
  db.sqlite.exec(D1SessionDriver.schema("app_sessions"));
  const store = new SqlSessionStore(new D1SessionDriver(db, { table: "app_sessions" }));
  await store.set(record("a", "f1"));
  assert.equal((await store.get("a"))?.csrfToken, "csrf-a");
  // One active id per family: a second id in the same family is refused.
  await assert.rejects(store.set(record("b", "f1")));
  // An id never changes family.
  await assert.rejects(store.set(record("a", "f2")), /cannot change family/);
  assert.equal(await store.replace("a", record("b", "f1")), true);
  assert.equal(await store.get("a"), undefined);
  assert.equal((await store.get("b"))?.familyId, "f1");
  // A stale handle cannot rotate twice, nor rotate into another family.
  assert.equal(await store.replace("a", record("c", "f1")), false);
  assert.equal(await store.replace("b", record("c", "other")), false);
  await store.set(record("z", "f2"));
  await store.revokeFamily("f1");
  assert.equal(await store.get("b"), undefined);
  assert.equal((await store.get("z"))?.id, "z");
});

test("D1SessionDriver refuses to rotate an expired session and prunes expired rows", async () => {
  const db = sqliteD1();
  db.sqlite.exec(D1SessionDriver.schema());
  const driver = new D1SessionDriver(db);
  const row = { id: "old", familyId: "f", csrfToken: "t", dataJson: "{}", createdAt: 1, expiresAt: Date.now() - 1 };
  db.sqlite.prepare("INSERT INTO meeko_sessions (id, family_id, csrf_token, data_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(row.id, row.familyId, row.csrfToken, row.dataJson, row.createdAt, row.expiresAt);
  assert.equal(await driver.replace("old", { ...row, id: "new", expiresAt: Date.now() + 1000 }, Date.now()), false);
  assert.equal(await driver.deleteExpired(), 1);
  assert.equal(await driver.read("old"), undefined);
});

test("D1SessionDriver rejects table names that are not plain identifiers", () => {
  assert.throws(() => new D1SessionDriver(sqliteD1(), { table: "x; DROP TABLE y" }), /table/);
  assert.match(D1SessionDriver.schema(), /family_id TEXT NOT NULL UNIQUE/);
});

test("createCloudflareAssetReader serves only manifest files through the ASSETS binding", async () => {
  const fetched: string[] = [];
  const reader = createCloudflareAssetReader({
    binding: { async fetch(request) { fetched.push(new URL(request.url).pathname); return new Response("console.log(1)"); } },
    assets: { "/assets/app.js": { type: "text/javascript; charset=utf-8", etag: "\"e\"", size: 14, immutable: true } },
  });
  const ok = await reader.get("/assets/app.js", new Request("https://example.com/assets/app.js"));
  assert.equal(ok?.status, 200);
  assert.equal(ok?.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(await ok?.text(), "console.log(1)");
  const head = await reader.get("/assets/app.js", new Request("https://example.com/assets/app.js", { method: "HEAD" }));
  assert.equal(await head?.text(), "");
  assert.equal((await reader.get("/assets/app.js", new Request("https://example.com/assets/app.js", { headers: { "if-none-match": "\"e\"" } })))?.status, 304);
  assert.equal(await reader.get("/wrangler.jsonc", new Request("https://example.com/wrangler.jsonc")), null);
  assert.deepEqual(fetched, ["/assets/app.js"]);
});

test("createCloudflarePrerenderSource reads the prerender index from the ASSETS binding", async () => {
  const files: Record<string, string> = {
    "/_meeko/prerender/manifest.json": JSON.stringify({ version: 1, pages: { "/": { file: "index.html", headOffset: 6, etag: "\"p\"" } } }),
    "/_meeko/prerender/index.html": "<head></head>home",
  };
  const source = createCloudflarePrerenderSource({
    binding: { async fetch(request) {
      const body = files[new URL(request.url).pathname];
      return body === undefined ? new Response(null, { status: 404 }) : new Response(body);
    } },
  });
  assert.deepEqual(await source.get("/"), { html: "<head></head>home", headOffset: 6, etag: "\"p\"" });
  assert.equal(await source.get("/missing"), undefined);
  const empty = createCloudflarePrerenderSource({ binding: { fetch: async () => new Response(null, { status: 404 }) } });
  assert.equal(await empty.get("/"), undefined);
});

const text: Schema<{ text: string }> = {
  "~standard": { version: 1, validate: (value) => ({ value: value as { text: string } }) },
};

const manifest: AppManifest = {
  version: 1, routes: [], routeMiddleware: [], serverMiddleware: [],
  server: { api: [], rpc: [], socket: [{ kind: "socket", name: "room", file: "/server/socket/room.ts", pathname: "/_meeko/socket/room" }] },
  client: { entry: "/assets/entry.js", css: [], preload: [] },
};

function context(): CloudflareExecutionContext & { readonly pending: Promise<unknown>[] } {
  const pending: Promise<unknown>[] = [];
  return { pending, waitUntil(promise) { pending.push(promise); } };
}

test("createWorker creates the application once per isolate with Cloudflare bindings", async () => {
  let created = 0;
  let failNext = true;
  const env = { NAME: "binding" };
  const worker = createWorker<typeof env>(async ({ env: bindings, platform }) => {
    created++;
    assert.equal(platform.name, "cloudflare");
    assert.equal(bindings, env);
    if (failNext) { failNext = false; throw new Error("startup failed"); }
    return {
      manifest, reportError() {}, async close() {},
      async fetch(request, requestPlatform) {
        requestPlatform?.waitUntil(Promise.resolve("background"));
        return Response.json({ url: request.url, platform: requestPlatform?.name, env: (requestPlatform?.env as typeof env).NAME });
      },
    } satisfies ServerApp;
  });
  const failed = await worker.fetch(new Request("https://example.com/"), env, context());
  assert.equal(failed.status, 500);
  const ctx = context();
  const response = await worker.fetch(new Request("https://example.com/a"), env, ctx);
  assert.deepEqual(await response.json(), { url: "https://example.com/a", platform: "cloudflare", env: "binding" });
  assert.equal(ctx.pending.length, 1);
  await worker.fetch(new Request("https://example.com/b"), env, context());
  assert.equal(created, 2);
});

function namespace(): DurableObjectNamespaceLike & { readonly calls: Array<{ name: string; kind: string; detail?: unknown }> } {
  const calls: Array<{ name: string; kind: string; detail?: unknown }> = [];
  return {
    calls,
    idFromName: (name) => ({ name, toString: () => `id:${name}` }),
    get: (id) => ({
      async fetch(request: Request) {
        calls.push({ name: id.name!, kind: "fetch", detail: { url: request.url, upgrade: request.headers.get("upgrade") } });
        return new Response(null, { status: 200, headers: { "x-room": "yes" } });
      },
      async meekoPublish(channel: string, room: string, message: SocketMessage) {
        calls.push({ name: id.name!, kind: "publish", detail: { channel, room, message } });
      },
    }),
  };
}

test("createWorker checks Socket upgrades and forwards them to the room Durable Object", async () => {
  const rooms = namespace();
  const env = { MEEKO_SOCKET: rooms };
  const worker = createWorker<typeof env>(({ env: bindings, platform }) => createServerApp({
    manifest, production: false, platform,
    defaultSocketPubSub: new DurableObjectSocketPubSub(bindings.MEEKO_SOCKET),
    load: async () => ({ default: defineSocketChannel({ clientToServer: { say: text }, serverToClient: { said: text } }) }),
  }));
  const upgrade = (path: string, origin: string) => new Request(`https://example.com${path}`, { headers: { upgrade: "websocket", origin } });
  assert.equal((await worker.fetch(upgrade("/_meeko/socket/room?room=a", "https://evil.test"), env, context())).status, 403);
  assert.equal((await worker.fetch(upgrade("/_meeko/socket/bad.name", "https://example.com"), env, context())).status, 400);
  assert.equal(rooms.calls.length, 0);
  const forwarded = await worker.fetch(upgrade("/_meeko/socket/room?room=a", "https://example.com"), env, context());
  assert.equal(forwarded.headers.get("x-room"), "yes");
  assert.deepEqual(rooms.calls, [{ name: socketRoomName("room", "a"), kind: "fetch", detail: { url: "https://example.com/_meeko/socket/room?room=a", upgrade: "websocket" } }]);
  assert.equal(socketRoomName("room", "a"), "room\0a");
});

test("DurableObjectSocketPubSub publishes through the room's RPC and subscribes only inside a room", async () => {
  const rooms = namespace();
  const pubsub = new DurableObjectSocketPubSub(rooms);
  await pubsub.publish("room", "lobby", { event: "said", payload: { text: "hi" } });
  assert.deepEqual(rooms.calls, [{ name: "room\0lobby", kind: "publish", detail: { channel: "room", room: "lobby", message: { event: "said", payload: { text: "hi" } } } }]);
  assert.throws(() => pubsub.subscribe("room", "lobby", () => {}), /Durable Object/);
});

test("the default Socket broker is replaced by the runtime's own broker", async () => {
  const rooms = namespace();
  const published: string[] = [];
  const app = await createServerApp({
    manifest, production: false,
    defaultSocketPubSub: new DurableObjectSocketPubSub(rooms),
    runtime: defineServerRuntime(() => ({
      sessions: new SessionManager({ store: new MemorySessionStore(), production: false }),
      socket: { pubsub: { async publish(channel) { published.push(channel); }, subscribe: () => () => {} } },
    })),
    load: async () => ({ default: defineSocketChannel({ clientToServer: { say: text }, serverToClient: { said: text } }) }),
  });
  await app.socket!.hub.broadcast("room", "a", "said", { text: "x" });
  assert.deepEqual(published, ["room"]);
  assert.equal(rooms.calls.length, 0);
});

test("the cloudflare adapter can be built", () => {
  assert.equal(assertBuildAdapter("cloudflare"), "cloudflare");
});

test("wranglerConfig owns the Worker bundle and assets and combines the application's fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-wrangler-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "@acme/Shop App" }), "utf8");
    const config = await wranglerConfig(root, {
      adapter: "cloudflare",
      wrangler: {
        compatibility_flags: ["nodejs_compat", "nodejs_als"],
        durable_objects: { bindings: [{ name: "COUNTER", class_name: "Counter" }] },
        migrations: [{ tag: "app-v1", new_sqlite_classes: ["Counter"] }],
        vars: { PUBLIC_ORIGIN: "https://shop.example" },
      },
    });
    assert.equal(config.name, "shop-app");
    assert.equal(config.main, "./worker.js");
    assert.equal(config.no_bundle, true);
    // Files next to worker.js (the assets) are never uploaded as extra modules.
    assert.equal(config.find_additional_modules, false);
    assert.equal(config.compatibility_date, cloudflareCompatibilityDate);
    assert.deepEqual(config.compatibility_flags, ["nodejs_als", "nodejs_compat"]);
    assert.deepEqual(config.assets, { directory: "./assets", binding: "ASSETS", run_worker_first: true, html_handling: "none", not_found_handling: "none" });
    assert.deepEqual(config.durable_objects, { bindings: [{ name: "MEEKO_SOCKET", class_name: "MeekoSocketRoom" }, { name: "COUNTER", class_name: "Counter" }] });
    assert.deepEqual(config.migrations, [{ tag: "meeko-socket-v1", new_sqlite_classes: ["MeekoSocketRoom"] }, { tag: "app-v1", new_sqlite_classes: ["Counter"] }]);
    assert.deepEqual(config.vars, { PUBLIC_ORIGIN: "https://shop.example" });
    // A migration history that already declares the room class is kept as is.
    const declared = await wranglerConfig(root, { adapter: "cloudflare", name: "shop", socketClassName: "Rooms", wrangler: { migrations: [{ tag: "v1", new_classes: ["Rooms"] }] } });
    assert.deepEqual(declared.migrations, [{ tag: "v1", new_classes: ["Rooms"] }]);
    for (const field of ["main", "assets", "no_bundle", "find_additional_modules"]) {
      await assert.rejects(wranglerConfig(root, { adapter: "cloudflare", wrangler: { [field]: true } }), new RegExp(`server\.wrangler\.${field} is generated by Meeko`));
    }
    await assert.rejects(
      wranglerConfig(root, { adapter: "cloudflare", wrangler: { durable_objects: { bindings: [{ name: "MEEKO_SOCKET", class_name: "Other" }] } } }),
      /cannot redefine MEEKO_SOCKET/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

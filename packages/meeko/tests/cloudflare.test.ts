import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  createCloudflareAssetReader, createCloudflarePrerenderSource, createSocketRoomClass, createWorker, D1SessionDriver, DurableObjectSocketPubSub, socketRoomName,
} from "../src/cloudflare.ts";
import type {
  CloudflareExecutionContext, CloudflareWebSocket, D1DatabaseLike, D1PreparedStatementLike, DurableObjectNamespaceLike, DurableObjectStateLike,
  MeekoSocketRoom, SocketRoomOptions,
} from "../src/cloudflare.ts";
import {
  createServerApp, defineServerRuntime, defineSocketChannel, LocalSocketPubSub, MemorySessionStore, SessionManager, SqlSessionStore,
} from "../src/framework-server.ts";
import type { AppManifest, Schema, ServerApp, SocketMessage, SocketPubSub } from "../src/framework-server.ts";
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

test("D1 sessions keep their own TTL across rotation without a schema change", async () => {
  const db = sqliteD1();
  db.sqlite.exec(D1SessionDriver.schema());
  const manager = new SessionManager({ store: new SqlSessionStore<{ user: string }>(new D1SessionDriver(db)), production: true, secure: false });
  const handle = await manager.load(new Request("http://localhost/"));
  const created = await handle.create({ user: "staff" }, { ttlMs: 12 * 60 * 60 * 1000 });
  const loaded = await manager.load(new Request("http://localhost/", { headers: { cookie: `${manager.cookieName}=${created.id}` } }));
  const rotated = await loaded.rotate();
  assert.equal(rotated.expiresAt - rotated.createdAt, 12 * 60 * 60 * 1000);
  assert.match(loaded.cookieHeader ?? "", /Max-Age=43200(;|$)/);
  const row = db.sqlite.prepare("SELECT created_at, expires_at FROM meeko_sessions WHERE id = ?").get(rotated.id) as { created_at: number; expires_at: number };
  assert.equal(row.expires_at - row.created_at, 12 * 60 * 60 * 1000);
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

test("createWorker closes Socket auth refusals with 4401/4403 without waking the room", async () => {
  await withWorkersGlobals(async () => {
    const servers: FakeSocket[] = [];
    (globalThis as Record<string, unknown>).WebSocketPair = class {
      0 = new FakeSocket();
      1 = new FakeSocket();
      constructor() { servers.push(this[1]); }
    };
    for (const [policy, code, reason] of [
      [{ auth: "required" as const }, 4401, "Autenticación requerida"],
      [{ authorize: () => false }, 4403, "Acceso denegado"],
    ] as const) {
      const rooms = namespace();
      const env = { MEEKO_SOCKET: rooms };
      const worker = createWorker<typeof env>(({ env: bindings, platform }) => createServerApp({
        manifest, production: false, platform,
        defaultSocketPubSub: new DurableObjectSocketPubSub(bindings.MEEKO_SOCKET),
        load: async () => ({ default: defineSocketChannel({ clientToServer: { say: text }, serverToClient: { said: text }, ...policy }) }),
      }));
      const upgrade = (origin: string) => new Request("https://example.com/_meeko/socket/room?room=a", { headers: { upgrade: "websocket", origin } });
      const response = await worker.fetch(upgrade("https://example.com"), env, context()) as Response & { webSocket?: FakeSocket };
      assert.equal(response.status, 101);
      assert.ok(response.webSocket instanceof FakeSocket);
      assert.deepEqual(servers.at(-1)?.closed, { code, reason });
      // A foreign Origin keeps its HTTP refusal and never upgrades.
      const pairs = servers.length;
      assert.equal((await worker.fetch(upgrade("https://evil.test"), env, context())).status, 403);
      assert.equal(servers.length, pairs);
      assert.equal(rooms.calls.length, 0, "the room's Durable Object is never woken");
    }
  });
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
    // Without a migration history of its own, the Worker gets Meeko's.
    assert.deepEqual(config.migrations, [{ tag: "meeko-socket-v1", new_sqlite_classes: ["MeekoSocketRoom"] }]);
    assert.equal("exports" in config, false);
    assert.deepEqual(config.vars, { PUBLIC_ORIGIN: "https://shop.example" });
    // A migration history that already declares the room class is kept as is.
    const declared = await wranglerConfig(root, { adapter: "cloudflare", name: "shop", socketClassName: "Rooms", wrangler: { migrations: [{ tag: "v1", new_classes: ["Rooms"] }] } });
    assert.deepEqual(declared.migrations, [{ tag: "v1", new_classes: ["Rooms"] }]);
    const renamed = [{ tag: "v1", new_sqlite_classes: ["Chat"] }, { tag: "v2", renamed_classes: [{ from: "Chat", to: "MeekoSocketRoom" }] }];
    assert.deepEqual((await wranglerConfig(root, { adapter: "cloudflare", wrangler: { migrations: renamed } })).migrations, renamed);
    for (const field of ["main", "assets", "no_bundle", "find_additional_modules"]) {
      await assert.rejects(wranglerConfig(root, { adapter: "cloudflare", wrangler: { [field]: true } }), new RegExp(`server\\.wrangler\\.${field} is generated by Meeko`));
    }
    await assert.rejects(
      wranglerConfig(root, { adapter: "cloudflare", wrangler: { durable_objects: { bindings: [{ name: "MEEKO_SOCKET", class_name: "Other" }] } } }),
      /cannot redefine MEEKO_SOCKET/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("wranglerConfig never rewrites an existing Durable Object migration history", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-wrangler-"));
  try {
    // Migrations are applied in order and recorded by tag: putting Meeko's
    // before a deployed history would change it, so the build fails instead.
    const history = [{ tag: "app-v1", new_sqlite_classes: ["Counter"] }];
    await assert.rejects(
      wranglerConfig(root, { adapter: "cloudflare", wrangler: { migrations: history } }),
      (error: Error) => {
        assert.match(error.message, /server\.wrangler\.migrations does not create the Socket room class MeekoSocketRoom/);
        assert.match(error.message, /append \{ "tag": "meeko-socket-v1", "new_sqlite_classes": \["MeekoSocketRoom"\] \}/);
        return true;
      },
    );
    assert.deepEqual(history, [{ tag: "app-v1", new_sqlite_classes: ["Counter"] }]);
    // The declarative exports flow replaces migrations: the class is declared there instead.
    const exported = await wranglerConfig(root, { adapter: "cloudflare", wrangler: { exports: { Counter: { type: "durable-object", storage: "sqlite" } } } });
    assert.equal("migrations" in exported, false);
    assert.deepEqual(exported.exports, {
      Counter: { type: "durable-object", storage: "sqlite" },
      MeekoSocketRoom: { type: "durable-object", storage: "sqlite" },
    });
    const own = { MeekoSocketRoom: { type: "durable-object", storage: "legacy-kv" } };
    assert.deepEqual((await wranglerConfig(root, { adapter: "cloudflare", wrangler: { exports: own } })).exports, own);
    await assert.rejects(
      wranglerConfig(root, { adapter: "cloudflare", wrangler: { exports: { MeekoSocketRoom: { type: "durable-object", state: "deleted" } } } }),
      /exports\.MeekoSocketRoom must be a live Durable Object entry/,
    );
    await assert.rejects(
      wranglerConfig(root, { adapter: "cloudflare", wrangler: { exports: { Counter: { type: "durable-object", storage: "sqlite" } }, migrations: history } }),
      /cannot combine Durable Object exports with migrations/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/** Server side of a hibernatable WebSocket, with the 16,384-byte attachment limit. */
class FakeSocket implements CloudflareWebSocket {
  readyState = 1;
  readonly sent: string[] = [];
  closed: { code: number | undefined; reason: string | undefined } | undefined;
  attachment: unknown = null;
  send(message: string): void {
    if (this.readyState !== 1) throw new Error("closed");
    this.sent.push(message);
  }
  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closed = { code, reason };
  }
  serializeAttachment(value: unknown): void {
    if (JSON.stringify(value).length > 16_384) throw new Error("WebSocket attachment too large");
    this.attachment = structuredClone(value);
  }
  deserializeAttachment(): unknown { return this.attachment; }
  received(): unknown[] { return this.sent.map((message) => JSON.parse(message) as unknown); }
}

type FakeRoomState = DurableObjectStateLike & { readonly sockets: FakeSocket[]; readonly pending: Promise<unknown>[] };

function roomState(name: string | undefined, sockets: FakeSocket[] = []): FakeRoomState {
  const pending: Promise<unknown>[] = [];
  return {
    sockets, pending,
    id: { ...(name === undefined ? {} : { name }), toString: () => "room-id" },
    acceptWebSocket(socket) { sockets.push(socket as FakeSocket); },
    getWebSockets: () => sockets.filter((socket) => socket.readyState <= 1),
    waitUntil(promise) { pending.push(promise.catch(() => undefined)); },
  };
}

/** WebSocketPair and a Response that accepts status 101, as in workerd. */
async function withWorkersGlobals(run: () => Promise<void>): Promise<void> {
  const globals = globalThis as Record<string, unknown>;
  const NativeResponse = globalThis.Response;
  globals.WebSocketPair = class { 0 = new FakeSocket(); 1 = new FakeSocket(); };
  globals.Response = new Proxy(NativeResponse, {
    construct(target, args: [BodyInit | null, (ResponseInit & { webSocket?: unknown })?], newTarget) {
      const init = args[1];
      if (init?.status === 101) return { status: 101, webSocket: init.webSocket, headers: new Headers() } as unknown as object;
      return Reflect.construct(target, args, newTarget) as object;
    },
  });
  try { await run(); }
  finally {
    globals.Response = NativeResponse;
    delete globals.WebSocketPair;
  }
}

class FakeDurableObject {
  constructor(readonly ctx: DurableObjectStateLike, readonly env: unknown) {}
}

const settle = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));
const said = (value: string) => ({ event: "said", payload: { text: value } });

function gate(): { readonly wait: Promise<void>; open(): void } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => { open = resolve; });
  return { wait, open };
}

interface SocketRoomFixture {
  readonly name?: string | undefined;
  readonly sockets?: FakeSocket[];
  readonly room?: SocketRoomOptions;
  readonly slow?: Promise<void>;
}

/**
 * A Socket room over fakes: the `room` channel's `say` publishes to its own
 * room, and connections with `authorization: slow` wait for `slow` to open.
 */
function socketRoom(options: SocketRoomFixture = {}) {
  const rooms = namespace();
  const reported: unknown[] = [];
  const RoomClass = createSocketRoomClass<Record<string, unknown>>(({ platform }) => {
    const pubsub: SocketPubSub = new DurableObjectSocketPubSub(rooms);
    return createServerApp({
      manifest, production: false, platform,
      runtime: defineServerRuntime(() => ({
        sessions: new SessionManager({ store: new MemorySessionStore(), production: false, secure: false }),
        socket: { pubsub },
      })),
      load: async () => ({ default: defineSocketChannel({
        clientToServer: { say: text }, serverToClient: { said: text },
        authorize: async ({ context }) => {
          if (context.request.headers.get("authorization") === "slow") await options.slow;
          return true;
        },
        handlers: { say: async ({ payload, roomId }) => { await pubsub.publish("room", roomId ?? "", { event: "said", payload }); } },
      }) }),
    });
  }, FakeDurableObject, { ...options.room, onError: (error) => { reported.push(error); } });
  const ctx = roomState("name" in options ? options.name : socketRoomName("room", "lobby"), options.sockets);
  const room: MeekoSocketRoom = new RoomClass(ctx, {});
  const connect = async (headers: Record<string, string> = {}): Promise<FakeSocket> => {
    const before = ctx.sockets.length;
    const response = await room.fetch(new Request("https://example.com/_meeko/socket/room?room=lobby", {
      headers: { upgrade: "websocket", origin: "https://example.com", ...headers },
    }));
    assert.equal(response.status, 101);
    assert.equal(ctx.sockets.length, before + 1);
    return ctx.sockets[before]!;
  };
  return { room, ctx, rooms, reported, connect };
}

/** A WebSocket of a hibernated room, rebuilt from its attachment when the room wakes. */
function hibernated(headers: Record<string, string> = {}): FakeSocket {
  const socket = new FakeSocket();
  socket.serializeAttachment({ v: 1, name: "room", room: "lobby", url: "https://example.com/_meeko/socket/room?room=lobby", headers: { origin: "https://example.com", ...headers } });
  return socket;
}

test("Socket rooms keep only the session cookie with each connection", async () => {
  await withWorkersGlobals(async () => {
    const { connect, reported } = socketRoom();
    // Other cookies of the site would not fit in the 16 KiB attachment.
    const crowded = `${Array.from({ length: 40 }, (_, index) => `pref${index}=${"x".repeat(500)}`).join("; ")}; meeko.sid=abc; theme=dark`;
    const socket = await connect({ cookie: crowded, "x-team": "red" });
    assert.equal(socket.closed, undefined);
    assert.deepEqual(socket.attachment, {
      v: 1, name: "room", room: "lobby", url: "https://example.com/_meeko/socket/room?room=lobby",
      headers: { origin: "https://example.com", cookie: "meeko.sid=abc" },
    });
    assert.deepEqual(reported, []);
  });
});

test("SocketRoomOptions.keepHeaders keeps extra headers and refuses state over the attachment limit before accepting", async () => {
  assert.throws(() => createSocketRoomClass(() => { throw new Error("unused"); }, FakeDurableObject, { keepHeaders: ["X-Team"] }), /lowercase header names/);
  await withWorkersGlobals(async () => {
    const { connect, ctx, room, reported } = socketRoom({ room: { keepHeaders: ["cookie", "x-team"] } });
    const socket = await connect({ cookie: "meeko.sid=abc; theme=dark", "x-team": "red" });
    assert.deepEqual((socket.attachment as { headers: unknown }).headers, { origin: "https://example.com", "x-team": "red", cookie: "meeko.sid=abc; theme=dark" });
    const refused = await room.fetch(new Request("https://example.com/_meeko/socket/room?room=lobby", {
      headers: { upgrade: "websocket", origin: "https://example.com", cookie: `meeko.sid=abc; big=${"x".repeat(17_000)}` },
    }));
    assert.equal(refused.status, 431);
    assert.equal(ctx.sockets.length, 1, "the oversized connection was never accepted");
    assert.match(String(reported[0]), /16384-byte limit of a Durable Object WebSocket attachment.*keepHeaders/);
  });
});

test("a slow authorization does not hold the room's publications", async () => {
  await withWorkersGlobals(async () => {
    const slow = gate();
    const { connect, room } = socketRoom({ slow: slow.wait });
    const fast = await connect();
    await settle();
    const pending = await connect({ authorization: "slow" });
    await room.meekoPublish("room", "lobby", said("first"));
    await settle();
    assert.deepEqual(fast.received(), [said("first")]);
    assert.deepEqual(pending.received(), []);
    slow.open();
    await settle();
    await room.meekoPublish("room", "lobby", said("second"));
    await settle();
    assert.deepEqual(fast.received(), [said("first"), said("second")]);
    // A connection receives the publications made after its authorization.
    assert.deepEqual(pending.received(), [said("second")]);
  });
});

test("a woken room bounds its pending publications and waits for rebuilt connections only up to a timeout", async () => {
  await withWorkersGlobals(async () => {
    const slow = gate();
    const fast = hibernated();
    const late = hibernated({ authorization: "slow" });
    const { room } = socketRoom({ sockets: [fast, late], slow: slow.wait, room: { maxPendingPublications: 2, rebuildTimeoutMs: 100 } });
    await room.meekoPublish("room", "lobby", said("one"));
    await room.meekoPublish("room", "lobby", said("two"));
    await assert.rejects(room.meekoPublish("room", "lobby", said("three")), (error: Error & { code?: string; status?: number }) => {
      assert.equal(error.code, "SOCKET_BACKLOG_EXCEEDED");
      assert.equal(error.status, 503);
      return true;
    });
    await settle(30);
    // Rebuilt connections are waited for, so a woken room keeps its own broadcasts in order.
    assert.deepEqual(fast.received(), []);
    await settle(150);
    assert.deepEqual(fast.received(), [said("one"), said("two")]);
    assert.deepEqual(late.received(), []);
    slow.open();
    await settle();
    await room.meekoPublish("room", "lobby", said("four"));
    await settle();
    assert.deepEqual(fast.received(), [said("one"), said("two"), said("four")]);
    assert.deepEqual(late.received(), [said("four")]);
  });
});

test("a room without ctx.id.name learns its name and publishes to itself without RPC", async () => {
  await withWorkersGlobals(async () => {
    // Durable Object names over 1,024 bytes leave ctx.id.name undefined.
    const { connect, room, rooms } = socketRoom({ name: undefined });
    const first = await connect();
    const second = await connect();
    await settle();
    await room.webSocketMessage(first, JSON.stringify({ event: "say", payload: { text: "own room" } }));
    await settle();
    assert.deepEqual(rooms.calls, []);
    assert.deepEqual(first.received(), [said("own room")]);
    assert.deepEqual(second.received(), [said("own room")]);
    const other = await room.fetch(new Request("https://example.com/_meeko/socket/room?room=elsewhere", { headers: { upgrade: "websocket", origin: "https://example.com" } }));
    assert.equal(other.status, 400);
    await assert.rejects(room.meekoPublish("room", "elsewhere", said("lost")), /another room/);
  });
});

test("a room that cannot start closes the WebSocket that woke it", async () => {
  await withWorkersGlobals(async () => {
    const reported: unknown[] = [];
    const RoomClass = createSocketRoomClass(() => { throw new Error("bindings missing"); }, FakeDurableObject, { onError: (error) => { reported.push(error); } });
    const socket = hibernated();
    const room = new RoomClass(roomState(socketRoomName("room", "lobby"), [socket]), {});
    await room.webSocketMessage(socket, JSON.stringify({ event: "say", payload: { text: "hi" } }));
    assert.equal(socket.closed?.code, 1011);
    assert.match(String(reported[0]), /bindings missing/);
  });
});

test("createWorker refuses Socket brokers that cannot reach Durable Object rooms", async () => {
  const reported: unknown[] = [];
  const env = { MEEKO_SOCKET: namespace() };
  const worker = createWorker<typeof env>(({ env: bindings, platform }) => createServerApp({
    manifest, production: false, platform,
    defaultSocketPubSub: new DurableObjectSocketPubSub(bindings.MEEKO_SOCKET),
    runtime: defineServerRuntime(() => ({
      sessions: new SessionManager({ store: new MemorySessionStore(), production: false }),
      socket: { pubsub: new LocalSocketPubSub() },
    })),
    load: async () => ({ default: defineSocketChannel({ clientToServer: { say: text }, serverToClient: { said: text } }) }),
  }), { onError: (error) => { reported.push(error); } });
  const response = await worker.fetch(new Request("https://example.com/"), env, context());
  assert.equal(response.status, 500);
  assert.match(String(reported[0]), /require DurableObjectSocketPubSub/);
});

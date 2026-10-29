import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiError, createServerApp, createServerSocketRegistry, createSocketHub, defineApiRoute, defineServerRuntime, defineSocketChannel,
  LocalSocketPubSub, MemorySessionStore, SessionManager,
} from "../src/framework-server.ts";
import type { AppManifest, Schema, SocketMessage, SocketPeer, SocketPubSub } from "../src/framework-server.ts";
import { resetEnvWarnings } from "../src/framework-server/env.ts";

function object<T>(check: (value: Record<string, unknown>) => boolean): Schema<T> {
  return { "~standard": { version: 1, validate(value) {
    return value !== null && typeof value === "object" && check(value as Record<string, unknown>) ? { value: value as T } : { issues: [{ message: "Invalid value" }] };
  } } };
}

const kitchenChanged = object<{ orderId: string; status: "ready" | "cooking" }>((value) => typeof value.orderId === "string" && (value.status === "ready" || value.status === "cooking"));
const relay = object<{ room: string; orderId: string }>((value) => typeof value.room === "string" && typeof value.orderId === "string");
const ready = object<{ room: string; orderId: string; background?: boolean }>((value) => typeof value.room === "string" && typeof value.orderId === "string");
const done = object<{ ok: true }>((value) => value.ok === true);

/** The public contracts, as `.meeko/generated/socket-contracts.ts` emits them. */
const socketContracts = {
  kitchen: { clientToServer: { relay }, serverToClient: { kitchenChanged } },
} as const;

function peer() {
  const sent: unknown[] = [];
  const socket: SocketPeer = { send(message) { sent.push(JSON.parse(message)); }, close() {}, bufferedAmount: 0 };
  return { socket, sent };
}

/** Records every accepted publication before the local broker delivers it. */
class RecordingPubSub implements SocketPubSub {
  readonly published: { channel: string; room: string; message: SocketMessage }[] = [];
  private readonly inner = new LocalSocketPubSub();
  async publish(channel: string, room: string, message: SocketMessage): Promise<void> {
    this.published.push({ channel, room, message });
    await this.inner.publish(channel, room, message);
  }
  subscribe(channel: string, room: string, listener: (message: SocketMessage) => void | Promise<void>) {
    return this.inner.subscribe(channel, room, listener);
  }
}

test("the server socket registry types broadcast from the channel contracts and keeps client members SSR-only", () => {
  const socket = createServerSocketRegistry(socketContracts);
  assert.deepEqual(Object.keys(socket), ["kitchen"]);
  assert.throws(() => socket.kitchen.on("kitchenChanged", () => {}), /unavailable during SSR/);
  assert.throws(() => socket.kitchen.state, /unavailable during SSR/);
  const typed = async () => {
    await socket.kitchen.broadcast("store-1", "kitchenChanged", { orderId: "A1", status: "ready" });
    // @ts-expect-error the event must be a serverToClient event of the channel
    await socket.kitchen.broadcast("store-1", "relay", { room: "x", orderId: "A1" });
    // @ts-expect-error the payload is typed by the event's schema
    await socket.kitchen.broadcast("store-1", "kitchenChanged", { orderId: "A1", status: "lost" });
    // @ts-expect-error only declared channels exist
    void socket.missing;
  };
  void typed;
});

test("API handlers broadcast through the application hub with the hub's validation and limits", async () => {
  const socket = createServerSocketRegistry(socketContracts);
  const pubsub = new RecordingPubSub();
  const background: Promise<unknown>[] = [];
  const manifest: AppManifest = {
    version: 1,
    routes: [],
    server: {
      api: [{ kind: "api", file: "/server/api/ready.post.ts", pathname: "/api/ready", method: "POST", clientKey: "ready" }],
      rpc: [],
      socket: [{ kind: "socket", file: "/server/socket/kitchen.ts", name: "kitchen", pathname: "/_meeko/socket/kitchen" }],
    },
    routeMiddleware: [],
    serverMiddleware: [],
    client: { entry: "/assets/entry.js", css: [], preload: [] },
  };
  const table: Record<string, unknown> = {
    "/server/socket/kitchen.ts": { default: defineSocketChannel({ clientToServer: { relay }, serverToClient: { kitchenChanged } }) },
    "/server/api/ready.post.ts": { default: defineApiRoute({
      body: ready,
      response: done,
      status: 202,
      handler: async ({ body, context }) => {
        const payload = { orderId: body.orderId, status: "ready" as const };
        if (body.background) {
          // Work registered during the request keeps the request's hub.
          const task = new Promise((resolve) => setTimeout(resolve, 5)).then(() => socket.kitchen.broadcast(body.room, "kitchenChanged", payload));
          background.push(task);
          context.platform.waitUntil(task);
        } else if (body.orderId === "unknown-event") {
          await (socket.kitchen.broadcast as (room: string, event: string, payload: unknown) => Promise<void>)(body.room, "relay", payload);
        } else if (body.orderId === "invalid") {
          await socket.kitchen.broadcast(body.room, "kitchenChanged", { orderId: body.orderId, status: "lost" } as unknown as typeof payload);
        } else {
          await socket.kitchen.broadcast(body.room, "kitchenChanged", payload);
        }
        return { ok: true as const };
      },
    }) },
  };
  const runtime = defineServerRuntime(() => ({
    sessions: new SessionManager({ store: new MemorySessionStore(), secure: false }),
    socket: { pubsub, maxMessageBytes: 200 },
    onError: () => {},
  }));
  const app = await createServerApp({ manifest, production: false, runtime, load: async (key) => table[key] });
  try {
    const post = (body: unknown) => app.fetch(new Request("http://local.test/api/ready", { method: "POST", headers: { "content-type": "application/json", origin: "http://local.test" }, body: JSON.stringify(body) }));
    const accepted = await post({ room: "store-1", orderId: "A1" });
    assert.equal(accepted.status, 202);
    assert.deepEqual(await accepted.json(), { ok: true });
    assert.deepEqual(pubsub.published, [{ channel: "kitchen", room: "store-1", message: { event: "kitchenChanged", payload: { orderId: "A1", status: "ready" } } }]);

    const codeOf = async (response: Response) => ({ status: response.status, code: (await response.json() as { code: string }).code });
    assert.deepEqual(await codeOf(await post({ room: "store-1", orderId: "unknown-event" })), { status: 404, code: "UNKNOWN_SOCKET_EVENT" });
    assert.deepEqual(await codeOf(await post({ room: "store-1", orderId: "invalid" })), { status: 400, code: "INVALID_SOCKET_PAYLOAD" });
    assert.deepEqual(await codeOf(await post({ room: "store-1", orderId: "x".repeat(300) })), { status: 413, code: "SOCKET_LIMIT_EXCEEDED" });
    assert.equal(pubsub.published.length, 1);

    assert.equal((await post({ room: "store-2", orderId: "B2", background: true })).status, 202);
    await Promise.all(background);
    assert.deepEqual(pubsub.published.at(-1), { channel: "kitchen", room: "store-2", message: { event: "kitchenChanged", payload: { orderId: "B2", status: "ready" } } });

    // Outside a request there is no current application, unless the caller names its hub.
    await assert.rejects(socket.kitchen.broadcast("store-1", "kitchenChanged", { orderId: "C3", status: "cooking" }), /requires an active Meeko request or Socket handler/);
    const scheduled = createServerSocketRegistry(socketContracts, { hub: () => app.socket?.hub });
    await scheduled.kitchen.broadcast("store-3", "kitchenChanged", { orderId: "C3", status: "cooking" });
    assert.deepEqual(pubsub.published.at(-1)?.room, "store-3");
  } finally {
    await app.close();
  }
});

test("Socket handlers broadcast to other rooms through their own hub", async () => {
  const socket = createServerSocketRegistry(socketContracts);
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const channel = defineSocketChannel({
    clientToServer: { relay },
    serverToClient: { kitchenChanged },
    handlers: { relay: ({ payload }) => socket.kitchen.broadcast(payload.room, "kitchenChanged", { orderId: payload.orderId, status: "cooking" }) },
  });
  const hub = createSocketHub({ channels: { kitchen: channel }, sessions, services: {} });
  const request = new Request("https://example.test/_meeko/socket/kitchen", { headers: { origin: "https://example.test" } });
  const sender = peer();
  const receiver = peer();
  const connection = await hub.accept("kitchen", request, sender.socket, "store-1");
  await hub.accept("kitchen", request, receiver.socket, "store-2");
  await connection.receive(JSON.stringify({ event: "relay", payload: { room: "store-2", orderId: "D4" } }));
  assert.deepEqual(receiver.sent, [{ event: "kitchenChanged", payload: { orderId: "D4", status: "cooking" } }]);
  assert.deepEqual(sender.sent, []);

  const invalid = defineSocketChannel({
    clientToServer: { relay },
    serverToClient: { kitchenChanged },
    handlers: { relay: ({ payload }) => socket.kitchen.broadcast(payload.room, "kitchenChanged", { orderId: payload.orderId } as never) },
  });
  const strict = createSocketHub({ channels: { kitchen: invalid }, sessions, services: {} });
  const strictConnection = await strict.accept("kitchen", request, peer().socket, "store-1");
  await assert.rejects(strictConnection.receive(JSON.stringify({ event: "relay", payload: { room: "store-2", orderId: "E5" } })),
    (error: unknown) => error instanceof ApiError && error.code === "INVALID_SOCKET_PAYLOAD");
});

test("production with the default in-memory broker warns once; a declared broker or development does not", async () => {
  resetEnvWarnings();
  const manifest: AppManifest = {
    version: 1,
    routes: [],
    server: { api: [], rpc: [], socket: [{ kind: "socket", file: "/server/socket/kitchen.ts", name: "kitchen", pathname: "/_meeko/socket/kitchen" }] },
    routeMiddleware: [],
    serverMiddleware: [],
    client: { entry: "/assets/entry.js", css: [], preload: [] },
  };
  const table: Record<string, unknown> = { "/server/socket/kitchen.ts": { default: defineSocketChannel({ clientToServer: { relay }, serverToClient: { kitchenChanged } }) } };
  const build = async (production: boolean, pubsub?: SocketPubSub) => createServerApp({
    manifest, production, load: async (key) => table[key],
    runtime: defineServerRuntime(() => ({
      sessions: new SessionManager({ store: new MemorySessionStore(), secure: false }),
      ...(pubsub ? { socket: { pubsub } } : {}),
    })),
  });
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (message: unknown) => { warnings.push(String(message)); };
  try {
    for (const app of [await build(false), await build(true, new LocalSocketPubSub())]) await app.close();
    assert.deepEqual(warnings, [], "development and an explicit broker stay quiet");
    for (const app of [await build(true), await build(true)]) await app.close();
  } finally { console.warn = original; }
  assert.equal(warnings.length, 1, "once per process");
  assert.match(warnings[0]!, /LocalSocketPubSub.*varias réplicas.*RedisSocketPubSub/s);
});

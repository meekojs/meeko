import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import WebSocket from "ws";
import { attachNodeWebSocketServer, createSocketHub, defineSocketChannel, MemorySessionStore, SessionManager } from "../src/framework-server.ts";
import type { Schema } from "../src/framework-server.ts";

const textSchema: Schema<{ text: string }> = {
  "~standard": {
    version: 1,
    validate(value) {
      return value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string"
        ? { value: value as { text: string } }
        : { issues: [{}] };
    },
  },
};

test("official Node adapter upgrades real WebSockets and enforces origin, session, events, and shutdown", async () => {
  const store = new MemorySessionStore<{ user: string }>();
  const sessions = new SessionManager({ store, secure: false });
  const handle = await sessions.load(new Request("http://127.0.0.1/"));
  const session = await handle.create({ user: "alice" });
  const hub = createSocketHub({
    channels: {
      chat: defineSocketChannel({
        clientToServer: { message: textSchema },
        serverToClient: { message: textSchema },
        auth: "required",
        authorize: ({ context, roomId }) => (context.session.current?.data as { user: string } | undefined)?.user === roomId,
        handlers: { message: ({ payload, emit }) => emit("message", payload) },
      }),
    },
    sessions,
    services: {},
  });
  const server = createServer((_request, response) => { response.writeHead(404); response.end(); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const url = `ws://127.0.0.1:${address.port}/_meeko/socket/chat?room=alice`;
  const adapter = attachNodeWebSocketServer({ server, hub, publicOrigin: origin, heartbeatMs: 30, maxMessageBytes: 256 });
  const connect = (requestedOrigin: string, cookie?: string) => new WebSocket(url, { headers: { origin: requestedOrigin, ...(cookie ? { cookie } : {}) } });
  const rejection = async (peer: WebSocket): Promise<number> => {
    return await new Promise<number>((resolve, reject) => {
      peer.once("unexpected-response", (_request, response) => { response.resume(); resolve(response.statusCode ?? 0); });
      peer.once("error", reject);
    });
  };
  try {
    assert.equal(await rejection(connect("http://evil.test", `meeko.sid=${session.id}`)), 403);
    assert.equal(await rejection(connect(origin)), 401);
    const peer = connect(origin, `meeko.sid=${session.id}`);
    await once(peer, "open");
    const reply = once(peer, "message");
    peer.send(JSON.stringify({ event: "message", payload: { text: "hello" } }));
    const [data] = await reply;
    assert.deepEqual(JSON.parse(String(data)) as unknown, { event: "message", payload: { text: "hello" } });
    const invalid = once(peer, "close");
    peer.send(JSON.stringify({ event: "message", payload: { text: 4 } }));
    assert.equal((await invalid)[0], 1008);

    const revoked = connect(origin, `meeko.sid=${session.id}`);
    await once(revoked, "open");
    await store.delete(session.id);
    const revokedClose = once(revoked, "close");
    revoked.send(JSON.stringify({ event: "message", payload: { text: "later" } }));
    assert.equal((await revokedClose)[0], 1008);

    const freshHandle = await sessions.load(new Request(origin));
    const fresh = await freshHandle.create({ user: "alice" });
    const large = connect(origin, `meeko.sid=${fresh.id}`);
    await once(large, "open");
    const largeClose = once(large, "close");
    large.send("x".repeat(257));
    assert.equal((await largeClose)[0], 1009);

    const active = connect(origin, `meeko.sid=${fresh.id}`);
    await once(active, "open");
    const closed = once(active, "close");
    await adapter.close();
    await closed;
    assert.equal(server.listenerCount("upgrade"), 0);
  } finally {
    await adapter.close();
    server.close();
    await once(server, "close");
  }
});

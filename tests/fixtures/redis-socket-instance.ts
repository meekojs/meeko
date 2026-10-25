// Second server instance for tests/redis.integration.ts: subscribes one peer
// to a room through Redis and prints every message it receives.
import { createClient } from "redis";
import { createSocketHub, defineSocketChannel, MemorySessionStore, RedisSocketPubSub, SessionManager } from "../../src/framework-server.ts";
import type { Schema } from "../../src/framework-server.ts";

const url = process.env.MEEKO_REDIS_URL;
const prefix = process.env.MEEKO_TEST_PREFIX;
if (!url || !prefix) throw new Error("MEEKO_REDIS_URL and MEEKO_TEST_PREFIX are required");

const textSchema: Schema<{ text: string }> = { "~standard": { version: 1, validate(value) {
  return value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string" ? { value: value as { text: string } } : { issues: [{}] };
} } };

const publisher = createClient({ url, socket: { reconnectStrategy: false } });
publisher.on("error", (error: unknown) => console.error("publisher", error instanceof Error ? error.name : "error"));
await publisher.connect();
const subscriber = publisher.duplicate();
subscriber.on("error", (error: unknown) => console.error("subscriber", error instanceof Error ? error.name : "error"));
await subscriber.connect();

const hub = createSocketHub({
  channels: { chat: defineSocketChannel({ clientToServer: {}, serverToClient: { message: textSchema } }) },
  sessions: new SessionManager({ store: new MemorySessionStore(), secure: false }),
  services: {},
  pubsub: new RedisSocketPubSub({ publisher, subscriber, prefix }),
  onDeliveryError: (error) => console.log(`delivery-error ${error instanceof Error ? error.message : String(error)}`),
});
const connection = await hub.accept("chat", new Request("https://example.test/_meeko/socket/chat", { headers: { origin: "https://example.test" } }), {
  send(message) { console.log(`message ${message}`); },
  close(code) { console.log(`closed ${code ?? 1000}`); },
}, "room 1");
console.log("ready");

process.stdin.resume();
process.stdin.on("end", () => {
  void (async () => {
    connection.close();
    await subscriber.quit();
    await publisher.quit();
  })();
});

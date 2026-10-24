import assert from "node:assert/strict";
import test from "node:test";
import { createSocketClient, createSocketRegistry, useSocketChannel } from "../src/framework/socket.ts";
import { createRoot } from "../src/reactivity.ts";

class FakeSocket extends EventTarget {
  readyState: number = WebSocket.CONNECTING;
  sent: string[] = [];
  closeCode: number | undefined;
  send(value: string): void { this.sent.push(value); }
  close(code: number): void { this.closeCode = code; this.readyState = WebSocket.CLOSED; this.dispatchEvent(new Event("close")); }
  open(): void { this.readyState = WebSocket.OPEN; this.dispatchEvent(new Event("open")); }
  receive(value: string): void { this.dispatchEvent(new MessageEvent("message", { data: value })); }
}

const stringSchema = {
  "~standard": {
    version: 1 as const,
    validate(value: unknown) {
      return typeof value === "string" ? { value } : { issues: ["expected string"] };
    },
  },
};

test("socket client validates both directions and never queues while disconnected", async () => {
  const peer = new FakeSocket();
  const client = createSocketClient("ws://localhost/chat", {
    clientToServer: { message: stringSchema }, serverToClient: { message: stringSchema },
  }, { webSocketFactory: () => peer as unknown as WebSocket, retryMs: 60_000 });
  await assert.rejects(client.emit("message", "early"), /disconnected/);
  assert.deepEqual(peer.sent, []);
  peer.open();
  assert.equal(client.state.value, "open");
  await client.emit("message", "hello");
  assert.deepEqual(JSON.parse(peer.sent[0] ?? ""), { event: "message", payload: "hello" });
  await assert.rejects(client.emit("message", 42 as never), /Invalid socket event payload/);
  const received: string[] = [];
  client.on("message", (value) => received.push(value));
  peer.receive('{"event":"message","payload":"reply"}');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(received, ["reply"]);
  peer.receive('{"event":"message","payload":42}');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(peer.closeCode, 1008);
  client.close();
  assert.equal(client.state.value, "closed");
});

test("channel registry is lazy during SSR and component sockets close with their root", () => {
  const contracts = { chat: { clientToServer: { message: stringSchema }, serverToClient: { message: stringSchema } } };
  const addresses: string[] = [];
  const peers: FakeSocket[] = [];
  const options = {
    roomId: "general",
    webSocketFactory(address: string): WebSocket {
      addresses.push(address);
      const peer = new FakeSocket();
      peers.push(peer);
      return peer as unknown as WebSocket;
    },
  };
  const registry = createSocketRegistry(contracts, options);
  assert.deepEqual(addresses, []);
  assert.throws(() => registry.chat, /unavailable during SSR/);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { href: "https://example.test/" } } });
  try {
    const direct = registry.chat;
    assert.equal(registry.chat, direct);
    assert.deepEqual(addresses, ["wss://example.test/_meeko/socket/chat?room=general"]);
    const dispose = createRoot((stop) => {
      const scoped = useSocketChannel(contracts, "chat", options);
      assert.equal(scoped.state.value, "connecting");
      return stop;
    });
    assert.equal(peers.length, 2);
    dispose();
    assert.equal(peers[1]!.closeCode, 1000);
    assert.equal(direct.state.value, "connecting");
    direct.close();
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { createSocketClient, createSocketRegistry, useSocketChannel, useSocketClient } from "../src/framework/socket.ts";
import * as framework from "../src/framework.ts";
import { createRoot, effect } from "../src/reactivity.ts";
import { createAppErrorChannel, provideAppErrorChannel, provideErrorHandler } from "../src/component-errors.ts";

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
  }, { webSocketFactory: () => peer as unknown as WebSocket, retryMs: 60_000, onError: () => {} });
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

/** In SSR the client never connects nor throws: it stays `"connecting"`, `on` is a no-op and `emit` rejects. */
async function ssrClientIsInert(contract: { clientToServer: { message: typeof stringSchema }; serverToClient: { message: typeof stringSchema } }): Promise<void> {
  let opened = 0;
  const client = useSocketClient("ws://example.test/chat", contract, { webSocketFactory: () => { opened++; throw new Error("no socket in SSR"); } });
  assert.equal(client.state.value, "connecting");
  assert.equal(typeof client.on("message", () => {}), "function");
  await assert.rejects(client.emit("message", "hola"), /Socket is disconnected/);
  client.close();
  assert.equal(opened, 0, "SSR never opens a connection");
}

test("the deprecated framework useSocket is the same function as useSocketClient and keeps working", async () => {
  assert.equal(framework.useSocketClient, useSocketClient);
  assert.equal(framework.useSocket, framework.useSocketClient);
  assert.equal(framework.createSocketClient, createSocketClient);
  const contract = { clientToServer: { message: stringSchema }, serverToClient: { message: stringSchema } };
  assert.equal(typeof window, "undefined");
  assert.equal(framework.useSocket, useSocketClient);
  await ssrClientIsInert(contract);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { href: "https://example.test/" } } });
  const peers: FakeSocket[] = [];
  const options = {
    webSocketFactory(): WebSocket {
      const peer = new FakeSocket();
      peers.push(peer);
      return peer as unknown as WebSocket;
    },
  };
  try {
    const dispose = createRoot((stop) => {
      const legacy = framework.useSocket("ws://example.test/chat", contract, options);
      const current = useSocketClient("ws://example.test/chat", contract, options);
      assert.equal(legacy.state.value, "connecting");
      assert.equal(current.state.value, "connecting");
      return stop;
    });
    assert.equal(peers.length, 2);
    dispose();
    assert.deepEqual(peers.map((peer) => peer.closeCode), [1000, 1000]);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("component Socket errors use the nearest observer without crossing roots", async () => {
  const contracts = { chat: { clientToServer: { message: stringSchema }, serverToClient: { message: stringSchema } } };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { href: "https://example.test/" } } });
  const peers: FakeSocket[] = [];
  const seen: string[] = [];
  const options = {
    webSocketFactory(): WebSocket {
      const peer = new FakeSocket();
      peers.push(peer);
      return peer as unknown as WebSocket;
    },
  };
  try {
    const stops = ["A", "B"].map((name) => createRoot((stop) => {
      provideErrorHandler((error) => { seen.push(`${name}:${String(error)}`); });
      const client = useSocketChannel(contracts, "chat", options);
      client.on("message", () => { throw new Error(`listener ${name}`); });
      return stop;
    }));
    try {
      peers[0]!.open();
      peers[1]!.open();
      peers[0]!.receive('{"event":"message","payload":"one"}');
      peers[1]!.receive('{"event":"message","payload":"two"}');
      await new Promise<void>((done) => setImmediate(done));
      assert.deepEqual(seen, ["A:Error: listener A", "B:Error: listener B"]);
    } finally {
      for (const stop of stops) stop();
    }
    assert.deepEqual(peers.map((peer) => peer.closeCode), [1000, 1000]);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("autoimport-style socket registry is owned and closed by each application", async () => {
  const contracts = { chat: { clientToServer: { message: stringSchema }, serverToClient: { message: stringSchema } } };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { href: "https://example.test/" } } });
  const peers: FakeSocket[] = [];
  const seen: string[] = [];
  const registry = createSocketRegistry(contracts, {
    webSocketFactory() {
      const peer = new FakeSocket();
      peers.push(peer);
      return peer as unknown as WebSocket;
    },
  });
  const apps = ["A", "B"].map((name) => {
    const channel = createAppErrorChannel();
    const stop = createRoot((dispose) => {
      provideAppErrorChannel(channel);
      provideErrorHandler((error) => { seen.push(`${name}:${String(error)}`); });
      const client = registry.chat;
      assert.equal(registry.chat, client);
      client.on("message", () => { throw new Error(`listener ${name}`); });
      return dispose;
    });
    return { channel, stop };
  });
  try {
    assert.equal(peers.length, 2);
    peers[0]!.open();
    peers[1]!.open();
    peers[0]!.receive('{"event":"message","payload":"one"}');
    peers[1]!.receive('{"event":"message","payload":"two"}');
    await new Promise<void>((done) => setImmediate(done));
    assert.deepEqual(seen, ["A:Error: listener A", "B:Error: listener B"]);
    apps[0]!.stop();
    peers[0]!.receive('{"event":"message","payload":"late"}');
    await new Promise<void>((done) => setImmediate(done));
    assert.equal(seen.length, 2);
    apps[0]!.channel.clear();
    assert.equal(peers[0]!.closeCode, 1000);
    assert.equal(peers[1]!.closeCode, undefined);
  } finally {
    for (const app of apps) {
      app.stop();
      app.channel.clear();
    }
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
  assert.equal(peers[1]!.closeCode, 1000);
});

test("socket listener failures are reported without closing the channel or skipping other listeners", async () => {
  const peer = new FakeSocket();
  const errors: unknown[] = [];
  const client = createSocketClient("ws://localhost/chat", {
    clientToServer: { message: stringSchema }, serverToClient: { message: stringSchema },
  }, { webSocketFactory: () => peer as unknown as WebSocket, onError: (error) => errors.push(error) });
  const received: string[] = [];
  client.on("message", async () => { throw new Error("consumer listener failed"); });
  client.on("message", (value) => received.push(value));
  peer.open();
  peer.receive('{"event":"message","payload":"reply"}');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(received, ["reply"]);
  assert.match(String(errors[0]), /consumer listener failed/);
  assert.equal(peer.closeCode, undefined);
  assert.equal(client.state.value, "open");
  client.close();
});

test("a late message from a replaced socket cannot close the active connection", async () => {
  const peers: FakeSocket[] = [];
  const client = createSocketClient("ws://localhost/chat", {
    clientToServer: { message: stringSchema }, serverToClient: { message: stringSchema },
  }, {
    retryMs: 1,
    webSocketFactory: () => {
      const peer = new FakeSocket();
      peers.push(peer);
      return peer as unknown as WebSocket;
    },
  });
  const first = peers[0]!;
  first.open();
  first.close(1006);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(peers.length, 2);
  const active = peers[1]!;
  active.open();
  first.receive('{"event":"message","payload":"late"}');
  assert.equal(client.state.value, "open");
  assert.equal(active.closeCode, undefined);
  await client.emit("message", "still open");
  assert.equal(active.sent.length, 1);
  client.close();
});

test("a message still validating from an old socket is not delivered after reconnect", async () => {
  const peers: FakeSocket[] = [];
  let finishValidation: ((value: { value: string }) => void) | undefined;
  const delayedSchema = {
    "~standard": {
      version: 1 as const,
      validate: (_value: unknown): Promise<{ value: string }> => new Promise((resolve) => { finishValidation = resolve; }),
    },
  };
  const client = createSocketClient("ws://localhost/chat", {
    clientToServer: { message: stringSchema }, serverToClient: { message: delayedSchema },
  }, {
    retryMs: 1,
    webSocketFactory: () => {
      const peer = new FakeSocket();
      peers.push(peer);
      return peer as unknown as WebSocket;
    },
  });
  const received: string[] = [];
  client.on("message", (value) => received.push(value));
  const first = peers[0]!;
  first.open();
  first.receive('{"event":"message","payload":"stale"}');
  assert.ok(finishValidation);
  first.close(1006);
  await new Promise((resolve) => setTimeout(resolve, 10));
  peers[1]!.open();
  finishValidation({ value: "stale" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(received, []);
  assert.equal(client.state.value, "open");
  client.close();
});

test("a rejected validation from an old socket cannot close the new connection", async () => {
  const peers: FakeSocket[] = [];
  let failValidation: ((error: Error) => void) | undefined;
  const delayedSchema = {
    "~standard": {
      version: 1 as const,
      validate: (_value: unknown): Promise<{ value: string }> => new Promise((_resolve, reject) => { failValidation = reject; }),
    },
  };
  const errors: unknown[] = [];
  const client = createSocketClient("ws://localhost/chat", {
    clientToServer: { message: stringSchema }, serverToClient: { message: delayedSchema },
  }, {
    retryMs: 1,
    onError: (error) => errors.push(error),
    webSocketFactory: () => {
      const peer = new FakeSocket();
      peers.push(peer);
      return peer as unknown as WebSocket;
    },
  });
  const first = peers[0]!;
  first.open();
  first.receive('{"event":"message","payload":"stale"}');
  assert.ok(failValidation);
  first.close(1006);
  await new Promise((resolve) => setTimeout(resolve, 10));
  peers[1]!.open();
  failValidation(new Error("stale payload rejected"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(client.state.value, "open");
  assert.equal(peers[1]!.closeCode, undefined);
  assert.deepEqual(errors, []);
  client.close();
});

test("a transport close failure is reported after an invalid inbound event", async () => {
  const closeFailure = new Error("transport close failed");
  const peer = new FakeSocket();
  peer.close = () => { throw closeFailure; };
  const errors: unknown[] = [];
  const client = createSocketClient("ws://localhost/chat", {
    clientToServer: { message: stringSchema }, serverToClient: { message: stringSchema },
  }, { webSocketFactory: () => peer as unknown as WebSocket, onError: (error) => errors.push(error) });
  peer.open();
  peer.receive('{"event":"message","payload":42}');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.match(String(errors[0]), /Invalid socket event payload/);
  assert.equal(errors[1], closeFailure);
  assert.equal(client.state.value, "closed");
});

test("a failed reconnect attempt is reported and retried", async () => {
  const errors: unknown[] = [];
  const peers: FakeSocket[] = [];
  let attempts = 0;
  const client = createSocketClient("ws://localhost/chat", {
    clientToServer: { message: stringSchema }, serverToClient: { message: stringSchema },
  }, {
    retryMs: 1,
    onError: (error) => errors.push(error),
    webSocketFactory: () => {
      attempts++;
      if (attempts === 2) throw new Error("reconnect factory failed");
      const peer = new FakeSocket();
      peers.push(peer);
      return peer as unknown as WebSocket;
    },
  });
  peers[0]!.open();
  peers[0]!.close(1006);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(attempts, 3);
  assert.match(String(errors[0]), /reconnect factory failed/);
  peers[1]!.open();
  assert.equal(client.state.value, "open");
  client.close();
});

test("an active WebSocket transport error reaches the error observer once", () => {
  const peer = new FakeSocket();
  const errors: unknown[] = [];
  const client = createSocketClient("ws://localhost/chat", {
    clientToServer: { message: stringSchema }, serverToClient: { message: stringSchema },
  }, { webSocketFactory: () => peer as unknown as WebSocket, onError: (error) => errors.push(error) });
  try {
    peer.dispatchEvent(new Event("error"));
    peer.dispatchEvent(new Event("error"));
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /Socket transport error/);
  } finally { client.close(); }
});

test("an error from a replaced WebSocket does not reach the current application", async () => {
  const peers: FakeSocket[] = [];
  const errors: unknown[] = [];
  const client = createSocketClient("ws://localhost/chat", {
    clientToServer: { message: stringSchema }, serverToClient: { message: stringSchema },
  }, {
    retryMs: 1,
    onError: (error) => errors.push(error),
    webSocketFactory: () => {
      const peer = new FakeSocket();
      peers.push(peer);
      return peer as unknown as WebSocket;
    },
  });
  try {
    peers[0]!.open();
    peers[0]!.close(1006);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(peers.length, 2);
    peers[1]!.open();
    peers[0]!.dispatchEvent(new Event("error"));
    assert.deepEqual(errors, []);
    assert.equal(client.state.value, "open");
  } finally { client.close(); }
});

test("a rejected observer of a WebSocket transport error is reported safely", async () => {
  const peer = new FakeSocket();
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    const client = createSocketClient("ws://localhost/chat", {
      clientToServer: { message: stringSchema }, serverToClient: { message: stringSchema },
    }, {
      webSocketFactory: () => peer as unknown as WebSocket,
      onError: async () => { throw new Error("transport observer failed"); },
    });
    try {
      assert.doesNotThrow(() => peer.dispatchEvent(new Event("error")));
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.match(String(logged[0]?.[0]), /Meeko socket error observer failed/);
      assert.match(String(logged[0]?.[2]), /transport observer failed/);
    } finally { client.close(); }
  } finally { console.error = originalError; }
});

test("an asynchronous error observer cannot create an unhandled socket rejection", async () => {
  const peer = new FakeSocket();
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    const client = createSocketClient("ws://localhost/chat", {
      clientToServer: { message: stringSchema }, serverToClient: { message: stringSchema },
    }, {
      webSocketFactory: () => peer as unknown as WebSocket,
      onError: async () => { throw new Error("observer failed"); },
    });
    peer.open();
    peer.receive('{"event":"message","payload":42}');
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(client.state.value, "closed");
    assert.match(String(logged[0]?.[0]), /Meeko socket error observer failed/);
    assert.match(String(logged[0]?.[2]), /observer failed/);
  } finally {
    console.error = originalError;
  }
});

test("a socket state observer failure is reported without escaping the transport event", () => {
  const peer = new FakeSocket();
  const errors: unknown[] = [];
  const client = createSocketClient("ws://localhost/chat", {
    clientToServer: { message: stringSchema }, serverToClient: { message: stringSchema },
  }, { webSocketFactory: () => peer as unknown as WebSocket, onError: (error) => { errors.push(error); } });
  const stop = effect(() => {
    if (client.state.value === "open") throw new Error("state observer failed");
  });
  assert.doesNotThrow(() => peer.open());
  assert.match(String(errors[0]), /state observer failed/);
  stop();
  client.close();
});

/** A real HTTP server that refuses every WebSocket upgrade with `status`. */
async function refusingServer(status: number): Promise<{ url: string; upgrades: () => number; close: () => Promise<void> }> {
  const { createServer } = await import("node:http");
  let upgrades = 0;
  const server = createServer((_request, response) => { response.statusCode = 404; response.end(); });
  server.on("upgrade", (_request, socket) => {
    upgrades++;
    socket.end(`HTTP/1.1 ${status} Refused\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `ws://127.0.0.1:${port}/_meeko/socket/chat`,
    upgrades: () => upgrades,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const socketContract = { clientToServer: { message: stringSchema }, serverToClient: { message: stringSchema } };

for (const status of [401, 403]) {
  test(`a ${status} handshake stops reconnecting and reports an explicit error`, { timeout: 5_000 }, async () => {
    const { WebSocket: NodeWebSocket } = await import("ws");
    const server = await refusingServer(status);
    const errors: unknown[] = [];
    const client = createSocketClient(server.url, socketContract, {
      retryMs: 1,
      onError: (error) => errors.push(error),
      webSocketFactory: (address) => new NodeWebSocket(address) as unknown as WebSocket,
    });
    try {
      await new Promise<void>((resolve) => {
        createRoot((dispose) => effect(() => { if (client.state.value === "unauthorized") { resolve(); queueMicrotask(dispose); } }));
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(server.upgrades(), 1, "no reconnection after the refusal");
      assert.equal(client.state.value, "unauthorized");
      assert.equal(errors.length, 1, String(errors));
      assert.ok(errors[0] instanceof framework.ClientError);
      assert.equal(errors[0].status, status);
      assert.equal(errors[0].code, status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
      assert.doesNotMatch(String(errors[0]), /transport error/);
      await assert.rejects(client.emit("message", "x"), /disconnected/);
    } finally {
      client.close();
      await server.close();
    }
  });
}

test("the hub's authorization close codes are terminal and other closes keep reconnecting", { timeout: 5_000 }, async () => {
  for (const [code, reason, status] of [[1008, "Unauthorized", 401], [1008, "Session expired", 401], [1008, "Session revoked", 401], [4401, "", 401], [4403, "", 403]] as const) {
    const peers: FakeSocket[] = [];
    const errors: unknown[] = [];
    const client = createSocketClient("ws://localhost/chat", socketContract, {
      retryMs: 1,
      onError: (error) => errors.push(error),
      webSocketFactory: () => { const peer = new FakeSocket(); peers.push(peer); return peer as unknown as WebSocket; },
    });
    peers[0]!.open();
    peers[0]!.dispatchEvent(new CloseEvent("close", { code, reason }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(peers.length, 1, `${code} ${reason}`);
    assert.equal(client.state.value, "unauthorized", `${code} ${reason}`);
    assert.equal((errors[0] as { status?: number }).status, status, `${code} ${reason}`);
    client.close();
    assert.equal(client.state.value, "closed");
  }
  // A network failure, even before the first open, keeps the backoff.
  const peers: FakeSocket[] = [];
  const errors: unknown[] = [];
  const client = createSocketClient("ws://localhost/chat", socketContract, {
    retryMs: 1,
    onError: (error) => errors.push(error),
    webSocketFactory: () => { const peer = new FakeSocket(); peers.push(peer); return peer as unknown as WebSocket; },
  });
  peers[0]!.dispatchEvent(new Event("error"));
  peers[0]!.dispatchEvent(new CloseEvent("close", { code: 1006 }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(peers.length >= 2);
  assert.equal(client.state.value, "connecting");
  assert.match(String(errors[0]), /Socket transport error/);
  client.close();
});

test("the autoimport useSocket stops after a 401 handshake", { timeout: 5_000 }, async () => {
  const { WebSocket: NodeWebSocket } = await import("ws");
  const server = await refusingServer(401);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { href: server.url.replace("ws:", "http:") } } });
  const errors: unknown[] = [];
  try {
    let state: (() => string) | undefined;
    const dispose = createRoot((stop) => {
      const chat = useSocketChannel({ chat: socketContract }, "chat", {
        retryMs: 1,
        onError: (error) => errors.push(error),
        webSocketFactory: (address) => new NodeWebSocket(address) as unknown as WebSocket,
      });
      state = () => chat.state.value;
      return stop;
    });
    for (let index = 0; index < 50 && state!() !== "unauthorized"; index++) await new Promise((resolve) => setTimeout(resolve, 10));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(state!(), "unauthorized");
    assert.equal(server.upgrades(), 1);
    assert.equal(errors.length, 1);
    dispose();
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
    await server.close();
  }
});

for (const [status, closeCode] of [[401, 4401], [403, 4403]] as const) {
  test(`a Meeko server that refuses with ${closeCode} stops a ws client without reconnecting`, { timeout: 5_000 }, async () => {
    const { createServer } = await import("node:http");
    const { WebSocket: NodeWebSocket } = await import("ws");
    const { attachNodeWebSocketServer } = await import("../src/node.ts");
    const { createSocketHub, defineSocketChannel, MemorySessionStore, SessionManager } = await import("../src/framework-server.ts");
    let handled = 0;
    const hub = createSocketHub({
      channels: {
        chat: defineSocketChannel({
          ...socketContract,
          ...(status === 401 ? { auth: "required" as const } : { authorize: () => false }),
          handlers: { message: () => { handled++; } },
        }),
      },
      sessions: new SessionManager({ store: new MemorySessionStore(), secure: false }),
      services: {},
    });
    const server = createServer((_request, response) => { response.statusCode = 404; response.end(); });
    let upgrades = 0;
    server.on("upgrade", () => { upgrades++; });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    const origin = `http://127.0.0.1:${port}`;
    const adapter = attachNodeWebSocketServer({ server, hub, publicOrigin: origin });
    const closes: number[] = [];
    const errors: unknown[] = [];
    const client = createSocketClient(`ws://127.0.0.1:${port}/_meeko/socket/chat`, socketContract, {
      retryMs: 1,
      onError: (error) => errors.push(error),
      webSocketFactory: (address) => {
        const peer = new NodeWebSocket(address, { origin });
        peer.on("close", (code) => closes.push(code));
        return peer as unknown as WebSocket;
      },
    });
    try {
      await new Promise<void>((resolve) => {
        createRoot((dispose) => effect(() => { if (client.state.value === "unauthorized") { resolve(); queueMicrotask(dispose); } }));
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(upgrades, 1, "no reconnection after the close");
      assert.deepEqual(closes, [closeCode]);
      assert.equal(client.state.value, "unauthorized");
      assert.equal(errors.length, 1, String(errors));
      assert.ok(errors[0] instanceof framework.ClientError);
      assert.equal(errors[0].status, status);
      assert.equal(handled, 0);
    } finally {
      client.close();
      await adapter.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}

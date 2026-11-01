---
title: createSocketHub
group: advanced
since: 1.0.0
description: Creates the Socket hub for a custom host, authorizing handshakes, accepting connections, validating events and distributing broadcasts across rooms and instances.
symbols:
  - "@meekojs/meeko/server#createSocketHub"
types:
  - "@meekojs/meeko/server#SocketHubOptions"
  - "@meekojs/meeko/server#SocketHub"
  - "@meekojs/meeko/server#SocketPeer"
  - "@meekojs/meeko/server#SocketConnection"
related:
  - "@meekojs/meeko/server#createSocketUpgradeHandler"
  - "@meekojs/meeko/server#defineSocketChannel"
  - "@meekojs/meeko/server#LocalSocketPubSub"
  - "@meekojs/meeko/server#RedisSocketPubSub"
  - "@meekojs/meeko/server#createServerApp"
  - docs/framework.md#websocket
  - docs/framework.md#broadcast-y-varias-instancias
source-hash: 21fe1699e21bf0039706fd7e4558eba7f9ce9b18a8b7689a69d93e7d7d174ac2
---

`createSocketHub` is Meeko's transport-independent Socket core. It receives channel definitions (`defineSocketChannel`), the session manager and services, and validates everything coming in and going out: `Origin`, session and channel authorization at handshake, and the event and its payload against schemas on every message. It applies per-peer size, buffer and queue limits, and distributes broadcasts through a broker (`LocalSocketPubSub` on one instance, `RedisSocketPubSub` or Durable Objects on multiple instances).

The hub does not open sockets: the host performs the HTTP upgrade with its runtime and passes each connected peer to it. [`createSocketUpgradeHandler`](/en/docs/reference/createsocketupgradehandler) provides this bridge portably; `createServerApp` creates the hub automatically when the application has channels (`app.socket.hub`).

## Usage

```ts
import { createSocketHub, defineSocketChannel, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";
import type { Schema, SocketPeer } from "@meekojs/meeko/server";

const text: Schema<{ text: string }> = {
  "~standard": {
    version: 1,
    validate: (value) => typeof value === "object" && value !== null && typeof (value as { text?: unknown }).text === "string"
      ? { value: value as { text: string } }
      : { issues: [{ message: "Se esperaba { text }" }] },
  },
};
const chat = defineSocketChannel({
  clientToServer: { message: text },
  serverToClient: { message: text },
  handlers: { message: ({ payload, emit }) => emit("message", { text: payload.text.toUpperCase() }) },
});

const hub = createSocketHub({ channels: { chat }, sessions: new SessionManager({ store: new MemorySessionStore() }), services: {} });

const sent: string[] = [];
const peer: SocketPeer = { send: (message) => { sent.push(message); }, close: () => {} };
const request = new Request("http://localhost/_meeko/socket/chat?room=general", { headers: { origin: "http://localhost" } });
const connection = await hub.accept("chat", request, peer, "general");
await connection.receive(JSON.stringify({ event: "message", payload: { text: "hola" } }));
console.log(sent); // [ '{"event":"message","payload":{"text":"HOLA"}}' ]
```

## Options

| Option                 | Type                                         | Default             | Description                                                                                                                                                     |
| ---------------------- | -------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `channels`             | `Record<string, SocketChannelDefinition>`    | required            | Channels by name: the default export of each `server/socket/<nombre>.ts`.                                                                                       |
| `sessions`             | `SessionManager`                             | required            | Loads the handshake session and closes the peer if revoked.                                                                                                     |
| `services`             | `S` or `(request) => S`                      | required            | Channel callback services, shared or created on each handshake.                                                                                                 |
| `allowedOrigins`       | `string[]`                                   | none                | Accepted origins in addition to the handshake URL's own origin.                                                                                                 |
| `maxMessageBytes`      | number                                       | 65 536              | Largest incoming or outgoing serialized message. A larger incoming message closes with `1009`; a larger `broadcast` rejects with `SOCKET_LIMIT_EXCEEDED` (413). |
| `maxBufferBytes`       | number                                       | 1 MiB               | Pending outgoing bytes per peer before closing it.                                                                                                              |
| `maxPendingDeliveries` | number                                       | 256                 | Pending broker deliveries per peer; a slower peer closes with `1013`.                                                                                           |
| `sessionRefreshMs`     | number                                       | 1000                | How long deliveries reuse the last session read; `0` rereads on every delivery.                                                                                 |
| `pubsub`               | `SocketPubSub`                               | `LocalSocketPubSub` | Cross-instance broker.                                                                                                                                          |
| `platform`             | `ServerPlatform`                             | none                | What callbacks see in `context.platform`.                                                                                                                       |
| `onDeliveryError`      | `(error, { channel, room, event? }) => void` | `console.error`     | Failed deliveries to a local peer, which is closed. Never reaches the sender.                                                                                   |

## Return value

A `SocketHub`:

| Method                                    | Description                                                                                                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preflight(name, request, roomId?)`       | Checks the channel, `Origin`, session and authorization before upgrading. Rejects with `ApiError`: `UNKNOWN_SOCKET_CHANNEL` (404), `INVALID_ORIGIN` (403), channel `401` or `403`. |
| `accept(name, request, peer, roomId?)`    | Accepts an already-connected peer; resolves with its `SocketConnection` when subscribed to its channel and room.                                                                   |
| `broadcast(name, roomId, event, payload)` | Validates the event with the `serverToClient` schema and publishes it to the broker; each room peer receives it at most once.                                                      |

`SocketConnection` has `receive(message)` for each client message, `emit(event, payload)` and `close(code?, reason?)`. A message that is not JSON or lacks `event` and `payload` closes the peer with `1008` and `receive` rejects with `INVALID_SOCKET_MESSAGE`.

## Examples

### Broadcast from a task or API

<!-- no-check -->

```ts
// server/api/maintenance.post.ts
export default defineApiRoute({
  auth: "required",
  body: Notice,
  response: Ok,
  handler: async ({ body }) => {
    await socket.chat.broadcast("general", "message", { text: body.text });
    return { ok: true };
  },
});
```

In an application, the `socket` auto-import wraps its hub. In a custom host, call `hub.broadcast("chat", "general", "message", { text: "Mantenimiento en 5 minutos" })`.

### Multiple instances with Redis

<!-- no-check -->

```ts
import { createClient } from "redis";
import { createSocketHub, RedisSocketPubSub } from "@meekojs/meeko/server";

const publisher = createClient({ url: process.env.REDIS_URL });
const subscriber = publisher.duplicate();
await Promise.all([publisher.connect(), subscriber.connect()]);

const hub = createSocketHub({ channels, sessions, services: {}, pubsub: new RedisSocketPubSub({ publisher, subscriber, prefix: "tienda:prod:socket:" }) });
```

A `broadcast` on one instance reaches peers in the same room on all instances.

## Common mistakes

### A payload failing the server schema

```ts bad
await hub.broadcast("chat", "general", "message", { body: "hola" });
```

Rejects with `ApiError` `INVALID_SOCKET_PAYLOAD` (400) before publishing: outgoing data is validated too, so the client always receives what its contract specifies.

<!-- no-check -->

```ts good
await hub.broadcast("chat", "general", "message", { text: "hola" });
```

### A handshake from another origin

```ts bad
await hub.preflight("chat", new Request("http://localhost/_meeko/socket/chat", { headers: { origin: "https://otro.example" } }));
```

`ApiError` `INVALID_ORIGIN` (403). The browser sends `Origin` on WebSockets, and without this check any page could connect with the user's cookies.

<!-- no-check -->

```ts good
createSocketHub({ channels, sessions, services: {}, allowedOrigins: ["https://app.example.com"] });
```

### Limits that are not positive integers

```ts bad
createSocketHub({ channels, sessions, services: {}, maxMessageBytes: 0 });
```

`RangeError: Invalid socket limits`, when creating the hub.

<!-- no-check -->

```ts good
createSocketHub({ channels, sessions, services: {}, maxMessageBytes: 16 * 1024 });
```

## Notes

- **Portable.** Does not depend on the runtime: Node, Bun, Deno and Cloudflare adapters use the same hub with their own WebSocket.
- **Delivery.** At most once, without queueing or resending: a disconnected peer loses messages. A peer that does not read (full buffer or broker queue) closes to avoid slowing down the rest of the room.
- **Sessions.** The session loads at handshake; revocation closes the peer immediately. Channel authorization also runs on each delivery.
- **Security.** Validates events in both directions; an invalid message closes the peer with `1008` without running any handler.

---
title: LocalSocketPubSub
group: server
since: 1.0.0
description: Socket broadcast broker within a single process, used by the hub by default in Node, Bun and Deno; does not reach other instances.
symbols:
  - "@meekojs/meeko/server#LocalSocketPubSub"
types:
  - "@meekojs/meeko/server#LocalSocketPubSubOptions"
  - "@meekojs/meeko/server#SocketPubSub"
  - "@meekojs/meeko/server#SocketMessage"
related:
  - "@meekojs/meeko/server#RedisSocketPubSub"
  - "@meekojs/meeko/cloudflare#DurableObjectSocketPubSub"
  - "@meekojs/meeko/server#defineSocketChannel"
  - "@meekojs/meeko/server#createSocketHub"
  - docs/framework.md#broadcast-y-varias-instancias
  - docs/framework.md#broadcast-desde-el-servidor
source-hash: 9134a574ee6717e32b4538b6eb93171a32b25335d9491cb1bc680c12d8628ec3
---

`LocalSocketPubSub` distributes Socket broadcasts among peers connected to **this** process: each channel/room pair is a set of in-memory listeners, and `publish` calls them and waits for their local delivery attempts. It is the hub's default broker in Node, Bun and Deno when `server/runtime.ts` does not declare `socket.pubsub`.

With a single instance, nothing else is needed. With multiple replicas or processes, a broadcast in one does not reach peers in the others: use `RedisSocketPubSub`. It is not supported in Cloudflare Workers. Since `1.7`, if a production application has channels and does not declare `socket.pubsub`, Meeko warns once that it is using this broker; explicitly declaring it (`new LocalSocketPubSub()`) indicates a single-instance deployment and removes the warning.

## Usage

```ts
// server/runtime.ts
import { defineServerRuntime, LocalSocketPubSub } from "@meekojs/meeko/server";

export default defineServerRuntime(() => ({
  socket: {
    pubsub: new LocalSocketPubSub({ onListenerError: (error) => console.warn("[socket] listener", error) }),
  },
}));
```

Without `socket.pubsub`, the hub creates an identical one with `console.error` as observer, and warns once in production (since `1.7`).

## Parameters

`new LocalSocketPubSub(options?)`:

| Option            | Type                       | Default                                                  | Description                                                                                                                                    |
| ----------------- | -------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `onListenerError` | `(error: unknown) => void` | `console.error("[meeko] Socket listener failed", error)` | Receives a listener failure. Hub listeners never fail; this covers custom listeners. An observer that throws does not stop delivery to others. |

## Return value

A `SocketPubSub`:

| Method                                       | Description                                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `publish(channel, room, { event, payload })` | Calls all listeners for the channel/room pair and resolves when their delivery attempts finish. |
| `subscribe(channel, room, listener)`         | Adds a listener and synchronously returns the function to remove it.                            |

## Examples

### Broadcast from an API

<!-- no-check -->

```ts
// server/api/orders/[id]/ready.post.ts
export default defineApiRoute({
  params: orderParams,
  response: orderSchema,
  handler: async ({ params }) => {
    const order = await markReady(params.id);
    // Valida evento y payload con el contrato del canal y publica en el broker del hub.
    await socket.operations.broadcast(order.storeId, "kitchenChanged", { orderId: order.id, status: "ready" });
    return order;
  },
});
```

`broadcast` uses the runtime's broker: this same code works with `LocalSocketPubSub`, `RedisSocketPubSub` or the Workers Durable Object.

### Listen to a channel/room pair in a test

```ts
import { LocalSocketPubSub } from "@meekojs/meeko/server";

const pubsub = new LocalSocketPubSub();
const received: unknown[] = [];
const stop = pubsub.subscribe("chat", "general", (message) => { received.push(message.payload); });
await pubsub.publish("chat", "general", { event: "message", payload: { text: "Hola" } });
await pubsub.publish("chat", "otra", { event: "message", payload: { text: "No llega" } });
stop();
console.log(received); // [{ text: "Hola" }]
```

### Choose the broker according to the deployment

<!-- no-check -->

```ts
// server/runtime.ts
export default defineServerRuntime(async ({ env }) => {
  if (!env.MEEKO_REDIS_URL) return { socket: { pubsub: new LocalSocketPubSub() } }; // una sola instancia
  const { publisher, subscriber } = await connectRedis(env.MEEKO_REDIS_URL);
  return {
    socket: { pubsub: new RedisSocketPubSub({ publisher, subscriber, prefix: "app:prod:" }) },
    close: async () => { await subscriber.quit(); await publisher.quit(); },
  };
});
```

## Common mistakes

### Multiple instances with the local broker

```text bad
2 réplicas tras un balanceador, sin socket.pubsub (LocalSocketPubSub por defecto)
```

`broadcast` resolves, but only peers connected to the replica that published it receive the message: users on the other replica do not see the change. Since `1.7`, a production application with channels and without `socket.pubsub` warns once per process at startup, like the in-memory `rateLimit` counter: `[meeko] Los canales de Socket usan LocalSocketPubSub, el broker en memoria de cada instancia: …`. Meeko cannot count replicas, so the warning also appears with a single instance; declare `new LocalSocketPubSub()` to remove it.

<!-- no-check -->

```ts good
socket: { pubsub: new RedisSocketPubSub({ publisher: redis, subscriber, prefix: "app:prod:" }) }
```

### Use it in Cloudflare Workers

```ts bad
socket: { pubsub: new LocalSocketPubSub() } // en un Worker
```

Connections live in each room's Durable Object, not in the isolate. The Worker rejects the application on creation: `Socket channels on Cloudflare Workers require DurableObjectSocketPubSub: leave runtime.socket.pubsub unset and bind MEEKO_SOCKET, or set it to new DurableObjectSocketPubSub(env.MEEKO_SOCKET)…`.

<!-- no-check -->

```ts good
socket: env.MEEKO_SOCKET ? { pubsub: new DurableObjectSocketPubSub(env.MEEKO_SOCKET) } : {}
```

## Notes

- **Delivery.** At most once per peer, in publication order; a peer whose queue exceeds `maxPendingDeliveries` closes with `1013`.
- **Validation.** The hub validates the event and payload before publishing and again on delivery; the broker only transports them.
- **Memory.** A room's listeners are released when its last peer leaves.
- **Development.** In `meeko dev`, recreating the application (creating or deleting a route) closes open connections and clients reconnect.

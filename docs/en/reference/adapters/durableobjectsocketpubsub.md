---
title: DurableObjectSocketPubSub
group: adapters
since: 1.0.0
description: The Socket broker for Cloudflare Workers, where each channel and room is a Durable Object that receives publications over RPC and distributes them to its peers.
symbols:
  - "@meekojs/meeko/cloudflare#DurableObjectSocketPubSub"
types:
  - "@meekojs/meeko/cloudflare#DurableObjectNamespaceLike"
  - "@meekojs/meeko/server#SocketPubSub"
related:
  - "@meekojs/meeko/cloudflare#createSocketRoomClass"
  - "@meekojs/meeko/cloudflare#createWorker"
  - "@meekojs/meeko/cloudflare#socketRoomName"
  - "@meekojs/meeko/server#LocalSocketPubSub"
  - "@meekojs/meeko/server#RedisSocketPubSub"
  - docs/framework.md#socket-y-durable-objects
  - docs/framework.md#broadcast-desde-el-servidor
source-hash: aba3abbcd9e46ea14da16e390207d3312289ce2c75d3eadaa056567b7b5b3cea
---

On Workers, Socket connections do not live in the isolate handling the request, but in their room's Durable Object. `DurableObjectSocketPubSub` is the only broker that reaches them: `publish` delivers the message to the room over RPC (or directly, if already running inside that room) and resolves when the room accepts it; the room distributes it to its peers in publication order.

It is the default broker on Workers: with the `MEEKO_SOCKET` binding and no `socket.pubsub`, the generated Worker uses it. Declare it only to make it explicit or use another binding; any other broker is rejected.

## Usage

```ts
// server/runtime.ts
import { DurableObjectSocketPubSub } from "@meekojs/meeko/cloudflare";
import type { DurableObjectNamespaceLike } from "@meekojs/meeko/cloudflare";
import { defineServerRuntime } from "@meekojs/meeko/server";

interface Env { readonly MEEKO_SOCKET?: DurableObjectNamespaceLike }

export default defineServerRuntime<Env>(({ env }) => ({
  socket: env.MEEKO_SOCKET ? { pubsub: new DurableObjectSocketPubSub(env.MEEKO_SOCKET) } : {},
}));
```

`env.MEEKO_SOCKET` does not exist during prerendering, which runs in Node.

## Parameters

`new DurableObjectSocketPubSub(namespace)`:

| Parameter   | Type                         | Description                                                                                                   |
| ----------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `namespace` | `DurableObjectNamespaceLike` | The room namespace binding, usually `env.MEEKO_SOCKET`, whose class was created with `createSocketRoomClass`. |

## Return value

A `SocketPubSub`:

| Method                               | Description                                                                                                                                                                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publish(channel, room, message)`    | Delivers the message to the Durable Object for `socketRoomName(channel, room)` and resolves when it accepts it. Rejects with `SOCKET_BACKLOG_EXCEEDED` (`503`) if the room already has `maxPendingPublications` undelivered publications. |
| `subscribe(channel, room, listener)` | Only inside the room's Durable Object, where the hub subscribes its peers.                                                                                                                                                                |

## Examples

### Broadcasting from an API

<!-- no-check -->

```ts
// server/api/documents/[id]/publish.post.ts
export default defineApiRoute({
  params: documentParams,
  response: documentSchema,
  auth: "required",
  handler: async ({ params }) => {
    const document = await publishDocument(params.id);
    await socket.documents.broadcast(document.id, "published", { id: document.id, at: document.publishedAt });
    return document;
  },
});
```

The same code works on Node with `LocalSocketPubSub` or `RedisSocketPubSub`: `broadcast` uses the runtime's broker.

### One room per document

```text
/_meeko/socket/documents?room=doc_42  → Durable Object "documents\u0000doc_42"
/_meeko/socket/documents?room=doc_43  → Durable Object "documents\u0000doc_43"
```

Each room processes its messages on a single thread: dividing rooms by document scales better than a global room.

## Common mistakes

### A binding that is not for Durable Objects

```ts bad
new DurableObjectSocketPubSub(env.DB as never);
```

`TypeError: DurableObjectSocketPubSub requires a Durable Object namespace binding`.

<!-- no-check -->

```ts good
new DurableObjectSocketPubSub(env.MEEKO_SOCKET);
```

### Subscribing outside the room

```ts bad
new DurableObjectSocketPubSub(env.MEEKO_SOCKET).subscribe("chat", "general", (message) => console.log(message));
```

`Error: DurableObjectSocketPubSub subscribes only inside the Socket room Durable Object; forward upgrades with createWorker`. Subscriptions exist only inside the room; every upgrade must go through `createWorker`.

<!-- no-check -->

```ts good
export default createWorker(createCloudflareApp); // reenvía cada upgrade a su sala
```

### A room class that is not Meeko's

```text bad
MEEKO_SOCKET apunta a una clase Durable Object propia
```

The first `publish` rejects with `TypeError: The Socket Durable Object must be created with createSocketRoomClass`: the room must expose the `meekoPublish` RPC.

```text good
export const MeekoSocketRoom = createSocketRoomClass(createCloudflareApp, DurableObject);
```

### Another broker on Workers

```ts bad
socket: { pubsub: new LocalSocketPubSub() }
```

The Worker and room reject the application on creation: `Socket channels on Cloudflare Workers require DurableObjectSocketPubSub: leave runtime.socket.pubsub unset and bind MEEKO_SOCKET, or set it to new DurableObjectSocketPubSub(env.MEEKO_SOCKET)…`.

<!-- no-check -->

```ts good
socket: {} // el Worker usa DurableObjectSocketPubSub(env.MEEKO_SOCKET)
```

## Notes

- **Delivery.** At most once, in publication order per room. A publication to the same room does not use RPC.
- **Validation.** The hub validates the event and payload before publishing; the room validates them again and applies `authorize` and `authorizeSend` to each peer.
- **Hibernation.** A publication wakes the room if it was hibernating; it waits at most `rebuildTimeoutMs` for connections to be reconstructed.
- **No TCP or Redis.** No external broker is needed: the Durable Object is each room's single coordination point.

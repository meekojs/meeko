---
title: socket
group: utils
since: 1.0.0
description: Generated registry of server/socket channels, with typed on and emit in the browser and typed broadcast on the server.
symbols:
  - "autoimport:socket"
types:
  - "@meekojs/meeko/framework#SocketClient"
  - "@meekojs/meeko/framework#SocketRegistry"
related:
  - "@meekojs/meeko/server#defineSocketChannel"
  - "autoimport:useSocket"
  - "@meekojs/meeko/framework#createSocketClient"
  - "@meekojs/meeko/framework#useSocketClient"
  - "@meekojs/meeko/server#RedisSocketPubSub"
  - docs/framework.md#websocket
  - docs/framework.md#broadcast-desde-el-servidor
source-hash: fa3156c16460b9622cbaa31a4486efb75228f636596515e08a58063344c52734
---

`socket` is the registry Meeko generates from `server/socket` channels: `server/socket/chat.ts` becomes `socket.chat`. Events and their payloads have the types of the channel's `clientToServer` and `serverToClient` schemas.

It is auto-imported, with two sides:

- **In the browser**, `socket.chat` is a WebSocket client for the channel, with `on(evento, listener)`, `emit(evento, payload)`, `state` and `close()`. The connection opens the first time the channel is accessed in the browser.
- **On the server** (API, RPC, `<script server>`, middleware and Socket handlers), since `1.2`, `socket.chat.broadcast(sala, evento, payload)` publishes an event to a room, typed against the channel contract.

## Usage

<!-- no-check -->

```ts
// server/api/orders/[id]/ready.post.ts: notifies the kitchen room
import { defineApiRoute } from "@meekojs/meeko/server";
import { orderParams, orderSchema } from "../../../../shared/schemas/order";

export default defineApiRoute({
  params: orderParams,
  response: orderSchema,
  auth: "required",
  handler: async ({ params }) => {
    const order = await markReady(params.id);
    await socket.operations.broadcast(order.kitchenId, "kitchenChanged", { orderId: order.id, status: "ready" });
    return order;
  },
});
```

<!-- no-check -->

```ts
// app/plugins/kitchen.client.ts: listens in the browser
import { definePlugin } from "@meekojs/meeko/framework";

export default definePlugin(() => {
  socket.operations.on("kitchenChanged", (change) => console.info(`Pedido ${change.orderId}: ${change.status}`));
});
```

## Parameters

| Call                                                | Parameters                                       | Description                                                       |
| --------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------- |
| `socket.<canal>.on(evento, listener)`               | a `serverToClient` event and `(payload) => void` | In the browser. The payload arrives validated against its schema. |
| `socket.<canal>.emit(evento, payload)`              | a `clientToServer` event and its input           | In the browser. The server validates it again.                    |
| `socket.<canal>.broadcast(roomId, evento, payload)` | the room, a `serverToClient` event and its input | On the server, since `1.2`.                                       |

## Return value

In the browser, each channel is a `SocketClient`:

| Member                  | Type                                                                        | Description                                                                                              |
| ----------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `on(evento, listener)`  | `() => void`                                                                | Listens to a `serverToClient` event, with its validated payload. Returns the function to stop listening. |
| `emit(evento, payload)` | `Promise<void>`                                                             | Sends a `clientToServer` event. Rejects if the channel is not open: no queue or resend.                  |
| `state`                 | `ReadonlySignal<"connecting" \| "open" \| "closed" \| "unauthorized" \| …>` | Connection state. `"unauthorized"` is terminal: the server rejected the session.                         |
| `close()`               | `void`                                                                      | Closes the channel.                                                                                      |

On the server, each channel has `broadcast(roomId, evento, payload): Promise<void>`.

## Examples

### A connection indicator

`state` is a signal, so the template tracks it:

```html
<script lang="ts">
const state = typeof window === "undefined" ? undefined : socket.chat.state;
</script>

<template>
  <span class="dot" bind:data-state="state?.value ?? 'connecting'">{state?.value ?? "connecting"}</span>
</template>
```

### Start and stop listening

`socket` is application-scoped: a listener registered outside a component is canceled with the function returned by `on`.

<!-- no-check -->

```ts
const off = socket.chat.on("message", (message) => console.log(message.author, message.text));
// …
off();
```

In a component, `useSocket("chat", { roomId })` creates a dedicated connection that closes on unmount, and is the recommended approach for rooms.

## Common mistakes

### A payload that fails its schema

```ts bad
await socket.chat.emit("message", { body: "Hello" });
```

`meeko check` reports `TS2353: Object literal may only specify known properties, and 'body' does not exist in type '{ text: string; }'.`

<!-- no-check -->

```ts good
await socket.chat.emit("message", { text: "Hello" });
```

### A channel or event that does not exist

```ts bad
socket.lobby.emit("message", { text: "x" });
socket.chat.on("typing", () => {});
```

`meeko check` reports `TS2339: Property 'lobby' does not exist on type 'SocketRegistry<…>'.` and `TS2345: Argument of type '"typing"' is not assignable to parameter of type '"message"'.`

<!-- no-check -->

```ts good
socket.chat.on("message", (message) => console.log(message.text));
```

## Notes

- **SSR.** No connection opens during SSR. To listen in a component, `await useSocket(…)` splits setup and the rest only runs in the browser.
- **Delivery.** At most once: `emit` rejects if the channel is disconnected. The client reconnects with backoff, except after session rejection (`"unauthorized"`).
- **Security.** The server validates `Origin`, session, room, event and payload; an invalid incoming message closes the channel. `broadcast` checks the event and payload against the contract, unlike publishing manually to `SocketPubSub`.
- **Multiple instances.** `broadcast` publishes to the runtime's broker (`socket.pubsub`): in memory with one instance; with multiple instances, `RedisSocketPubSub` or Workers Durable Objects.
- **Errors.** A transport or listener failure reaches the application's error observer (`mountClientApp({ onError })` or the active `provideErrorHandler`); without one, the console.

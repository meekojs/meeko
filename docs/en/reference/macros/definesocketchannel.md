---
title: defineSocketChannel
group: macros
since: 1.0.0
description: Declares a WebSocket channel in server/socket with schemas for each direction, per-room and per-event guards, and handlers for client messages.
symbols:
  - "@meekojs/meeko/server#defineSocketChannel"
types:
  - "@meekojs/meeko/server#SocketChannelDefinition"
related:
  - "autoimport:socket"
  - "autoimport:useSocket"
  - "@meekojs/meeko/server#defineServerRuntime"
  - "@meekojs/meeko/server#RedisSocketPubSub"
  - docs/framework.md#websocket
  - docs/framework.md#broadcast-desde-el-servidor
  - docs/framework.md#broadcast-y-varias-instancias
source-hash: c86bc19fde8f894a54ab55c004235a94d73a832cf5e129d52768816410eafce3
---

`defineSocketChannel` declares a WebSocket channel: the default export of `server/socket/<nombre>.ts`. It declares, using schemas from `shared/`, events sent by the client (`clientToServer`) and server (`serverToClient`), guards for the connection, each room and each event, and handlers for incoming messages.

The generator emits a public contract with schemas, without importing handlers, for `useSocket`, the browser's `socket` registry and the server's `socket.<canal>.broadcast`. The hub validates `Origin`, session, channel, room, event and payload on every message.

## Usage

<!-- no-check -->

```ts
// shared/schemas/chat.ts
import * as v from "valibot";

export const chatInput = v.object({ text: v.pipe(v.string(), v.minLength(1), v.maxLength(500)) });
export const chatMessage = v.object({ text: v.string(), author: v.string() });
```

<!-- no-check -->

```ts
// server/socket/chat.ts
import { defineSocketChannel } from "@meekojs/meeko/server";
import { chatInput, chatMessage } from "../../shared/schemas/chat";

export default defineSocketChannel({
  clientToServer: { message: chatInput },
  serverToClient: { message: chatMessage },
  auth: "required",
  authorize: ({ context, roomId }) => !!context.session.current && roomId === "general",
  handlers: {
    message: async ({ payload, roomId, context }) => {
      await socket.chat.broadcast(roomId ?? "general", "message", { text: payload.text, author: context.session.current!.id });
    },
  },
});
```

```html
<!-- app/pages/chat.meeko -->
<script lang="ts">
const messages = signal<{ text: string; author: string }[]>([]);
const draft = signal("");
// useSocket sin await sólo existe en el navegador: en SSR no hay conexión.
const chat = typeof window === "undefined" ? undefined : useSocket("chat", { roomId: "general" });
chat?.on("message", (message) => {
  messages.value = [...messages.value, message];
});
async function send(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  await chat?.emit("message", { text: draft.value });
  draft.value = "";
}
</script>

<template>
  <ul aria-live="polite"><li each:of="messages.value" each:as="message">{message.author}: {message.text}</li></ul>
  <form on:submit="send"><input model="draft" aria-label="Mensaje"><button>Enviar</button></form>
</template>
```

## Options

| Option           | Type                                                                          | Default      | Description                                                                                                |
| ---------------- | ----------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| `clientToServer` | `{ [evento]: schema }`                                                        | required     | Events sent by the client, with schemas from `shared/`. An invalid payload closes the channel.             |
| `serverToClient` | `{ [evento]: schema }`                                                        | required     | Events sent by the server, with schemas from `shared/`.                                                    |
| `auth`           | `"required" \| "optional"`                                                    | `"optional"` | `"required"` rejects connections without a session: the server accepts the upgrade and closes with `4401`. |
| `authorize`      | `({ context, roomId }) => boolean \| Promise<boolean>`                        | none         | Authorizes connection to a room and each delivery; `false` closes with `4403`.                             |
| `authorizeEvent` | `({ event, payload, context, roomId }) => boolean \| Promise<boolean>`        | none         | Authorizes each incoming event.                                                                            |
| `authorizeSend`  | `({ event, payload, context, roomId }) => boolean \| Promise<boolean>`        | none         | Filters each send to a peer: with `false`, it does not receive it and remains connected.                   |
| `handlers`       | `{ [evento]: ({ payload, context, roomId, emit }) => void \| Promise<void> }` | none         | One handler per client event, with the payload already validated. `emit` replies only to that client.      |

Each event can use shorthand (`{ message }`) when the imported schema has the same name as the event.

## Return value

The same definition, with inferred types. The hub uses it to validate and dispatch; the generator uses it for the channel's public contract.

## Examples

### Notify a room from the API

`socket.<canal>.broadcast(roomId, evento, payload)`, auto-imported on the server, publishes a typed event using the channel contract:

<!-- no-check -->

```ts
// server/socket/operations.ts
import { defineSocketChannel } from "@meekojs/meeko/server";
import { kitchenChanged, subscribe } from "../../shared/schemas/operations";

export default defineSocketChannel({
  clientToServer: { subscribe },
  serverToClient: { kitchenChanged },
  auth: "required",
});
```

<!-- no-check -->

```ts
// server/api/orders/[id]/ready.post.ts
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

### Rooms per team

`authorize` decides who enters each room; `authorizeEvent`, what they can send:

<!-- no-check -->

```ts
// server/socket/team.ts
import { defineSocketChannel } from "@meekojs/meeko/server";
import { teamEvent, teamUpdate } from "../../shared/schemas/team";

export default defineSocketChannel({
  clientToServer: { teamEvent },
  serverToClient: { teamUpdate },
  auth: "required",
  authorize: async ({ context, roomId }) => !!roomId && (await isMember(context, roomId)),
  authorizeEvent: ({ payload }) => typeof payload === "object" && payload !== null,
  handlers: {
    teamEvent: async ({ payload, roomId }) => {
      if (roomId) await socket.team.broadcast(roomId, "teamUpdate", { kind: payload.kind });
    },
  },
});
```

## Common mistakes

### A schema outside `shared/`

```ts bad
export default defineSocketChannel({
  clientToServer: { message: v.object({ text: v.string() }) },
  serverToClient: { message: chatMessage },
});
```

`meeko check` stops with `server\socket\chat.ts: clientToServer.message debe referenciar un schema importado de shared/`. A schema with `any`, `unknown` or unresolved types reports `… debe exponer tipos de entrada y salida de Standard Schema concretos`.

<!-- no-check -->

```ts good
import { chatInput, chatMessage } from "../../shared/schemas/chat";
export default defineSocketChannel({ clientToServer: { message: chatInput }, serverToClient: { message: chatMessage } });
```

### Emitting a payload that fails the schema

```ts bad
handlers: { message: async ({ payload, emit }) => emit("message", payload) },
```

With `chatMessage` requiring `author`, `meeko check` reports `TS2741: Property 'author' is missing in type '{ text: string; }' but required in type '{ author: string; text: string; }'.`

<!-- no-check -->

```ts good
handlers: { message: async ({ payload, emit }) => emit("message", { text: payload.text, author: "sistema" }) },
```

### Using `roomId` without checking it

The client can connect without a room, so `roomId` is optional.

```ts bad
authorize: ({ roomId }) => roomId.startsWith("team-"),
```

`meeko check` reports `TS18048: 'roomId' is possibly 'undefined'.`

<!-- no-check -->

```ts good
authorize: ({ roomId }) => roomId?.startsWith("team-") ?? false,
```

## Notes

- **Security.** `Origin` is checked before the upgrade, using `publicOrigin` from `server/runtime.ts` or `MEEKO_PUBLIC_ORIGIN`. `auth` and `authorize` reject with close codes `4401` and `4403`, which the client converts to the terminal `"unauthorized"` state without retrying. An invalid incoming message closes the channel.
- **Delivery.** At most once: the client's `emit` rejects if disconnected, without queuing or resending. The hub enforces message size and buffer limits, heartbeat and graceful shutdown.
- **Multiple instances.** `broadcast` publishes through the runtime's `SocketPubSub`: in memory with one instance, or with `RedisSocketPubSub` (or Durable Objects on Workers) with several.
- **Adapters.** Node uses `ws`, Bun its native WebSocket, Deno `Deno.upgradeWebSocket` and Cloudflare Workers a Durable Object with hibernation per room.
- **SSR.** No connection opens on the server. `await useSocket(…)` in a component splits setup: the rest runs only in the browser, with the socket already open, and the template cannot use declarations after it (`MEEK057`), such as the sending handler. For a sending form, use `useSocket` without `await` after checking `window`, as in the example.

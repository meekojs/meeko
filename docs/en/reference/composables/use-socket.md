---
title: useSocket
group: composables
since: 1.0.0
description: Connects a component to a server/socket channel with typed events and closes the connection on unmount.
symbols:
  - "autoimport:useSocket"
types:
  - "@meekojs/meeko/framework#SocketClient"
  - "@meekojs/meeko/framework#SocketRegistryOptions"
related:
  - "@meekojs/meeko/framework#useSocketChannel"
  - "@meekojs/meeko/framework#useSocketClient"
  - "autoimport:socket"
  - "@meekojs/meeko/server#defineSocketChannel"
  - "@meekojs/meeko#provideErrorHandler"
  - docs/framework.md#websocket
  - docs/api.md#composables-de-nivel-superior-y-await
source-hash: ce904a3699392b65fdb3af3c1106703cef914b95a6a4e2d8a6a806c4eb20cc47
---

`useSocket(canal, opciones?)` opens a client for the `server/socket` channel `canal`, tied to the component: `emit` and `on` events are typed by channel schemas and the connection closes when the component unmounts. With `await` at the script's top level, the rest of setup continues in the browser once the socket opens.

Application clients generate it from `server/socket` channels and it is auto-imported in `.meeko` files. In a project without generated clients, the auto-import is `useSocketClient(url, contrato, opciones)`.

## Usage

```html
<!-- app/pages/chat.meeko -->
<script lang="ts">
const messages = signal<string[]>([]);
const chat = await useSocket("chat", { roomId: "general" });
// Desde aquí, sólo en el navegador y con el socket abierto.
chat.on("message", (message) => { messages.value = [...messages.value, message.text]; });
</script>

<template><p each:of="messages.value" each:as="text">{text}</p></template>
```

Server HTML has an empty list; on mount, the browser opens the channel and the continuation subscribes to messages.

## Parameters

| Parameter                                 | Type                       | Default            | Description                                                                             |
| ----------------------------------------- | -------------------------- | ------------------ | --------------------------------------------------------------------------------------- |
| `canal`                                   | a channel name             | required           | One of the `server/socket` files, such as `"chat"`. A nonexistent name is a type error. |
| `opciones.roomId`                         | `string`                   | none               | Room to join (`?room=`); the channel receives it in `authorize` and its handlers.       |
| `opciones.baseUrl`                        | `string`                   | browser origin     | HTTP(S) or WS(S) base URL.                                                              |
| `opciones.pathnamePrefix`                 | `string`                   | `"/_meeko/socket"` | Channel route prefix.                                                                   |
| `opciones.retryMs`, `opciones.maxRetryMs` | `number`                   | `500`, `30000`     | Reconnection backoff: the initial delay doubles on each attempt up to the maximum.      |
| `opciones.maxMessageBytes`                | `number`                   | 64 KiB             | Maximum incoming message size.                                                          |
| `opciones.onError`                        | `(error: unknown) => void` | nearest observer   | Invalid messages, listener failures and authorization rejections.                       |

## Return value

A `SocketClient` for the channel contract:

| Property               | Type                                                                   | Description                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `state`                | `ReadonlySignal<"connecting" \| "open" \| "closed" \| "unauthorized">` | Connection state. `"unauthorized"` is terminal: the server rejected the session or authorization and the client does not retry. |
| `emit(evento, datos)`  | `Promise<void>`                                                        | Validates and sends a `clientToServer` event. Rejects if the socket is not open or data is invalid: there is no queue.          |
| `on(evento, listener)` | `() => void`                                                           | Listens to an already validated `serverToClient` event; returns the function to stop listening.                                 |
| `close()`              | `void`                                                                 | Closes the connection and stops reconnecting.                                                                                   |

With `await`, the promise resolves with the client once its state is `"open"`.

## Examples

### Send and receive

```html
<script lang="ts">
const draft = signal("");
const messages = signal<{ text: string }[]>([]);
const chat = await useSocket("chat", { roomId: "general" });
chat.on("message", (message) => { messages.value = [...messages.value, message]; });
async function send(): Promise<void> {
  await chat.emit("message", { text: draft.value, roomId: "general" });
  draft.value = "";
}
</script>

<template>
  <p each:of="messages.value" each:as="message">{message.text}</p>
  <input model="draft">
</template>
```

`send` is declared after `await`, so the template cannot use it (`MEEK057`): call it from browser code, or declare what the template needs before `await`.

### Without `await`, with connection state

Since `1.7`, `useSocket` without `await` can also be called during component setup with SSR: on the server it returns an inert client that remains `"connecting"`, so HTML uses the initial state and the browser opens the connection on mount. Through `1.6`, it threw in SSR and you had to check `window`. Render the state:

```html
<script lang="ts">
const chat = useSocket("chat", { roomId: "general" });
const online = computed(() => chat.state.value === "open");
const send = (text: string) => chat.emit("message", { text, roomId: "general" });
</script>

<template><span class="dot" bind:data-online="String(online.value)">{online.value ? "Conectado" : "Conectando…"}</span></template>
```

### A channel with authorization

<!-- no-check -->

```ts
// server/socket/room.ts
import { defineSocketChannel } from "@meekojs/meeko/server";
import { roomMessage } from "../../shared/schemas/room.js";

export default defineSocketChannel({
  clientToServer: { message: roomMessage },
  serverToClient: { message: roomMessage },
  auth: "required",
  authorize: ({ context, roomId }) => !!context.session.current && roomId === context.session.current.data.teamId,
  handlers: { message: async ({ payload, emit }) => emit("message", payload) },
});
```

If `authorize` returns `false`, the client becomes `"unauthorized"`, does not retry and the error observer receives a `403` `ClientError` (`FORBIDDEN`).

## Common mistakes

### A channel or event that does not exist

```ts bad
const chat = await useSocket("chats");
chat.on("mesage", (message) => console.log(message));
```

`meeko check` reports `TS2345: Argument of type '"chats"' is not assignable to parameter of type '"chat"'` and, for the event, `TS2345: Argument of type '"mesage"' is not assignable to parameter of type '"message"'`.

<!-- no-check -->

```ts good
const chat = await useSocket("chat");
chat.on("message", (message) => console.log(message.text));
```

### Use a name declared after `await` in the template

```html bad
<script lang="ts">
const chat = await useSocket("chat", { roomId: "general" });
const messages = signal<string[]>([]);
</script>
<template><p>{messages.value.length}</p></template>
```

`meeko check` reports `MEEK057: La plantilla no puede usar messages: se declara en la línea 3, después del primer await de navegador, y sólo existe en el navegador una vez montado el componente. Declara ese nombre antes de ese await`.

```html good
<script lang="ts">
const messages = signal<string[]>([]);
const chat = await useSocket("chat", { roomId: "general" });
</script>
<template><p>{messages.value.length}</p></template>
```

### Rely on `emit` to wait for connection

```ts bad
const chat = useSocket("chat");
void chat.emit("message", { text: "Hola", roomId: "general" }); // aún "connecting"
```

`emit` rejects with `Socket is disconnected` while the socket is not open: no queue or resend. Await connection with `await useSocket(...)` or check `state` before sending.

<!-- no-check -->

```ts good
const chat = await useSocket("chat");
await chat.emit("message", { text: "Hola", roomId: "general" });
```

## Notes

- **SSR.** Never opens a connection on the server: since `1.7`, it returns an inert client there instead of throwing `useSocketClient() is only available in the browser`. In the browser, neither the render producing component HTML before mounting nor dry runs open it: they return a client remaining `"connecting"` whose `emit` rejects; mounting opens the connection, once.
- **Continuation.** After `await useSocket(...)`, the rest of the script runs only in the browser, with the component mounted. If the socket never opens, the continuation keeps waiting; if the component unmounts while waiting, it does not resume.
- **Delivery.** At most once: no queue or resend. Invalid incoming messages close the channel. Reconnection uses exponential backoff.
- **Security.** The server checks path, `Origin` and session before upgrading, and validates each event against its schemas. Client-visible schemas come from `shared/`.
- **Application registry.** `socket.chat` is an application-scoped alternative, one connection per mounted application; `useSocket` ties the connection to the component.

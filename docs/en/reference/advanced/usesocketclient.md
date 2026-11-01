---
title: useSocketClient
group: advanced
since: 1.1.0
description: Creates a component's Socket client with explicit URL and contract, closing it on unmount and using its error observer.
symbols:
  - "@meekojs/meeko/framework#useSocketClient"
types:
  - "@meekojs/meeko/framework#SocketClient"
  - "@meekojs/meeko/framework#SocketClientOptions"
related:
  - "@meekojs/meeko/framework#createSocketClient"
  - "autoimport:useSocket"
  - "@meekojs/meeko/framework#useSocketChannel"
  - "@meekojs/meeko#provideErrorHandler"
  - docs/framework.md#clientes-con-url-y-contrato-explícitos
  - docs/framework.md#websocket
source-hash: 9c928390f873a16e79eac9577b945836ff388b639bcd1e9b01517d104c35770d
---

`useSocketClient` is [`createSocketClient`](/en/docs/reference/createsocketclient) tied to a component: it creates the client with the URL and contract you pass, closes it with `onCleanup` when the component unmounts (also on page changes) and, without its own `onError`, reports failures to the nearest `provideErrorHandler` or the application's `onError`.

This is the low-level form, for a channel outside your application or with a computed URL. For `server/socket` channels, the auto-import `useSocket("chat", opciones)` already knows the URL and generated contract; it is not this function. Since `1.1`, `useSocket` from `@meekojs/meeko/framework` is a deprecated alias for `useSocketClient`.

## Usage

```html
<!-- app/components/Ticker.meeko -->
<script lang="ts">
import { signal } from "@meekojs/meeko";
import { useSocketClient } from "@meekojs/meeko/framework";
import { tickerContract } from "../../shared/ticker";

const price = signal<number | undefined>(undefined);
const ticker = await useSocketClient("wss://precios.example.com/_meeko/socket/ticker?room=EURUSD", tickerContract);
ticker.on("price", (data) => { price.value = data.value; });
</script>

<template>
  <p>EUR/USD: {price.value ?? "…"}</p>
</template>
```

With `await`, the server renders the component up to that line (here, `EUR/USD: …`) and the rest of setup continues in the browser once the socket is open.

## Parameters

| Parameter  | Type                  | Default  | Description                                                                                                                                     |
| ---------- | --------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`      | text                  | required | Channel `ws:` or `wss:` URL, with `?room=` if needed.                                                                                           |
| `contract` | `SocketContract`      | required | Each event's schemas in each direction.                                                                                                         |
| `options`  | `SocketClientOptions` | `{}`     | `retryMs`, `maxRetryMs`, `maxMessageBytes`, `webSocketFactory` and `onError`. Without `onError`, failures go to the component's error observer. |

## Return value

The same `SocketClient` as `createSocketClient` (`state`, `emit`, `on`, `close`), automatically closed on component unmount. With `await`, the expression resolves when the socket is open.

In an HTML-only render in the browser, it returns an inert client without a connection, whose `emit` rejects with `Socket is disconnected`.

## Examples

### A chat with connection state

```html
<!-- app/components/Chat.meeko -->
<script lang="ts">
import { effect, signal, untrack } from "@meekojs/meeko";
import { useSocketClient } from "@meekojs/meeko/framework";
import type { SocketClient } from "@meekojs/meeko/framework";
import { chatContract } from "../../shared/chat";

const props = defineProps<{ room: string }>();
const messages = signal<string[]>([]);
const draft = signal("");
const status = signal("connecting");
const connection: { client?: SocketClient<typeof chatContract> } = {};

async function send() {
  await connection.client?.emit("message", { text: draft.value });
  draft.value = "";
}

const room = untrack(() => props.room);
const chat = await useSocketClient(`wss://chat.example.com/_meeko/socket/chat?room=${encodeURIComponent(room)}`, chatContract, {
  onError: (error) => console.warn("chat", error),
});
connection.client = chat;
effect(() => { status.value = chat.state.value; });
chat.on("message", (data) => { messages.value = [...messages.value, data.text]; });
</script>

<template>
  <p if:when="status.value !== 'open'">Conectando…</p>
  <ul><li each:of="messages.value" each:as="text">{text}</li></ul>
  <form on:submit="(event) => { event.preventDefault(); void send(); }">
    <input model="draft" aria-label="Mensaje">
    <button type="submit">Enviar</button>
  </form>
</template>
```

Everything the template uses (`status`, `messages`, `draft`, `send`) is declared before `await`: what follows only exists in the browser. `effect` copies socket state to a signal already known to the server.

### A browser-only page

```html
<!-- app/pages/live.meeko -->
<script server lang="ts">
export const route = definePage({ render: "client" });
</script>

<script lang="ts">
import { useSocketClient } from "@meekojs/meeko/framework";
import { feedContract } from "../../shared/feed";

const feed = useSocketClient("wss://feed.example.com/_meeko/socket/feed", feedContract);
</script>

<template><p>Estado: {feed.state.value}</p></template>
```

With `render: "client"`, setup never runs on the server, so `await` is unnecessary.

## Common mistakes

### Emit without `await` during setup

```html bad
<script lang="ts">
import { useSocketClient } from "@meekojs/meeko/framework";
const chat = useSocketClient("wss://example.com/_meeko/socket/chat", chatContract);
void chat.emit("message", { text: "hola" });
</script>
```

Setup also runs on the server, where there are no sockets. Since `1.7`, `useSocketClient` returns an inert client there, remaining `"connecting"` (through `1.6`, rendering failed with `useSocketClient() is only available in the browser`), so the call no longer breaks SSR; but on the server, and in the browser before the socket opens, `emit` rejects with `Socket is disconnected`.

```html good
<script lang="ts">
import { useSocketClient } from "@meekojs/meeko/framework";
const chat = await useSocketClient("wss://example.com/_meeko/socket/chat", chatContract);
void chat.emit("message", { text: "hola" });
</script>
```

With `await`, the server stops before that line and the browser continues setup with the socket open.

### Use the client declared after `await` in the template

```html bad
<script lang="ts">
const chat = await useSocketClient("wss://example.com/_meeko/socket/chat", chatContract);
</script>

<template><p>{chat.state.value}</p></template>
```

`meeko check` reports `MEEK057: La plantilla no puede usar chat: se declara en la línea 2, después del primer await de navegador, y sólo existe en el navegador una vez montado el componente. Declara ese nombre antes de ese await`.

```html good
<script lang="ts">
import { effect, signal } from "@meekojs/meeko";
const status = signal("connecting");
const chat = await useSocketClient("wss://example.com/_meeko/socket/chat", chatContract);
effect(() => { status.value = chat.state.value; });
</script>

<template><p>{status.value}</p></template>
```

### Call it outside setup

```ts bad
button.addEventListener("click", () => {
  const chat = useSocketClient(url, chatContract);
});
```

Outside component setup, there is no root to attach cleanup to: the client closes and the call throws `onCleanup() requires an active component root`.

<!-- no-check -->

```ts good
button.addEventListener("click", () => {
  const chat = createSocketClient(url, chatContract);
  window.addEventListener("pagehide", () => chat.close(), { once: true });
});
```

### Confuse it with the `useSocket` auto-import

```html bad
<script lang="ts">
const chat = useSocketClient("chat");
</script>
```

`useSocketClient` receives a URL and contract: `meeko check` reports `TS2554: Expected 2-3 arguments, but got 1`. The `useSocket` auto-import receives the channel name and knows its contract.

```html good
<script lang="ts">
const chat = useSocket("chat");
</script>
```

## Notes

- **SSR.** Never opens a connection on the server. Without `await`, since `1.7` the call returns an inert client in SSR: `state` remains `"connecting"`, `on` registers nothing and `emit` rejects; through `1.6`, it threw. With `await`, the server renders up to that line and the browser continues; design the template so the first render does not depend on the socket.
- **Lifecycle.** The client closes with the component: navigating to another page, removing it with `if:when` or closing the application with `dispose()`.
- **Errors.** Without `onError`, invalid messages and listener failures reach the nearest `provideErrorHandler` or `mountClientApp`'s `onError`, like other component errors.
- **Deprecated.** `useSocket` imported from `@meekojs/meeko/framework` is an alias for this function since `1.1` and disappears in `2.0`; the editor marks it struck through. Applications' `useSocket(canal)` auto-import is not deprecated.

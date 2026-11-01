---
title: createSocketClient
group: advanced
since: 1.0.0
description: Low-level Socket client over native WebSocket, with explicit URL and contract, validation in both directions and exponential backoff reconnection.
symbols:
  - "@meekojs/meeko/framework#createSocketClient"
types:
  - "@meekojs/meeko/framework#SocketClientOptions"
  - "@meekojs/meeko/framework#SocketClient"
  - "@meekojs/meeko/framework#SocketContract"
related:
  - "@meekojs/meeko/framework#useSocketClient"
  - "autoimport:socket"
  - "autoimport:useSocket"
  - "@meekojs/meeko/server#defineSocketChannel"
  - "@meekojs/meeko/server#createSocketUpgradeHandler"
  - docs/framework.md#websocket
  - docs/framework.md#clientes-con-url-y-contrato-explícitos
source-hash: ce5471a34dccb1c3b7899ca68d9d70739c95b57658f18019bad3a3ace2443fd5
---

`createSocketClient` opens a `WebSocket` to a Socket channel with an explicit URL and contract. It validates every outgoing and incoming event against the contract schemas, automatically reconnects with exponential backoff and exposes its state as a signal. Delivery is at most once: `emit` rejects when disconnected, without a queue or resend.

It is not tied to a component: close it with `close()`. Inside a component, use [`useSocketClient`](/en/docs/reference/usesocketclient), which closes it on unmount; in an application, you typically use the auto-import `useSocket("chat")` or `socket.chat`, which already know each channel's URL and contract.

## Usage

```ts
import { createSocketClient } from "@meekojs/meeko/framework";
import type { Schema } from "@meekojs/meeko/server";

const message: Schema<{ text: string }> = {
  "~standard": {
    version: 1,
    validate: (value) => typeof value === "object" && value !== null && typeof (value as { text?: unknown }).text === "string"
      ? { value: value as { text: string } }
      : { issues: [{ message: "Se esperaba { text }" }] },
  },
};
const chatContract = { clientToServer: { message }, serverToClient: { message } };

const chat = createSocketClient("wss://example.com/_meeko/socket/chat?room=general", chatContract, {
  onError: (error) => console.warn("socket", error),
});
const stop = chat.on("message", (data) => console.log(data.text));
// Más tarde, con el socket abierto:
await chat.emit("message", { text: "Hola" });
stop();
chat.close();
```

## Parameters

| Parameter                  | Type                 | Default              | Description                                                                                             |
| -------------------------- | -------------------- | -------------------- | ------------------------------------------------------------------------------------------------------- |
| `url`                      | text                 | required             | Channel `ws:` or `wss:` URL: `<origen>/_meeko/socket/<canal>`, with `?room=` if the channel uses rooms. |
| `contract`                 | `SocketContract`     | required             | `{ clientToServer, serverToClient }`: each event's schema in each direction.                            |
| `options.retryMs`          | number               | 500                  | Initial reconnection delay; doubles on each attempt.                                                    |
| `options.maxRetryMs`       | number               | 30 000               | Maximum reconnection delay.                                                                             |
| `options.maxMessageBytes`  | number               | 65 536               | Largest incoming message; a larger one (or binary message) is discarded and reported.                   |
| `options.webSocketFactory` | `(url) => WebSocket` | `new WebSocket(url)` | Creates the socket; for tests or runtimes without a global `WebSocket`.                                 |
| `options.onError`          | `(error) => void`    | console              | Invalid incoming messages and listener failures.                                                        |

## Return value

A `SocketClient` typed by the contract:

| Member                | Description                                                                                                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`               | Read-only signal: `"connecting"`, `"open"`, `"closed"` or, since `1.1`, terminal `"unauthorized"`: the server rejected the session or authorization (close `4401`/`4403`) and the client does not retry.                                  |
| `emit(event, data)`   | Validates and sends. Rejects with `Socket is disconnected` if not open, `Invalid socket event payload` if the schema fails, `Unknown socket event: …` if the event does not exist and `Socket message too large` if it exceeds the limit. |
| `on(event, listener)` | Listens to an already validated server event. Returns the function to stop listening.                                                                                                                                                     |
| `close()`             | Closes the connection and stops reconnecting.                                                                                                                                                                                             |

The URL is passed unchanged to `new WebSocket(url)`: a URL rejected by the runtime's `WebSocket` throws its error when creating the client.

## Examples

### Wait for it to open before sending

<!-- no-check -->

```ts
import { effect } from "@meekojs/meeko";

effect(() => {
  if (chat.state.value === "open") void chat.emit("message", { text: "conectado" });
  if (chat.state.value === "unauthorized") location.assign("/login");
});
```

`state` is a signal: an `effect` (or a component's template) updates on every change.

### A test with a fake WebSocket

```ts
import { createSocketClient } from "@meekojs/meeko/framework";
import type { Schema } from "@meekojs/meeko/server";

class FakeSocket extends EventTarget {
  readyState: number = WebSocket.CONNECTING;
  sent: string[] = [];
  send(value: string): void { this.sent.push(value); }
  close(): void { this.readyState = WebSocket.CLOSED; this.dispatchEvent(new Event("close")); }
  open(): void { this.readyState = WebSocket.OPEN; this.dispatchEvent(new Event("open")); }
}

const text: Schema<string> = { "~standard": { version: 1, validate: (value) => typeof value === "string" ? { value } : { issues: [{ message: "texto" }] } } };
const peer = new FakeSocket();
const client = createSocketClient("ws://localhost/chat", { clientToServer: { message: text }, serverToClient: { message: text } }, {
  webSocketFactory: () => peer as unknown as WebSocket,
});

await client.emit("message", "pronto").catch((error: Error) => console.log(error.message)); // Socket is disconnected
peer.open();
await client.emit("message", "hola");
console.log(peer.sent); // [ '{"event":"message","payload":"hola"}' ]
client.close();
```

### Outside a Meeko application

<!-- no-check -->

```ts
// Un panel de administración que escucha los pedidos de la tienda
const orders = createSocketClient(`wss://tienda.example.com/_meeko/socket/orders?room=${storeId}`, ordersContract);
orders.on("created", (order) => addRow(order));
window.addEventListener("pagehide", () => orders.close());
```

The server checks `Origin`: an origin different from the application's must be in the runtime's `allowedOrigins`.

## Common mistakes

### Pass the channel name instead of its URL

```ts bad
createSocketClient("chat", chatContract);
```

`createSocketClient` does not know application channels: `"chat"` is a relative URL. In Node, the global `WebSocket` throws a `DOMException` with message `TypeError: Invalid URL`; with another scheme, such as `ftp:`, `expected a ws: or wss: url`.

<!-- no-check -->

```ts good
createSocketClient(`${location.origin.replace(/^http/, "ws")}/_meeko/socket/chat`, chatContract);
```

Inside an application, `useSocket("chat")` or `socket.chat` build the URL and know the contract.

### Send before it opens

```ts bad
const chat = createSocketClient(url, chatContract);
await chat.emit("message", { text: "hola" });
```

Rejects with `Socket is disconnected`: the socket is still `"connecting"`, and the client does not queue messages.

<!-- no-check -->

```ts good
const chat = createSocketClient(url, chatContract);
effect(() => { if (chat.state.value === "open") void chat.emit("message", { text: "hola" }); });
```

### Never close it

```ts bad
function openChat() {
  const chat = createSocketClient(url, chatContract);
  chat.on("message", render);
}
```

Each call leaves an open socket that also reconnects automatically after disconnecting: connections accumulate until the page reloads.

<!-- no-check -->

```ts good
function openChat() {
  const chat = createSocketClient(url, chatContract);
  chat.on("message", render);
  return () => chat.close();
}
```

## Notes

- **Browser only** (or with `webSocketFactory`). In Node and SSR there is no global `WebSocket` to open.
- **Security.** Server messages are validated with `serverToClient` before reaching listeners: an invalid message is discarded and sent to `onError`.
- **Reconnection.** After a disconnect, retries after 500 ms, 1 s, 2 s… up to 30 s. Messages sent meanwhile are rejected; resend what you need when it returns to `"open"`.
- **Authorization.** A `4401` or `4403` close (or the hub's session policy `1008`) leaves state at `"unauthorized"` permanently: redirect to sign-in and create a new client afterward.

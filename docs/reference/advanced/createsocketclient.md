---
title: createSocketClient
group: advanced
since: 1.0.0
description: Cliente Socket de bajo nivel sobre el WebSocket nativo, con URL y contrato explícitos, validación en las dos direcciones y reconexión con retroceso exponencial.
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
---

`createSocketClient` abre un `WebSocket` a un canal Socket con una URL y un contrato explícitos. Valida cada evento que envía y cada uno que recibe con los schemas del contrato, se reconecta solo con retroceso exponencial y expone su estado como una señal. La entrega es como mucho una vez: `emit` rechaza si no hay conexión, sin cola ni reenvío.

No está ligado a ningún componente: hay que cerrarlo con `close()`. Dentro de un componente, usa [`useSocketClient`](/docs/reference/usesocketclient), que lo cierra al desmontarse; en una aplicación, lo habitual es el autoimport `useSocket("chat")` o `socket.chat`, que ya conocen la URL y el contrato de cada canal.

## Uso

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

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `url` | texto | obligatorio | URL `ws:` o `wss:` del canal: `<origen>/_meeko/socket/<canal>`, con `?room=` si el canal usa salas. |
| `contract` | `SocketContract` | obligatorio | `{ clientToServer, serverToClient }`: los schemas de cada evento en cada dirección. |
| `options.retryMs` | número | 500 | Primer retraso de reconexión; se duplica en cada intento. |
| `options.maxRetryMs` | número | 30 000 | Retraso máximo de reconexión. |
| `options.maxMessageBytes` | número | 65 536 | Mensaje entrante más grande; uno mayor (o binario) se descarta y se informa. |
| `options.webSocketFactory` | `(url) => WebSocket` | `new WebSocket(url)` | Crea el socket; para pruebas o runtimes sin `WebSocket` global. |
| `options.onError` | `(error) => void` | consola | Mensajes entrantes inválidos y fallos de los listeners. |

## Valor devuelto

Un `SocketClient` tipado por el contrato:

| Miembro | Descripción |
| --- | --- |
| `state` | Señal de sólo lectura: `"connecting"`, `"open"`, `"closed"` o, desde `1.1`, `"unauthorized"`, terminal: el servidor rechazó la sesión o la autorización (cierre `4401`/`4403`) y el cliente no reintenta. |
| `emit(event, data)` | Valida y envía. Rechaza con `Socket is disconnected` si no está abierto, `Invalid socket event payload` si no cumple el schema, `Unknown socket event: …` si el evento no existe y `Socket message too large` si supera el límite. |
| `on(event, listener)` | Escucha un evento del servidor, ya validado. Devuelve la función que deja de escucharlo. |
| `close()` | Cierra la conexión y deja de reconectar. |

La URL se pasa tal cual a `new WebSocket(url)`: una URL que el `WebSocket` del runtime no acepta lanza su error al crear el cliente.

## Ejemplos

### Esperar a que abra antes de enviar

<!-- no-check -->
```ts
import { effect } from "@meekojs/meeko";

effect(() => {
  if (chat.state.value === "open") void chat.emit("message", { text: "conectado" });
  if (chat.state.value === "unauthorized") location.assign("/login");
});
```

`state` es una señal: un `effect` (o la plantilla de un componente) se actualiza con cada cambio.

### Una prueba con un WebSocket falso

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

### Fuera de una aplicación Meeko

<!-- no-check -->
```ts
// Un panel de administración que escucha los pedidos de la tienda
const orders = createSocketClient(`wss://tienda.example.com/_meeko/socket/orders?room=${storeId}`, ordersContract);
orders.on("created", (order) => addRow(order));
window.addEventListener("pagehide", () => orders.close());
```

El servidor comprueba `Origin`: un origen distinto del de la aplicación necesita estar en `allowedOrigins` del runtime.

## Errores comunes

### Pasar el nombre del canal en lugar de su URL

```ts bad
createSocketClient("chat", chatContract);
```

`createSocketClient` no conoce los canales de la aplicación: `"chat"` es una URL relativa. En Node, el `WebSocket` global lanza un `DOMException` con el mensaje `TypeError: Invalid URL`; con otro esquema, como `ftp:`, `expected a ws: or wss: url`.

<!-- no-check -->
```ts good
createSocketClient(`${location.origin.replace(/^http/, "ws")}/_meeko/socket/chat`, chatContract);
```

Dentro de una aplicación, `useSocket("chat")` o `socket.chat` construyen la URL y conocen el contrato.

### Enviar antes de que abra

```ts bad
const chat = createSocketClient(url, chatContract);
await chat.emit("message", { text: "hola" });
```

Rechaza con `Socket is disconnected`: el socket todavía está en `"connecting"`, y el cliente no encola mensajes.

<!-- no-check -->
```ts good
const chat = createSocketClient(url, chatContract);
effect(() => { if (chat.state.value === "open") void chat.emit("message", { text: "hola" }); });
```

### No cerrarlo

```ts bad
function openChat() {
  const chat = createSocketClient(url, chatContract);
  chat.on("message", render);
}
```

Cada llamada deja un socket abierto que, además, se reconecta solo al caerse: las conexiones se acumulan hasta recargar la página.

<!-- no-check -->
```ts good
function openChat() {
  const chat = createSocketClient(url, chatContract);
  chat.on("message", render);
  return () => chat.close();
}
```

## Notas

- **Sólo en el navegador** (o con `webSocketFactory`). En Node y en el SSR no hay `WebSocket` global que abrir.
- **Seguridad.** Los mensajes del servidor se validan con `serverToClient` antes de llegar a los listeners: un mensaje inválido se descarta y va a `onError`.
- **Reconexión.** Tras un corte, reintenta a los 500 ms, 1 s, 2 s… hasta 30 s. Los mensajes enviados mientras tanto se rechazan; reenvía tú lo que haga falta al volver a `"open"`.
- **Autorización.** Un cierre `4401` o `4403` (o el `1008` de política del hub por la sesión) deja el estado en `"unauthorized"` para siempre: redirige al inicio de sesión y crea un cliente nuevo después.

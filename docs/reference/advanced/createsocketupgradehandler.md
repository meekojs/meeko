---
title: createSocketUpgradeHandler
group: advanced
since: 1.0.0
description: Handshake portable de Socket, que valida la ruta del canal, ejecuta las comprobaciones del hub y conecta al hub el WebSocket que abre el runtime.
symbols:
  - "@meekojs/meeko/server#createSocketUpgradeHandler"
types:
  - "@meekojs/meeko/server#SocketUpgradeOptions"
  - "@meekojs/meeko/server#SocketUpgrade"
related:
  - "@meekojs/meeko/server#createSocketHub"
  - "@meekojs/meeko/node#createNodeSocketUpgradeHandler"
  - "@meekojs/meeko/node#attachNodeWebSocketServer"
  - "@meekojs/meeko/deno#serveDeno"
  - "@meekojs/meeko/framework#createSocketClient"
  - docs/framework.md#websocket
---

`createSocketUpgradeHandler` separa el handshake de Socket del transporte: recibe el `Request` del upgrade y decide qué hacer con él sin tocar ningún socket. Si la ruta no es de un canal, dice `"pass"`; si no es un upgrade válido o el hub lo rechaza, `"reject"` con el estado; y si todo está bien, `"upgrade"` con una función `open(peer)` que el adaptador llama cuando su runtime ya abrió el WebSocket. Desde ahí, los mensajes del cliente pasan al hub en serie.

Los adaptadores de Node, Bun, Deno y Cloudflare de Meeko lo comparten. Se usa directamente para conectar Socket a un runtime o un servidor para el que Meeko no tiene adaptador.

## Uso

<!-- no-check -->
```ts
// server.ts, en Deno
import { createSocketUpgradeHandler } from "@meekojs/meeko/server";

const handleUpgrade = createSocketUpgradeHandler({ hub: app.socket!.hub, publicOrigin: "https://example.com" });

Deno.serve(async (request) => {
  const upgrade = await handleUpgrade(request);
  if (upgrade.action === "pass") return app.fetch(request);
  if (upgrade.action === "reject" && !upgrade.close) return new Response(null, { status: upgrade.status });
  const { socket, response } = Deno.upgradeWebSocket(request);
  socket.onopen = () => {
    if (upgrade.action === "reject") { setTimeout(() => socket.close(upgrade.close?.code, upgrade.close?.reason), 0); return; }
    const session = upgrade.open({ send: (message) => socket.send(message), close: (code, reason) => socket.close(code, reason) });
    socket.onmessage = (event) => session.receive(event.data);
    socket.onclose = () => session.closed();
  };
  return response;
});
```

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `hub` | `SocketHub` | obligatorio | El hub de la aplicación (`app.socket.hub`) o uno de `createSocketHub`. |
| `publicOrigin` | origen | obligatorio | Origen público fijo, `http:` o `https:`. La URL de cada handshake se reconstruye con él: la política nunca se deduce de una cabecera `Host` que el cliente controla. |
| `pathnamePrefix` | texto | `/_meeko/socket` | Prefijo de los canales, que se sirven en `<prefijo>/<nombre>`. |
| `maxPendingBytes` | número | 65 536 | Bytes entrantes que se retienen mientras el hub autoriza una conexión nueva. |
| `onError` | `(error) => void` | ninguno | Fallos del transporte y de las sesiones. |

## Valor devuelto

`(request: Request) => Promise<SocketUpgrade>`, donde `SocketUpgrade` es una de:

| `action` | Cuándo | Qué hace el adaptador |
| --- | --- | --- |
| `"pass"` | La ruta no empieza por el prefijo. | Pasar la petición a `app.fetch`. |
| `"reject"` | Nombre de canal inválido o no es un `GET` con `Upgrade: websocket` (`400`), canal desconocido (`404`), `Origin` no permitido (`403`), sesión o autorización rechazadas (`401`, `403`). | Responder con `status`. Desde `1.1`, un `401` o `403` de la sesión o del canal lleva `close` (`4401` o `4403`): el adaptador hace el upgrade y cierra con ese código, que el navegador sí puede leer. |
| `"upgrade"` | El hub aceptó el handshake. | Hacer el upgrade y llamar a `open(peer)`, que devuelve `{ receive(message), closed() }` para conectar los eventos del socket. |

Lanza `TypeError` al crearse si `publicOrigin` no es HTTP(S) (`Socket publicOrigin must use HTTP or HTTPS`) o el prefijo no es válido, y `RangeError` si `maxPendingBytes` no es un entero positivo.

## Ejemplos

### Qué decide para cada petición

```ts
import { createSocketHub, createSocketUpgradeHandler, defineSocketChannel, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";
import type { Schema } from "@meekojs/meeko/server";

const text: Schema<{ text: string }> = { "~standard": { version: 1, validate: (value) => ({ value: value as { text: string } }) } };
const chat = defineSocketChannel({ clientToServer: { message: text }, serverToClient: { message: text } });
const hub = createSocketHub({ channels: { chat }, sessions: new SessionManager({ store: new MemorySessionStore() }), services: {} });
const handleUpgrade = createSocketUpgradeHandler({ hub, publicOrigin: "http://localhost" });

const ws = { upgrade: "websocket", origin: "http://localhost" };
console.log((await handleUpgrade(new Request("http://localhost/api"))).action);                                  // "pass"
console.log((await handleUpgrade(new Request("http://localhost/_meeko/socket/chat"))).action);                   // "reject" (400: no es un upgrade)
console.log((await handleUpgrade(new Request("http://localhost/_meeko/socket/chat", { headers: ws }))).action);  // "upgrade"
console.log(await handleUpgrade(new Request("http://localhost/_meeko/socket/nope", { headers: ws })));           // { action: "reject", status: 404 }
```

### Node, con el adaptador de Meeko

<!-- no-check -->
```ts
import { createServer } from "node:http";
import { attachNodeWebSocketServer, toNodeListener } from "@meekojs/meeko/node";

const server = createServer(toNodeListener((request) => app.fetch(request)));
attachNodeWebSocketServer({ server, hub: app.socket!.hub, publicOrigin: "https://example.com", pathnamePrefix: app.socket!.pathnamePrefix });
server.listen(3000);
```

En Node no hace falta usarlo a mano: `attachNodeWebSocketServer` (y `serveNode`) lo envuelven con `ws`.

## Errores comunes

### Deducir el origen de la petición

```ts bad
createSocketUpgradeHandler({ hub, publicOrigin: new URL(request.url).origin });
```

Con un proxy delante, `request.url` lleva el `Host` que envía el cliente: la comprobación de `Origin` aceptaría lo que un atacante quiera. El origen es configuración.

<!-- no-check -->
```ts good
createSocketUpgradeHandler({ hub, publicOrigin: process.env.MEEKO_PUBLIC_ORIGIN ?? "http://127.0.0.1:3000" });
```

### Un origen sin esquema

```ts bad
createSocketUpgradeHandler({ hub, publicOrigin: "localhost:3000" });
```

`TypeError: Socket publicOrigin must use HTTP or HTTPS`.

<!-- no-check -->
```ts good
createSocketUpgradeHandler({ hub, publicOrigin: "http://localhost:3000" });
```

### Responder `401` sin hacer el upgrade

```ts bad
if (upgrade.action === "reject") return new Response(null, { status: upgrade.status });
```

El navegador no expone el estado HTTP de un WebSocket rechazado: el cliente sólo ve un error genérico y vuelve a intentarlo para siempre. Con `close`, el adaptador acepta y cierra con `4401`/`4403`, y `createSocketClient` pasa a `"unauthorized"` sin reintentar.

<!-- no-check -->
```ts good
if (upgrade.action === "reject" && !upgrade.close) return new Response(null, { status: upgrade.status });
// …hace el upgrade y cierra con upgrade.close.code y upgrade.close.reason
```

## Notas

- **Portable.** Sólo usa `Request` y la interfaz `SocketPeer` (`send`, `close`, `bufferedAmount`): funciona con cualquier implementación de WebSocket.
- **Orden de los mensajes.** `receive` encola los mensajes y los entrega al hub en serie, también los que llegan mientras el hub todavía autoriza la conexión (hasta `maxPendingBytes`).
- **Seguridad.** `Origin`, sesión y autorización se comprueban antes de aceptar el upgrade, así que una conexión rechazada nunca llega a los handlers del canal.
- **Deno.** El cierre con código tras el upgrade se hace en el siguiente tick: Deno corta la conexión sin el frame de cierre si lee un mensaje mientras cierra.

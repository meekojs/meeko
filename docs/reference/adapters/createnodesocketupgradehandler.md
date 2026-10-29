---
title: createNodeSocketUpgradeHandler
group: adapters
since: 1.0.0
description: Comprueba la política de un upgrade de Socket en el evento upgrade de Node y deja el framing a la librería WebSocket que elija el host.
symbols:
  - "@meekojs/meeko/node#createNodeSocketUpgradeHandler"
types:
  - "@meekojs/meeko/node#NodeSocketUpgradeOptions"
  - "@meekojs/meeko/node#NodeAcceptedSocket"
related:
  - "@meekojs/meeko/node#attachNodeWebSocketServer"
  - "@meekojs/meeko/server#createSocketUpgradeHandler"
  - "@meekojs/meeko/server#createSocketHub"
  - docs/framework.md#websocket
---

`createNodeSocketUpgradeHandler(options)` es la parte de `attachNodeWebSocketServer` que no depende de `ws`: recibe `(incoming, socket, head)` del evento `upgrade` de Node, comprueba la ruta, el método, el `Origin`, la sesión y la autorización del canal con el hub, y sólo entonces llama a su `upgrade`, que hace el handshake con la librería WebSocket del host. Después conecta los mensajes y el cierre del peer con el hub.

Úselo para cambiar de librería WebSocket (`uWebSockets.js`, otra configuración de `ws`) o para compartir el evento `upgrade` con otros servicios.

## Uso

<!-- no-check -->
```ts
import { WebSocketServer } from "ws";
import type WebSocket from "ws";
import { createNodeSocketUpgradeHandler } from "@meekojs/meeko/node";
import type { NodeAcceptedSocket } from "@meekojs/meeko/node";

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const accepted = (ws: WebSocket): NodeAcceptedSocket => ({
  peer: { send: (message) => ws.send(message), close: (code, reason) => ws.close(code, reason), get bufferedAmount() { return ws.bufferedAmount; } },
  onMessage: (listener) => ws.on("message", (data, binary) => binary ? ws.close(1003, "Text messages required") : listener(data.toString())),
  onClose: (listener) => ws.on("close", listener),
});

const handleUpgrade = createNodeSocketUpgradeHandler({
  hub: app.socket!.hub,
  publicOrigin: "https://example.com",
  pathnamePrefix: app.socket!.pathnamePrefix,
  upgrade: (incoming, socket, head) => new Promise((resolve) => wss.handleUpgrade(incoming, socket, head, (ws) => resolve(accepted(ws)))),
});

server.on("upgrade", (incoming, socket, head) => {
  void handleUpgrade(incoming, socket, head).then((handled) => { if (!handled) socket.destroy(); });
});
```

## Parámetros

`createNodeSocketUpgradeHandler(options)`:

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `hub` | `SocketHub` | obligatorio | El hub de la aplicación. |
| `publicOrigin` | `string` | obligatorio | Origen público fijo (`http:` o `https:`); la política nunca se deduce de `Host`. |
| `pathnamePrefix` | `string` | `"/_meeko/socket"` | Prefijo de los canales. |
| `maxPendingBytes` | `number` | `65536` | Bytes entrantes que se retienen mientras el hub autoriza la conexión. |
| `upgrade(incoming, socket, head)` | `NodeAcceptedSocket \| Promise<…>` | obligatorio | Hace el handshake y devuelve `{ peer, onMessage, onClose }`. |
| `reject(incoming, socket, status)` | `void` | destruye el socket | Responde a un handshake rechazado por HTTP (`400`, `403` de Origin, `404`). |
| `onError` | `(error: unknown) => void` | la consola | Fallos del upgrade y de las sesiones. |

## Valor devuelto

Un handler `(incoming, socket, head) => Promise<boolean>`: `false` si la ruta no es de un canal (otro listener puede atenderla), `true` si la atendió (aceptada, rechazada o cerrada).

Desde `1.1`, un rechazo de sesión (`401`) o de autorización del canal (`403`) no llega a `reject`: se hace el upgrade y se cierra en seguida con `4401` o `4403`, porque el `WebSocket` del navegador no expone el estado HTTP de un handshake rechazado. Un `Origin` no permitido sí llega a `reject` con `403`.

## Ejemplos

### Una respuesta HTTP real en los rechazos

<!-- no-check -->
```ts
import { STATUS_CODES } from "node:http";

createNodeSocketUpgradeHandler({
  hub, publicOrigin, upgrade,
  reject(_incoming, socket, status) {
    if (!socket.destroyed) socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? "Error"}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  },
});
```

Es lo que hace `attachNodeWebSocketServer`.

### Compartir `upgrade` con otro servicio

<!-- no-check -->
```ts
server.on("upgrade", async (incoming, socket, head) => {
  if (await handleUpgrade(incoming, socket, head)) return; // un canal de Meeko
  if (incoming.url?.startsWith("/graphql")) return graphqlWs.handleUpgrade(incoming, socket, head);
  socket.destroy();
});
```

## Errores comunes

### Un origen público `wss://`

```ts bad
createNodeSocketUpgradeHandler({ hub, publicOrigin: "wss://example.com", upgrade });
```

`TypeError: Socket publicOrigin must use HTTP or HTTPS`. El `Origin` que envía el navegador es el de la página.

<!-- no-check -->
```ts good
createNodeSocketUpgradeHandler({ hub, publicOrigin: "https://example.com", upgrade });
```

### Un prefijo con `/` final

```ts bad
createNodeSocketUpgradeHandler({ hub, publicOrigin, pathnamePrefix: "/_meeko/socket/", upgrade });
```

`TypeError: Invalid socket pathname prefix`.

<!-- no-check -->
```ts good
createNodeSocketUpgradeHandler({ hub, publicOrigin, pathnamePrefix: app.socket!.pathnamePrefix, upgrade });
```

### Ignorar el resultado

```ts bad
server.on("upgrade", (incoming, socket, head) => { void handleUpgrade(incoming, socket, head); });
```

No hay error, pero un upgrade a otra ruta queda abierto sin respuesta hasta que el cliente se cansa. Destruya el socket cuando el handler devuelve `false`.

<!-- no-check -->
```ts good
server.on("upgrade", (incoming, socket, head) => {
  void handleUpgrade(incoming, socket, head).then((handled) => { if (!handled) socket.destroy(); });
});
```

## Notas

- **Seguridad.** La comprobación de `Origin` ocurre antes del upgrade; un origen ajeno nunca llega a la sesión, así que tampoco distingue un `4401` de un `4403`.
- **Forma absoluta.** Un request-target absoluto hacia otro origen responde `400`.
- **Mensajes antes de autorizar.** Lo que llega mientras el hub autoriza se retiene hasta `maxPendingBytes`; `attachNodeWebSocketServer` cierra con `1009` si se supera.
- **Framing.** El adaptador no implementa el protocolo WebSocket: límites de frame, compresión y pings son de la librería.

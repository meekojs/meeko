---
title: attachNodeWebSocketServer
group: adapters
since: 1.0.0
description: Conecta los canales Socket de Meeko a un servidor HTTP de Node con el paquete ws, con límite de frame, heartbeat y cierre de todos los peers.
symbols:
  - "@meekojs/meeko/node#attachNodeWebSocketServer"
types:
  - "@meekojs/meeko/node#NodeWebSocketOptions"
  - "@meekojs/meeko/node#NodeWebSocketServer"
related:
  - "@meekojs/meeko/node#serveNode"
  - "@meekojs/meeko/node#toNodeListener"
  - "@meekojs/meeko/node#createNodeSocketUpgradeHandler"
  - "@meekojs/meeko/server#defineSocketChannel"
  - docs/framework.md#websocket
  - docs/framework.md#broadcast-y-varias-instancias
---

`attachNodeWebSocketServer(options)` escucha el evento `upgrade` de un servidor HTTP de Node y atiende con el paquete [`ws`](https://github.com/websockets/ws) los upgrades a `/_meeko/socket/<canal>`. Antes de aceptar, el hub comprueba la ruta, el `Origin`, la sesión y la autorización del canal; después, el adaptador entrega cada mensaje de texto al hub, hace ping a los peers y cierra los que no responden.

`serveNode` lo llama solo cuando la aplicación declara canales. Úselo en un host con su propio `http.createServer`, junto a `toNodeListener`.

## Uso

<!-- no-check -->
```ts
import { createServer } from "node:http";
import { attachNodeWebSocketServer, toNodeListener } from "@meekojs/meeko/node";

const publicOrigin = "https://example.com";
const server = createServer(toNodeListener((request) => app.fetch(request), { publicOrigin }));
const sockets = app.socket
  ? attachNodeWebSocketServer({ server, hub: app.socket.hub, publicOrigin, pathnamePrefix: app.socket.pathnamePrefix })
  : undefined;
server.listen(3000);
```

## Parámetros

`attachNodeWebSocketServer(options)`:

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `server` | `http.Server` | obligatorio | El mismo servidor que atiende el handler Fetch. |
| `hub` | `SocketHub` | obligatorio | El hub de la aplicación, `app.socket.hub`. |
| `publicOrigin` | `string` | obligatorio | Origen público fijo, `http:` o `https:`. Se compara con el `Origin` del upgrade; nunca se deduce de `Host`. |
| `pathnamePrefix` | `string` | `"/_meeko/socket"` | Prefijo de los canales, el de `app.socket.pathnamePrefix`. Empieza por `/` y no termina en `/`. |
| `maxMessageBytes` | `number` | `65536` | Payload máximo de un frame, que `ws` aplica antes de decodificarlo; también el búfer de mensajes que llegan mientras el hub autoriza. |
| `heartbeatMs` | `number` | `30000` | Intervalo de ping. Un peer que no responde con `pong` antes del siguiente se termina. |
| `onError` | `(error: unknown) => void` | la consola | Fallos del upgrade, de los peers y de las sesiones. |

## Valor devuelto

Un `NodeWebSocketServer` con `close()`: quita el listener de `upgrade`, termina todos los peers y cierra el servidor de `ws`. El servidor HTTP sigue siendo del llamador.

Cada upgrade termina así:

| Caso | Resultado |
| --- | --- |
| Ruta fuera del prefijo | Se ignora: otro listener de `upgrade` puede atenderla. |
| Nombre de canal inválido o método distinto de `GET` | `400` por HTTP. |
| Canal inexistente | `404` por HTTP. |
| `Origin` no permitido | `403` por HTTP. |
| Canal `auth: "required"` sin sesión, o `authorize` que devuelve `false` | Upgrade y cierre inmediato con `4401` o `4403`, que el navegador sí puede leer. |
| Aceptado | Conexión abierta en el hub. |

## Ejemplos

### Cierre ordenado de un host propio

<!-- no-check -->
```ts
process.once("SIGTERM", async () => {
  await sockets?.close();                                   // 1. Socket
  await new Promise<void>((done) => server.close(() => done())); // 2. HTTP
  await app.close();                                        // 3. aplicación y sesiones
});
```

### Un límite menor para un chat

<!-- no-check -->
```ts
attachNodeWebSocketServer({ server, hub: app.socket!.hub, publicOrigin, pathnamePrefix: app.socket!.pathnamePrefix, maxMessageBytes: 4 * 1024, heartbeatMs: 15_000 });
```

Un frame mayor cierra el peer con `1009`. Mantenga este límite igual o por encima de `socket.maxMessageBytes` de `server/runtime.ts`, o los mensajes válidos para el hub se cortarán antes.

### Un proxy delante

```nginx
location /_meeko/socket/ {
  proxy_pass http://127.0.0.1:4173;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_read_timeout 120s;   # mayor que heartbeatMs
}
```

## Errores comunes

### Un límite que no es un entero positivo

```ts bad
attachNodeWebSocketServer({ server, hub, publicOrigin, maxMessageBytes: 0 });
```

`RangeError: Invalid socket message limit`; con `heartbeatMs`, `Invalid socket heartbeat interval`.

<!-- no-check -->
```ts good
attachNodeWebSocketServer({ server, hub, publicOrigin, maxMessageBytes: 16 * 1024 });
```

### Un origen `ws://`

```ts bad
attachNodeWebSocketServer({ server, hub, publicOrigin: "wss://example.com" });
```

`TypeError: Socket publicOrigin must use HTTP or HTTPS`: el navegador envía como `Origin` el de la página, `https://example.com`.

<!-- no-check -->
```ts good
attachNodeWebSocketServer({ server, hub, publicOrigin: "https://example.com" });
```

### Un prefijo con `/` final

```ts bad
attachNodeWebSocketServer({ server, hub, publicOrigin, pathnamePrefix: "/ws/" });
```

`TypeError: Invalid socket pathname prefix`: el prefijo empieza por `/` y no termina en `/`. Pase el de la aplicación, `app.socket.pathnamePrefix`, para que coincida con la URL que usan los clientes generados.

<!-- no-check -->
```ts good
attachNodeWebSocketServer({ server, hub: app.socket!.hub, publicOrigin, pathnamePrefix: app.socket!.pathnamePrefix });
```

## Notas

- **`ws`.** Es una dependencia de `@meekojs/meeko` y se carga al llamar a la función, no al importar el adaptador.
- **Mensajes.** Sólo texto JSON: un mensaje binario cierra el peer con `1003`. La compresión por mensaje está desactivada.
- **Origin.** Es la defensa frente al *cross-site WebSocket hijacking*: un origen ajeno nunca completa el upgrade, ni siquiera hacia un canal que después lo rechazaría.
- **IP.** El upgrade registra la IP del socket, que el canal ve en `context.clientAddress`.
- **Varias instancias.** El servidor sólo conoce sus peers; los broadcasts entre instancias necesitan `RedisSocketPubSub`.

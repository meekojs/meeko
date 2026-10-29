---
title: toNodeListener
group: adapters
since: 1.0.0
description: Adapta un handler Fetch al callback de http.createServer de Node, con streaming, varias Set-Cookie, cancelación al desconectarse el cliente y la IP de la conexión.
symbols:
  - "@meekojs/meeko/node#toNodeListener"
types:
  - "@meekojs/meeko/node#NodeListenerOptions"
related:
  - "@meekojs/meeko/node#serveNode"
  - "@meekojs/meeko/node#attachNodeWebSocketServer"
  - "@meekojs/meeko/server#composeServerMiddleware"
  - "@meekojs/meeko/server#clientAddress"
  - docs/framework.md#build-despliegue-y-verificación
---

`toNodeListener(handler, options)` convierte un handler Fetch (`(request) => Response`, como `app.fetch`) en el listener `(req, res)` de `http.createServer` o `https.createServer`. Construye el `Request` con la URL del origen público, transmite el cuerpo de la respuesta en streaming, envía cada `Set-Cookie` por separado y cancela el cuerpo si el cliente se desconecta. También registra la IP del socket remoto, que leen `context.clientAddress`, `clientAddress(request)` y `rateLimit`.

Es la pieza HTTP de `serveNode`. Úsela sola para montar Meeko en un servidor Node propio (HTTPS directo, un puerto compartido, otras rutas).

## Uso

<!-- no-check -->
```ts
import { createServer } from "node:http";
import { toNodeListener } from "@meekojs/meeko/node";

const server = createServer(toNodeListener((request) => app.fetch(request), { publicOrigin: "https://example.com" }));
server.listen(3000);
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `handler` | `(request: Request) => Response \| Promise<Response>` | obligatorio | El handler Fetch. |
| `options.publicOrigin` | `string` | la cabecera `Host` y el protocolo del socket | Origen con el que se construyen las URL, como `https://example.com` tras un proxy TLS. Una petición en forma absoluta a otro origen responde `400`. |
| `options.onError` | `(error, requestId) => void` | la consola | Recibe los fallos del handler o del stream de la respuesta, con un ID de correlación. |

## Valor devuelto

El listener `(request: IncomingMessage, response: ServerResponse) => void`. Nunca lanza: si el handler rechaza antes de enviar las cabeceras, responde con `errorResponse` (`500 INTERNAL_ERROR`, o el estado de un `ApiError`) y el mismo `requestId` que recibe `onError`; si ya había empezado, corta la conexión.

## Ejemplos

### HTTPS directo, sin proxy

<!-- no-check -->
```ts
import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { attachNodeWebSocketServer, toNodeListener } from "@meekojs/meeko/node";

const server = createServer(
  { key: readFileSync("/etc/tls/key.pem"), cert: readFileSync("/etc/tls/cert.pem") },
  toNodeListener((request) => app.fetch(request), { publicOrigin: "https://example.com", onError: (error, id) => app.reportError(error, id) }),
);
if (app.socket) attachNodeWebSocketServer({ server, hub: app.socket.hub, publicOrigin: "https://example.com", pathnamePrefix: app.socket.pathnamePrefix });
server.listen(443);
```

### Meeko junto a otra aplicación

<!-- no-check -->
```ts
import { createServer } from "node:http";
import { toNodeListener } from "@meekojs/meeko/node";

const meeko = toNodeListener((request) => app.fetch(request), { publicOrigin: "https://example.com" });
createServer((req, res) => {
  if (req.url?.startsWith("/legacy/")) return legacyHandler(req, res);
  meeko(req, res);
}).listen(3000);
```

### Un handler Fetch cualquiera

```ts
import { createServer } from "node:http";
import { toNodeListener } from "@meekojs/meeko/node";

export const server = createServer(toNodeListener((request) => new Response(`Hola desde ${new URL(request.url).pathname}`)));
```

## Errores comunes

### Un origen público sin esquema

```ts bad
toNodeListener(handler, { publicOrigin: "example.com" });
```

`TypeError: Invalid publicOrigin: example.com`, al crear el listener. Con otro esquema, `publicOrigin must use HTTP or HTTPS`.

<!-- no-check -->
```ts good
toNodeListener(handler, { publicOrigin: "https://example.com" });
```

### Confiar en la cabecera `Host` tras un proxy

```ts bad
createServer(toNodeListener((request) => app.fetch(request))); // tras un proxy TLS
```

Sin `publicOrigin`, la URL sale de `Host` y del socket (`http://`), así que la aplicación no reconoce el `Origin` `https://` del navegador y responde `403 INVALID_ORIGIN` a las mutaciones. `createServerApp` también acepta `publicOrigin` o `MEEKO_PUBLIC_ORIGIN`.

<!-- no-check -->
```ts good
createServer(toNodeListener((request) => app.fetch(request), { publicOrigin: process.env.MEEKO_PUBLIC_ORIGIN }));
```

### Olvidar Socket

```ts bad
createServer(toNodeListener((request) => app.fetch(request))).listen(3000); // la aplicación tiene server/socket
```

No hay error al arrancar, pero los upgrades no los atiende nadie y el cliente reintenta para siempre. `toNodeListener` sólo atiende HTTP.

<!-- no-check -->
```ts good
const server = createServer(toNodeListener((request) => app.fetch(request), { publicOrigin }));
if (app.socket) attachNodeWebSocketServer({ server, hub: app.socket.hub, publicOrigin, pathnamePrefix: app.socket.pathnamePrefix });
```

## Notas

- **Cancelación.** Si el cliente cierra la conexión, la `signal` de la petición se aborta y el cuerpo de la respuesta se cancela: se liberan archivos y se detienen los productores de un stream.
- **`HEAD`.** Envía las cabeceras sin cuerpo.
- **Request-target.** Un target que empieza por `//` es siempre una ruta del origen propio, nunca otro host.
- **IP.** Sin `MEEKO_TRUST_PROXY`, la IP es la del socket; `X-Forwarded-For` no se lee.
- **Plataforma.** `toNodeListener` no pasa `platform` a `app.fetch`: con un host propio, `waitUntil` y `env` son los que `createServerApp` recibió; `serveNode` además espera las tareas de `waitUntil` al cerrar.

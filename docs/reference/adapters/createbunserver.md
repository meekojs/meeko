---
title: createBunServer
group: adapters
since: 1.0.0
description: Los handlers fetch y websocket para servir una aplicación de Meeko con Bun.serve, con Socket sobre el WebSocket nativo de Bun y sus límites de payload, contrapresión e inactividad.
symbols:
  - "@meekojs/meeko/bun#createBunServer"
types:
  - "@meekojs/meeko/bun#BunServerOptions"
  - "@meekojs/meeko/bun#BunServeHandlers"
related:
  - "@meekojs/meeko/bun#createBunAssetReader"
  - "@meekojs/meeko/server#handleProcessErrors"
  - "@meekojs/meeko/server#createServerApp"
  - "@meekojs/meeko/node#serveNode"
  - "config:server"
  - docs/framework.md#bun
  - docs/framework.md#conformidad-entre-adaptadores
---

`createBunServer(app, options)` devuelve `{ fetch, websocket }` para expandir en `Bun.serve`: `fetch` atiende HTTP y hace el upgrade de los canales Socket con `server.upgrade`, y `websocket` conecta cada peer al hub con el WebSocket nativo de Bun. Registra además la IP de cada conexión (`server.requestIP()`), que leen `context.clientAddress` y `rateLimit`.

Es lo que usa la salida de `meeko build --adapter bun` (`.meeko/output/bun/index.js`). A diferencia de Node, no cierra el servidor ni instala la política de fallos del proceso: el host llama a `server.stop()` y a `handleProcessErrors`.

## Uso

<!-- no-check -->
```ts
import { createServerApp, handleProcessErrors } from "@meekojs/meeko/server";
import { createBunAssetReader, createBunServer } from "@meekojs/meeko/bun";

const app = await createServerApp({
  manifest, load, runtime, production: true,
  assets: createBunAssetReader({ root: new URL("./client/", import.meta.url), assets: manifest.assets ?? {} }),
});
const server = Bun.serve({ hostname: "0.0.0.0", port: 3000, ...createBunServer(app, { publicOrigin: "https://example.com" }) });
handleProcessErrors(app, { close: async () => { await server.stop(); await app.close(); } });
```

## Parámetros

`createBunServer(app, options?)`:

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `publicOrigin` | `string` | el de la aplicación, o la URL en la que escucha Bun | Origen público de las URL y de la comprobación de `Origin` en HTTP y Socket. Nunca se usa `Host`. |
| `platform` | `ServerPlatform` | Bun con `Bun.env` | La plataforma de cada petición. |
| `onError` | `(error, requestId) => void` | el de la aplicación | Observador de los fallos del transporte. |
| `maxPayloadLength` | `number` | `socket.maxMessageBytes` de la aplicación, o `65536` | Frame entrante más grande; Bun cierra los mayores. |
| `backpressureLimit` | `number` | `1048576` (1 MiB) | Bytes salientes en cola por peer. Un envío que lo supera cierra ese peer con `1011`, sin bloquear al resto de la sala. |
| `idleTimeout` | `number` | `60` | Segundos sin tráfico antes de cerrar un peer. |
| `sendPings` | `boolean` | `true` | Envía pings a los peers inactivos para que las conexiones vivas no caduquen. |

## Valor devuelto

Un `BunServeHandlers`:

| Miembro | Descripción |
| --- | --- |
| `fetch(request, server)` | Atiende HTTP con `app.fetch` y los upgrades de Socket. Devuelve `undefined` tras un upgrade, como espera Bun. |
| `websocket` | `open`, `message` y `close`, con `maxPayloadLength`, `backpressureLimit`, `closeOnBackpressureLimit: false`, `idleTimeout`, `sendPings` y `perMessageDeflate: false` ya resueltos. |

## Ejemplos

### Construir y ejecutar la salida de Bun

```sh
npx meeko build --adapter bun
npx meeko preview --adapter bun                 # lanza bun sobre la salida
MEEKO_HOST=0.0.0.0 MEEKO_PORT=3000 bun .meeko/output/bun/index.js
```

`index.js` incluye `@meekojs/meeko` y las dependencias del servidor: copie la carpeta entera, sin `node_modules`. El build y el prerender se siguen ejecutando con Node.

### Un contenedor de Bun

```dockerfile
FROM oven/bun:1.4
WORKDIR /app
COPY .meeko/output/bun ./
ENV MEEKO_HOST=0.0.0.0 MEEKO_PORT=3000
EXPOSE 3000
CMD ["bun", "index.js"]
```

`server.host` y `server.port` de `meeko.config.ts` sólo se aplican a Node: en Bun use `MEEKO_HOST` y `MEEKO_PORT` (o `PORT`).

### Junto a otras rutas de `Bun.serve`

<!-- no-check -->
```ts
const meeko = createBunServer(app);
Bun.serve({
  port: 3000,
  websocket: meeko.websocket,
  fetch(request, server) {
    if (new URL(request.url).pathname === "/healthz") return new Response("ok");
    return meeko.fetch(request, server);
  },
});
```

El handler `websocket` ignora los sockets que no abrió Meeko.

## Errores comunes

### Usarlo fuera de Bun

```ts bad
// node server.ts
createBunAssetReader({ root, assets }).get("/assets/entry.js", request);
```

`Error: The Meeko Bun adapter requires the Bun runtime`. `meeko preview --adapter bun` lanza `bun`; si no está en el `PATH`, falla con un mensaje explícito.

```sh good
bun .meeko/output/bun/index.js
```

### Un límite que no es un entero positivo

```ts bad
Bun.serve({ port: 3000, ...createBunServer(app, { maxPayloadLength: 0 }) });
```

`RangeError: Invalid maxPayloadLength` (o `Invalid backpressureLimit`, `Invalid idleTimeout`).

<!-- no-check -->
```ts good
Bun.serve({ port: 3000, ...createBunServer(app, { maxPayloadLength: 16 * 1024 }) });
```

### Sin `handleProcessErrors` en un host propio

```ts bad
Bun.serve({ port: 3000, ...createBunServer(app) });
setTimeout(() => { throw new Error("tarea programada"); }, 1000);
```

El proceso termina con el error sin pasar por `onError` ni cerrar las conexiones: `createBunServer` no instala la política `processErrors`.

<!-- no-check -->
```ts good
const server = Bun.serve({ port: 3000, ...createBunServer(app) });
handleProcessErrors(app, { close: async () => { await server.stop(); await app.close(); } });
```

### Un `MEEKO_TRUST_PROXY` no válido

```sh bad
MEEKO_TRUST_PROXY=on bun .meeko/output/bun/index.js
```

El arranque se detiene con `TypeError: MEEKO_TRUST_PROXY must be true, false or the number of trusted proxies (1-99), not "on"`: `createBunServer` comprueba la variable al crearse.

```sh good
MEEKO_TRUST_PROXY=1 bun .meeko/output/bun/index.js
```

## Notas

- **Socket en Bun.** WebSocket nativo de `Bun.serve`: `maxPayloadLength` corta los frames antes del hub (que además responde `1009` por encima de su propio límite), los mensajes binarios se cierran con `1003` y la compresión está desactivada. Un rechazo de sesión o autorización hace el upgrade y cierra con `4401` o `4403`.
- **Señales.** La salida generada detiene `Bun.serve` y cierra la aplicación ante `SIGINT` y `SIGTERM`, y aplica `processErrors`; en un host propio, hágalo usted.
- **Fallos del proceso.** Bun conserva el `requestId` de la petición en las excepciones, no en los rechazos.
- **IP.** `server.requestIP()` da la IP de la conexión; tras un proxy, `MEEKO_TRUST_PROXY`.
- **CSP y cabeceras (desde 1.7).** `server.contentSecurityPolicy` y `server.headers` se aplican igual que en Node.
- **Conformidad.** `pnpm run conformance:bun` construye la aplicación de prueba con este adaptador y la ejecuta con Bun sin fuentes ni `node_modules`.

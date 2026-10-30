---
title: serveNode
group: adapters
since: 1.0.0
description: Sirve una aplicación de Meeko con el servidor HTTP de Node, sus canales Socket con ws, el cierre ordenado ante señales y la política de fallos del proceso.
symbols:
  - "@meekojs/meeko/node#serveNode"
types:
  - "@meekojs/meeko/node#ServeNodeOptions"
  - "@meekojs/meeko/node#NodeServer"
related:
  - "@meekojs/meeko/node#toNodeListener"
  - "@meekojs/meeko/node#attachNodeWebSocketServer"
  - "@meekojs/meeko/node#createNodeAssetReader"
  - "@meekojs/meeko/server#createServerApp"
  - "@meekojs/meeko/server#handleProcessErrors"
  - "config:server"
  - "cli:start"
  - docs/framework.md#build-despliegue-y-verificación
  - docs/framework.md#ip-del-cliente-tras-un-proxy
---

`serveNode(app, options)` pone en marcha un servidor `node:http` para una aplicación de `createServerApp`: convierte cada petición con `toNodeListener`, conecta los canales Socket al mismo servidor con `attachNodeWebSocketServer` (si la aplicación los tiene) y, con `handleSignals`, cierra de forma ordenada ante `SIGINT` y `SIGTERM` y aplica `processErrors`. Es lo que ejecuta la salida de `meeko build` para Node (`.meeko/output/node/index.mjs`, la que arranca `meeko start`).

Escríbalo a mano sólo para un host propio; con el adaptador `node`, `meeko build` ya genera el entry.

## Uso

<!-- no-check -->
```ts
import { createServerApp } from "@meekojs/meeko/server";
import { serveNode } from "@meekojs/meeko/node";

const app = await createServerApp({ manifest, load, runtime, production: true });
const server = await serveNode(app, { host: "0.0.0.0", port: 3000, publicOrigin: "https://example.com", handleSignals: true });
console.log(`Escuchando en ${server.url}`);
```

## Parámetros

`serveNode(app, options?)`:

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `host` | `string` | `"127.0.0.1"` | Interfaz en la que escucha. `"0.0.0.0"` acepta tráfico remoto. |
| `port` | `number` | `4173` | Puerto; `0` elige uno libre. |
| `publicOrigin` | `string` | el de la aplicación | Origen público con el que se construyen las URL y se comprueba `Origin` en HTTP y Socket, como `https://example.com` tras un proxy TLS. |
| `platform` | `ServerPlatform` | Node con `process.env` | La plataforma de cada petición: `name`, `env` y `waitUntil`. |
| `onError` | `(error, requestId) => void` | el de la aplicación | Observador de los fallos del transporte. |
| `handleSignals` | `boolean` | `false` | Cierra ante `SIGINT` y `SIGTERM`. Desde `1.3`, aplica también `processErrors`. |
| `shutdownTimeout` | `number` | `10000` | Milisegundos que las respuestas abiertas (un stream) pueden seguir tras `close()` antes de cortar sus conexiones. |

## Valor devuelto

Una promesa con un `NodeServer`:

| Miembro | Descripción |
| --- | --- |
| `server` | El `http.Server` de Node. |
| `url` | La URL local con la dirección en la que escucha, como `http://127.0.0.1:4173` (con `0.0.0.0`, la de loopback). No cambia en `1.7.1`: `meeko start` y la salida de Node *muestran* `http://localhost:4173`, pero `url` sigue siendo la dirección real y la identidad de Socket sin `publicOrigin`. |
| `close()` | Cierra, por este orden, los peers de Socket, HTTP (con `shutdownTimeout`), las tareas de `waitUntil` y la aplicación. Es idempotente. |

Si el servidor arranca pero falla la conexión de Socket, libera el puerto y cierra la aplicación antes de rechazar.

## Ejemplos

### Producción con `meeko start`

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ server: { adapter: "node", host: "0.0.0.0", port: 3000 } });
```

```sh
npm run build
MEEKO_PUBLIC_ORIGIN=https://tienda.example.com MEEKO_REDIS_URL=rediss://… MEEKO_TRUST_PROXY=1 npm start
```

`MEEKO_HOST` y `MEEKO_PORT` (o `PORT`) sustituyen a `server.host` y `server.port`. La carpeta `.meeko/output/node/` no lee `app/` ni `server/`: sólo necesita `node_modules`, `@meekojs/meeko` incluido.

### Un contenedor

```dockerfile
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY .meeko/output/node ./.meeko/output/node
ENV MEEKO_HOST=0.0.0.0 MEEKO_PORT=3000
EXPOSE 3000
CMD ["node", ".meeko/output/node/index.mjs"]
```

El entry generado llama a `serveNode` con `handleSignals: true`: el `SIGTERM` del orquestador cierra Socket, HTTP, las tareas de `waitUntil` y el runtime, por ese orden.

### Un puerto libre en las pruebas

<!-- no-check -->
```ts
const node = await serveNode(app, { port: 0 });
try {
  const response = await fetch(`${node.url}/api/health`);
  assert.equal(response.status, 200);
} finally {
  await node.close();
}
```

## Errores comunes

### Escuchar en `127.0.0.1` dentro de un contenedor

```sh bad
docker run -p 3000:4173 tienda   # sin MEEKO_HOST
```

No hay error: el servidor escucha en el loopback del contenedor y el puerto publicado no llega a él. El cliente ve la conexión rechazada o cortada.

```sh good
docker run -p 3000:3000 -e MEEKO_HOST=0.0.0.0 -e MEEKO_PORT=3000 tienda
```

### Un `MEEKO_TRUST_PROXY` no válido

```sh bad
MEEKO_TRUST_PROXY=yes node .meeko/output/node/index.mjs
```

El arranque se detiene con `TypeError: MEEKO_TRUST_PROXY must be true, false or the number of trusted proxies (1-99), not "yes"`: `serveNode` comprueba la variable antes de escuchar, no en cada petición.

```sh good
MEEKO_TRUST_PROXY=1 node .meeko/output/node/index.mjs
```

### Un puerto fuera de rango

```ts bad
await serveNode(app, { port: 70000 });
```

`RangeError: Invalid port: 70000`. En `meeko.config.ts`, `server.port` fuera de rango detiene `meeko build` con `server.port debe ser un entero entre 0 y 65535`.

<!-- no-check -->
```ts good
await serveNode(app, { port: Number(process.env.MEEKO_PORT ?? 4173) });
```

### Tras un proxy sin `publicOrigin`

```sh bad
# Caddy termina TLS en https://tienda.example.com y reenvía a http://127.0.0.1:4173
node .meeko/output/node/index.mjs
```

Las mutaciones autenticadas y `origin: "required"` responden `403 INVALID_ORIGIN`, y los upgrades de Socket del navegador, `403`: la aplicación compara `Origin` con su propia dirección, no con la pública.

```sh good
MEEKO_PUBLIC_ORIGIN=https://tienda.example.com node .meeko/output/node/index.mjs
```

## Notas

- **Node 24.** El adaptador usa `node:http` y Web Streams; las cabeceras `Set-Cookie` se envían por separado.
- **Socket.** Usa el paquete `ws` (se carga sólo si la aplicación tiene canales), con frames de hasta `socket.maxMessageBytes` (64 KiB por defecto), sin compresión y con heartbeat de 30 s. Los mensajes binarios se cierran con `1003`.
- **Assets.** Los sirve la aplicación desde su manifiesto (`createNodeAssetReader`): nunca lee del disco una ruta que no esté en él.
- **IP del cliente.** `context.clientAddress` y `clientAddress(request)` son el socket remoto; tras un proxy, `MEEKO_TRUST_PROXY=1` toma la entrada que añadió el proxy en `X-Forwarded-For`.
- **CSP y cabeceras (desde 1.7).** `server.contentSecurityPolicy` y `server.headers` de `meeko.config.ts` se aplican a cada respuesta en producción, con un nonce por respuesta SSR y hashes en las prerenderizadas.
- **Request-target.** Una ruta que empieza por `//` es siempre del origen propio, nunca otro host.

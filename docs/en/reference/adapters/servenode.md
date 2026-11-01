---
title: serveNode
group: adapters
since: 1.0.0
description: Serves a Meeko application with Node's HTTP server, its Socket channels with ws, graceful shutdown on signals and the process failure policy.
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
source-hash: 384b5e31823d71ef1c674c980d08bcb1d904393f0d495ab2ff6775822bb21e14
---

`serveNode(app, options)` starts a `node:http` server for a `createServerApp` application: it converts each request with `toNodeListener`, connects Socket channels to the same server with `attachNodeWebSocketServer` (if the application has them) and, with `handleSignals`, shuts down gracefully on `SIGINT` and `SIGTERM` and applies `processErrors`. This is what the Node output of `meeko build` runs (`.meeko/output/node/index.mjs`, started by `meeko start`).

Write it manually only for a custom host; with the `node` adapter, `meeko build` already generates the entry point.

## Usage

<!-- no-check -->

```ts
import { createServerApp } from "@meekojs/meeko/server";
import { serveNode } from "@meekojs/meeko/node";

const app = await createServerApp({ manifest, load, runtime, production: true });
const server = await serveNode(app, { host: "0.0.0.0", port: 3000, publicOrigin: "https://example.com", handleSignals: true });
console.log(`Escuchando en ${server.url}`);
```

## Parameters

`serveNode(app, options?)`:

| Option            | Type                         | Default                 | Description                                                                                                                    |
| ----------------- | ---------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `host`            | `string`                     | `"127.0.0.1"`           | Listening interface. `"0.0.0.0"` accepts remote traffic.                                                                       |
| `port`            | `number`                     | `4173`                  | Port; `0` chooses an available one.                                                                                            |
| `publicOrigin`    | `string`                     | the application's       | Public origin used to construct URLs and check `Origin` for HTTP and Socket, such as `https://example.com` behind a TLS proxy. |
| `platform`        | `ServerPlatform`             | Node with `process.env` | Each request's platform: `name`, `env` and `waitUntil`.                                                                        |
| `onError`         | `(error, requestId) => void` | the application's       | Observer for transport failures.                                                                                               |
| `handleSignals`   | `boolean`                    | `false`                 | Shuts down on `SIGINT` and `SIGTERM`. Since `1.3`, also applies `processErrors`.                                               |
| `shutdownTimeout` | `number`                     | `10000`                 | Milliseconds open responses (a stream) can continue after `close()` before their connections are terminated.                   |

## Return value

A promise with a `NodeServer`:

| Member    | Description                                                                                                                                                                                                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server`  | Node's `http.Server`.                                                                                                                                                                                                                                                                     |
| `url`     | The local URL with the listening address, such as `http://127.0.0.1:4173` (with `0.0.0.0`, the loopback address). Unchanged in `1.7.1`: `meeko start` and Node output _display_ `http://localhost:4173`, but `url` remains the actual address and Socket identity without `publicOrigin`. |
| `close()` | Closes, in order, Socket peers, HTTP (with `shutdownTimeout`), `waitUntil` tasks and the application. It is idempotent.                                                                                                                                                                   |

If the server starts but Socket attachment fails, it releases the port and closes the application before rejecting.

## Examples

### Production with `meeko start`

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ server: { adapter: "node", host: "0.0.0.0", port: 3000 } });
```

```sh
npm run build
MEEKO_PUBLIC_ORIGIN=https://tienda.example.com MEEKO_REDIS_URL=rediss://… MEEKO_TRUST_PROXY=1 npm start
```

`MEEKO_HOST` and `MEEKO_PORT` (or `PORT`) override `server.host` and `server.port`. The `.meeko/output/node/` folder does not read `app/` or `server/`: it only needs `node_modules`, including `@meekojs/meeko`.

### A container

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

The generated entry point calls `serveNode` with `handleSignals: true`: the orchestrator's `SIGTERM` closes Socket, HTTP, `waitUntil` tasks and the runtime, in that order.

### An available port in tests

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

## Common mistakes

### Listening on `127.0.0.1` inside a container

```sh bad
docker run -p 3000:4173 tienda   # sin MEEKO_HOST
```

There is no error: the server listens on the container's loopback, and the published port cannot reach it. The client sees a refused or closed connection.

```sh good
docker run -p 3000:3000 -e MEEKO_HOST=0.0.0.0 -e MEEKO_PORT=3000 tienda
```

### An invalid `MEEKO_TRUST_PROXY`

```sh bad
MEEKO_TRUST_PROXY=yes node .meeko/output/node/index.mjs
```

Startup stops with `TypeError: MEEKO_TRUST_PROXY must be true, false or the number of trusted proxies (1-99), or cloudflare, not "yes"`: `serveNode` checks the variable before listening, not on every request.

```sh good
MEEKO_TRUST_PROXY=1 node .meeko/output/node/index.mjs
```

### An out-of-range port

```ts bad
await serveNode(app, { port: 70000 });
```

`RangeError: Invalid port: 70000`. In `meeko.config.ts`, an out-of-range `server.port` stops `meeko build` with `server.port debe ser un entero entre 0 y 65535`.

<!-- no-check -->

```ts good
await serveNode(app, { port: Number(process.env.MEEKO_PORT ?? 4173) });
```

### Behind a proxy without `publicOrigin`

```sh bad
# Caddy termina TLS en https://tienda.example.com y reenvía a http://127.0.0.1:4173
node .meeko/output/node/index.mjs
```

API and RPC mutations (since `1.8`, also without a session) respond with `403 INVALID_ORIGIN`, and browser Socket upgrades with `403`: the application compares `Origin` with its own address, not the public one.

```sh good
MEEKO_PUBLIC_ORIGIN=https://tienda.example.com node .meeko/output/node/index.mjs
```

## Notes

- **Node 24.** The adapter uses `node:http` and Web Streams; `Set-Cookie` headers are sent separately.
- **Socket.** It uses the `ws` package (loaded only if the application has channels), with frames up to `socket.maxMessageBytes` (64 KiB by default), no compression and a 30 s heartbeat. Binary messages are closed with `1003`.
- **Assets.** The application serves them from its manifest (`createNodeAssetReader`): it never reads a disk path not listed there.
- **Client IP.** `context.clientAddress` and `clientAddress(request)` are the remote socket; behind a proxy, `MEEKO_TRUST_PROXY=1` takes the entry the proxy added to `X-Forwarded-For`, and behind Cloudflare Tunnel (since `1.8`), `MEEKO_TRUST_PROXY=cloudflare` takes `CF-Connecting-IP` if the connection comes from networks in `MEEKO_TRUSTED_PROXIES`.
- **CSP and headers (since 1.7).** `server.contentSecurityPolicy` and `server.headers` from `meeko.config.ts` apply to every production response, with a nonce per SSR response and hashes for prerendered ones.
- **Request-target.** A path starting with `//` is always on the same origin, never another host.

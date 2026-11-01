---
title: createBunServer
group: adapters
since: 1.0.0
description: The fetch and websocket handlers for serving a Meeko application with Bun.serve, using Bun's native WebSocket for Socket and its payload, backpressure and idle limits.
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
source-hash: 8c09d7054d96a9f10e8145aa46c842aa34c965b61a81b2cc7bf65e9dd0afdac5
---

`createBunServer(app, options)` returns `{ fetch, websocket }` to spread into `Bun.serve`: `fetch` handles HTTP and upgrades Socket channels with `server.upgrade`, and `websocket` connects each peer to the hub using Bun's native WebSocket. It also records each connection's IP (`server.requestIP()`), read by `context.clientAddress` and `rateLimit`.

This is what `meeko build --adapter bun` output uses (`.meeko/output/bun/index.js`). Unlike Node, it does not close the server or install process failure policy: the host calls `server.stop()` and `handleProcessErrors`.

## Usage

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

## Parameters

`createBunServer(app, options?)`:

| Option              | Type                         | Default                                                | Description                                                                                                                |
| ------------------- | ---------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `publicOrigin`      | `string`                     | the application's, or Bun's listening URL              | Public origin for URLs and HTTP and Socket `Origin` checks. Never uses `Host`.                                             |
| `platform`          | `ServerPlatform`             | Bun with `Bun.env`                                     | Each request's platform.                                                                                                   |
| `onError`           | `(error, requestId) => void` | the application's                                      | Transport failure observer.                                                                                                |
| `maxPayloadLength`  | `number`                     | the application's `socket.maxMessageBytes`, or `65536` | Largest incoming frame; Bun closes larger ones.                                                                            |
| `backpressureLimit` | `number`                     | `1048576` (1 MiB)                                      | Queued outgoing bytes per peer. A send exceeding this closes that peer with `1011`, without blocking the rest of the room. |
| `idleTimeout`       | `number`                     | `60`                                                   | Seconds without traffic before closing a peer.                                                                             |
| `sendPings`         | `boolean`                    | `true`                                                 | Sends pings to idle peers so live connections do not expire.                                                               |

## Return value

A `BunServeHandlers`:

| Member                   | Description                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetch(request, server)` | Handles HTTP with `app.fetch` and Socket upgrades. Returns `undefined` after an upgrade, as Bun expects.                                                                                    |
| `websocket`              | `open`, `message` and `close`, with `maxPayloadLength`, `backpressureLimit`, `closeOnBackpressureLimit: false`, `idleTimeout`, `sendPings` and `perMessageDeflate: false` already resolved. |

## Examples

### Build and run Bun output

```sh
npx meeko build --adapter bun
npx meeko preview --adapter bun                 # lanza bun sobre la salida
MEEKO_HOST=0.0.0.0 MEEKO_PORT=3000 bun .meeko/output/bun/index.js
```

`index.js` includes `@meekojs/meeko` and server dependencies: copy the entire folder, without `node_modules`. Building and prerendering still run in Node.

### A Bun container

```dockerfile
FROM oven/bun:1.4
WORKDIR /app
COPY .meeko/output/bun ./
ENV MEEKO_HOST=0.0.0.0 MEEKO_PORT=3000
EXPOSE 3000
CMD ["bun", "index.js"]
```

`server.host` and `server.port` in `meeko.config.ts` only apply to Node: in Bun use `MEEKO_HOST` and `MEEKO_PORT` (or `PORT`).

### Alongside other `Bun.serve` routes

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

The `websocket` handler ignores sockets not opened by Meeko.

## Common mistakes

### Use it outside Bun

```ts bad
// node server.ts
createBunAssetReader({ root, assets }).get("/assets/entry.js", request);
```

`Error: The Meeko Bun adapter requires the Bun runtime`. `meeko preview --adapter bun` launches `bun`; if it is not on `PATH`, it fails with an explicit message.

```sh good
bun .meeko/output/bun/index.js
```

### A limit that is not a positive integer

```ts bad
Bun.serve({ port: 3000, ...createBunServer(app, { maxPayloadLength: 0 }) });
```

`RangeError: Invalid maxPayloadLength` (or `Invalid backpressureLimit`, `Invalid idleTimeout`).

<!-- no-check -->

```ts good
Bun.serve({ port: 3000, ...createBunServer(app, { maxPayloadLength: 16 * 1024 }) });
```

### Without `handleProcessErrors` in a custom host

```ts bad
Bun.serve({ port: 3000, ...createBunServer(app) });
setTimeout(() => { throw new Error("tarea programada"); }, 1000);
```

The process exits with the error without going through `onError` or closing connections: `createBunServer` does not install the `processErrors` policy.

<!-- no-check -->

```ts good
const server = Bun.serve({ port: 3000, ...createBunServer(app) });
handleProcessErrors(app, { close: async () => { await server.stop(); await app.close(); } });
```

### An invalid `MEEKO_TRUST_PROXY`

```sh bad
MEEKO_TRUST_PROXY=on bun .meeko/output/bun/index.js
```

Startup stops with `TypeError: MEEKO_TRUST_PROXY must be true, false or the number of trusted proxies (1-99), or cloudflare, not "on"`: `createBunServer` checks the variable on creation.

```sh good
MEEKO_TRUST_PROXY=1 bun .meeko/output/bun/index.js
```

## Notes

- **Socket in Bun.** Native `Bun.serve` WebSocket: `maxPayloadLength` cuts off frames before the hub (which also responds with `1009` above its own limit), binary messages close with `1003` and compression is disabled. A session or authorization rejection upgrades and closes with `4401` or `4403`.
- **Signals.** Generated output stops `Bun.serve` and closes the application on `SIGINT` and `SIGTERM`, and applies `processErrors`; in a custom host, do this yourself.
- **Process failures.** Bun preserves the request's `requestId` in exceptions, not in rejections.
- **IP.** `server.requestIP()` provides the connection IP; behind a proxy, use `MEEKO_TRUST_PROXY`.
- **CSP and headers (since 1.7).** `server.contentSecurityPolicy` and `server.headers` apply just as in Node.
- **Conformance.** `pnpm run conformance:bun` builds the test application with this adapter and runs it with Bun without sources or `node_modules`.

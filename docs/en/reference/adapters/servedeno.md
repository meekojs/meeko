---
title: serveDeno
group: adapters
since: 1.0.0
description: Serves a Meeko application with Deno.serve, with Socket over Deno.upgradeWebSocket, graceful shutdown on signals and the process failure policy.
symbols:
  - "@meekojs/meeko/deno#serveDeno"
types:
  - "@meekojs/meeko/deno#ServeDenoOptions"
  - "@meekojs/meeko/deno#DenoServer"
related:
  - "@meekojs/meeko/deno#createDenoAssetReader"
  - "@meekojs/meeko/server#handleProcessErrors"
  - "@meekojs/meeko/server#createServerApp"
  - "@meekojs/meeko/node#serveNode"
  - "config:server"
  - docs/framework.md#deno
  - docs/framework.md#conformidad-entre-adaptadores
source-hash: 5271fba8ded85c7abed7df0c347b05bf658b8185f50c49919e68b52b8c53e057
---

`serveDeno(app, options)` starts `Deno.serve` for a `createServerApp` application: it handles HTTP through `app.fetch`, upgrades Socket channels through `Deno.upgradeWebSocket` and records each connection's IP (`remoteAddr`). With `handleSignals`, it shuts down gracefully on `SIGINT` and `SIGTERM` (`SIGINT` and `SIGBREAK` on Windows) and, since `1.3`, applies `processErrors`.

It is what the `meeko build --adapter deno` output runs (`.meeko/output/deno/main.js`).

## Usage

<!-- no-check -->

```ts
import { createServerApp } from "@meekojs/meeko/server";
import { createDenoAssetReader, serveDeno } from "@meekojs/meeko/deno";

const app = await createServerApp({
  manifest, load, runtime, production: true,
  assets: createDenoAssetReader({ root: new URL("./client/", import.meta.url), assets: manifest.assets ?? {} }),
});
const server = await serveDeno(app, { host: "0.0.0.0", port: 8000, handleSignals: true });
console.log(server.url);
```

## Parameters

`serveDeno(app, options?)`:

| Option            | Type                         | Default                                                | Description                                                                       |
| ----------------- | ---------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `host`            | `string`                     | `"127.0.0.1"`                                          | Interface; `"0.0.0.0"` accepts remote traffic.                                    |
| `port`            | `number`                     | `4173`                                                 | Port; `0` chooses a free one.                                                     |
| `publicOrigin`    | `string`                     | the application's, or the listening URL                | Origin for URLs and the `Origin` check.                                           |
| `platform`        | `ServerPlatform`             | Deno with `Deno.env.toObject()`                        | Each request's platform.                                                          |
| `onError`         | `(error, requestId) => void` | the application's                                      | Observer for transport failures.                                                  |
| `maxMessageBytes` | `number`                     | the application's `socket.maxMessageBytes`, or `65536` | Largest incoming Socket message; larger ones close the peer with `1009`.          |
| `idleTimeout`     | `number`                     | `60`                                                   | Seconds without `pong` before Deno closes a peer; pings are sent halfway through. |
| `handleSignals`   | `boolean`                    | `false`                                                | Graceful shutdown on signals and, since `1.3`, `processErrors`.                   |

## Return value

A promise with a `DenoServer`:

| Member     | Description                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`      | The local URL with the listening address, such as `http://127.0.0.1:4173`. The `meeko build --adapter deno` output _displays_ `http://localhost:4173` since `1.7.1`; `url` does not change. |
| `finished` | Resolves when the HTTP server has stopped.                                                                                                                                                  |
| `close()`  | Closes Socket peers with `1001`, stops HTTP, waits for `waitUntil` tasks and closes the application, in that order. During shutdown, new requests receive `503`.                            |

## Examples

### Build and run with minimum permissions

```sh
npx meeko build --adapter deno
deno run --allow-net --allow-env --allow-read=.meeko/output/deno .meeko/output/deno/main.js
```

`main.js` includes all server dependencies. `--allow-env` is required because the runtime receives `Deno.env.toObject()`; `meeko preview --adapter deno` grants `-A`.

### A container

```dockerfile
FROM denoland/deno:2.9.8
WORKDIR /app
COPY .meeko/output/deno ./
ENV MEEKO_HOST=0.0.0.0 MEEKO_PORT=8000 MEEKO_PUBLIC_ORIGIN=https://tienda.example.com
EXPOSE 8000
CMD ["run", "--allow-net", "--allow-env", "--allow-read=.", "main.js"]
```

`server.host` and `server.port` from `meeko.config.ts` only apply to Node; here, use `MEEKO_HOST` and `MEEKO_PORT` (or `PORT`).

### Tests with a free port

<!-- no-check -->

```ts
const server = await serveDeno(app, { port: 0 });
const response = await fetch(`${server.url}/api/health`);
await response.body?.cancel();
await server.close();
await server.finished;
```

## Common mistakes

### Run the output without permissions

```sh bad
deno run .meeko/output/deno/main.js
```

Deno requests network, environment and build read access (or denies it if there is no terminal), and startup fails without those permissions.

```sh good
deno run --allow-net --allow-env --allow-read=.meeko/output/deno .meeko/output/deno/main.js
```

### Call it outside Deno

```ts bad
// node server.mjs
await serveDeno(app);
```

`Error: The Meeko Deno adapter requires the Deno runtime`.

```sh good
deno run --allow-net --allow-env --allow-read=. main.js
```

### An invalid port or limit

```ts bad
await serveDeno(app, { port: 70000, maxMessageBytes: 0 });
```

`RangeError: Invalid port: 70000`; with a valid port, `RangeError: Invalid maxMessageBytes` (or `Invalid idleTimeout`).

<!-- no-check -->

```ts good
await serveDeno(app, { port: 8000, maxMessageBytes: 16 * 1024 });
```

## Notes

- **Socket in Deno.** `Deno.upgradeWebSocket` has no frame limit: the adapter measures each message and closes larger ones with `1009`, but Deno has already reassembled it in memory. Limit request sizes at the proxy if you need an earlier cap. Binary messages close with `1003`; the outgoing buffer is controlled with `bufferedAmount`.
- **Session rejections.** The upgrade completes and the connection closes with `4401` or `4403` one loop iteration after opening, so the close reaches the client even if it has already sent a message.
- **Process failures.** Deno uses `globalThis`'s `unhandledrejection` and `error`; it preserves `requestId` in rejections.
- **IP.** The connection's `remoteAddr`; behind a proxy, `MEEKO_TRUST_PROXY`. An invalid variable stops startup.
- **CSP and headers (since 1.7).** `server.contentSecurityPolicy` and `server.headers` apply just as in Node.

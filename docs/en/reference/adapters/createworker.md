---
title: createWorker
group: adapters
since: 1.0.0
description: Serves a Meeko application from a Cloudflare module Worker, created once per isolate with its bindings, forwarding Socket upgrades to their room's Durable Object.
symbols:
  - "@meekojs/meeko/cloudflare#createWorker"
types:
  - "@meekojs/meeko/cloudflare#CloudflareWorkerOptions"
  - "@meekojs/meeko/cloudflare#CloudflareApp"
  - "@meekojs/meeko/cloudflare#CloudflareAppContext"
related:
  - "@meekojs/meeko/cloudflare#createSocketRoomClass"
  - "@meekojs/meeko/cloudflare#DurableObjectSocketPubSub"
  - "@meekojs/meeko/cloudflare#D1SessionDriver"
  - "@meekojs/meeko/cloudflare#createCloudflareAssetReader"
  - "@meekojs/meeko/cloudflare#createCloudflarePrerenderSource"
  - "config:server"
  - docs/framework.md#cloudflare-workers
  - docs/framework.md#socket-y-durable-objects
source-hash: 4a17d1010f37574440c0545407b4c82e57b3aabb8fed5a11aa8601656c081293
---

`createWorker(app, options)` returns the `{ fetch }` handler for a module Worker (`export default createWorker(…)`). `app` can be an existing application or, usually, a factory `({ env, platform }) => ServerApp` that runs on each isolate's first event with the Worker's bindings; if it fails, the next event retries it. Each request receives `platform.waitUntil` backed by `ctx.waitUntil` and the IP from `CF-Connecting-IP`.

Socket upgrades are checked in the Worker itself (path, `Origin`, session and channel authorization) and forwarded to their room's Durable Object, `env.MEEKO_SOCKET.idFromName(canal + "\0" + sala)`. This is what `meeko build --adapter cloudflare` generates in `.meeko/output/cloudflare/worker.js`.

## Usage

<!-- no-check -->

```ts
// worker.ts de un Worker propio
import { DurableObject } from "cloudflare:workers";
import { createCloudflareAssetReader, createCloudflarePrerenderSource, createSocketRoomClass, createWorker } from "@meekojs/meeko/cloudflare";
import type { CloudflareAppContext } from "@meekojs/meeko/cloudflare";

function createCloudflareApp({ env, platform }: CloudflareAppContext<Env>) {
  return createApp({
    production: true,
    platform,
    assets: createCloudflareAssetReader({ binding: env.ASSETS, assets: manifest.assets ?? {} }),
    prerender: createCloudflarePrerenderSource({ binding: env.ASSETS }),
  });
}

export default createWorker(createCloudflareApp);
export const MeekoSocketRoom = createSocketRoomClass(createCloudflareApp, DurableObject);
```

## Parameters

`createWorker(app, options?)`:

| Parameter               | Type                                                                    | Default                                       | Description                                            |
| ----------------------- | ----------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| `app`                   | `ServerApp` or `({ env, platform }) => ServerApp \| Promise<ServerApp>` | required                                      | The application, or its factory, run once per isolate. |
| `options.socketBinding` | `string`                                                                | `"MEEKO_SOCKET"`                              | The namespace binding for room Durable Objects.        |
| `options.publicOrigin`  | `string`                                                                | the application's, or the routed URL's origin | Origin for HTTP and Socket `Origin` checks.            |
| `options.onError`       | `(error, requestId) => void`                                            | the application's                             | Observer for failures, including startup.              |

## Return value

A `CloudflareWorker` with `fetch(request, env, ctx)`:

| Case                                                                                   | Response                                                                                                                                   |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| The factory fails                                                                      | The `errorResponse` response (`500 INTERNAL_ERROR`) and the error in `onError` or the console (`[meeko] application startup failed <id>`). |
| The application declares channels with a broker other than `DurableObjectSocketPubSub` | The factory is rejected: `500` on every request until corrected.                                                                           |
| Upgrade rejected by path, `Origin` or channel                                          | `400`, `403` or `404` over HTTP.                                                                                                           |
| Upgrade rejected by session or authorization                                           | `101` and immediate closure with `4401` or `4403`, without waking the Durable Object.                                                      |
| Upgrade accepted                                                                       | The room Durable Object's response.                                                                                                        |
| Any other                                                                              | `app.fetch`, with assets and prerendered pages from the binding.                                                                           |

## Examples

### Adapter configuration

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  server: {
    adapter: "cloudflare",
    name: "mi-app",
    compatibilityDate: "2026-10-19",
    wrangler: {
      d1_databases: [{ binding: "DB", database_name: "mi-app", database_id: "<id>" }],
      vars: { MEEKO_PUBLIC_ORIGIN: "https://mi-app.example" },
    },
  },
});
```

```sh
npx meeko build --adapter cloudflare
npx meeko preview --adapter cloudflare   # wrangler dev sobre la salida
npx wrangler deploy --config .meeko/output/cloudflare/wrangler.jsonc
```

### The runtime with D1 and rooms

```ts
// server/runtime.ts
import { D1SessionDriver, DurableObjectSocketPubSub } from "@meekojs/meeko/cloudflare";
import type { D1DatabaseLike, DurableObjectNamespaceLike } from "@meekojs/meeko/cloudflare";
import { defineServerRuntime, MemorySessionStore, SessionManager, SqlSessionStore } from "@meekojs/meeko/server";

interface Env { readonly DB?: D1DatabaseLike; readonly MEEKO_SOCKET?: DurableObjectNamespaceLike }

export default defineServerRuntime<Env>(({ env, production, prerendering }) => {
  // El prerender se ejecuta en Node, sin bindings.
  const store = prerendering || !env.DB ? new MemorySessionStore() : new SqlSessionStore(new D1SessionDriver(env.DB, { rateLimitTable: "meeko_rate_limits" }));
  return {
    sessions: new SessionManager({ production: production && !prerendering, store }),
    ...(env.MEEKO_SOCKET ? { socket: { pubsub: new DurableObjectSocketPubSub(env.MEEKO_SOCKET) } } : {}),
  };
});
```

### A room binding with another name

<!-- no-check -->

```ts
export default createWorker(createCloudflareApp, { socketBinding: "ROOMS", publicOrigin: "https://mi-app.example" });
```

`wrangler.jsonc` must declare `ROOMS` pointing to the class from `createSocketRoomClass`.

## Common mistakes

### Sessions with `MEEKO_REDIS_URL`

```ts bad
// server/runtime.ts sin sessions, con MEEKO_REDIS_URL en vars
export default defineServerRuntime(() => ({}));
```

Each request responds with `500`, and startup reports `MEEKO_REDIS_URL needs TCP connections, which Cloudflare Workers do not offer: return a SessionManager with SqlSessionStore(new D1SessionDriver(env.DB)), or RedisSessionStore over the Upstash REST API, from server/runtime.ts`. Without the variable, `Production requires a persistent session store: …`.

<!-- no-check -->

```ts good
export default defineServerRuntime<Env>(({ env, production, prerendering }) => ({
  sessions: new SessionManager({ store: new SqlSessionStore(new D1SessionDriver(env.DB!)), production: production && !prerendering }),
}));
```

### Another Socket broker

```ts bad
socket: { pubsub: new RedisSocketPubSub({ publisher, subscriber, prefix: "app:" }) }
```

The application is not created: `Socket channels on Cloudflare Workers require DurableObjectSocketPubSub: leave runtime.socket.pubsub unset and bind MEEKO_SOCKET, or set it to new DurableObjectSocketPubSub(env.MEEKO_SOCKET). Other brokers cannot reach the WebSockets held by Socket room Durable Objects.`

<!-- no-check -->

```ts good
socket: env.MEEKO_SOCKET ? { pubsub: new DurableObjectSocketPubSub(env.MEEKO_SOCKET) } : {}
```

### Channels without the room binding

```text bad
wrangler.jsonc propio sin el binding MEEKO_SOCKET
```

Every upgrade responds with `500`, and `onError` receives `Socket channels require the MEEKO_SOCKET Durable Object binding`. The `wrangler.jsonc` generated by `meeko build` always declares it.

```text good
npx wrangler deploy --config .meeko/output/cloudflare/wrangler.jsonc
```

### A `publicOrigin` without a scheme

```ts bad
createWorker(createCloudflareApp, { publicOrigin: "mi-app.example" });
```

`TypeError: Invalid publicOrigin: mi-app.example`, when loading the module.

<!-- no-check -->

```ts good
createWorker(createCloudflareApp, { publicOrigin: "https://mi-app.example" });
```

## Notes

- **One application per isolate.** The factory runs on the first event and is reused; `server/runtime.ts` receives the bindings object as `env`, and `platform` is `"cloudflare"`.
- **Assets.** `wrangler.jsonc` declares `run_worker_first: true`: all requests reach the Worker, which serves only manifest files, with the same `ETag` and caching as other adapters. Prerendered pages live in `assets/_meeko/prerender/` and are never served as files.
- **IP.** `CF-Connecting-IP`, set and replaced by Cloudflare's edge: a client cannot spoof it. `MEEKO_TRUST_PROXY` is only needed if there is another proxy in front; `cloudflare` changes nothing because the connection is already `CF-Connecting-IP`, a public IP.
- **Process failures.** There is no process to close: unhandled isolate rejections reach `onError`, and an exception only fails its request or `waitUntil` task.
- **CSP and headers (since 1.7).** `server.contentSecurityPolicy` and `server.headers` apply as on Node; hashes and the nonce use Web Crypto.
- **No TCP.** Neither TCP Redis nor `@meekojs/meeko/password` (scrypt exhausts the isolate's memory): use D1 or Upstash for sessions, and an external service for password verification.
- **Conformance.** The `workerd` variant builds with this adapter and runs it using Wrangler's local runtime, with in-memory D1 and Durable Objects, including forced hibernation.

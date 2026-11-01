---
title: createSocketRoomClass
group: adapters
since: 1.0.0
description: Creates the Durable Object class hosting a Socket room's WebSockets in Cloudflare Workers, with the hibernation API, reconstruction on wake and per-room limits.
symbols:
  - "@meekojs/meeko/cloudflare#createSocketRoomClass"
types:
  - "@meekojs/meeko/cloudflare#SocketRoomOptions"
  - "@meekojs/meeko/cloudflare#MeekoSocketRoomClass"
related:
  - "@meekojs/meeko/cloudflare#createWorker"
  - "@meekojs/meeko/cloudflare#DurableObjectSocketPubSub"
  - "@meekojs/meeko/cloudflare#socketRoomName"
  - "@meekojs/meeko/server#defineSocketChannel"
  - docs/framework.md#socket-y-durable-objects
  - docs/framework.md#cloudflare-workers
source-hash: d705a33ce104be7a921d14b0986a2e9abb629f10a2ad9e063532aa44a5b2eb22
---

`createSocketRoomClass(app, DurableObject, options)` returns the class exported from the Worker for Socket rooms: one Durable Object per channel/room pair. The room accepts WebSockets with the hibernation API (`ctx.acceptWebSocket`), so idle connections do not keep the object in memory; on wake, it reconstructs each connection from its _attachment_ and the hub authorizes it again. It distributes publications to its peers in order.

Import `DurableObject` from `cloudflare:workers` and pass it as an argument so `@meekojs/meeko/cloudflare` can load outside Workers. `app` is the same application or factory passed to `createWorker`.

## Usage

<!-- no-check -->

```ts
import { DurableObject } from "cloudflare:workers";
import { createSocketRoomClass, createWorker } from "@meekojs/meeko/cloudflare";

export default createWorker(createCloudflareApp);
export const MeekoSocketRoom = createSocketRoomClass(createCloudflareApp, DurableObject, {
  keepHeaders: ["accept-language"],
  rebuildTimeoutMs: 2_000,
});
```

The exported name must match `wrangler.jsonc` (`server.socketClassName`, `MeekoSocketRoom` by default).

## Parameters

`createSocketRoomClass(app, base, options?)`:

| Option                   | Type                             | Default                                                | Description                                                                                                                                                                                                      |
| ------------------------ | -------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxMessageBytes`        | `number`                         | the application's `socket.maxMessageBytes`, or `65536` | Largest incoming message; larger ones close the peer with `1009`.                                                                                                                                                |
| `autoResponse`           | `{ request, response } \| false` | `{ request: "ping", response: "pong" }`                | Text message the runtime answers without waking the object. Protocol pings are always answered.                                                                                                                  |
| `keepHeaders`            | `readonly string[]`              | `[]`                                                   | Additional headers (lowercase) the channel sees in `context.request` before and after hibernation. By default the session cookie, `origin` and `authorization` are retained; `"cookie"` retains the full header. |
| `maxPendingPublications` | `number`                         | `1024`                                                 | Undelivered publications a room accepts; above this, `publish` rejects with `SOCKET_BACKLOG_EXCEEDED` (`503`).                                                                                                   |
| `rebuildTimeoutMs`       | `number`                         | `5000`                                                 | Milliseconds publications wait for connections being reconstructed after hibernation.                                                                                                                            |
| `onError`                | `(error, requestId) => void`     | the application's                                      | Error observer.                                                                                                                                                                                                  |

## Return value

A `MeekoSocketRoomClass<Env>` class (`new (ctx, env) => MeekoSocketRoom`) with `fetch` (the upgrade forwarded by `createWorker`), `webSocketMessage`, `webSocketClose`, `webSocketError` and `meekoPublish` (`DurableObjectSocketPubSub`'s RPC).

## Examples

### The declaration in `wrangler.jsonc`

```jsonc
// .meeko/output/cloudflare/wrangler.jsonc (generado; no lo edite)
{
  "main": "./worker.js",
  "durable_objects": { "bindings": [{ "name": "MEEKO_SOCKET", "class_name": "MeekoSocketRoom" }] },
  "migrations": [{ "tag": "meeko-socket-v1", "new_sqlite_classes": ["MeekoSocketRoom"] }]
}
```

With your own `migrations` history in `server.wrangler`, append that entry; the build stops with `server.wrangler.migrations does not create the Socket room class …; append { "tag": "meeko-socket-v1", "new_sqlite_classes": ["MeekoSocketRoom"] } at the end of server.wrangler.migrations` if missing.

### A per-connection language surviving hibernation

<!-- no-check -->

```ts
// worker.ts
export const MeekoSocketRoom = createSocketRoomClass(createCloudflareApp, DurableObject, { keepHeaders: ["accept-language"] });
```

<!-- no-check -->

```ts
// server/socket/support.ts
export default defineSocketChannel({
  clientToServer: { ask },
  serverToClient: { answer },
  handlers: {
    ask: async ({ payload, context, emit }) => {
      const language = context.request.headers.get("accept-language") ?? "es";
      await emit("answer", await answerIn(language, payload));
    },
  },
});
```

### Very active rooms

<!-- no-check -->

```ts
export const MeekoSocketRoom = createSocketRoomClass(createCloudflareApp, DurableObject, {
  maxPendingPublications: 4096,
  maxMessageBytes: 8 * 1024,
  autoResponse: false,
});
```

A Durable Object runs its code on a single thread: distribute traffic across multiple rooms (per document, per group) before increasing the limits of one global room.

## Common mistakes

### Omit the `DurableObject` class

```ts bad
export const MeekoSocketRoom = createSocketRoomClass(createCloudflareApp, undefined as never);
```

`TypeError: createSocketRoomClass requires DurableObject from cloudflare:workers`. Pass it from the Worker.

<!-- no-check -->

```ts good
import { DurableObject } from "cloudflare:workers";
export const MeekoSocketRoom = createSocketRoomClass(createCloudflareApp, DurableObject);
```

### Uppercase headers

```ts bad
createSocketRoomClass(createCloudflareApp, DurableObject, { keepHeaders: ["Accept-Language"] });
```

`TypeError: keepHeaders must list lowercase header names: Accept-Language`.

<!-- no-check -->

```ts good
createSocketRoomClass(createCloudflareApp, DurableObject, { keepHeaders: ["accept-language"] });
```

### An invalid limit

```ts bad
createSocketRoomClass(createCloudflareApp, DurableObject, { maxPendingPublications: 0, rebuildTimeoutMs: -1 });
```

`RangeError: Invalid maxPendingPublications`; with a valid value, `RangeError: rebuildTimeoutMs must be a non-negative number`.

<!-- no-check -->

```ts good
createSocketRoomClass(createCloudflareApp, DurableObject, { maxPendingPublications: 512, rebuildTimeoutMs: 2_000 });
```

### A cookie too large for the _attachment_

```ts bad
createSocketRoomClass(createCloudflareApp, DurableObject, { keepHeaders: ["cookie"] }); // cookies de analítica de 20 KB
```

Cloudflare limits a WebSocket's _attachment_ to 16,384 bytes. Meeko estimates size before accepting: the upgrade responds with `431` and `onError` receives the error, rather than opening a connection that would close with `1011`.

<!-- no-check -->

```ts good
createSocketRoomClass(createCloudflareApp, DurableObject); // sólo la cookie de sesión de Meeko
```

## Notes

- **Security.** By default, only the cookie named by `SessionManager` is stored, not the rest of the `Cookie` header; on wake, the hub authorizes each connection again with it and closes with `4401` or `4403` if no longer valid.
- **Delivery.** Each publication reaches already subscribed peers; a connection still being authorized does not delay others. On wake, publications wait at most `rebuildTimeoutMs` for reconstructed connections.
- **Buffer.** Workers WebSockets do not report `bufferedAmount`: `socket.maxBufferBytes` does not apply in rooms; `maxMessageBytes` and `maxPendingDeliveries` do.
- **Configuration.** The Worker generated by `meeko build` uses defaults; changing `keepHeaders`, `maxPendingPublications` or `rebuildTimeoutMs` requires a custom Worker.
- **Failures on wake.** If the application cannot be created, the room reports the error and closes the WebSocket that woke it with `1011`.

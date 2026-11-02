---
title: attachNodeWebSocketServer
group: adapters
since: 1.0.0
description: Connects Meeko Socket channels to a Node HTTP server through the ws package, with a frame limit, heartbeat and shutdown of all peers.
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
source-hash: 1b674dc97ba1236a8206bcae1b848b66d1c322941206dc3afb426aed1e96bb54
---

`attachNodeWebSocketServer(options)` listens for a Node HTTP server's `upgrade` event and handles upgrades to `/_meeko/socket/<canal>` through the [`ws`](https://github.com/websockets/ws) package. Before accepting, the hub checks the path, `Origin`, session and channel authorization; afterwards, the adapter delivers each text message to the hub, pings peers and closes unresponsive ones.

`serveNode` calls it automatically when the application declares channels. Use it in a host with its own `http.createServer`, alongside `toNodeListener`.

## Usage

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

## Parameters

`attachNodeWebSocketServer(options)`:

| Option            | Type                       | Default            | Description                                                                                                              |
| ----------------- | -------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `server`          | `http.Server`              | required           | The same server that serves the Fetch handler.                                                                           |
| `hub`             | `SocketHub`                | required           | The application's hub, `app.socket.hub`.                                                                                 |
| `publicOrigin`    | `string`                   | required           | Fixed public origin, `http:` or `https:`. Compared against the upgrade's `Origin`; never inferred from `Host`.           |
| `pathnamePrefix`  | `string`                   | `"/_meeko/socket"` | Channel prefix, from `app.socket.pathnamePrefix`. Starts with `/` and does not end with `/`.                             |
| `maxMessageBytes` | `number`                   | `65536`            | Maximum frame payload, enforced by `ws` before decoding; also the buffer for messages arriving while the hub authorizes. |
| `heartbeatMs`     | `number`                   | `30000`            | Ping interval. A peer that does not respond with `pong` before the next one is terminated.                               |
| `onError`         | `(error: unknown) => void` | console            | Upgrade, peer and session failures.                                                                                      |

## Return value

A `NodeWebSocketServer` with `close()`: removes the `upgrade` listener, terminates all peers and closes the `ws` server. The caller retains ownership of the HTTP server.

Each upgrade ends as follows:

| Case                                                                                | Result                                                                         |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Path outside the prefix                                                             | Ignored: another `upgrade` listener can handle it.                             |
| Invalid channel name or method other than `GET`                                     | `400` over HTTP.                                                               |
| Nonexistent channel                                                                 | `404` over HTTP.                                                               |
| Disallowed `Origin`                                                                 | `403` over HTTP.                                                               |
| Channel with `auth: "required"` without a session, or `authorize` returning `false` | Upgrade and immediate close with `4401` or `4403`, which the browser can read. |
| Accepted                                                                            | Open connection in the hub.                                                    |

## Examples

### Graceful shutdown of a custom host

<!-- no-check -->

```ts
process.once("SIGTERM", async () => {
  await sockets?.close();                                   // 1. Socket
  await new Promise<void>((done) => server.close(() => done())); // 2. HTTP
  await app.close();                                        // 3. aplicación y sesiones
});
```

### A smaller limit for a chat

<!-- no-check -->

```ts
attachNodeWebSocketServer({ server, hub: app.socket!.hub, publicOrigin, pathnamePrefix: app.socket!.pathnamePrefix, maxMessageBytes: 4 * 1024, heartbeatMs: 15_000 });
```

A larger frame closes the peer with `1009`. Keep this limit equal to or above `socket.maxMessageBytes` in `server/runtime.ts`, or messages valid for the hub will be cut off earlier.

### A proxy in front

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

## Common mistakes

### A limit that is not a positive integer

```ts bad
attachNodeWebSocketServer({ server, hub, publicOrigin, maxMessageBytes: 0 });
```

`RangeError: Invalid socket message limit`; with `heartbeatMs`, `Invalid socket heartbeat interval`.

<!-- no-check -->

```ts good
attachNodeWebSocketServer({ server, hub, publicOrigin, maxMessageBytes: 16 * 1024 });
```

### A `ws://` origin

```ts bad
attachNodeWebSocketServer({ server, hub, publicOrigin: "wss://example.com" });
```

`TypeError: Socket publicOrigin must use HTTP or HTTPS`: the browser sends the page's origin as `Origin`, `https://example.com`.

<!-- no-check -->

```ts good
attachNodeWebSocketServer({ server, hub, publicOrigin: "https://example.com" });
```

### A prefix with a trailing `/`

```ts bad
attachNodeWebSocketServer({ server, hub, publicOrigin, pathnamePrefix: "/ws/" });
```

`TypeError: Invalid socket pathname prefix`: the prefix starts with `/` and does not end with `/`. Pass the application's prefix, `app.socket.pathnamePrefix`, to match the URL used by generated clients.

<!-- no-check -->

```ts good
attachNodeWebSocketServer({ server, hub: app.socket!.hub, publicOrigin, pathnamePrefix: app.socket!.pathnamePrefix });
```

## Notes

- **`ws`.** It is a dependency of `@meekojs/meeko` and loads when you call the function, not when you import the adapter.
- **Messages.** JSON text only: a binary message closes the peer with `1003`. Per-message compression is disabled.
- **Origin.** Protects against _cross-site WebSocket hijacking_: a foreign origin never completes the upgrade, even to a channel that would subsequently reject it.
- **IP.** The upgrade records the socket's IP, which the channel sees in `context.clientAddress`.
- **Multiple instances.** The server only knows its peers; broadcasts between instances require `RedisSocketPubSub`.

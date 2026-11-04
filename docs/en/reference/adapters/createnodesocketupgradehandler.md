---
title: createNodeSocketUpgradeHandler
group: adapters
since: 1.0.0
description: Checks Socket upgrade policy in Node's upgrade event and leaves framing to the host's chosen WebSocket library.
symbols:
  - "@meekojs/meeko/node#createNodeSocketUpgradeHandler"
types:
  - "@meekojs/meeko/node#NodeSocketUpgradeOptions"
  - "@meekojs/meeko/node#NodeAcceptedSocket"
related:
  - "@meekojs/meeko/node#attachNodeWebSocketServer"
  - "@meekojs/meeko/server#createSocketUpgradeHandler"
  - "@meekojs/meeko/server#createSocketHub"
  - docs/framework.md#websocket
source-hash: c5410fcdfbea9d4d46b0cad7a49438504d786bdc2ec70f0311581fc1b799c120
---

`createNodeSocketUpgradeHandler(options)` is the part of `attachNodeWebSocketServer` independent of `ws`: it receives `(incoming, socket, head)` from Node's `upgrade` event, checks the path, method, `Origin`, session and channel authorization with the hub, and only then calls your `upgrade`, which performs the handshake with the host's WebSocket library. It then connects peer messages and closure to the hub.

Use it to change WebSocket libraries (`uWebSockets.js`, a different `ws` configuration) or share the `upgrade` event with other services.

## Usage

<!-- no-check -->

```ts
import { WebSocketServer } from "ws";
import type WebSocket from "ws";
import { createNodeSocketUpgradeHandler } from "@meekojs/meeko/node";
import type { NodeAcceptedSocket } from "@meekojs/meeko/node";

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const accepted = (ws: WebSocket): NodeAcceptedSocket => ({
  peer: { send: (message) => ws.send(message), close: (code, reason) => ws.close(code, reason), get bufferedAmount() { return ws.bufferedAmount; } },
  onMessage: (listener) => ws.on("message", (data, binary) => binary ? ws.close(1003, "Text messages required") : listener(data.toString())),
  onClose: (listener) => ws.on("close", listener),
});

const handleUpgrade = createNodeSocketUpgradeHandler({
  hub: app.socket!.hub,
  publicOrigin: "https://example.com",
  pathnamePrefix: app.socket!.pathnamePrefix,
  upgrade: (incoming, socket, head) => new Promise((resolve) => wss.handleUpgrade(incoming, socket, head, (ws) => resolve(accepted(ws)))),
});

server.on("upgrade", (incoming, socket, head) => {
  void handleUpgrade(incoming, socket, head).then((handled) => { if (!handled) socket.destroy(); });
});
```

## Parameters

`createNodeSocketUpgradeHandler(options)`:

| Option                             | Type                               | Default             | Description                                                                      |
| ---------------------------------- | ---------------------------------- | ------------------- | -------------------------------------------------------------------------------- |
| `hub`                              | `SocketHub`                        | required            | The application's hub.                                                           |
| `publicOrigin`                     | `string`                           | required            | Fixed public origin (`http:` or `https:`); policy is never inferred from `Host`. |
| `pathnamePrefix`                   | `string`                           | `"/_meeko/socket"`  | Channel prefix.                                                                  |
| `maxPendingBytes`                  | `number`                           | `65536`             | Incoming bytes retained while the hub authorizes the connection.                 |
| `upgrade(incoming, socket, head)`  | `NodeAcceptedSocket \| Promise<…>` | required            | Performs the handshake and returns `{ peer, onMessage, onClose }`.               |
| `reject(incoming, socket, status)` | `void`                             | destroys the socket | Responds to a rejected handshake over HTTP (`400`, Origin `403`, `404`).         |
| `onError`                          | `(error: unknown) => void`         | console             | Upgrade and session failures.                                                    |

## Return value

A handler `(incoming, socket, head) => Promise<boolean>`: `false` if the path is not a channel (another listener can handle it), `true` if handled (accepted, rejected or closed).

Since `1.1`, session rejection (`401`) or channel authorization rejection (`403`) does not reach `reject`: the connection upgrades and immediately closes with `4401` or `4403`, because the browser's `WebSocket` does not expose the HTTP status of a rejected handshake. A disallowed `Origin` does reach `reject` with `403`.

## Examples

### A real HTTP response for rejections

<!-- no-check -->

```ts
import { STATUS_CODES } from "node:http";

createNodeSocketUpgradeHandler({
  hub, publicOrigin, upgrade,
  reject(_incoming, socket, status) {
    if (!socket.destroyed) socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? "Error"}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  },
});
```

This is what `attachNodeWebSocketServer` does.

### Share `upgrade` with another service

<!-- no-check -->

```ts
server.on("upgrade", async (incoming, socket, head) => {
  if (await handleUpgrade(incoming, socket, head)) return; // a Meeko channel
  if (incoming.url?.startsWith("/graphql")) return graphqlWs.handleUpgrade(incoming, socket, head);
  socket.destroy();
});
```

## Common mistakes

### A `wss://` public origin

```ts bad
createNodeSocketUpgradeHandler({ hub, publicOrigin: "wss://example.com", upgrade });
```

`TypeError: Socket publicOrigin must use HTTP or HTTPS`. The browser sends the page's `Origin`.

<!-- no-check -->

```ts good
createNodeSocketUpgradeHandler({ hub, publicOrigin: "https://example.com", upgrade });
```

### A prefix with a trailing `/`

```ts bad
createNodeSocketUpgradeHandler({ hub, publicOrigin, pathnamePrefix: "/_meeko/socket/", upgrade });
```

`TypeError: Invalid socket pathname prefix`.

<!-- no-check -->

```ts good
createNodeSocketUpgradeHandler({ hub, publicOrigin, pathnamePrefix: app.socket!.pathnamePrefix, upgrade });
```

### Ignore the result

```ts bad
server.on("upgrade", (incoming, socket, head) => { void handleUpgrade(incoming, socket, head); });
```

There is no error, but an upgrade to another path remains open without a response until the client gives up. Destroy the socket when the handler returns `false`.

<!-- no-check -->

```ts good
server.on("upgrade", (incoming, socket, head) => {
  void handleUpgrade(incoming, socket, head).then((handled) => { if (!handled) socket.destroy(); });
});
```

## Notes

- **Security.** The `Origin` check occurs before the upgrade; a foreign origin never reaches the session, so it cannot distinguish a `4401` from a `4403` either.
- **Absolute form.** An absolute request-target pointing to another origin responds with `400`.
- **Messages before authorization.** Data arriving while the hub authorizes is retained up to `maxPendingBytes`; `attachNodeWebSocketServer` closes with `1009` if exceeded.
- **Framing.** The adapter does not implement the WebSocket protocol: frame limits, compression and pings belong to the library.

---
title: createSocketUpgradeHandler
group: advanced
since: 1.0.0
description: Portable Socket handshake, validating the channel path, running hub checks and connecting the runtime's WebSocket to the hub.
symbols:
  - "@meekojs/meeko/server#createSocketUpgradeHandler"
types:
  - "@meekojs/meeko/server#SocketUpgradeOptions"
  - "@meekojs/meeko/server#SocketUpgrade"
related:
  - "@meekojs/meeko/server#createSocketHub"
  - "@meekojs/meeko/node#createNodeSocketUpgradeHandler"
  - "@meekojs/meeko/node#attachNodeWebSocketServer"
  - "@meekojs/meeko/deno#serveDeno"
  - "@meekojs/meeko/framework#createSocketClient"
  - docs/framework.md#websocket
source-hash: c113cf3e1b94319c56b6dbb110d9538466dc21bad446e526207544bb6ca7907a
---

`createSocketUpgradeHandler` separates the Socket handshake from transport: it receives the upgrade `Request` and decides what to do without touching any socket. If the path is not a channel, it returns `"pass"`; if it is not a valid upgrade or the hub rejects it, `"reject"` with the status; if everything is valid, `"upgrade"` with an `open(peer)` function the adapter calls once its runtime has opened the WebSocket. From there, client messages pass to the hub sequentially.

Meeko's Node, Bun, Deno and Cloudflare adapters share it. Use it directly to connect Socket to a runtime or server without a Meeko adapter.

## Usage

<!-- no-check -->

```ts
// server.ts, in Deno
import { createSocketUpgradeHandler } from "@meekojs/meeko/server";

const handleUpgrade = createSocketUpgradeHandler({ hub: app.socket!.hub, publicOrigin: "https://example.com" });

Deno.serve(async (request) => {
  const upgrade = await handleUpgrade(request);
  if (upgrade.action === "pass") return app.fetch(request);
  if (upgrade.action === "reject" && !upgrade.close) return new Response(null, { status: upgrade.status });
  const { socket, response } = Deno.upgradeWebSocket(request);
  socket.onopen = () => {
    if (upgrade.action === "reject") { setTimeout(() => socket.close(upgrade.close?.code, upgrade.close?.reason), 0); return; }
    const session = upgrade.open({ send: (message) => socket.send(message), close: (code, reason) => socket.close(code, reason) });
    socket.onmessage = (event) => session.receive(event.data);
    socket.onclose = () => session.closed();
  };
  return response;
});
```

## Options

| Option            | Type              | Default          | Description                                                                                                                                             |
| ----------------- | ----------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hub`             | `SocketHub`       | required         | The application's hub (`app.socket.hub`) or one from `createSocketHub`.                                                                                 |
| `publicOrigin`    | origin            | required         | Fixed public origin, `http:` or `https:`. Each handshake URL is reconstructed with it: policy is never inferred from a client-controlled `Host` header. |
| `pathnamePrefix`  | text              | `/_meeko/socket` | Channel prefix, served at `<prefijo>/<nombre>`.                                                                                                         |
| `maxPendingBytes` | number            | 65 536           | Incoming bytes retained while the hub authorizes a new connection.                                                                                      |
| `onError`         | `(error) => void` | none             | Transport and session failures.                                                                                                                         |

## Return value

`(request: Request) => Promise<SocketUpgrade>`, where `SocketUpgrade` is one of:

| `action`    | When                                                                                                                                                                           | What the adapter does                                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"pass"`    | The path does not start with the prefix.                                                                                                                                       | Pass the request to `app.fetch`.                                                                                                                                                         |
| `"reject"`  | Invalid channel name or not a `GET` with `Upgrade: websocket` (`400`), unknown channel (`404`), disallowed `Origin` (`403`), rejected session or authorization (`401`, `403`). | Respond with `status`. Since `1.1`, a session or channel `401` or `403` includes `close` (`4401` or `4403`): the adapter upgrades and closes with that code, which the browser can read. |
| `"upgrade"` | The hub accepted the handshake.                                                                                                                                                | Upgrade and call `open(peer)`, returning `{ receive(message), closed() }` to connect socket events.                                                                                      |

Throws `TypeError` on creation if `publicOrigin` is not HTTP(S) (`Socket publicOrigin must use HTTP or HTTPS`) or the prefix is invalid, and `RangeError` if `maxPendingBytes` is not a positive integer.

## Examples

### The decision for each request

```ts
import { createSocketHub, createSocketUpgradeHandler, defineSocketChannel, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";
import type { Schema } from "@meekojs/meeko/server";

const text: Schema<{ text: string }> = { "~standard": { version: 1, validate: (value) => ({ value: value as { text: string } }) } };
const chat = defineSocketChannel({ clientToServer: { message: text }, serverToClient: { message: text } });
const hub = createSocketHub({ channels: { chat }, sessions: new SessionManager({ store: new MemorySessionStore() }), services: {} });
const handleUpgrade = createSocketUpgradeHandler({ hub, publicOrigin: "http://localhost" });

const ws = { upgrade: "websocket", origin: "http://localhost" };
console.log((await handleUpgrade(new Request("http://localhost/api"))).action);                                  // "pass"
console.log((await handleUpgrade(new Request("http://localhost/_meeko/socket/chat"))).action);                   // "reject" (400: not an upgrade)
console.log((await handleUpgrade(new Request("http://localhost/_meeko/socket/chat", { headers: ws }))).action);  // "upgrade"
console.log(await handleUpgrade(new Request("http://localhost/_meeko/socket/nope", { headers: ws })));           // { action: "reject", status: 404 }
```

### Node, with Meeko's adapter

<!-- no-check -->

```ts
import { createServer } from "node:http";
import { attachNodeWebSocketServer, toNodeListener } from "@meekojs/meeko/node";

const server = createServer(toNodeListener((request) => app.fetch(request)));
attachNodeWebSocketServer({ server, hub: app.socket!.hub, publicOrigin: "https://example.com", pathnamePrefix: app.socket!.pathnamePrefix });
server.listen(3000);
```

In Node, you do not need to use it manually: `attachNodeWebSocketServer` (and `serveNode`) wrap it with `ws`.

## Common mistakes

### Infer the origin from the request

```ts bad
createSocketUpgradeHandler({ hub, publicOrigin: new URL(request.url).origin });
```

Behind a proxy, `request.url` contains the client-supplied `Host`: the `Origin` check would accept whatever an attacker chooses. The origin is configuration.

<!-- no-check -->

```ts good
createSocketUpgradeHandler({ hub, publicOrigin: process.env.MEEKO_PUBLIC_ORIGIN ?? "http://127.0.0.1:3000" });
```

### An origin without a scheme

```ts bad
createSocketUpgradeHandler({ hub, publicOrigin: "localhost:3000" });
```

`TypeError: Socket publicOrigin must use HTTP or HTTPS`.

<!-- no-check -->

```ts good
createSocketUpgradeHandler({ hub, publicOrigin: "http://localhost:3000" });
```

### Respond with `401` without upgrading

```ts bad
if (upgrade.action === "reject") return new Response(null, { status: upgrade.status });
```

The browser does not expose the HTTP status of a rejected WebSocket: the client only sees a generic error and retries forever. With `close`, the adapter accepts and closes with `4401`/`4403`, and `createSocketClient` becomes `"unauthorized"` without retrying.

<!-- no-check -->

```ts good
if (upgrade.action === "reject" && !upgrade.close) return new Response(null, { status: upgrade.status });
// …upgrades and closes with upgrade.close.code and upgrade.close.reason
```

## Notes

- **Portable.** Only uses `Request` and the `SocketPeer` interface (`send`, `close`, `bufferedAmount`): works with any WebSocket implementation.
- **Message order.** `receive` queues messages and delivers them to the hub sequentially, including those arriving while the hub still authorizes the connection (up to `maxPendingBytes`).
- **Security.** `Origin`, session and authorization are checked before accepting the upgrade, so a rejected connection never reaches channel handlers.
- **Deno.** Closing with a code after upgrading occurs on the next tick: Deno drops the connection without a close frame if it reads a message while closing.

---
title: toNodeListener
group: adapters
since: 1.0.0
description: Adapts a Fetch handler to Node's http.createServer callback, with streaming, multiple Set-Cookie headers, cancellation on client disconnect and the connection's IP.
symbols:
  - "@meekojs/meeko/node#toNodeListener"
types:
  - "@meekojs/meeko/node#NodeListenerOptions"
related:
  - "@meekojs/meeko/node#serveNode"
  - "@meekojs/meeko/node#attachNodeWebSocketServer"
  - "@meekojs/meeko/server#composeServerMiddleware"
  - "@meekojs/meeko/server#clientAddress"
  - docs/framework.md#build-despliegue-y-verificación
source-hash: c8cbe7de01f1af5c0a25ea4ae51f5987bcf691feb19685785533b723723fa435
---

`toNodeListener(handler, options)` converts a Fetch handler (`(request) => Response`, such as `app.fetch`) to the `(req, res)` listener for `http.createServer` or `https.createServer`. It builds the `Request` with the public origin's URL, streams the response body, sends each `Set-Cookie` separately and cancels the body if the client disconnects. It also records the remote socket's IP, read by `context.clientAddress`, `clientAddress(request)` and `rateLimit`.

It is the HTTP part of `serveNode`. Use it alone to mount Meeko in a custom Node server (direct HTTPS, a shared port, other routes).

## Usage

<!-- no-check -->

```ts
import { createServer } from "node:http";
import { toNodeListener } from "@meekojs/meeko/node";

const server = createServer(toNodeListener((request) => app.fetch(request), { publicOrigin: "https://example.com" }));
server.listen(3000);
```

## Parameters

| Parameter              | Type                                                  | Default                               | Description                                                                                                                             |
| ---------------------- | ----------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `handler`              | `(request: Request) => Response \| Promise<Response>` | required                              | The Fetch handler.                                                                                                                      |
| `options.publicOrigin` | `string`                                              | the `Host` header and socket protocol | Origin used to build URLs, such as `https://example.com` behind a TLS proxy. An absolute-form request to another origin receives `400`. |
| `options.onError`      | `(error, requestId) => void`                          | console                               | Receives handler or response stream failures, with a correlation ID.                                                                    |

## Return value

The `(request: IncomingMessage, response: ServerResponse) => void` listener. It never throws: if the handler rejects before headers are sent, it responds with `errorResponse` (`500 INTERNAL_ERROR`, or an `ApiError`'s status) and the same `requestId` received by `onError`; if sending has already started, it terminates the connection.

## Examples

### Direct HTTPS, without a proxy

<!-- no-check -->

```ts
import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { attachNodeWebSocketServer, toNodeListener } from "@meekojs/meeko/node";

const server = createServer(
  { key: readFileSync("/etc/tls/key.pem"), cert: readFileSync("/etc/tls/cert.pem") },
  toNodeListener((request) => app.fetch(request), { publicOrigin: "https://example.com", onError: (error, id) => app.reportError(error, id) }),
);
if (app.socket) attachNodeWebSocketServer({ server, hub: app.socket.hub, publicOrigin: "https://example.com", pathnamePrefix: app.socket.pathnamePrefix });
server.listen(443);
```

### Meeko alongside another application

<!-- no-check -->

```ts
import { createServer } from "node:http";
import { toNodeListener } from "@meekojs/meeko/node";

const meeko = toNodeListener((request) => app.fetch(request), { publicOrigin: "https://example.com" });
createServer((req, res) => {
  if (req.url?.startsWith("/legacy/")) return legacyHandler(req, res);
  meeko(req, res);
}).listen(3000);
```

### Any Fetch handler

```ts
import { createServer } from "node:http";
import { toNodeListener } from "@meekojs/meeko/node";

export const server = createServer(toNodeListener((request) => new Response(`Hola desde ${new URL(request.url).pathname}`)));
```

## Common mistakes

### A public origin without a scheme

```ts bad
toNodeListener(handler, { publicOrigin: "example.com" });
```

`TypeError: Invalid publicOrigin: example.com`, when creating the listener. With another scheme, `publicOrigin must use HTTP or HTTPS`.

<!-- no-check -->

```ts good
toNodeListener(handler, { publicOrigin: "https://example.com" });
```

### Trust the `Host` header behind a proxy

```ts bad
createServer(toNodeListener((request) => app.fetch(request))); // tras un proxy TLS
```

Without `publicOrigin`, the URL comes from `Host` and the socket (`http://`), so the application does not recognize the browser's `https://` `Origin` and responds to mutations with `403 INVALID_ORIGIN`. `createServerApp` also accepts `publicOrigin` or `MEEKO_PUBLIC_ORIGIN`.

<!-- no-check -->

```ts good
createServer(toNodeListener((request) => app.fetch(request), { publicOrigin: process.env.MEEKO_PUBLIC_ORIGIN }));
```

### Forget Socket

```ts bad
createServer(toNodeListener((request) => app.fetch(request))).listen(3000); // la aplicación tiene server/socket
```

There is no startup error, but nothing handles upgrades and the client retries forever. `toNodeListener` only handles HTTP.

<!-- no-check -->

```ts good
const server = createServer(toNodeListener((request) => app.fetch(request), { publicOrigin }));
if (app.socket) attachNodeWebSocketServer({ server, hub: app.socket.hub, publicOrigin, pathnamePrefix: app.socket.pathnamePrefix });
```

## Notes

- **Cancellation.** If the client closes the connection, the request's `signal` is aborted and the response body is canceled: files are released and stream producers stop.
- **`HEAD`.** Sends headers without a body.
- **Request-target.** A target starting with `//` is always a path on the application's own origin, never another host.
- **IP.** Without `MEEKO_TRUST_PROXY`, the IP is the socket's; `X-Forwarded-For` is not read.
- **Platform.** `toNodeListener` does not pass `platform` to `app.fetch`: with a custom host, `waitUntil` and `env` are those received by `createServerApp`; `serveNode` also waits for `waitUntil` tasks when shutting down.

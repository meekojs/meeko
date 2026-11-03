---
title: composeServerMiddleware
group: server
since: 1.0.0
description: Composes a list of server middleware around a Fetch handler, from outside in, as Meeko does with server/middleware files.
symbols:
  - "@meekojs/meeko/server#composeServerMiddleware"
types:
  - "@meekojs/meeko/server#ServerMiddleware"
related:
  - "@meekojs/meeko/server#defineServerMiddleware"
  - "@meekojs/meeko/server#clientAddress"
  - "@meekojs/meeko/server#createServerApp"
  - docs/framework.md#middleware-de-servidor
  - docs/framework.md#middleware-de-rutas-y-servidor
source-hash: 6d284993d8d94e5872f8e66de23477979ce005a754c0b49223964224b654c70c
---

`composeServerMiddleware(middlewares, handler)` chains `(request, next) => Response` functions around a final handler and returns a `(request) => Promise<Response>` handler. This is what `createServerApp` does with `server/middleware/` files (by filename) and middleware added by modules: each middleware can continue with `next()`, change the request or response, or short-circuit by returning its own `Response`.

Composition is strict: `next()` can only be called once, each middleware must return a `Response` and, if middleware forgets to await `next()`, the downstream chain is still awaited and its errors are not lost.

## Usage

```ts
import { composeServerMiddleware } from "@meekojs/meeko/server";
import type { ServerMiddleware } from "@meekojs/meeko/server";

const timing: ServerMiddleware = async (request, next) => {
  const start = performance.now();
  const response = await next();
  console.log(request.method, new URL(request.url).pathname, response.status, `${Math.round(performance.now() - start)} ms`);
  return response;
};

const handle = composeServerMiddleware([timing], async () => new Response("hello"));
const response = await handle(new Request("http://localhost/"));
```

## Parameters

| Parameter     | Type                                      | Description                                 |
| ------------- | ----------------------------------------- | ------------------------------------------- |
| `middlewares` | `readonly ServerMiddleware[]`             | In execution order: the first is outermost. |
| `handler`     | `(request: Request) => Promise<Response>` | The final handler, such as `app.fetch`.     |

A `ServerMiddleware` is `(request, next) => Response | Promise<Response>`; `next(request?)` continues with the same request or a different one.

## Return value

A `(request: Request) => Promise<Response>` handler. Rejects if middleware or the handler throws; if both fail, it rejects with an `AggregateError` (`Server middleware and downstream failed`) preserving both errors.

## Examples

### In `server/middleware/`, without manual composition

```ts
// server/middleware/20-maintenance.ts
import { defineServerMiddleware } from "@meekojs/meeko/server";

export default defineServerMiddleware(async (request, next) => {
  if (process.env.MAINTENANCE === "1" && !new URL(request.url).pathname.startsWith("/_meeko/")) {
    return new Response("En mantenimiento", { status: 503, headers: { "retry-after": "120" } });
  }
  return next();
});
```

Meeko sorts files by name (`10-…`, `20-…`) and composes them with this same function, around pages, `/api` and `/_meeko/rpc`.

### An access log with the real IP (since 1.7)

```ts
// server/middleware/10-access-log.ts
import { clientAddress, defineServerMiddleware } from "@meekojs/meeko/server";

export default defineServerMiddleware(async (request, next) => {
  const ip = clientAddress(request) ?? "unknown"; // applies MEEKO_TRUST_PROXY
  const response = await next();
  console.log(`${request.method} ${new URL(request.url).pathname} ${response.status} ${ip}`);
  return response;
});
```

### Change the downstream request

```ts
import type { ServerMiddleware } from "@meekojs/meeko/server";

export const tagRequests: ServerMiddleware = (request, next) => {
  const headers = new Headers(request.headers);
  headers.set("x-request-start", String(Date.now()));
  return next(new Request(request, { headers })); // preserves the connection IP
};
```

### A custom host wrapping the application

<!-- no-check -->

```ts
import { createServer } from "node:http";
import { composeServerMiddleware } from "@meekojs/meeko/server";
import { toNodeListener } from "@meekojs/meeko/node";

const guarded = composeServerMiddleware([timing, tagRequests], (request) => app.fetch(request));
createServer(toNodeListener(guarded, { publicOrigin: "https://example.com" })).listen(3000);
```

## Common mistakes

### Call `next()` twice

```ts bad
const retry: ServerMiddleware = async (request, next) => {
  const response = await next();
  return response.status >= 500 ? next() : response;
};
```

The second call throws `Error: Server middleware called next() more than once` and the request responds with `500`. The request body has already been consumed: a retry needs a new `Request` and another composition.

<!-- no-check -->

```ts good
const retry: ServerMiddleware = async (request, next) => next(request);
```

### Do not return the response

```ts bad
const log: ServerMiddleware = async (request, next) => {
  const response = await next();
  console.log(response.status);
};
```

`TypeError: Server middleware must return a Response` at runtime; `meeko check` already marks it as a type error.

<!-- no-check -->

```ts good
const log: ServerMiddleware = async (request, next) => {
  const response = await next();
  console.log(response.status);
  return response;
};
```

### Read `X-Forwarded-For` manually

```ts bad
const ip = request.headers.get("x-forwarded-for")?.split(",")[0];
```

Any client can send this header: the IP can be spoofed. `clientAddress(request)` only reads it with `MEEKO_TRUST_PROXY` and takes the trusted proxy's entry.

```ts good
import { clientAddress } from "@meekojs/meeko/server";
export const ipOf = (request: Request) => clientAddress(request);
```

## Notes

- **Before context.** Server middleware runs before creating the session and `RequestContext`; API and RPC guards (Origin, CSRF, `auth`) remain inside the handler.
- **What it wraps.** Pages (including prerendered ones), `/api` and `/_meeko/rpc`. Public build files are served first, and Socket upgrades have their own handler.
- **Immutable responses.** A `Response` from `fetch` or `Response.redirect` has immutable headers: create a new one with `new Response(response.body, response)` before changing them.
- **IP.** A `next(new Request(request, …))` preserves the connection's IP, so `rateLimit` and `clientAddress` still count by client.

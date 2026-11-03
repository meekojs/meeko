---
title: defineServerMiddleware
group: macros
since: 1.0.0
description: Declares HTTP middleware from server/middleware, wrapping pages, API and RPC before session creation and able to short-circuit or modify the response.
symbols:
  - "@meekojs/meeko/server#defineServerMiddleware"
types:
  - "@meekojs/meeko/server#ServerMiddleware"
related:
  - "@meekojs/meeko/framework#defineServerRouteMiddleware"
  - "@meekojs/meeko/framework#defineRouteMiddleware"
  - "@meekojs/meeko/server#composeServerMiddleware"
  - "@meekojs/meeko/server#contentSecurityPolicy"
  - docs/framework.md#middleware-de-servidor
  - docs/framework.md#ip-del-cliente-tras-un-proxy
source-hash: 45bd0dd924bdb1f9fc4e28059e8acde91104c2610c393f85b614e7d7c1a9288e
---

`defineServerMiddleware` declares the middleware exported by default from a `server/middleware/` file. It receives the `Request` and `next(request?)`, and returns a `Response`: it can continue, modify the rest of the chain's response or short-circuit with its own.

It wraps SSR pages, `/api` and `/_meeko/rpc`, including prerendered pages, and runs **before** session context creation: it has no `RequestContext`. Meeko runs files by name, from outside in. It is auto-imported in `server/`.

## Usage

```ts
// server/middleware/10-security-headers.ts
import { defineServerMiddleware } from "@meekojs/meeko/server";

export default defineServerMiddleware(async (request, next) => {
  const response = await next();
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
});
```

## Parameters

| Parameter    | Type                                                                                                  | Default  | Description                                                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `middleware` | `(request: Request, next: (request?: Request) => Promise<Response>) => Response \| Promise<Response>` | required | The function. `next()` continues with the next middleware and handler; `next(otraRequest)` continues with a different request. May only be called once. |

## Return value

The same middleware, for default export. At runtime, the chain requires you to:

- return a `Response`: otherwise, `TypeError: Server middleware must return a Response`;
- call `next()` at most once: otherwise, `Error: Server middleware called next() more than once`;
- pass a `Request` to `next()`: otherwise, `TypeError: Server middleware next() requires a Request`.

If middleware calls `next()` without awaiting the promise, Meeko still awaits it; if both middleware and the downstream chain fail, both errors arrive in an `AggregateError`.

## Examples

### Short-circuit with a custom response

```ts
// server/middleware/00-maintenance.ts
import { defineServerMiddleware } from "@meekojs/meeko/server";

const maintenanceUntil = Date.parse("2026-11-01T06:00:00Z");

export default defineServerMiddleware((request, next) => {
  if (Date.now() < maintenanceUntil && !new URL(request.url).pathname.startsWith("/api/health")) {
    return new Response("En mantenimiento", { status: 503, headers: { "retry-after": "600" } });
  }
  return next();
});
```

### The client's IP, with `clientAddress`

Since `1.7`, `clientAddress(request)` returns the IP with the same policy as `context.clientAddress` and `rateLimit`: the connection's IP or, with `MEEKO_TRUST_PROXY`, the one added by the trusted proxy. Since `1.8`, behind Cloudflare Tunnel, `MEEKO_TRUST_PROXY=cloudflare` takes it from `CF-Connecting-IP` if the request came from the `MEEKO_TRUSTED_PROXIES` networks (see [Cloudflare Tunnel and Traefik](../../framework.md#cloudflare-tunnel-and-traefik)).

```ts
// server/middleware/20-blocklist.ts
import { clientAddress, defineServerMiddleware } from "@meekojs/meeko/server";

const blocked = new Set(["203.0.113.7"]);

export default defineServerMiddleware((request, next) => {
  const ip = clientAddress(request);
  if (ip && blocked.has(ip)) return new Response(null, { status: 403 });
  return next();
});
```

### Measure each response's time

```ts
// server/middleware/30-timing.ts
import { defineServerMiddleware } from "@meekojs/meeko/server";

export default defineServerMiddleware(async (request, next) => {
  const start = performance.now();
  const response = await next();
  const headers = new Headers(response.headers);
  headers.append("server-timing", `app;dur=${(performance.now() - start).toFixed(1)}`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
});
```

## Common mistakes

### Do not return the response

```ts bad
export default defineServerMiddleware(async (request, next) => {
  await next();
});
```

`meeko check` reports `TS2345` with `Type 'Promise<void>' is not assignable to type 'Promise<Response> | Response'.` At runtime, `TypeError: Server middleware must return a Response`.

<!-- no-check -->

```ts good
export default defineServerMiddleware(async (request, next) => {
  const response = await next();
  return response;
});
```

### Call `next()` twice

```ts bad
export default defineServerMiddleware(async (request, next) => {
  const first = await next();
  return first.ok ? first : next();
});
```

At runtime, `Error: Server middleware called next() more than once`. To retry, do so in the handler, or build the response yourself.

<!-- no-check -->

```ts good
export default defineServerMiddleware(async (request, next) => {
  const response = await next();
  return response.ok ? response : new Response("Servicio no disponible", { status: 503 });
});
```

### Read `X-Forwarded-For` manually

Any client can send this header: trusting it allows IP spoofing, without any error.

```ts bad
const ip = request.headers.get("x-forwarded-for")?.split(",")[0];
```

<!-- no-check -->

```ts good
const ip = clientAddress(request); // applies MEEKO_TRUST_PROXY
```

## Notes

- **Order.** `server/middleware` files run by name (use numeric prefixes: `10-…`, `20-…`). Those added by modules with `meeko.addServerMiddleware` run before project middleware.
- **What it wraps.** SSR pages, `/api` and `/_meeko/rpc`. Public build files are served before middleware; the development Vite server and WebSocket upgrades have their own handlers.
- **No session.** Runs before creating request context: there is no `context`, `session` or `services`. To check a page's session, use `defineServerRouteMiddleware`; for the API, `auth` and `authorize`.
- **Security.** Built-in API and RPC checks (authentication, authorization, contracts and CSRF) remain inside the handler: middleware neither replaces nor bypasses them. For CSP and security headers, `server.contentSecurityPolicy` and `server.headers` exist in all adapters since `1.7`.
- **Development.** Editing middleware reloads the browser; adding or removing it makes `meeko dev` recreate the application without restarting. Only the project's `server/middleware` counts, not layers'. Excludes `*.test.ts`, `*.spec.ts`, `*.d.ts` and `*.client.ts`.

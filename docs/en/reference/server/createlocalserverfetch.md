---
title: createLocalServerFetch
group: server
since: 1.0.0
description: The local dispatch used by api and rpc clients during SSR, serving calls through the HTTP pipeline without leaving the process and only with the current request's origin and credentials.
symbols:
  - "@meekojs/meeko/server#createLocalServerFetch"
types:
  - "@meekojs/meeko/server#ServerFetch"
related:
  - "@meekojs/meeko/server#createLocalCalls"
  - "@meekojs/meeko/server#createServerDispatcher"
  - "@meekojs/meeko/server#createServerClientOptions"
  - "autoimport:api"
  - docs/framework.md#api-y-rpc
source-hash: 1b00fcb4fff1750378a199832570c82aa9e53996e18b3a2da6c222fa952fd428
---

`createLocalServerFetch(options)` creates a `ServerFetch`: a `(request, context) => Promise<Response>` function that handles a request to `/api` or `/_meeko/rpc` through the application's pipeline, inside the process, reusing the current request's session, services, state and `requestId`. It underlies `api.*` and `rpc.*` while the server renders a page: the page calls its own API without a network or second session.

Because it reuses the session from `context`, it only accepts requests with the same origin and credentials: any others receive `403`. This prevents anyone from using it to communicate with the API on behalf of another user.

## Usage

<!-- no-check -->

```ts
import { pathToFileURL } from "node:url";
import { createLocalServerFetch } from "@meekojs/meeko/server";

const serverFetch = createLocalServerFetch({ manifest, sessions, load: (file) => import(pathToFileURL(file).href) });
// Mismo origen y mismas credenciales que la petición original.
const request = new Request(new URL("/api/users", context.request.url), { headers: context.request.headers });
const response = await serverFetch(request, context);
```

## Parameters

`createLocalServerFetch(options)`:

| Option     | Type                                 | Default  | Description                        |
| ---------- | ------------------------------------ | -------- | ---------------------------------- |
| `manifest` | `ServerManifest`                     | required | The API and RPC endpoints.         |
| `sessions` | `SessionManager`                     | required | The application's manager.         |
| `load`     | `(file: string) => Promise<unknown>` | required | Loads each manifest file's module. |
| `onError`  | `(error, requestId) => void`         | none     | Observer for `5xx` failures.       |

## Return value

A `ServerFetch`: `(request: Request, context: RequestContext) => Promise<Response>`.

| Request                                                      | Response                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Origin different from `context.request`                      | `403 INVALID_ORIGIN`                                                                 |
| `cookie` or `authorization` different from `context.request` | `403 INVALID_CREDENTIALS`                                                            |
| An API or RPC route                                          | The endpoint's response, with the usual guards and this request's `Idempotency-Key`. |

## Examples

### Measure a render's internal calls

```ts
import type { ServerFetch } from "@meekojs/meeko/server";

export const logged = (inner: ServerFetch): ServerFetch => async (request, context) => {
  const start = performance.now();
  const response = await inner(request, context);
  console.log(context.requestId, request.method, new URL(request.url).pathname, response.status, `${Math.round(performance.now() - start)} ms`);
  return response;
};
```

### A typed server client at module level

<!-- no-check -->

```ts
import { createApiClient } from "@meekojs/meeko/framework";
import { createServerClientOptions } from "@meekojs/meeko/server";

// Cada llamada lee la URL, las credenciales y el despacho local de la petición en curso:
// el cliente nunca retiene las credenciales de otro usuario.
export const api = createApiClient<ApiContract>(manifest, createServerClientOptions());
```

This is how the generated `api` and `rpc` clients work for SSR. Outside a Meeko request, each call throws an error.

## Common mistakes

### Forward a different cookie

```ts bad
const request = new Request(new URL("/api/admin/users", context.request.url), { headers: { cookie: adminCookie } });
await serverFetch(request, context);
```

Responds with `403 {"code":"INVALID_CREDENTIALS"}`: local dispatch shares the session from `context` and cannot change it. To act as another user, make a real HTTP request.

<!-- no-check -->

```ts good
const request = new Request(new URL("/api/admin/users", context.request.url), { headers: context.request.headers });
await serverFetch(request, context);
```

### Call another host

```ts bad
await serverFetch(new Request("https://api.otro.example/users", { headers: context.request.headers }), context);
```

Responds with `403 {"code":"INVALID_ORIGIN"}`. For an external service, use `fetch` with `context.signal`.

<!-- no-check -->

```ts good
await fetch("https://api.otro.example/users", { signal: context.signal });
```

## Notes

- **Security.** Comparing origin and credentials prevents local dispatch from being used as a proxy with someone else's session.
- **`requestId`.** The call shares the original request's ID: logs and `onError` group the render and its calls.
- **Origin.** SSR `api.*` and `rpc.*` clients send the current request's origin, so the mutation `Origin` check (enabled by default since `1.8`) also works locally.

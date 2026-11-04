---
title: createLocalCalls
group: server
since: 1.0.0
description: Calls the application's API and RPC inside the process, using the current request's credentials and the same guards, validation and limits as HTTP.
symbols:
  - "@meekojs/meeko/server#createLocalCalls"
types:
  - "@meekojs/meeko/server#LocalCallOptions"
  - "@meekojs/meeko/server#LocalApiInput"
related:
  - "@meekojs/meeko/server#createLocalServerFetch"
  - "@meekojs/meeko/server#createServerDispatcher"
  - "@meekojs/meeko/server#errorResponse"
  - "autoimport:api"
  - "autoimport:rpc"
  - docs/framework.md#api-y-rpc
  - docs/framework.md#límite-de-peticiones-ratelimit
source-hash: 8dc4fbab051e792827d87a7b7f0e2a9970f8e9eb48d18aa918e45f4edc9c9445
---

`createLocalCalls(options)` returns two functions, `api` and `rpc`, that handle an application endpoint or procedure without leaving the process: they construct an in-memory `Request` with the original request's credential headers (`cookie`, `x-meeko-csrf` and `authorization`) and the application's origin as `Origin` (since `1.8`; previously it forwarded the original `Origin`), and pass it through `dispatchApiRoute` or `dispatchRpc`. The response is the same as over HTTP: Origin, CSRF, `rateLimit`, `auth`, `authorize`, schemas, `locals` and error normalization.

In a framework application this is unnecessary: the `api.*` and `rpc.*` clients already dispatch locally during SSR. This is for your own host, task or test with a `RequestContext` that wants to reuse an endpoint without a network call.

## Usage

<!-- no-check -->

```ts
import { pathToFileURL } from "node:url";
import { createLocalCalls } from "@meekojs/meeko/server";

const calls = createLocalCalls({ manifest, context, sessions, load: (file) => import(pathToFileURL(file).href) });
const user = await (await calls.api("users.byId", "GET", { params: { id: "123" } })).json();
const result = await (await calls.rpc("users.get", { id: "123" })).json();
```

## Parameters

`createLocalCalls(options)` takes a `LocalCallOptions<S>` object:

| Option     | Type                                 | Default  | Description                                                                                     |
| ---------- | ------------------------------------ | -------- | ----------------------------------------------------------------------------------------------- |
| `manifest` | `ServerManifest`                     | required | Endpoints from `server/api` and `server/rpc`.                                                   |
| `context`  | `RequestContext<S>`                  | required | The original request's context: its credentials, session, services, signal, IP and `requestId`. |
| `sessions` | `SessionManager`                     | required | The manager that checks Origin and CSRF.                                                        |
| `load`     | `(file: string) => Promise<unknown>` | required | Loads each manifest file's module.                                                              |
| `onError`  | `(error, requestId) => void`         | none     | Observer for `5xx` failures.                                                                    |

## Return value

`{ api, rpc }`:

| Function                         | Description                                                                                                                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api(clientKey, method, input?)` | Handles the endpoint with that client key (`"users.byId"`, the one from `api.users.byId`) and method. `input` is `{ params?, query?, body? }`; `body` is serialized to JSON and is not allowed in `GET`. |
| `rpc(id, input)`                 | Handles procedure `id` (`"users.get"`) with `input` as its body.                                                                                                                                         |

Both return `Promise<Response>` and **never reject**: a missing endpoint is `404 NOT_FOUND`, `params` that do not form the route are `400 INVALID_PARAMS`, and a handler failure is the usual error response, with the original request's `requestId`.

## Examples

### A module handler that reuses an endpoint

<!-- no-check -->

```ts
// A custom handler that already has the request context.
const calls = createLocalCalls({ manifest: app.manifest.server, context, sessions, load });
const response = await calls.api("orders", "POST", { body: { productId: "p_1", quantity: 2 } });
if (response.status === 429) return new Response("Demasiados pedidos", { status: 429, headers: { "retry-after": response.headers.get("retry-after") ?? "60" } });
return Response.json(await response.json(), { status: response.status });
```

### Query string with lists

<!-- no-check -->

```ts
await calls.api("products", "GET", { query: { tag: ["oferta", "nuevo"], page: 2, draft: undefined } });
// GET /api/products?tag=oferta&tag=nuevo&page=2 (null and undefined are omitted)
```

### A test of a protected endpoint

<!-- no-check -->

```ts
const context = createRequestContext(new Request("http://localhost/", { headers: { cookie, origin: "http://localhost", "x-meeko-csrf": csrf } }), services, await sessions.load(request));
const response = await createLocalCalls({ manifest, context, sessions, load }).api("profile", "PUT", { body: { name: "Ada" } });
assert.equal(response.status, 200);
```

## Common mistakes

### Expecting rejection

```ts bad
try {
  const user = await (await calls.api("users.byId", "GET", { params: { id } })).json();
} catch {
  // never reaches here with a 404
}
```

`api` and `rpc` always resolve with a `Response`. A `404 {"code":"NOT_FOUND"}` arrives as a response, and `.json()` returns it as though it were the user.

<!-- no-check -->

```ts good
const response = await calls.api("users.byId", "GET", { params: { id } });
if (!response.ok) throw new Error(`users.byId ${response.status}`);
const user = await response.json();
```

### A body in `GET`

```ts bad
await calls.api("search", "GET", { body: { q: "zapatillas" } });
```

Returns `400 INVALID_BODY`. Use `query`.

<!-- no-check -->

```ts good
await calls.api("search", "GET", { query: { q: "zapatillas" } });
```

### Without `load`

```ts bad
createLocalCalls({ manifest, context, sessions });
```

`TypeError: Local calls require a module loader`, on creation.

<!-- no-check -->

```ts good
createLocalCalls({ manifest, context, sessions, load: (file) => import(pathToFileURL(file).href) });
```

## Notes

- **Same guards.** A local call is not a back door: it passes through CSRF with the original request's token, and through `auth`, `authorize` and schemas. Its `Origin` is the application's, just like SSR clients: it is a call from the server itself, so a local mutation works from a page requested with `GET`, which carries no `Origin`.
- **`rateLimit`.** Uses the HTTP dispatcher's route counter and the IP from `context`, so a local call does not bypass the limit.
- **Cancellation.** The internal `Request` carries `context.signal`: if the client leaves or the session is revoked, the call aborts.
- **Cookies.** The response carries its `Set-Cookie` if the endpoint changes the session; your own host must forward it to reach the browser.

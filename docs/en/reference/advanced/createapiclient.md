---
title: createApiClient
group: advanced
since: 1.0.0
description: Creates a typed API endpoint client from its public manifest, without importing server code, for explicit, external or test clients.
symbols:
  - "@meekojs/meeko/framework#createApiClient"
types:
  - "@meekojs/meeko/framework#ClientOptions"
  - "@meekojs/meeko/framework#ApiOperation"
related:
  - "autoimport:api"
  - "@meekojs/meeko/framework#createRpcClient"
  - "@meekojs/meeko/framework#createBrowserClientOptions"
  - "@meekojs/meeko/framework#ClientError"
  - "@meekojs/meeko/server#defineApiRoute"
  - docs/framework.md#api-y-rpc
source-hash: 20ea09cce1c6546591f8e19d9682656969744368825e967d9c5f841f7bfa68f0
---

`createApiClient` builds a client like an application's [`api`](/en/docs/reference/client-api) auto-import: an object with one method per endpoint (`api.users.byId.get(…)`) that builds the URL with parameters and query, sends the JSON body with the CSRF token on mutations and returns the parsed response, or throws a `ClientError` with the server's code. It only needs the public endpoint list (key, path and method); it never imports server code.

The `api` auto-import is already generated with it. Use it for an explicit client: a script, a test, another application consuming the API, or a client with a different base URL or custom headers.

## Usage

```ts
import { createApiClient } from "@meekojs/meeko/framework";
import type { ApiOperation } from "@meekojs/meeko/framework";

type Contract = {
  users: { get: ApiOperation<undefined, undefined, undefined, { id: string; name: string }[]> };
  "users.byId": { get: ApiOperation<{ id: string }, { tab?: string }, undefined, { id: string; name: string }> };
};

const api = createApiClient<Contract>(
  {
    api: [
      { clientKey: "users", pathname: "/api/users", method: "GET" },
      { clientKey: "users.byId", pathname: "/api/users/[id]", method: "GET" },
    ],
  },
  { baseUrl: "https://example.com" },
);

const users = await api.users.get();
const ada = await api.users.byId.get({ params: { id: "42" }, query: { tab: "perfil" } });
// GET https://example.com/api/users/42?tab=perfil
```

## Parameters

| Parameter           | Type                                         | Default  | Description                                                                                                                                                                                                         |
| ------------------- | -------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest`          | `{ api: { clientKey, pathname, method }[] }` | required | Public endpoints. `clientKey` is the method path (`"users.byId"` → `api.users.byId`); `pathname` uses `[param]` for dynamic segments. In an application, `meeko check` writes it to `.meeko/manifests/server.json`. |
| `options.baseUrl`   | URL or `() => string`                        | none     | Origin against which paths resolve. Without it, relative paths: valid in the browser, not Node.                                                                                                                     |
| `options.fetch`     | `typeof fetch`                               | global   | `fetch` implementation, for testing or adding logic.                                                                                                                                                                |
| `options.csrfToken` | text or `() => string \| undefined`          | none     | Token sent in `x-meeko-csrf` on methods other than `GET` and `HEAD`.                                                                                                                                                |
| `options.headers`   | `HeadersInit` or `() => HeadersInit`         | none     | Headers for each request.                                                                                                                                                                                           |

`Contract` (the type argument) describes each operation with `ApiOperation<Params, Query, Body, Output>`. In an application it comes from `.meeko/types/server-contracts.d.ts`.

## Return value

An object nested by `clientKey`, with one method per lowercase HTTP verb (`get`, `post`, `put`, `patch`, `delete`). Each method takes `{ params, query, body }` according to its operation (anything the contract does not declare is forbidden; a query with only optional fields may be omitted) and also `signal` and `idempotencyKey` (since `1.2`, a UUID for the `Idempotency-Key` header). Returns a promise of `Output`:

| Response                                                   | Result                                                                           |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `2xx` with JSON                                            | The parsed value.                                                                |
| `4xx` or `5xx` with `{ code, status, requestId, issues? }` | Rejects with `ClientError` carrying those fields.                                |
| A non-JSON body                                            | Rejects with `ClientError` `INVALID_RESPONSE`.                                   |
| A parameter containing `/`                                 | Rejects with `TypeError: Invalid route parameter: id`, without making a request. |
| A network failure                                          | Rejects with the `fetch` error (in Node, `TypeError: fetch failed`).             |

Throws `TypeError` on creation if two endpoints produce the same method (`Duplicate API method: users.get`) or a segment is both static and dynamic.

## Examples

### A script consuming the production API

```ts
import { createApiClient } from "@meekojs/meeko/framework";
import type { ApiOperation } from "@meekojs/meeko/framework";

type Contract = { orders: { get: ApiOperation<undefined, { since: string }, undefined, { id: string }[]> } };

const api = createApiClient<Contract>(
  { api: [{ clientKey: "orders", pathname: "/api/orders", method: "GET" }] },
  { baseUrl: "https://tienda.example.com", headers: () => ({ authorization: `Bearer ${process.env.API_TOKEN ?? ""}` }) },
);

const orders = await api.orders.get({ query: { since: "2026-10-01" } });
console.log(`${orders.length} pedidos`);
```

### Tests with a fake `fetch`

```ts
import { ClientError, createApiClient } from "@meekojs/meeko/framework";
import type { ApiOperation } from "@meekojs/meeko/framework";

type Contract = { users: { get: ApiOperation<undefined, undefined, undefined, { id: string }[]> } };

const api = createApiClient<Contract>(
  { api: [{ clientKey: "users", pathname: "/api/users", method: "GET" }] },
  { fetch: async () => Response.json({ code: "UNAUTHENTICATED", status: 401, requestId: "r1" }, { status: 401 }) },
);

try {
  await api.users.get();
} catch (error) {
  if (error instanceof ClientError) console.log(error.code, error.status, error.requestId); // UNAUTHENTICATED 401 r1
}
```

### In the browser, with the page's CSRF token

<!-- no-check -->

```ts
import { createApiClient, createBrowserClientOptions } from "@meekojs/meeko/framework";
import manifest from "./api-manifest.json";

export const api = createApiClient<ApiContract>(manifest, createBrowserClientOptions());
```

`createBrowserClientOptions()` reads the token from the `meeko-csrf-token` meta on each call and updates it from responses' `x-meeko-csrf-token` header.

## Common mistakes

### Use it in Node without `baseUrl`

```ts bad
const api = createApiClient<Contract>(manifest);
await api.users.get();
```

In Node, `fetch` does not resolve relative paths: `TypeError: Failed to parse URL from /api/users`.

<!-- no-check -->

```ts good
const api = createApiClient<Contract>(manifest, { baseUrl: "http://127.0.0.1:4173" });
```

### Two endpoints with the same key and method

```ts bad
createApiClient({ api: [
  { clientKey: "users", pathname: "/api/users", method: "GET" },
  { clientKey: "users", pathname: "/api/people", method: "GET" },
] });
```

`TypeError: Duplicate API method: users.get`, when creating the client.

<!-- no-check -->

```ts good
createApiClient({ api: [
  { clientKey: "users", pathname: "/api/users", method: "GET" },
  { clientKey: "people", pathname: "/api/people", method: "GET" },
] });
```

### Put a `/` in a parameter

```ts bad
await api.users.byId.get({ params: { id: "equipo/ana" } });
```

`TypeError: Invalid route parameter: id`, without a request: a parameter is a single URL segment. An undeclared route parameter gives `Unknown route parameter: …`.

<!-- no-check -->

```ts good
await api.users.byId.get({ params: { id: "ana" }, query: { team: "equipo" } });
```

### Expect a `ClientError` on network failure

```ts bad
try { await api.users.get(); }
catch (error) { if (isClientError(error)) showError(error.code); }
```

Without a connection or with the server down, there is no server response to convert: the rejection comes from `fetch` (`TypeError: fetch failed` in Node, `TypeError: Failed to fetch` in Chrome) and the `catch` above silently swallows it.

<!-- no-check -->

```ts good
try { await api.users.get(); }
catch (error) {
  if (isClientError(error)) showError(error.code);
  else showError("SIN_CONEXION");
}
```

## Notes

- **Server and browser.** Works in any runtime with `fetch`. In application SSR, the `api` auto-import dispatches calls locally, without a network; a manually created client always uses `fetch`.
- **Security.** The public manifest only contains keys, paths and methods: never server file paths. Mutations need `csrfToken` when there is a session; without it, the server responds with `403`.
- **Encoding.** Parameters and query are encoded (`"a b"` → `a%20b`); query keys with `null` or `undefined` are omitted and an array repeats the key.
- **Types.** With `Contract`, parameters, query, body and response are checked at compile time: `api.users.post({ body: { invalid: true } })` is a type error if the contract specifies otherwise.

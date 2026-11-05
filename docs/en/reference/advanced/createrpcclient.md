---
title: createRpcClient
group: advanced
since: 1.0.0
description: Creates a typed RPC procedure client from its public manifest, where each call is a JSON POST with the CSRF token.
symbols:
  - "@meekojs/meeko/framework#createRpcClient"
types:
  - "@meekojs/meeko/framework#ClientOptions"
  - "@meekojs/meeko/framework#RpcOperation"
related:
  - "autoimport:rpc"
  - "@meekojs/meeko/framework#createApiClient"
  - "@meekojs/meeko/framework#createBrowserClientOptions"
  - "@meekojs/meeko/framework#ClientError"
  - "@meekojs/meeko/server#defineRpc"
  - docs/framework.md#api-y-rpc
source-hash: 072368b816993a3efc1c62193a42ebcf76f2407a49739ed052425adf5e9d514e
---

`createRpcClient` builds a client like the [`rpc`](/en/docs/reference/client-rpc) auto-import: one method per procedure, nested by ID (`"users.get"` → `rpc.users.get(input)`). Each call is a `POST` to its path (`/_meeko/rpc/users/get`) with JSON input and the CSRF token in `x-meeko-csrf`, and returns the parsed output or rejects with `ClientError`. It only needs the public procedure list; it never imports server code.

## Usage

```ts
import { createRpcClient } from "@meekojs/meeko/framework";
import type { RpcOperation } from "@meekojs/meeko/framework";

type Contract = {
  "math.sum": RpcOperation<{ a: number; b: number }, { total: number }>;
  "users.get": RpcOperation<{ id: string }, { id: string; name: string }>;
};

const rpc = createRpcClient<Contract>(
  {
    rpc: [
      { id: "math.sum", pathname: "/_meeko/rpc/math/sum" },
      { id: "users.get", pathname: "/_meeko/rpc/users/get" },
    ],
  },
  { baseUrl: "https://example.com", csrfToken: () => process.env.CSRF_TOKEN },
);

const { total } = await rpc.math.sum({ a: 1, b: 2 }); // POST https://example.com/_meeko/rpc/math/sum
```

## Parameters

| Parameter  | Type                          | Default  | Description                                                                                                                      |
| ---------- | ----------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `manifest` | `{ rpc: { id, pathname }[] }` | required | The public procedures. The dotted `id` is the method path; `pathname` is its route, normally `/_meeko/rpc/<carpetas>/<archivo>`. |
| `options`  | `ClientOptions`               | `{}`     | `baseUrl`, `fetch`, `credentials`, `csrfToken` and `headers`, as in `createApiClient`.                                           |

`Contract` describes each procedure with `RpcOperation<Input, Output>`; in an application it comes from `.meeko/types/server-contracts.d.ts`.

## Return value

An object nested by ID. Each method takes input and, optionally, `{ signal, idempotencyKey }`, and returns a promise of the output:

| Response                                              | Result                                         |
| ----------------------------------------------------- | ---------------------------------------------- |
| `2xx` with JSON                                       | The parsed output.                             |
| A server error `{ code, status, requestId, issues? }` | Rejects with `ClientError`.                    |
| A non-JSON body                                       | Rejects with `ClientError` `INVALID_RESPONSE`. |

Throws `TypeError` on creation if two procedures collide (`Client key collision: users.get`, for example with `users` and `users.get`, because `rpc.users` cannot be both a function and an object) or an ID is invalid.

## Examples

### Cancel a slow call

```ts
import { createRpcClient } from "@meekojs/meeko/framework";
import type { RpcOperation } from "@meekojs/meeko/framework";

type Contract = { "reports.build": RpcOperation<{ month: string }, { url: string }> };
const rpc = createRpcClient<Contract>({ rpc: [{ id: "reports.build", pathname: "/_meeko/rpc/reports/build" }] }, { baseUrl: "https://example.com" });

const report = await rpc.reports.build({ month: "2026-10" }, { signal: AbortSignal.timeout(5_000) });
console.log(report.url);
```

### Safe retries with an idempotency key

<!-- no-check -->

```ts
const key = crypto.randomUUID();
await retry(() => rpc.orders.create({ items }, { idempotencyKey: key }));
```

The server receives the same `Idempotency-Key` on each attempt (`context.idempotencyKey`) and can return the stored result instead of creating another order. A value that is not a UUID rejects with `TypeError` without sending anything.

### In a test, against the application without a network

<!-- no-check -->

```ts
const rpc = createRpcClient<Contract>(manifest, {
  baseUrl: "http://localhost",
  fetch: (input, init) => app.fetch(new Request(input, init)),
});
```

With `app` from `createServerApp`, the client tests the complete contract (CSRF, validation, errors) without opening a port.

## Common mistakes

### Two IDs that cannot coexist

```ts bad
createRpcClient({ rpc: [
  { id: "users", pathname: "/_meeko/rpc/users" },
  { id: "users.get", pathname: "/_meeko/rpc/users/get" },
] });
```

`TypeError: Client key collision: users.get`. In an application, server discovery already rejects this when generating the manifest, naming both files.

<!-- no-check -->

```ts good
createRpcClient({ rpc: [
  { id: "users.list", pathname: "/_meeko/rpc/users/list" },
  { id: "users.get", pathname: "/_meeko/rpc/users/get" },
] });
```

### Use it in Node without `baseUrl`

```ts bad
await createRpcClient<Contract>(manifest).math.sum({ a: 1, b: 2 });
```

`TypeError: Failed to parse URL from /_meeko/rpc/math/sum`: in Node, `fetch` does not resolve relative paths.

<!-- no-check -->

```ts good
await createRpcClient<Contract>(manifest, { baseUrl: "http://127.0.0.1:4173" }).math.sum({ a: 1, b: 2 });
```

### A mutation with a session but no CSRF token

```ts bad
const rpc = createRpcClient<Contract>(manifest, { baseUrl, headers: { cookie } });
await rpc.cart.add({ sku: "A1" });
```

With a session cookie, the server requires `x-meeko-csrf` on each `POST`: without it, `ClientError` with status `403`. The token arrives in responses' `x-meeko-csrf-token` header and the document's `meeko-csrf-token` meta.

<!-- no-check -->

```ts good
const rpc = createRpcClient<Contract>(manifest, { baseUrl, headers: { cookie }, csrfToken: () => token });
```

## Notes

- **Always `POST`.** You cannot request an RPC procedure with `GET`: the server responds with `405` and `Allow: POST`. For cacheable or linkable reads, use an API endpoint.
- **Server and browser.** Works in any runtime with `fetch`. In the browser, `createBrowserClientOptions()` provides `csrfToken` and `fetch` already connected to the document.
- **Security.** The public manifest does not contain server file paths. Input is validated on the server with the `defineRpc` schema; client types do not replace that validation.

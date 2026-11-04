---
title: createServerDispatcher
group: advanced
since: 1.0.0
description: Creates an HTTP handler that serves /api/... and /_meeko/rpc/... on your own host, with the same sessions, guards, validation and errors as the application.
symbols:
  - "@meekojs/meeko/server#createServerDispatcher"
types:
  - "@meekojs/meeko/server#ServerDispatcherOptions"
  - "@meekojs/meeko/server#ServerManifest"
related:
  - "@meekojs/meeko/server#createServerApp"
  - "@meekojs/meeko/server#createLocalServerFetch"
  - "@meekojs/meeko/server#createFrameworkHandler"
  - "@meekojs/meeko/server#SessionManager"
  - "@meekojs/meeko/server#defineApiRoute"
  - "@meekojs/meeko/server#defineRpc"
  - docs/framework.md#api-y-rpc
source-hash: a30047f5066f75fd6e50f061391d3bba588627e5821a15ce03c5d63e37a44c52
---

`createServerDispatcher` dispatches endpoints from `server/api` and procedures from `server/rpc` using their manifest: it finds the endpoint by route and method, loads the session, creates the `RequestContext` and executes the `defineApiRoute` or `defineRpc` definition with all its guards (Origin, CSRF, `rateLimit`, `auth`, `authorize`), input and response validation, and normalization of errors to JSON. It returns a handler `(request) => Promise<Response>` that never rejects.

It is the API and RPC part of [`createServerApp`](/en/docs/reference/createserverapp), for a host that serves its pages differently or mounts the API inside another server.

## Usage

```ts
import { createServerDispatcher, defineApiRoute, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";
import type { Schema, ServerManifest } from "@meekojs/meeko/server";

const users: Schema<{ id: string }[]> = { "~standard": { version: 1, validate: (value) => ({ value: value as { id: string }[] }) } };
const modules: Record<string, unknown> = {
  "/server/api/users.get.ts": { default: defineApiRoute({ response: users, handler: () => [{ id: "1" }] }) },
};
const manifest: ServerManifest = {
  api: [{ kind: "api", file: "/server/api/users.get.ts", pathname: "/api/users", method: "GET", clientKey: "users" }],
  rpc: [],
  socket: [],
};

const dispatch = createServerDispatcher({
  manifest,
  sessions: new SessionManager({ store: new MemorySessionStore() }),
  services: {},
  load: async (file) => modules[file],
});
const response = await dispatch(new Request("http://localhost/api/users"));
console.log(response.status, await response.json()); // 200 [ { id: '1' } ]
```

## Options

| Option     | Type                         | Default                     | Description                                                                                                                              |
| ---------- | ---------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest` | `ServerManifest`             | required                    | Endpoints (`api`), procedures (`rpc`) and channels (`socket`), as written by `discoverServerManifest`.                                   |
| `sessions` | `SessionManager`             | required                    | The session manager: loads each request's session and checks Origin and CSRF.                                                            |
| `services` | `S` or `(request) => S`      | required                    | Services for `context.services`, shared or created per request.                                                                          |
| `load`     | `(file) => Promise<unknown>` | required                    | Returns each manifest file's module; its `default` is the definition. Without it, `TypeError: Server dispatch requires a module loader`. |
| `platform` | `ServerPlatform`             | `{ name: "node", env: {} }` | What handlers see in `context.platform`.                                                                                                 |
| `onError`  | `(error, requestId) => void` | console                     | Internal failures; the client only receives `{ code, status, requestId }`.                                                               |

## Return value

`(request: Request) => Promise<Response>`, which never rejects:

| Request                                          | Response                                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| An existing endpoint and method                  | The handler's response, validated against `response`.                                                 |
| An endpoint with another method                  | `405` `{"code":"METHOD_NOT_ALLOWED",…}` with `Allow` and that route's methods.                        |
| An RPC procedure with a method other than `POST` | `405` `{"code":"METHOD_NOT_ALLOWED",…}` with `Allow: POST` (since `1.7`; previously without `Allow`). |
| Any other route                                  | `404` `{"code":"NOT_FOUND","status":404,"requestId":"…"}`.                                            |
| An `ApiError` from the handler                   | Its status and code, with `issues` if present.                                                        |
| Any other error                                  | `500` `INTERNAL_ERROR`, and the error sent to `onError`.                                              |

## Examples

### Inside an existing Node server

<!-- no-check -->

```ts
import { createServer } from "node:http";
import { toNodeListener } from "@meekojs/meeko/node";

const api = toNodeListener(dispatch);
createServer((request, response) => {
  if (request.url?.startsWith("/api/") || request.url?.startsWith("/_meeko/rpc/")) return api(request, response);
  legacyApp(request, response);
}).listen(3000);
```

### An RPC procedure with per-request services

```ts
import { createServerDispatcher, defineRpc, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";
import type { Schema } from "@meekojs/meeko/server";

const sumInput: Schema<{ a: number; b: number }> = { "~standard": { version: 1, validate: (value) => ({ value: value as { a: number; b: number } }) } };
const sumOutput: Schema<{ total: number }> = { "~standard": { version: 1, validate: (value) => ({ value: value as { total: number } }) } };
const sum = defineRpc({ input: sumInput, output: sumOutput, handler: ({ input }) => ({ total: input.a + input.b }) });

const dispatch = createServerDispatcher({
  manifest: { api: [], rpc: [{ kind: "rpc", file: "/server/rpc/math/sum.ts", pathname: "/_meeko/rpc/math/sum", id: "math.sum" }], socket: [] },
  sessions: new SessionManager({ store: new MemorySessionStore() }),
  services: (request: Request) => ({ region: request.headers.get("x-region") ?? "eu" }),
  load: async () => ({ default: sum }),
});

const response = await dispatch(new Request("http://localhost/_meeko/rpc/math/sum", {
  method: "POST",
  headers: { "content-type": "application/json", origin: "http://localhost" },
  body: JSON.stringify({ a: 1, b: 2 }),
}));
console.log(await response.json()); // { total: 3 }
```

## Common mistakes

### Without `load`

```ts bad
createServerDispatcher({ manifest, sessions, services: {} });
```

`TypeError: Server dispatch requires a module loader`. The dispatcher never imports files on its own: this prevents it from loading anything the manifest does not declare.

<!-- no-check -->

```ts good
createServerDispatcher({ manifest, sessions, services: {}, load: (file) => import(pathToFileURL(file).href) });
```

### Calling an RPC with `GET`

```ts bad
await dispatch(new Request("http://localhost/_meeko/rpc/math/sum"));
```

`405` `{"code":"METHOD_NOT_ALLOWED","status":405,…}` with `Allow: POST`: an RPC procedure only accepts `POST` with JSON. Until `1.6`, the response did not carry `Allow`, although the JSDoc promised it.

<!-- no-check -->

```ts good
await dispatch(new Request("http://localhost/_meeko/rpc/math/sum", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
```

### `MemorySessionStore` in production

```ts bad
new SessionManager({ store: new MemorySessionStore(), production: true });
```

`Persistent session storage with atomic rotation and family revocation is required in production`. In production, sessions must survive restarts and be shared between instances.

<!-- no-check -->

```ts good
new SessionManager({ store: new RedisSessionStore(redis, { prefix: "tienda:prod:session:" }), production: true });
```

## Notes

- **Server.** Uses only Web APIs; works in any runtime. Error responses are JSON and never contain a stack trace.
- **Security.** Mutations with a session require Origin and the CSRF token (`x-meeko-csrf`), as in the application. Guards run in the documented order: Origin, CSRF, `rateLimit`, `auth`, `authorize`, input, `locals`, handler and response.
- **Routes.** Only responds to what the manifest declares; everything else is a JSON `404`, so you should route only `/api/` and `/_meeko/rpc/` to it beforehand.
- **Local calls.** For SSR to call the API without a network, use `createLocalServerFetch` with the same options.

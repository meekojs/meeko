---
title: createRequestContext
group: advanced
since: 1.0.0
description: Creates a request's RequestContext (session, services, platform, requestId and signal) for a custom host or to test an endpoint without a server.
symbols:
  - "@meekojs/meeko/server#createRequestContext"
types:
  - "@meekojs/meeko/server#RequestContext"
related:
  - "@meekojs/meeko/server#createServerDispatcher"
  - "@meekojs/meeko/server#dispatchApiRoute"
  - "@meekojs/meeko/server#SessionManager"
  - "@meekojs/meeko/server#useRequestState"
  - docs/framework.md#revocación-durante-una-petición
  - docs/framework.md#tipos-de-los-servicios
source-hash: cdb47b57317f3ebc336d46db720d184546d9f0cbde2797918f3e7155cfdb4f80
---

`createRequestContext` builds the context received as `context` by API and RPC handlers, loaders and `<script server>`: the request, a new `requestId`, the already-loaded session, services, platform, a request-specific state `Map` and a `signal` aborted when the client disconnects or the session is revoked.

`createServerApp` and `createServerDispatcher` create it automatically. Use it in a custom host dispatching endpoints individually (`dispatchApiRoute`, `dispatchRpc`) and, especially, to test an endpoint in a unit test.

## Usage

```ts
import { createRequestContext, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";

const sessions = new SessionManager({ store: new MemorySessionStore() });
const request = new Request("http://localhost/api/report");
const context = createRequestContext(request, { db: { name: "test" } }, await sessions.load(request));

console.log(context.requestId);        // un UUID nuevo
console.log(context.platform.name);    // "node"
console.log(context.services.db.name); // "test"
```

## Parameters

| Parameter  | Type                   | Default                     | Description                                                                            |
| ---------- | ---------------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| `request`  | `Request`              | required                    | The request. Its `signal` is combined with the context's.                              |
| `services` | `TServices`            | required                    | The already-created `context.services` services.                                       |
| `session`  | `SessionHandle`        | required                    | The result of `sessions.load(request)`.                                                |
| `platform` | `ServerPlatform<TEnv>` | `{ name: "node", env: {} }` | The adapter's name, environment and `waitUntil`. Without it, the environment is empty. |

## Return value

A `RequestContext<TServices, TEnv>`:

| Member           | Description                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `request`        | The original request.                                                                                                                    |
| `requestId`      | A new ID, sent in `x-request-id` and received by `onError`.                                                                              |
| `signal`         | Aborted if the client disconnects or, with `SessionRevokedError`, if the session family is revoked. Combined on first access.            |
| `services`       | The received services. Since `1.7`, without a type argument it is `AppServices`, the type `meeko check` infers from `server/runtime.ts`. |
| `session`        | The session: `current`, `create`, `rotate`, `revoke`…                                                                                    |
| `state`          | An empty `Map` for this request's values (`useRequestState`).                                                                            |
| `platform`       | The received platform.                                                                                                                   |
| `idempotencyKey` | The `Idempotency-Key` header if it is a UUID, lowercased; otherwise, `undefined`.                                                        |
| `clientAddress`  | The client's IP. `undefined` in a manually created context: adapters provide it.                                                         |

## Examples

### Test an endpoint without a server

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequestContext, defineApiRoute, dispatchApiRoute, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";
import type { Schema } from "@meekojs/meeko/server";

const report: Schema<{ region: string }> = { "~standard": { version: 1, validate: (value) => ({ value: value as { region: string } }) } };
interface Services { readonly region: string }

// En una aplicación, .meeko/types/services.d.ts da el tipo de context.services; aquí se indica a mano.
const route = defineApiRoute<undefined, undefined, undefined, typeof report, Services>({
  response: report,
  handler: ({ context }) => ({ region: context.services.region }),
});

test("el informe usa la región de los servicios", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore() });
  const request = new Request("http://localhost/api/report");
  const context = createRequestContext(request, { region: "eu" }, await sessions.load(request));
  const response = await dispatchApiRoute(route, context, sessions);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { region: "eu" });
});
```

`dispatchApiRoute` applies guards and `response` validation and normalizes errors, just as in the application.

### With the host's platform and environment

```ts
import { createRequestContext, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";

const sessions = new SessionManager({ store: new MemorySessionStore() });
const request = new Request("http://localhost/");
const context = createRequestContext(request, {}, await sessions.load(request), {
  name: "node",
  env: { FEATURE_FLAGS: "beta" },
  waitUntil: (promise) => { void Promise.resolve(promise).catch(console.error); },
});
console.log(context.platform.env.FEATURE_FLAGS); // "beta"
```

### Cancel work when the client leaves

<!-- no-check -->

```ts
export default defineApiRoute({
  response: Report,
  handler: async ({ context }) => {
    const upstream = await fetch("https://api.example.com/report", { signal: context.signal });
    return await upstream.json();
  },
});
```

If the client closes the connection, or another request revokes its session, `context.signal` is aborted and `fetch` is canceled.

## Common mistakes

### Pass the `SessionManager` instead of the session

```ts bad
const context = createRequestContext(request, services, sessions);
```

`TS2345`: the third argument is this request's `SessionHandle`, not the manager. At runtime, `context.session.current` would be `undefined` and session guards would fail.

<!-- no-check -->

```ts good
const context = createRequestContext(request, services, await sessions.load(request));
```

### Reuse a context across requests

```ts bad
const shared = createRequestContext(firstRequest, services, session);
await dispatchApiRoute(route, shared, sessions);
await dispatchApiRoute(otherRoute, shared, sessions); // otra petición
```

A context belongs to one request: `context.request` (with its body), `requestId`, `signal`, session and `state` belong to the first one. The second endpoint does not see its own request, and both share `requestId` in logs.

<!-- no-check -->

```ts good
for (const request of requests) {
  const context = createRequestContext(request, services, await sessions.load(request));
  await dispatchApiRoute(route, context, sessions);
}
```

## Notes

- **Server.** A synchronous, portable function; load the session first with `await sessions.load(request)`.
- **Types.** `createRequestContext<TServices, TEnv>` infers both types from its arguments. Since `1.7`, a `RequestContext` written without arguments has `services: AppServices`; with generated `.meeko/types/services.d.ts`, it is the `server/runtime.ts` type. A test context with fake services (`{ db: falso }`) is still accepted in a route handler without a services type, as in `1.6`: `RequestContext` compares by its services type.
- **IP.** A manually created context has no `clientAddress`, so `rateLimit` without `key` counts all clients together. Outside a context, `clientAddress(request)` (since `1.7`) gives the IP with the same policy.
- **Security.** `signal` is aborted with `SessionRevokedError` when the session is revoked mid-request: use it in long operations to avoid finishing work for a session that is no longer valid.

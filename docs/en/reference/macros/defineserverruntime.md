---
title: defineServerRuntime
group: macros
since: 1.0.0
description: Declares sessions, services, Socket policy and application shutdown in server/runtime.ts, created once per process.
symbols:
  - "@meekojs/meeko/server#defineServerRuntime"
types:
  - "@meekojs/meeko/server#ServerRuntime"
related:
  - "@meekojs/meeko/server#SessionManager"
  - "@meekojs/meeko/server#RedisSessionStore"
  - "@meekojs/meeko/server#SqlSessionStore"
  - "@meekojs/meeko/server#RedisSocketPubSub"
  - "@meekojs/meeko/server#createServerApp"
  - docs/framework.md#runtime-de-servidor
  - docs/framework.md#tipos-de-los-servicios
  - docs/framework.md#sesiones-sin-configuración
source-hash: 115618f207386d4cd7be411904e3f432e8ed4e22d3b68d6e82ae9e2bb4576415
---

`defineServerRuntime(factory)` is the default export of `server/runtime.ts`: it declares application resources that live for the process's lifetime. Meeko calls the factory **once per process** with `{ env, production, platform, prerendering, root }` and uses its result: sessions, services available to each request as `context.services`, Socket policy, public origin, error observer and shutdown.

Since `1.7`, the type of `services` is inferred from this file: `context.services.db` is typed in pages, API, RPC, Socket and server middleware without casts.

## Usage

<!-- no-check -->

```ts
// server/runtime.ts
import { defineServerRuntime, SessionManager } from "@meekojs/meeko/server";
import { createDatabase } from "./utils/database";

export default defineServerRuntime(async ({ env, production, prerendering }) => {
  const db = await createDatabase(env.DATABASE_URL);
  return {
    sessions: new SessionManager({ store: db.sessionStore(), production: production && !prerendering }),
    services: { db },
    publicOrigin: env.MEEKO_PUBLIC_ORIGIN,
    onError: (error, requestId) => console.error("request failed", requestId, error),
    close: () => db.close(),
  };
});
```

```ts
// server/api/users/[id].get.ts: typed services, without `as`
// const user = await context.services.db.users.find(params.id);
```

## Parameters

| Parameter | Type                                                   | Default  | Description                                                                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `factory` | `(context) => ServerRuntime \| Promise<ServerRuntime>` | required | Creates resources. Receives `env` (environment variables), `production`, `platform` (`{ name, env, waitUntil }`), `prerendering`, `true` when `meeko build` prerenders without client traffic, and, since `1.8`, `root`, the absolute project root path (`undefined` in Workers). |

The factory's return value:

| Field           | Type                                                | Default                                                              | Description                                                                                             |
| --------------- | --------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `sessions`      | `SessionManager`                                    | in memory in development, Redis with `MEEKO_REDIS_URL` in production | Optional since `1.2`. Application sessions. Explicit sessions always take priority.                     |
| `services`      | object, or `(request, { platform }) => objeto`      | none                                                                 | Available to each request as `RequestContext.services`: a shared object or a per-request function.      |
| `socket`        | `{ allowedOrigins?, maxMessageBytes?, pubsub?, … }` | none                                                                 | Socket policy: origins, limits and broadcast broker.                                                    |
| `publicOrigin`  | URL                                                 | server address                                                       | Public origin behind a proxy, for HTTP and Socket `Origin` checks. Overridden by `MEEKO_PUBLIC_ORIGIN`. |
| `onError`       | `(error, requestId, info?) => void`                 | minimal logging                                                      | Internal failures, with request ID; since `1.3`, also process failures.                                 |
| `processErrors` | policy                                              | report and shut down on exception                                    | Since `1.3`. What to do with rejected promises and process exceptions.                                  |
| `close`         | `() => void \| Promise<void>`                       | none                                                                 | Runs when stopping the server, after closing sessions.                                                  |

## Return value

The same factory, to default-export. Without a function, throws `TypeError: defineServerRuntime requires a factory function`.

## Examples

### Per-request services

A function creates each request's services with the platform (for example, Worker variables):

<!-- no-check -->

```ts
// server/runtime.ts
import { defineServerRuntime } from "@meekojs/meeko/server";
import { createDatabase } from "./utils/database";

export default defineServerRuntime(async ({ env }) => {
  const db = await createDatabase(env.DATABASE_URL);
  return {
    services: (request, { platform }) => ({ db, region: platform.env.REGION ?? "local", locale: request.headers.get("accept-language") ?? "es" }),
    close: () => db.close(),
  };
});
```

### Redis sessions and Socket across instances

<!-- no-check -->

```ts
// server/runtime.ts
import { defineServerRuntime, RedisSessionStore, RedisSocketPubSub, SessionManager } from "@meekojs/meeko/server";
import { createClient } from "redis";

export default defineServerRuntime(async ({ env, production, prerendering }) => {
  if (prerendering) return { services: {} };
  const redis = createClient({ url: env.REDIS_URL });
  const subscriber = redis.duplicate();
  await Promise.all([redis.connect(), subscriber.connect()]);
  return {
    sessions: new SessionManager({ store: new RedisSessionStore(redis, { prefix: "app:prod:session:" }), production }),
    socket: { pubsub: new RedisSocketPubSub({ publisher: redis, subscriber, prefix: "app:prod:socket:" }) },
    close: async () => { await Promise.all([redis.quit(), subscriber.quit()]); },
  };
});
```

With `prerendering`, the build serves no traffic: an in-memory store is enough, which Meeko creates without `sessions`.

### Project files with `root`

Since `1.8`, `root` identifies the project location in `meeko dev`, `meeko start` and Node, Bun or Deno output, placed by the build in `.meeko/output/…`, where `import.meta.url` no longer points to `server/`. If output is deployed outside the project, specify it with `MEEKO_ROOT`.

```ts
// server/runtime.ts
import { join } from 'node:path'
import { defineServerRuntime } from '@meekojs/meeko/server'

export default defineServerRuntime(({ root }) => {
	if (!root) throw new Error('This server requires the project filesystem')
	return { services: { content: join(root, 'content') } }
})
```

See [Server runtime](../../framework.md#server-runtime).

### A service used by a page

<!-- no-check -->

```html
<!-- app/pages/users/[id].meeko -->
<script server lang="ts">
const { params, context } = usePage();
const row = await context.services.db.users.find(params.id); // typed from server/runtime.ts
if (!row) notFound();
export const user = { id: row.id, name: row.name };
</script>

<template><h1>{user.name}</h1></template>
```

## Common mistakes

### Cast `context.services` to another type

Since `1.7`, `context.services` already has the type from `server/runtime.ts`. A cast to an incompatible type is an error.

```ts bad
const cache = context.services as { cache: Map<string, string> };
```

`meeko check` reports `TS2352: Conversion of type '{ db: …; region: string; }' to type '{ cache: Map<string, string>; }' may be a mistake because neither type sufficiently overlaps with the other.` Remove the cast and read services directly.

<!-- no-check -->

```ts good
const user = await context.services.db.users.find(params.id);
```

### Create per-request resources inside shared services

A `services` object is created once and shared by all requests: storing user data there exposes it to others, without any error.

```ts bad
export default defineServerRuntime(() => ({ services: { currentUser: null as string | null } }));
```

<!-- no-check -->

```ts good
export default defineServerRuntime(() => ({
  services: (request) => ({ locale: request.headers.get("accept-language") ?? "es" }),
}));
```

Read user data from `context.session` on each request.

### Export an object instead of the factory

```ts bad
export default defineServerRuntime({ services: {} });
```

`defineServerRuntime` throws `TypeError: defineServerRuntime requires a factory function` when loading the module.

<!-- no-check -->

```ts good
export default defineServerRuntime(() => ({ services: {} }));
```

## Notes

- **Once per process.** The factory runs at startup (and in `meeko build` with `prerendering: true`); in Workers, once per isolate. Connect databases and clients here, not per request.
- **Service types (`1.7`).** `meeko check`, `meeko dev` and the editor generate `.meeko/types/services.d.ts` from this file; `RequestContext` without an argument uses that type (`AppServices`). With a JavaScript runtime file or no `services`, it is `unknown`. An explicit type (`RequestContext<MisServicios>`) still takes priority.
- **Secrets.** This file never reaches the browser: read environment variables here. `meeko dev`, `build`, `start`, `preview` and `check` load the project's `.env`.
- **Shutdown.** `close` runs after closing sessions when stopping the server; `serveNode` also waits for `platform.waitUntil` tasks.
- **Process errors.** Without `processErrors`, an unhandled rejection is reported and the server continues; an uncaught exception is reported and the server shuts down gracefully with code 1.

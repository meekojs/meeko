---
title: RedisSessionStore
group: server
since: 1.0.0
description: Persistent Redis session store, with Redis expiration, atomic rotation and revocation, cross-instance revocation and shared rateLimit counters.
symbols:
  - "@meekojs/meeko/server#RedisSessionStore"
types:
  - "@meekojs/meeko/server#RedisSessionStoreOptions"
  - "@meekojs/meeko/server#RedisSessionClient"
  - "@meekojs/meeko/server#RedisSubscriberClient"
related:
  - "@meekojs/meeko/server#SessionManager"
  - "@meekojs/meeko/server#RedisSocketPubSub"
  - "@meekojs/meeko/server#SqlSessionStore"
  - docs/framework.md#sesiones-y-seguridad
  - docs/framework.md#sesiones-sin-configuración
  - docs/framework.md#redis-mediante-la-api-rest-de-upstash
  - docs/framework.md#límite-de-peticiones-ratelimit
source-hash: b43d1961ef7251851d34b9aa6ba86a0afce999aa52aabead4638eabad92e12a7
---

`RedisSessionStore` stores each session in Redis with its expiration (`PX`) and a per-family index locating the active session. `set`, `replace`, `revokeFamily` and `rateLimit` are atomic Lua scripts, so multiple instances share sessions, revocations and limits without races. With a `subscriber`, it receives revocations published by any instance and immediately aborts that family's requests and sockets.

This is the store Meeko creates without configuration in production with `MEEKO_REDIS_URL` (Node, Bun and Deno). Create it manually for your own client, another prefix or Upstash on Workers.

## Usage

<!-- no-check -->

```ts
// server/runtime.ts
import { createClient } from "redis";
import { defineServerRuntime, RedisSessionStore, SessionManager } from "@meekojs/meeko/server";

export default defineServerRuntime(async ({ env, production, prerendering }) => {
  const redis = createClient({ url: env.MEEKO_REDIS_URL });
  await redis.connect();
  const subscriber = redis.duplicate(); // conexión dedicada en modo suscriptor
  await subscriber.connect();
  const store = new RedisSessionStore(redis, { prefix: "tienda:prod:session:", subscriber });
  return {
    sessions: new SessionManager({ store, production: production && !prerendering }),
    close: async () => { await subscriber.quit(); await redis.quit(); },
  };
});
```

## Parameters

`new RedisSessionStore(client, options)`:

| Parameter             | Type                    | Default  | Description                                                                                                                                          |
| --------------------- | ----------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client`              | `RedisSessionClient`    | required | A connected client with `get`, `set(key, value, { PX })`, `del` and `eval(script, { keys, arguments })`. node-redis 4 or later satisfies this as is. |
| `options.prefix`      | `string`                | required | Prefix for all keys, unique per application and environment: nonempty, without whitespace and ending in `:`.                                         |
| `options.subscriber`  | `RedisSubscriberClient` | none     | Dedicated connection (`client.duplicate()`) to receive revocations from `<prefix>revoked`. The application opens and closes it.                      |
| `options.closeClient` | `boolean`               | `false`  | Closes `client` with `quit()` when closing the store, when the store owns the connection.                                                            |

## Return value

A persistent `SessionStore` (`persistent: true`) with `replace`, `revokeFamily` and `rateLimit`, and `subscribeRevocations` only if given a `subscriber`. Keys it writes:

| Key                           | Content                                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `<prefix><id>`                | The session record in JSON, with `PX` equal to its remaining lifetime.                                               |
| `<prefix>family:<familyId>`   | The family's active ID, with the same `PX`.                                                                          |
| `<prefix>ratelimit:<resumen>` | The counter for a `rateLimit` window; the key is a SHA-256 of the route and subject, never the plain-text IP.        |
| `<prefix>revoked`             | Pub/sub channel where `revokeFamily` publishes the `familyId` in the same atomic operation that deletes the session. |

## Examples

### Sessions and Socket across instances with one Redis

<!-- no-check -->

```ts
// server/runtime.ts
import { createClient } from "redis";
import { defineServerRuntime, RedisSessionStore, RedisSocketPubSub, SessionManager } from "@meekojs/meeko/server";

export default defineServerRuntime(async ({ env, production, prerendering }) => {
  const redis = createClient({ url: env.MEEKO_REDIS_URL });
  await redis.connect();
  const subscriber = redis.duplicate();
  await subscriber.connect();
  return {
    sessions: new SessionManager({ store: new RedisSessionStore(redis, { prefix: "app:prod:session:", subscriber }), production: production && !prerendering }),
    socket: { pubsub: new RedisSocketPubSub({ publisher: redis, subscriber, prefix: "app:prod:" }) },
    close: async () => { await subscriber.quit(); await redis.quit(); },
  };
});
```

The same `subscriber` serves both: each subscribes to its own channels.

### Upstash through its REST API, on Cloudflare Workers

Workers does not open TCP connections. Upstash's REST API covers the four operations the store needs:

```ts
import { RedisSessionStore } from "@meekojs/meeko/server";
import type { RedisSessionClient } from "@meekojs/meeko/server";

function upstashClient(url: string, token: string): RedisSessionClient {
  const command = async (...args: Array<string | number>): Promise<unknown> => {
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    const body = await response.json() as { result?: unknown; error?: string };
    if (!response.ok || body.error) throw new Error(`Upstash ${String(args[0])} failed: ${body.error ?? response.status}`);
    return body.result;
  };
  return {
    get: async (key) => (await command("GET", key)) as string | null,
    set: (key, value, { PX }) => command("SET", key, value, "PX", PX),
    del: (key) => command("DEL", key),
    eval: (script, { keys, arguments: args }) => command("EVAL", script, keys.length, ...keys, ...args),
  };
}

export const createStore = (env: { UPSTASH_REDIS_REST_URL: string; UPSTASH_REDIS_REST_TOKEN: string }) =>
  new RedisSessionStore(upstashClient(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN), { prefix: "mi-app:prod:" });
```

The REST API does not maintain a subscription: without `subscriber`, other instances detect a revocation when rereading the session.

### Without `server/runtime.ts`

```sh
MEEKO_REDIS_URL=rediss://default:…@redis.example.com:6380
MEEKO_REDIS_PREFIX=tienda:prod:   # por defecto, meeko:<name de package.json>:prod:
```

With `npm install redis` in the project, `meeko start` connects a client and a subscriber before serving traffic and closes both on shutdown.

## Common mistakes

### A prefix without a trailing `:`

```ts bad
new RedisSessionStore(redis, { prefix: "app" });
```

`TypeError: Session Redis prefix must be nonempty, contain no whitespace, and end with ':'`.

<!-- no-check -->

```ts good
new RedisSessionStore(redis, { prefix: "app:prod:session:" });
```

### The same prefix in two applications or environments

```text bad
staging y producción con prefix: "app:" en el mismo Redis
```

There is no error: both applications read each other's sessions, a `revokeFamily` published on `app:revoked` reaches both, and they share `rateLimit` counters. Use one prefix per application and environment, and never `FLUSHALL` or `FLUSHDB` on shared Redis.

```text good
prefix: "app:staging:session:" y prefix: "app:prod:session:"
```

### Using the normal connection as `subscriber`

```ts bad
new RedisSessionStore(redis, { prefix: "app:prod:session:", subscriber: redis });
```

A node-redis connection in subscriber mode does not accept other commands: session reads fail. Create a separate connection.

<!-- no-check -->

```ts good
const subscriber = redis.duplicate();
await subscriber.connect();
new RedisSessionStore(redis, { prefix: "app:prod:session:", subscriber });
```

### `MEEKO_REDIS_URL` without the `redis` package

```sh bad
MEEKO_REDIS_URL=redis://127.0.0.1:6379 npm start   # sin npm install redis
```

Startup stops with `MEEKO_REDIS_URL is set but the project does not install the redis package: add it with npm install redis (or pnpm add redis) and build again`. A URL other than `redis://` or `rediss://` reports `MEEKO_REDIS_URL must be a redis:// or rediss:// URL`, and an unreachable server reports `Could not connect to the Redis server of MEEKO_REDIS_URL`. Messages never include the URL, which contains the password.

```sh good
npm install redis && npm run build && MEEKO_REDIS_URL=rediss://… npm start
```

## Notes

- **Fail closed.** If Redis does not respond, the request reading the session fails with `500`; access is never granted without the store. `rateLimit` also rejects.
- **Old records.** Records without `familyId` (from before family revocation) remain readable and receive a family on their first rotation.
- **Forgeable notifications.** Anyone with `PUBLISH` permission on Redis can publish a `familyId` to `<prefix>revoked`: it does not grant access, but aborts requests and closes that family's sockets. Restrict that channel with ACLs.
- **Disconnected subscriber.** Redis pub/sub does not store messages: a revocation published while an instance's `subscriber` is down does not reach it. Deletion is atomic, however, so the next read detects it; use `session.verify()` before irreversible effects.
- **Shutdown.** The store does not close the client except with `closeClient`; close `client` and `subscriber` in `close` in `server/runtime.ts`.

---
title: RedisSocketPubSub
group: server
since: 1.0.0
description: Distributes Socket broadcasts across multiple instances or processes with Redis pub/sub, including sharded pub/sub in Redis Cluster.
symbols:
  - "@meekojs/meeko/server#RedisSocketPubSub"
types:
  - "@meekojs/meeko/server#RedisSocketPubSubOptions"
  - "@meekojs/meeko/server#RedisPublisherClient"
  - "@meekojs/meeko/server#RedisSubscriberClient"
related:
  - "@meekojs/meeko/server#LocalSocketPubSub"
  - "@meekojs/meeko/server#RedisSessionStore"
  - "@meekojs/meeko/cloudflare#DurableObjectSocketPubSub"
  - "@meekojs/meeko/server#defineSocketChannel"
  - docs/framework.md#broadcast-y-varias-instancias
  - docs/framework.md#websocket
source-hash: 7d96019c0a0e8843428f35c6d5bb6200bd6f9c358a6bf059b56d66a0aabb09e5
---

`RedisSocketPubSub` is the Socket broker for multiple instances: each channel/room pair is a Redis channel (`<prefix>socket:<canal>:<sala>`, with channel and room encoded using `encodeURIComponent`), to which each instance subscribes once while it has local peers in that room. A `broadcast` in any instance reaches peers in all instances.

Delivery is at most once: Redis pub/sub does not store messages, so anything published while an instance is disconnected from Redis is lost for that instance.

## Usage

<!-- no-check -->

```ts
// server/runtime.ts
import { createClient } from "redis";
import { defineServerRuntime, RedisSocketPubSub } from "@meekojs/meeko/server";

export default defineServerRuntime(async ({ env }) => {
  const redis = createClient({ url: env.MEEKO_REDIS_URL });
  await redis.connect();
  const subscriber = redis.duplicate(); // el suscriptor necesita su propia conexión
  await subscriber.connect();
  return {
    socket: { pubsub: new RedisSocketPubSub({ publisher: redis, subscriber, prefix: "chat:prod:" }) },
    close: async () => { await subscriber.quit(); await redis.quit(); },
  };
});
```

## Parameters

`new RedisSocketPubSub(options)`:

| Option            | Type                                 | Default           | Description                                                                                                                                                     |
| ----------------- | ------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publisher`       | `RedisPublisherClient`               | required          | Normal connection with `publish(channel, message)` (and `sPublish` with `sharded`).                                                                             |
| `subscriber`      | `RedisSubscriberClient`              | required          | Dedicated subscriber-mode connection with `subscribe(channel, listener)` and `unsubscribe(channel, listener)` (and `sSubscribe`/`sUnsubscribe` with `sharded`). |
| `prefix`          | `string`                             | required          | Unique prefix per application and environment: nonempty, without whitespace and ending in `:`.                                                                  |
| `maxMessageBytes` | `number`                             | `1048576` (1 MiB) | Largest serialized message accepted by `publish`.                                                                                                               |
| `sharded`         | `boolean`                            | `false`           | Uses Redis 7's `SPUBLISH`/`SSUBSCRIBE`/`SUNSUBSCRIBE`, keeping each room on its shard in a cluster.                                                             |
| `onError`         | `(error, { channel, room }) => void` | `console.error`   | Receives malformed messages and listener failures.                                                                                                              |

node-redis 4 or later clients implement both interfaces as-is.

## Return value

A `SocketPubSub`:

| Member                               | Description                                                                                                                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publish(channel, room, message)`    | Serializes `{ v: 1, event, payload }` with `serializeJson` and publishes it; resolves when Redis accepts it. Rejects a message larger than `maxMessageBytes` with `SOCKET_LIMIT_EXCEEDED` (`413`). |
| `subscribe(channel, room, listener)` | Resolves with the `Unsubscribe` function once Redis confirms the subscription, so no subsequent broadcast is lost. `hub.accept` awaits it.                                                         |
| `channelName(channel, room)`         | The Redis channel for a channel/room pair.                                                                                                                                                         |

## Examples

### Redis Cluster

<!-- no-check -->

```ts
// publisher ofrece sPublish; subscriber, sSubscribe y sUnsubscribe (Redis 7 o posterior).
const pubsub = new RedisSocketPubSub({ publisher, subscriber, prefix: "chat:prod:", sharded: true });
```

### Observe discarded messages

<!-- no-check -->

```ts
new RedisSocketPubSub({
  publisher: redis,
  subscriber,
  prefix: "chat:prod:",
  onError: (error, { channel, room }) => logger.warn({ channel, room, error }, "socket message dropped"),
});
```

A message from another format version or malformed (another process publishing to the same channel) is discarded and reported here, without closing any peer.

### Deploy with multiple replicas

```yaml
# docker-compose.yml (fragmento): dos réplicas detrás del proxy, un Redis compartido
services:
  app:
    image: tienda:1.7.0
    deploy: { replicas: 2 }
    environment:
      MEEKO_PUBLIC_ORIGIN: https://tienda.example.com
      MEEKO_REDIS_URL: rediss://default:${REDIS_PASSWORD}@redis.internal:6380
      MEEKO_TRUST_PROXY: "1"
      MEEKO_HOST: 0.0.0.0
```

Sessions without configuration already use that Redis; declare the Socket broker in `server/runtime.ts` as in “Usage”.

## Common mistakes

### A prefix without a trailing `:`

```ts bad
new RedisSocketPubSub({ publisher: redis, subscriber, prefix: "chat:prod" });
```

`TypeError: Socket Redis prefix must be nonempty, contain no whitespace, and end with ':'`, when creating the runtime.

<!-- no-check -->

```ts good
new RedisSocketPubSub({ publisher: redis, subscriber, prefix: "chat:prod:" });
```

### `sharded` with a client lacking sharded pub/sub

```ts bad
new RedisSocketPubSub({ publisher: oldClient, subscriber: oldSubscriber, prefix: "chat:prod:", sharded: true });
```

`TypeError: Redis sharded pub/sub requires sPublish, sSubscribe and sUnsubscribe`. Requires node-redis with these methods and Redis 7 or later.

<!-- no-check -->

```ts good
new RedisSocketPubSub({ publisher: redis, subscriber, prefix: "chat:prod:" }); // sin sharded fuera de un clúster
```

### Use the normal connection as subscriber

```ts bad
new RedisSocketPubSub({ publisher: redis, subscriber: redis, prefix: "chat:prod:" });
```

In subscriber mode, a node-redis connection does not accept other commands: `publish` (and the session store, if shared) fails on the first broadcast.

<!-- no-check -->

```ts good
const subscriber = redis.duplicate();
await subscriber.connect();
new RedisSocketPubSub({ publisher: redis, subscriber, prefix: "chat:prod:" });
```

## Notes

- **Validation in each instance.** The receiving instance validates the payload against the channel schema again and runs `authorize` and `authorizeSend` before sending to each local peer.
- **Size.** The hub rejects messages larger than its `maxMessageBytes` (64 KiB by default) before publishing; the broker limit (1 MiB) protects Redis from messages that bypass the hub.
- **Security.** Anyone with `PUBLISH` access to Redis can inject messages into a room; the receiver validates them, but restrict access with ACLs and use a prefix per application and environment.
- **Workers.** Not supported: the Worker rejects any broker other than `DurableObjectSocketPubSub`.
- **Shutdown.** The application opens and closes `publisher` and `subscriber`.

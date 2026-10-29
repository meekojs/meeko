---
title: RedisSocketPubSub
group: server
since: 1.0.0
description: Reparte los broadcasts de Socket entre varias instancias o procesos con el pub/sub de Redis, también fragmentado en Redis Cluster.
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
---

`RedisSocketPubSub` es el broker de Socket para más de una instancia: cada par canal/sala es un canal Redis (`<prefix>socket:<canal>:<sala>`, con canal y sala codificados con `encodeURIComponent`), al que cada instancia se suscribe una vez mientras tenga peers locales en esa sala. Un `broadcast` en cualquier instancia llega a los peers de todas.

La entrega es a lo sumo una vez: Redis pub/sub no guarda mensajes, así que lo publicado mientras una instancia está desconectada de Redis se pierde para ella.

## Uso

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

## Parámetros

`new RedisSocketPubSub(options)`:

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `publisher` | `RedisPublisherClient` | obligatorio | Conexión normal con `publish(channel, message)` (y `sPublish` con `sharded`). |
| `subscriber` | `RedisSubscriberClient` | obligatorio | Conexión dedicada en modo suscriptor con `subscribe(channel, listener)` y `unsubscribe(channel, listener)` (y `sSubscribe`/`sUnsubscribe` con `sharded`). |
| `prefix` | `string` | obligatorio | Prefijo único por aplicación y entorno: no vacío, sin espacios y terminado en `:`. |
| `maxMessageBytes` | `number` | `1048576` (1 MiB) | Mensaje serializado más grande que acepta `publish`. |
| `sharded` | `boolean` | `false` | Usa `SPUBLISH`/`SSUBSCRIBE`/`SUNSUBSCRIBE` de Redis 7, que en un clúster mantiene cada sala en su shard. |
| `onError` | `(error, { channel, room }) => void` | `console.error` | Recibe los mensajes mal formados y los fallos de los listeners. |

Los clientes de node-redis 4 o posterior cumplen ambas interfaces tal cual.

## Valor devuelto

Un `SocketPubSub`:

| Miembro | Descripción |
| --- | --- |
| `publish(channel, room, message)` | Serializa `{ v: 1, event, payload }` con `serializeJson` y lo publica; se resuelve cuando Redis lo acepta. Rechaza con `SOCKET_LIMIT_EXCEEDED` (`413`) un mensaje mayor que `maxMessageBytes`. |
| `subscribe(channel, room, listener)` | Se resuelve con la función `Unsubscribe` cuando Redis confirma la suscripción, así que no se pierde ningún broadcast posterior. `hub.accept` lo espera. |
| `channelName(channel, room)` | El canal Redis de un par canal/sala. |

## Ejemplos

### Redis Cluster

<!-- no-check -->
```ts
// publisher ofrece sPublish; subscriber, sSubscribe y sUnsubscribe (Redis 7 o posterior).
const pubsub = new RedisSocketPubSub({ publisher, subscriber, prefix: "chat:prod:", sharded: true });
```

### Observar los mensajes descartados

<!-- no-check -->
```ts
new RedisSocketPubSub({
  publisher: redis,
  subscriber,
  prefix: "chat:prod:",
  onError: (error, { channel, room }) => logger.warn({ channel, room, error }, "socket message dropped"),
});
```

Un mensaje de otra versión del formato o mal formado (otro proceso que publica en el mismo canal) se descarta y se informa aquí, sin cerrar a ningún peer.

### Despliegue con varias réplicas

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

Las sesiones sin configuración ya usan ese Redis; el broker de Socket se declara en `server/runtime.ts` como en «Uso».

## Errores comunes

### Un prefijo sin `:` final

```ts bad
new RedisSocketPubSub({ publisher: redis, subscriber, prefix: "chat:prod" });
```

`TypeError: Socket Redis prefix must be nonempty, contain no whitespace, and end with ':'`, al crear el runtime.

<!-- no-check -->
```ts good
new RedisSocketPubSub({ publisher: redis, subscriber, prefix: "chat:prod:" });
```

### `sharded` con un cliente sin pub/sub fragmentado

```ts bad
new RedisSocketPubSub({ publisher: oldClient, subscriber: oldSubscriber, prefix: "chat:prod:", sharded: true });
```

`TypeError: Redis sharded pub/sub requires sPublish, sSubscribe and sUnsubscribe`. Necesita node-redis con esos métodos y Redis 7 o posterior.

<!-- no-check -->
```ts good
new RedisSocketPubSub({ publisher: redis, subscriber, prefix: "chat:prod:" }); // sin sharded fuera de un clúster
```

### La conexión normal como suscriptor

```ts bad
new RedisSocketPubSub({ publisher: redis, subscriber: redis, prefix: "chat:prod:" });
```

En modo suscriptor, una conexión de node-redis no admite otros comandos: `publish` (y, si la comparte, el store de sesiones) falla al primer broadcast.

<!-- no-check -->
```ts good
const subscriber = redis.duplicate();
await subscriber.connect();
new RedisSocketPubSub({ publisher: redis, subscriber, prefix: "chat:prod:" });
```

## Notas

- **Validación en cada instancia.** La instancia receptora vuelve a validar el payload con el schema del canal y ejecuta `authorize` y `authorizeSend` antes de enviar a cada peer local.
- **Tamaño.** El hub rechaza antes de publicar un mensaje mayor que su `maxMessageBytes` (64 KiB por defecto); el límite del broker (1 MiB) protege a Redis de mensajes que no pasan por el hub.
- **Seguridad.** Cualquiera con `PUBLISH` sobre el Redis puede inyectar mensajes en una sala; el receptor los valida, pero restrinja el acceso con ACL y use un prefijo por aplicación y entorno.
- **Workers.** No se admite: el Worker rechaza cualquier broker que no sea `DurableObjectSocketPubSub`.
- **Cierre.** La aplicación abre y cierra `publisher` y `subscriber`.

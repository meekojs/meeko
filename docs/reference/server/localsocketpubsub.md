---
title: LocalSocketPubSub
group: server
since: 1.0.0
description: Broker de broadcasts de Socket dentro de un solo proceso, el que usa el hub por defecto en Node, Bun y Deno; no alcanza a otras instancias.
symbols:
  - "@meekojs/meeko/server#LocalSocketPubSub"
types:
  - "@meekojs/meeko/server#LocalSocketPubSubOptions"
  - "@meekojs/meeko/server#SocketPubSub"
  - "@meekojs/meeko/server#SocketMessage"
related:
  - "@meekojs/meeko/server#RedisSocketPubSub"
  - "@meekojs/meeko/cloudflare#DurableObjectSocketPubSub"
  - "@meekojs/meeko/server#defineSocketChannel"
  - "@meekojs/meeko/server#createSocketHub"
  - docs/framework.md#broadcast-y-varias-instancias
  - docs/framework.md#broadcast-desde-el-servidor
---

`LocalSocketPubSub` reparte los broadcasts de Socket entre los peers conectados a **este** proceso: cada par canal/sala es un conjunto de listeners en memoria, y `publish` los llama y espera sus intentos de entrega locales. Es el broker por defecto del hub en Node, Bun y Deno cuando `server/runtime.ts` no declara `socket.pubsub`.

Con una sola instancia no hace falta nada más. Con varias réplicas o procesos, un broadcast hecho en una no llega a los peers de las otras: use `RedisSocketPubSub`. En Cloudflare Workers no se admite. Desde `1.7`, si una aplicación de producción tiene canales y no declara `socket.pubsub`, Meeko avisa una vez de que usa este broker; declararlo de forma explícita (`new LocalSocketPubSub()`) indica que sirve una sola instancia y quita el aviso.

## Uso

```ts
// server/runtime.ts
import { defineServerRuntime, LocalSocketPubSub } from "@meekojs/meeko/server";

export default defineServerRuntime(() => ({
  socket: {
    pubsub: new LocalSocketPubSub({ onListenerError: (error) => console.warn("[socket] listener", error) }),
  },
}));
```

Sin `socket.pubsub`, el hub crea uno igual, con `console.error` como observador, y en producción avisa una vez (desde `1.7`).

## Parámetros

`new LocalSocketPubSub(options?)`:

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `onListenerError` | `(error: unknown) => void` | `console.error("[meeko] Socket listener failed", error)` | Recibe el fallo de un listener. Los listeners del hub nunca fallan; esto cubre listeners propios. Un observador que lanza no detiene la entrega a los demás. |

## Valor devuelto

Un `SocketPubSub`:

| Método | Descripción |
| --- | --- |
| `publish(channel, room, { event, payload })` | Llama a todos los listeners del par canal/sala y se resuelve cuando terminan sus intentos de entrega. |
| `subscribe(channel, room, listener)` | Añade un listener y devuelve, de forma síncrona, la función que lo quita. |

## Ejemplos

### Broadcast desde una API

<!-- no-check -->
```ts
// server/api/orders/[id]/ready.post.ts
export default defineApiRoute({
  params: orderParams,
  response: orderSchema,
  handler: async ({ params }) => {
    const order = await markReady(params.id);
    // Valida evento y payload con el contrato del canal y publica en el broker del hub.
    await socket.operations.broadcast(order.storeId, "kitchenChanged", { orderId: order.id, status: "ready" });
    return order;
  },
});
```

`broadcast` usa el broker del runtime: este mismo código funciona con `LocalSocketPubSub`, `RedisSocketPubSub` o el Durable Object de Workers.

### Escuchar un par canal/sala en una prueba

```ts
import { LocalSocketPubSub } from "@meekojs/meeko/server";

const pubsub = new LocalSocketPubSub();
const received: unknown[] = [];
const stop = pubsub.subscribe("chat", "general", (message) => { received.push(message.payload); });
await pubsub.publish("chat", "general", { event: "message", payload: { text: "Hola" } });
await pubsub.publish("chat", "otra", { event: "message", payload: { text: "No llega" } });
stop();
console.log(received); // [{ text: "Hola" }]
```

### Decidir el broker según el despliegue

<!-- no-check -->
```ts
// server/runtime.ts
export default defineServerRuntime(async ({ env }) => {
  if (!env.MEEKO_REDIS_URL) return { socket: { pubsub: new LocalSocketPubSub() } }; // una sola instancia
  const { publisher, subscriber } = await connectRedis(env.MEEKO_REDIS_URL);
  return {
    socket: { pubsub: new RedisSocketPubSub({ publisher, subscriber, prefix: "app:prod:" }) },
    close: async () => { await subscriber.quit(); await publisher.quit(); },
  };
});
```

## Errores comunes

### Varias instancias con el broker local

```text bad
2 réplicas tras un balanceador, sin socket.pubsub (LocalSocketPubSub por defecto)
```

`broadcast` se resuelve, pero sólo reciben el mensaje los peers conectados a la réplica que lo publicó: los usuarios de la otra réplica no ven el cambio. Desde `1.7`, una aplicación de producción con canales y sin `socket.pubsub` lo avisa una vez por proceso al arrancar, como el contador en memoria de `rateLimit`: `[meeko] Los canales de Socket usan LocalSocketPubSub, el broker en memoria de cada instancia: …`. Meeko no puede contar las réplicas, así que el aviso sale también con una sola instancia; declare `new LocalSocketPubSub()` para quitarlo.

<!-- no-check -->
```ts good
socket: { pubsub: new RedisSocketPubSub({ publisher: redis, subscriber, prefix: "app:prod:" }) }
```

### Usarlo en Cloudflare Workers

```ts bad
socket: { pubsub: new LocalSocketPubSub() } // en un Worker
```

Las conexiones viven en los Durable Objects de cada sala, no en el aislado. El Worker rechaza la aplicación al crearla: `Socket channels on Cloudflare Workers require DurableObjectSocketPubSub: leave runtime.socket.pubsub unset and bind MEEKO_SOCKET, or set it to new DurableObjectSocketPubSub(env.MEEKO_SOCKET)…`.

<!-- no-check -->
```ts good
socket: env.MEEKO_SOCKET ? { pubsub: new DurableObjectSocketPubSub(env.MEEKO_SOCKET) } : {}
```

## Notas

- **Entrega.** A lo sumo una vez por peer, en el orden de publicación; un peer cuya cola supera `maxPendingDeliveries` se cierra con `1013`.
- **Validación.** El hub valida evento y payload antes de publicar y vuelve a validar al entregar; el broker sólo transporta.
- **Memoria.** Los listeners de una sala se liberan al irse el último peer.
- **Desarrollo.** En `meeko dev`, al volver a crear la aplicación (crear o borrar una ruta), las conexiones abiertas se cierran y los clientes reconectan.

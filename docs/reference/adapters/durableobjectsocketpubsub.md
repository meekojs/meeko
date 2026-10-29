---
title: DurableObjectSocketPubSub
group: adapters
since: 1.0.0
description: El broker de Socket de Cloudflare Workers, donde cada canal y sala es un Durable Object que recibe las publicaciones por RPC y las reparte a sus peers.
symbols:
  - "@meekojs/meeko/cloudflare#DurableObjectSocketPubSub"
types:
  - "@meekojs/meeko/cloudflare#DurableObjectNamespaceLike"
  - "@meekojs/meeko/server#SocketPubSub"
related:
  - "@meekojs/meeko/cloudflare#createSocketRoomClass"
  - "@meekojs/meeko/cloudflare#createWorker"
  - "@meekojs/meeko/cloudflare#socketRoomName"
  - "@meekojs/meeko/server#LocalSocketPubSub"
  - "@meekojs/meeko/server#RedisSocketPubSub"
  - docs/framework.md#socket-y-durable-objects
  - docs/framework.md#broadcast-desde-el-servidor
---

En Workers, las conexiones Socket no viven en el aislado que atiende la petición, sino en el Durable Object de su sala. `DurableObjectSocketPubSub` es el único broker que llega a ellas: `publish` entrega el mensaje a la sala por RPC (o directamente, si ya se ejecuta dentro de esa sala) y se resuelve cuando la sala lo acepta; la sala lo reparte a sus peers en orden de publicación.

Es el broker por defecto en Workers: con el binding `MEEKO_SOCKET` y sin `socket.pubsub`, el Worker generado lo usa. Declárelo sólo para dejarlo explícito o con otro binding; cualquier otro broker se rechaza.

## Uso

```ts
// server/runtime.ts
import { DurableObjectSocketPubSub } from "@meekojs/meeko/cloudflare";
import type { DurableObjectNamespaceLike } from "@meekojs/meeko/cloudflare";
import { defineServerRuntime } from "@meekojs/meeko/server";

interface Env { readonly MEEKO_SOCKET?: DurableObjectNamespaceLike }

export default defineServerRuntime<Env>(({ env }) => ({
  socket: env.MEEKO_SOCKET ? { pubsub: new DurableObjectSocketPubSub(env.MEEKO_SOCKET) } : {},
}));
```

`env.MEEKO_SOCKET` no existe durante el prerender, que se ejecuta en Node.

## Parámetros

`new DurableObjectSocketPubSub(namespace)`:

| Parámetro | Tipo | Descripción |
| --- | --- | --- |
| `namespace` | `DurableObjectNamespaceLike` | El binding del namespace de las salas, normalmente `env.MEEKO_SOCKET`, cuya clase se creó con `createSocketRoomClass`. |

## Valor devuelto

Un `SocketPubSub`:

| Método | Descripción |
| --- | --- |
| `publish(channel, room, message)` | Entrega el mensaje al Durable Object de `socketRoomName(channel, room)` y se resuelve cuando lo acepta. Rechaza con `SOCKET_BACKLOG_EXCEEDED` (`503`) si la sala ya tiene `maxPendingPublications` sin entregar. |
| `subscribe(channel, room, listener)` | Sólo dentro del Durable Object de la sala, donde el hub suscribe a sus peers. |

## Ejemplos

### Broadcast desde una API

<!-- no-check -->
```ts
// server/api/documents/[id]/publish.post.ts
export default defineApiRoute({
  params: documentParams,
  response: documentSchema,
  auth: "required",
  handler: async ({ params }) => {
    const document = await publishDocument(params.id);
    await socket.documents.broadcast(document.id, "published", { id: document.id, at: document.publishedAt });
    return document;
  },
});
```

El mismo código funciona en Node con `LocalSocketPubSub` o `RedisSocketPubSub`: `broadcast` usa el broker del runtime.

### Una sala por documento

```text
/_meeko/socket/documents?room=doc_42  → Durable Object "documents\u0000doc_42"
/_meeko/socket/documents?room=doc_43  → Durable Object "documents\u0000doc_43"
```

Cada sala procesa sus mensajes en un solo hilo: repartir por documento escala mejor que una sala global.

## Errores comunes

### Un binding que no es de Durable Objects

```ts bad
new DurableObjectSocketPubSub(env.DB as never);
```

`TypeError: DurableObjectSocketPubSub requires a Durable Object namespace binding`.

<!-- no-check -->
```ts good
new DurableObjectSocketPubSub(env.MEEKO_SOCKET);
```

### Suscribirse fuera de la sala

```ts bad
new DurableObjectSocketPubSub(env.MEEKO_SOCKET).subscribe("chat", "general", (message) => console.log(message));
```

`Error: DurableObjectSocketPubSub subscribes only inside the Socket room Durable Object; forward upgrades with createWorker`. Las suscripciones sólo existen dentro de la sala; todo upgrade debe pasar por `createWorker`.

<!-- no-check -->
```ts good
export default createWorker(createCloudflareApp); // reenvía cada upgrade a su sala
```

### Una clase de salas que no es la de Meeko

```text bad
MEEKO_SOCKET apunta a una clase Durable Object propia
```

El primer `publish` rechaza con `TypeError: The Socket Durable Object must be created with createSocketRoomClass`: la sala debe ofrecer el RPC `meekoPublish`.

```text good
export const MeekoSocketRoom = createSocketRoomClass(createCloudflareApp, DurableObject);
```

### Otro broker en Workers

```ts bad
socket: { pubsub: new LocalSocketPubSub() }
```

El Worker y la sala rechazan la aplicación al crearla: `Socket channels on Cloudflare Workers require DurableObjectSocketPubSub: leave runtime.socket.pubsub unset and bind MEEKO_SOCKET, or set it to new DurableObjectSocketPubSub(env.MEEKO_SOCKET)…`.

<!-- no-check -->
```ts good
socket: {} // el Worker usa DurableObjectSocketPubSub(env.MEEKO_SOCKET)
```

## Notas

- **Entrega.** A lo sumo una vez y en orden de publicación por sala. Una publicación hacia la propia sala no hace RPC.
- **Validación.** El hub valida evento y payload antes de publicar; la sala los vuelve a validar y aplica `authorize` y `authorizeSend` a cada peer.
- **Hibernación.** Una publicación despierta la sala si estaba hibernada; espera a que las conexiones se reconstruyan como mucho `rebuildTimeoutMs`.
- **Sin TCP ni Redis.** No hace falta un broker externo: el Durable Object es el punto único de cada sala.

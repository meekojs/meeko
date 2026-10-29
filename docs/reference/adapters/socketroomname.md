---
title: socketRoomName
group: adapters
since: 1.0.0
description: El nombre del Durable Object de una sala de Socket en Cloudflare Workers, un objeto por canal y sala, para idFromName.
symbols:
  - "@meekojs/meeko/cloudflare#socketRoomName"
related:
  - "@meekojs/meeko/cloudflare#createSocketRoomClass"
  - "@meekojs/meeko/cloudflare#DurableObjectSocketPubSub"
  - "@meekojs/meeko/cloudflare#createWorker"
  - docs/framework.md#socket-y-durable-objects
---

`socketRoomName(channel, room)` devuelve el nombre con el que Meeko localiza el Durable Object de una sala: el canal y la sala separados por un carácter nulo (`"chat\u0000general"`). Lo usan `createWorker` al reenviar un upgrade, `DurableObjectSocketPubSub` al publicar y la propia sala para reconocer las publicaciones dirigidas a ella.

Sirve a un Worker propio que necesita hablar con una sala concreta: inspeccionarla, publicar sin pasar por el hub o reenviar un upgrade.

## Uso

<!-- no-check -->
```ts
import { socketRoomName } from "@meekojs/meeko/cloudflare";

const stub = env.MEEKO_SOCKET.get(env.MEEKO_SOCKET.idFromName(socketRoomName("chat", "general")));
```

## Parámetros

| Parámetro | Tipo | Descripción |
| --- | --- | --- |
| `channel` | `string` | El canal, el nombre del archivo de `server/socket/`. |
| `room` | `string` | La sala de `?room=`; las conexiones sin sala usan `""`. |

## Valor devuelto

`` `${channel}\0${room}` ``. El separador nulo no puede aparecer en un nombre de canal, así que dos pares distintos nunca comparten objeto.

## Ejemplos

### El nombre de cada par

```ts
import { socketRoomName } from "@meekojs/meeko/cloudflare";

console.log(JSON.stringify(socketRoomName("chat", "general"))); // "chat\u0000general"
console.log(JSON.stringify(socketRoomName("operations", "")));  // "operations\u0000", la sala por defecto
```

### Publicar en una sala desde un Cron Trigger

<!-- no-check -->
```ts
// worker.ts: un evento programado que no es una petición HTTP.
import { DurableObjectSocketPubSub } from "@meekojs/meeko/cloudflare";

export default {
  fetch: worker.fetch,
  async scheduled(_event: ScheduledEvent, env: Env) {
    const pubsub = new DurableObjectSocketPubSub(env.MEEKO_SOCKET);
    await pubsub.publish("status", "", { event: "maintenance", payload: { at: Date.now() } });
  },
};
```

`DurableObjectSocketPubSub` calcula el nombre con `socketRoomName`. Publicar así no valida el evento ni el payload antes de enviarlos (la sala descarta al entregar un payload que no cumple el schema); dentro de una petición, prefiera `socket.status.broadcast("", "maintenance", payload)`, que los valida con el contrato.

## Errores comunes

### Construir el nombre a mano

```ts bad
env.MEEKO_SOCKET.idFromName(`${channel}:${room}`);
```

No hay error, pero es otro objeto: vacío, sin los peers de la sala. Las publicaciones no llegan a nadie.

<!-- no-check -->
```ts good
env.MEEKO_SOCKET.idFromName(socketRoomName(channel, room));
```

## Notas

- **Nombres largos.** Si el nombre supera 1.024 bytes, el runtime no expone `ctx.id.name`: la sala lo toma de su primera conexión o publicación.
- **Estabilidad.** Las salas desplegadas se localizan por este nombre: un Worker propio que lo calcule de otra forma habla con objetos vacíos.

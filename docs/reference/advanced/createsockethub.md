---
title: createSocketHub
group: advanced
since: 1.0.0
description: Crea el hub de Socket de un host propio, que autoriza los handshakes, acepta las conexiones, valida los eventos y reparte los broadcasts entre salas e instancias.
symbols:
  - "@meekojs/meeko/server#createSocketHub"
types:
  - "@meekojs/meeko/server#SocketHubOptions"
  - "@meekojs/meeko/server#SocketHub"
  - "@meekojs/meeko/server#SocketPeer"
  - "@meekojs/meeko/server#SocketConnection"
related:
  - "@meekojs/meeko/server#createSocketUpgradeHandler"
  - "@meekojs/meeko/server#defineSocketChannel"
  - "@meekojs/meeko/server#LocalSocketPubSub"
  - "@meekojs/meeko/server#RedisSocketPubSub"
  - "@meekojs/meeko/server#createServerApp"
  - docs/framework.md#websocket
  - docs/framework.md#broadcast-y-varias-instancias
---

`createSocketHub` es el núcleo de Socket de Meeko, independiente del transporte. Recibe las definiciones de los canales (`defineSocketChannel`), el gestor de sesiones y los servicios, y valida todo lo que entra y sale: `Origin`, la sesión y la autorización del canal en el handshake, y el evento y su payload contra los schemas en cada mensaje. Aplica los límites de tamaño, de búfer y de cola por peer, y reparte los broadcasts a través de un broker (`LocalSocketPubSub` en una instancia, `RedisSocketPubSub` o Durable Objects en varias).

El hub no abre sockets: el host hace el upgrade HTTP con su runtime y le pasa cada peer conectado. [`createSocketUpgradeHandler`](/docs/reference/createsocketupgradehandler) hace ese puente de forma portable; `createServerApp` crea el hub solo cuando la aplicación tiene canales (`app.socket.hub`).

## Uso

```ts
import { createSocketHub, defineSocketChannel, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";
import type { Schema, SocketPeer } from "@meekojs/meeko/server";

const text: Schema<{ text: string }> = {
  "~standard": {
    version: 1,
    validate: (value) => typeof value === "object" && value !== null && typeof (value as { text?: unknown }).text === "string"
      ? { value: value as { text: string } }
      : { issues: [{ message: "Se esperaba { text }" }] },
  },
};
const chat = defineSocketChannel({
  clientToServer: { message: text },
  serverToClient: { message: text },
  handlers: { message: ({ payload, emit }) => emit("message", { text: payload.text.toUpperCase() }) },
});

const hub = createSocketHub({ channels: { chat }, sessions: new SessionManager({ store: new MemorySessionStore() }), services: {} });

const sent: string[] = [];
const peer: SocketPeer = { send: (message) => { sent.push(message); }, close: () => {} };
const request = new Request("http://localhost/_meeko/socket/chat?room=general", { headers: { origin: "http://localhost" } });
const connection = await hub.accept("chat", request, peer, "general");
await connection.receive(JSON.stringify({ event: "message", payload: { text: "hola" } }));
console.log(sent); // [ '{"event":"message","payload":{"text":"HOLA"}}' ]
```

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `channels` | `Record<string, SocketChannelDefinition>` | obligatorio | Los canales por nombre: el export por defecto de cada `server/socket/<nombre>.ts`. |
| `sessions` | `SessionManager` | obligatorio | Carga la sesión del handshake y cierra el peer si se revoca. |
| `services` | `S` o `(request) => S` | obligatorio | Servicios de los callbacks del canal, compartidos o creados en cada handshake. |
| `allowedOrigins` | `string[]` | ninguno | Orígenes aceptados además del de la propia URL del handshake. |
| `maxMessageBytes` | número | 65 536 | Mensaje entrante o saliente más grande, serializado. Un mensaje entrante mayor cierra con `1009`; un `broadcast` mayor rechaza con `SOCKET_LIMIT_EXCEEDED` (413). |
| `maxBufferBytes` | número | 1 MiB | Bytes salientes pendientes por peer antes de cerrarlo. |
| `maxPendingDeliveries` | número | 256 | Entregas del broker en espera por peer; uno más lento se cierra con `1013`. |
| `sessionRefreshMs` | número | 1000 | Durante cuánto reutilizan las entregas la última lectura de la sesión; `0` la relee en cada entrega. |
| `pubsub` | `SocketPubSub` | `LocalSocketPubSub` | Broker entre instancias. |
| `platform` | `ServerPlatform` | ninguno | Lo que ven los callbacks en `context.platform`. |
| `onDeliveryError` | `(error, { channel, room, event? }) => void` | `console.error` | Entregas fallidas a un peer local, que se cierra. Nunca llega al emisor. |

## Valor devuelto

Un `SocketHub`:

| Método | Descripción |
| --- | --- |
| `preflight(name, request, roomId?)` | Comprueba el canal, `Origin`, la sesión y la autorización antes del upgrade. Rechaza con `ApiError`: `UNKNOWN_SOCKET_CHANNEL` (404), `INVALID_ORIGIN` (403), `401` o `403` del canal. |
| `accept(name, request, peer, roomId?)` | Acepta un peer ya conectado; resuelve con su `SocketConnection` cuando está suscrito a su canal y sala. |
| `broadcast(name, roomId, event, payload)` | Valida el evento con el schema `serverToClient` y lo publica en el broker; cada peer de la sala lo recibe como mucho una vez. |

`SocketConnection` tiene `receive(message)` para cada mensaje del cliente, `emit(event, payload)` y `close(code?, reason?)`. Un mensaje que no es JSON o no tiene `event` y `payload` cierra el peer con `1008` y `receive` rechaza con `INVALID_SOCKET_MESSAGE`.

## Ejemplos

### Broadcast desde una tarea o una API

<!-- no-check -->
```ts
// server/api/maintenance.post.ts
export default defineApiRoute({
  auth: "required",
  body: Notice,
  response: Ok,
  handler: async ({ body }) => {
    await socket.chat.broadcast("general", "message", { text: body.text });
    return { ok: true };
  },
});
```

En una aplicación, el autoimport `socket` envuelve el hub de la aplicación. En un host propio, llama a `hub.broadcast("chat", "general", "message", { text: "Mantenimiento en 5 minutos" })`.

### Varias instancias con Redis

<!-- no-check -->
```ts
import { createClient } from "redis";
import { createSocketHub, RedisSocketPubSub } from "@meekojs/meeko/server";

const publisher = createClient({ url: process.env.REDIS_URL });
const subscriber = publisher.duplicate();
await Promise.all([publisher.connect(), subscriber.connect()]);

const hub = createSocketHub({ channels, sessions, services: {}, pubsub: new RedisSocketPubSub({ publisher, subscriber, prefix: "tienda:prod:socket:" }) });
```

Un `broadcast` en una instancia llega a los peers de la misma sala en todas.

## Errores comunes

### Un payload que no cumple el schema del servidor

```ts bad
await hub.broadcast("chat", "general", "message", { body: "hola" });
```

Rechaza con `ApiError` `INVALID_SOCKET_PAYLOAD` (400) antes de publicar: lo que sale también se valida, para que el cliente reciba siempre lo que su contrato dice.

<!-- no-check -->
```ts good
await hub.broadcast("chat", "general", "message", { text: "hola" });
```

### Un handshake desde otro origen

```ts bad
await hub.preflight("chat", new Request("http://localhost/_meeko/socket/chat", { headers: { origin: "https://otro.example" } }));
```

`ApiError` `INVALID_ORIGIN` (403). El navegador envía `Origin` en los WebSocket, y sin esta comprobación cualquier página podría conectarse con las cookies del usuario.

<!-- no-check -->
```ts good
createSocketHub({ channels, sessions, services: {}, allowedOrigins: ["https://app.example.com"] });
```

### Límites que no son enteros positivos

```ts bad
createSocketHub({ channels, sessions, services: {}, maxMessageBytes: 0 });
```

`RangeError: Invalid socket limits`, al crear el hub.

<!-- no-check -->
```ts good
createSocketHub({ channels, sessions, services: {}, maxMessageBytes: 16 * 1024 });
```

## Notas

- **Portable.** No depende del runtime: los adaptadores de Node, Bun, Deno y Cloudflare usan el mismo hub con su propio WebSocket.
- **Entrega.** Como mucho una vez, sin cola ni reenvío: un peer desconectado pierde los mensajes. Un peer que no lee (búfer lleno o cola del broker llena) se cierra para no frenar al resto de la sala.
- **Sesiones.** La sesión se carga en el handshake; si se revoca, el peer se cierra al momento. La autorización del canal se ejecuta también en cada entrega.
- **Seguridad.** Valida los eventos en las dos direcciones; un mensaje inválido cierra el peer con `1008` sin ejecutar ningún handler.

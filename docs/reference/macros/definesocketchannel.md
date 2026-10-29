---
title: defineSocketChannel
group: macros
since: 1.0.0
description: Declara un canal WebSocket de server/socket con los schemas de cada dirección, sus guardas por sala y evento y los handlers de los mensajes del cliente.
symbols:
  - "@meekojs/meeko/server#defineSocketChannel"
types:
  - "@meekojs/meeko/server#SocketChannelDefinition"
related:
  - "autoimport:socket"
  - "autoimport:useSocket"
  - "@meekojs/meeko/server#defineServerRuntime"
  - "@meekojs/meeko/server#RedisSocketPubSub"
  - docs/framework.md#websocket
  - docs/framework.md#broadcast-desde-el-servidor
  - docs/framework.md#broadcast-y-varias-instancias
---

`defineSocketChannel` declara un canal WebSocket: el export por defecto de `server/socket/<nombre>.ts`. Declara con schemas de `shared/` los eventos que envía el cliente (`clientToServer`) y los que envía el servidor (`serverToClient`), las guardas de la conexión, de cada sala y de cada evento, y los handlers de los mensajes que llegan.

El generador emite un contrato público con los schemas, sin importar los handlers, para `useSocket`, el registro `socket` del navegador y `socket.<canal>.broadcast` del servidor. El hub valida `Origin`, sesión, canal, sala, evento y payload en cada mensaje.

## Uso

<!-- no-check -->
```ts
// shared/schemas/chat.ts
import * as v from "valibot";

export const chatInput = v.object({ text: v.pipe(v.string(), v.minLength(1), v.maxLength(500)) });
export const chatMessage = v.object({ text: v.string(), author: v.string() });
```

<!-- no-check -->
```ts
// server/socket/chat.ts
import { defineSocketChannel } from "@meekojs/meeko/server";
import { chatInput, chatMessage } from "../../shared/schemas/chat";

export default defineSocketChannel({
  clientToServer: { message: chatInput },
  serverToClient: { message: chatMessage },
  auth: "required",
  authorize: ({ context, roomId }) => !!context.session.current && roomId === "general",
  handlers: {
    message: async ({ payload, roomId, context }) => {
      await socket.chat.broadcast(roomId ?? "general", "message", { text: payload.text, author: context.session.current!.id });
    },
  },
});
```

```html
<!-- app/pages/chat.meeko -->
<script lang="ts">
const messages = signal<{ text: string; author: string }[]>([]);
const draft = signal("");
// useSocket sin await sólo existe en el navegador: en SSR no hay conexión.
const chat = typeof window === "undefined" ? undefined : useSocket("chat", { roomId: "general" });
chat?.on("message", (message) => {
  messages.value = [...messages.value, message];
});
async function send(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  await chat?.emit("message", { text: draft.value });
  draft.value = "";
}
</script>

<template>
  <ul aria-live="polite"><li each:of="messages.value" each:as="message">{message.author}: {message.text}</li></ul>
  <form on:submit="send"><input model="draft" aria-label="Mensaje"><button>Enviar</button></form>
</template>
```

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `clientToServer` | `{ [evento]: schema }` | obligatorio | Los eventos que envía el cliente, con schemas de `shared/`. Un payload inválido cierra el canal. |
| `serverToClient` | `{ [evento]: schema }` | obligatorio | Los eventos que envía el servidor, con schemas de `shared/`. |
| `auth` | `"required" \| "optional"` | `"optional"` | `"required"` rechaza la conexión sin sesión: el servidor acepta el upgrade y cierra con `4401`. |
| `authorize` | `({ context, roomId }) => boolean \| Promise<boolean>` | ninguno | Autoriza la conexión a una sala y cada entrega; `false` cierra con `4403`. |
| `authorizeEvent` | `({ event, payload, context, roomId }) => boolean \| Promise<boolean>` | ninguno | Autoriza cada evento entrante. |
| `authorizeSend` | `({ event, payload, context, roomId }) => boolean \| Promise<boolean>` | ninguno | Filtra cada envío a un peer: con `false` no lo recibe y sigue conectado. |
| `handlers` | `{ [evento]: ({ payload, context, roomId, emit }) => void \| Promise<void> }` | ninguno | Un handler por evento del cliente, con el payload ya validado. `emit` responde sólo a ese cliente. |

Cada evento puede escribirse en forma abreviada (`{ message }`) cuando el schema importado se llama como el evento.

## Valor devuelto

La misma definición, con sus tipos inferidos. El hub la usa para validar y despachar; el generador, para el contrato público del canal.

## Ejemplos

### Avisar a una sala desde la API

`socket.<canal>.broadcast(roomId, evento, payload)`, autoimportado en el servidor, publica un evento tipado con el contrato del canal:

<!-- no-check -->
```ts
// server/socket/operations.ts
import { defineSocketChannel } from "@meekojs/meeko/server";
import { kitchenChanged, subscribe } from "../../shared/schemas/operations";

export default defineSocketChannel({
  clientToServer: { subscribe },
  serverToClient: { kitchenChanged },
  auth: "required",
});
```

<!-- no-check -->
```ts
// server/api/orders/[id]/ready.post.ts
import { defineApiRoute } from "@meekojs/meeko/server";
import { orderParams, orderSchema } from "../../../../shared/schemas/order";

export default defineApiRoute({
  params: orderParams,
  response: orderSchema,
  auth: "required",
  handler: async ({ params }) => {
    const order = await markReady(params.id);
    await socket.operations.broadcast(order.kitchenId, "kitchenChanged", { orderId: order.id, status: "ready" });
    return order;
  },
});
```

### Salas por equipo

`authorize` decide quién entra en cada sala; `authorizeEvent`, qué puede enviar:

<!-- no-check -->
```ts
// server/socket/team.ts
import { defineSocketChannel } from "@meekojs/meeko/server";
import { teamEvent, teamUpdate } from "../../shared/schemas/team";

export default defineSocketChannel({
  clientToServer: { teamEvent },
  serverToClient: { teamUpdate },
  auth: "required",
  authorize: async ({ context, roomId }) => !!roomId && (await isMember(context, roomId)),
  authorizeEvent: ({ payload }) => typeof payload === "object" && payload !== null,
  handlers: {
    teamEvent: async ({ payload, roomId }) => {
      if (roomId) await socket.team.broadcast(roomId, "teamUpdate", { kind: payload.kind });
    },
  },
});
```

## Errores comunes

### Un schema fuera de `shared/`

```ts bad
export default defineSocketChannel({
  clientToServer: { message: v.object({ text: v.string() }) },
  serverToClient: { message: chatMessage },
});
```

`meeko check` se detiene con `server\socket\chat.ts: clientToServer.message debe referenciar un schema importado de shared/`. Un schema con `any`, `unknown` o tipos sin resolver da `… debe exponer tipos de entrada y salida de Standard Schema concretos`.

<!-- no-check -->
```ts good
import { chatInput, chatMessage } from "../../shared/schemas/chat";
export default defineSocketChannel({ clientToServer: { message: chatInput }, serverToClient: { message: chatMessage } });
```

### Emitir un payload que no cumple el schema

```ts bad
handlers: { message: async ({ payload, emit }) => emit("message", payload) },
```

Con `chatMessage` exigiendo `author`, `meeko check` da `TS2741: Property 'author' is missing in type '{ text: string; }' but required in type '{ author: string; text: string; }'.`

<!-- no-check -->
```ts good
handlers: { message: async ({ payload, emit }) => emit("message", { text: payload.text, author: "sistema" }) },
```

### Usar `roomId` sin comprobarlo

El cliente puede conectarse sin sala, así que `roomId` es opcional.

```ts bad
authorize: ({ roomId }) => roomId.startsWith("team-"),
```

`meeko check` da `TS18048: 'roomId' is possibly 'undefined'.`

<!-- no-check -->
```ts good
authorize: ({ roomId }) => roomId?.startsWith("team-") ?? false,
```

## Notas

- **Seguridad.** El `Origin` se comprueba antes del upgrade, con `publicOrigin` de `server/runtime.ts` o `MEEKO_PUBLIC_ORIGIN`. `auth` y `authorize` rechazan con los cierres `4401` y `4403`, que el cliente convierte en el estado terminal `"unauthorized"` sin reintentar. Un mensaje entrante inválido cierra el canal.
- **Entrega.** A lo sumo una vez: `emit` del cliente rechaza si está desconectado, sin cola ni reenvío. El hub aplica límites de tamaño de mensaje y de buffer, heartbeat y cierre ordenado.
- **Varias instancias.** `broadcast` publica en el `SocketPubSub` del runtime: en memoria con una instancia, o con `RedisSocketPubSub` (o Durable Objects en Workers) con varias.
- **Adaptadores.** Node usa `ws`, Bun su WebSocket nativo, Deno `Deno.upgradeWebSocket` y Cloudflare Workers un Durable Object con hibernación por sala.
- **SSR.** No se abre ninguna conexión en el servidor. `await useSocket(…)` en el componente divide el setup: el resto se ejecuta sólo en el navegador, con el socket ya abierto, y la plantilla no puede usar lo que se declara después (`MEEK057`), como el manejador que envía. Para un formulario de envío, usa `useSocket` sin `await` tras comprobar `window`, como en el ejemplo.

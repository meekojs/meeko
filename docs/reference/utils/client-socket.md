---
title: socket
group: utils
since: 1.0.0
description: Registro generado de los canales de server/socket, con on y emit tipados en el navegador y broadcast tipado en el servidor.
symbols:
  - "autoimport:socket"
types:
  - "@meekojs/meeko/framework#SocketClient"
  - "@meekojs/meeko/framework#SocketRegistry"
related:
  - "@meekojs/meeko/server#defineSocketChannel"
  - "autoimport:useSocket"
  - "@meekojs/meeko/framework#createSocketClient"
  - "@meekojs/meeko/framework#useSocketClient"
  - "@meekojs/meeko/server#RedisSocketPubSub"
  - docs/framework.md#websocket
  - docs/framework.md#broadcast-desde-el-servidor
---

`socket` es el registro que Meeko genera a partir de los canales de `server/socket`: `server/socket/chat.ts` es `socket.chat`. Los eventos y sus payloads tienen los tipos de los schemas `clientToServer` y `serverToClient` del canal.

Se autoimporta, con dos caras:

- **En el navegador**, `socket.chat` es un cliente WebSocket del canal, con `on(evento, listener)`, `emit(evento, payload)`, `state` y `close()`. La conexión se abre la primera vez que se accede al canal en el navegador.
- **En el servidor** (API, RPC, `<script server>`, middleware y handlers de Socket), desde `1.2`, `socket.chat.broadcast(sala, evento, payload)` publica un evento a una sala, tipado con el contrato del canal.

## Uso

<!-- no-check -->
```ts
// server/api/orders/[id]/ready.post.ts: avisa a la sala de la cocina
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

<!-- no-check -->
```ts
// app/plugins/kitchen.client.ts: escucha en el navegador
import { definePlugin } from "@meekojs/meeko/framework";

export default definePlugin(() => {
  socket.operations.on("kitchenChanged", (change) => console.info(`Pedido ${change.orderId}: ${change.status}`));
});
```

## Parámetros

| Llamada | Parámetros | Descripción |
| --- | --- | --- |
| `socket.<canal>.on(evento, listener)` | un evento de `serverToClient` y `(payload) => void` | En el navegador. El payload llega validado con su schema. |
| `socket.<canal>.emit(evento, payload)` | un evento de `clientToServer` y su entrada | En el navegador. El servidor vuelve a validarlo. |
| `socket.<canal>.broadcast(roomId, evento, payload)` | la sala, un evento de `serverToClient` y su entrada | En el servidor, desde `1.2`. |

## Valor devuelto

En el navegador, cada canal es un `SocketClient`:

| Miembro | Tipo | Descripción |
| --- | --- | --- |
| `on(evento, listener)` | `() => void` | Escucha un evento de `serverToClient`, con su payload validado. Devuelve la función que deja de escuchar. |
| `emit(evento, payload)` | `Promise<void>` | Envía un evento de `clientToServer`. Rechaza si el canal no está abierto: no hay cola ni reenvío. |
| `state` | `ReadonlySignal<"connecting" \| "open" \| "closed" \| "unauthorized" \| …>` | El estado de la conexión. `"unauthorized"` es terminal: el servidor rechazó la sesión. |
| `close()` | `void` | Cierra el canal. |

En el servidor, cada canal tiene `broadcast(roomId, evento, payload): Promise<void>`.

## Ejemplos

### Un indicador de conexión

`state` es una señal, así que la plantilla la sigue:

```html
<script lang="ts">
const state = typeof window === "undefined" ? undefined : socket.chat.state;
</script>

<template>
  <span class="dot" bind:data-state="state?.value ?? 'connecting'">{state?.value ?? "connecting"}</span>
</template>
```

### Escuchar y dejar de escuchar

`socket` es de alcance de aplicación: un listener registrado fuera de un componente se cancela con la función que devuelve `on`.

<!-- no-check -->
```ts
const off = socket.chat.on("message", (message) => console.log(message.author, message.text));
// …
off();
```

En un componente, `useSocket("chat", { roomId })` crea una conexión propia que se cierra al desmontarlo, y es la forma recomendada para las salas.

## Errores comunes

### Un payload que no cumple el schema

```ts bad
await socket.chat.emit("message", { body: "Hola" });
```

`meeko check` da `TS2353: Object literal may only specify known properties, and 'body' does not exist in type '{ text: string; }'.`

<!-- no-check -->
```ts good
await socket.chat.emit("message", { text: "Hola" });
```

### Un canal o un evento que no existen

```ts bad
socket.lobby.emit("message", { text: "x" });
socket.chat.on("typing", () => {});
```

`meeko check` da `TS2339: Property 'lobby' does not exist on type 'SocketRegistry<…>'.` y `TS2345: Argument of type '"typing"' is not assignable to parameter of type '"message"'.`

<!-- no-check -->
```ts good
socket.chat.on("message", (message) => console.log(message.text));
```

## Notas

- **SSR.** Durante el SSR no se abre ninguna conexión. Para escuchar en un componente, `await useSocket(…)` divide el setup y el resto se ejecuta sólo en el navegador.
- **Entrega.** A lo sumo una vez: `emit` rechaza si el canal está desconectado. El cliente se reconecta con retroceso, salvo tras un rechazo de sesión (`"unauthorized"`).
- **Seguridad.** El servidor valida `Origin`, sesión, sala, evento y payload; un mensaje entrante inválido cierra el canal. `broadcast` comprueba el evento y el payload con el contrato, a diferencia de publicar a mano en el `SocketPubSub`.
- **Varias instancias.** `broadcast` publica en el broker del runtime (`socket.pubsub`): en memoria con una instancia; con varias, `RedisSocketPubSub` o los Durable Objects de Workers.
- **Errores.** Un fallo del transporte o de un listener llega al observador de errores de la aplicación (`mountClientApp({ onError })` o el `provideErrorHandler` activo); sin él, a la consola.

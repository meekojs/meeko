---
title: useSocket
group: composables
since: 1.0.0
description: Conecta un componente a un canal de server/socket con sus eventos tipados y cierra la conexión al desmontarlo.
symbols:
  - "autoimport:useSocket"
types:
  - "@meekojs/meeko/framework#SocketClient"
  - "@meekojs/meeko/framework#SocketRegistryOptions"
related:
  - "@meekojs/meeko/framework#useSocketChannel"
  - "@meekojs/meeko/framework#useSocketClient"
  - "autoimport:socket"
  - "@meekojs/meeko/server#defineSocketChannel"
  - "@meekojs/meeko#provideErrorHandler"
  - docs/framework.md#websocket
  - docs/api.md#composables-de-nivel-superior-y-await
---

`useSocket(canal, opciones?)` abre un cliente del canal `canal` de `server/socket`, ligado al componente: los eventos de `emit` y `on` están tipados por los schemas del canal y la conexión se cierra al desmontar el componente. Con `await` en el nivel superior del script, el resto del setup continúa en el navegador cuando el socket ya está abierto.

Lo generan los clientes de la aplicación a partir de los canales de `server/socket` y se autoimporta en los `.meeko`. En un proyecto sin clientes generados, el autoimport es `useSocketClient(url, contrato, opciones)`.

## Uso

```html
<!-- app/pages/chat.meeko -->
<script lang="ts">
const messages = signal<string[]>([]);
const chat = await useSocket("chat", { roomId: "general" });
// Desde aquí, sólo en el navegador y con el socket abierto.
chat.on("message", (message) => { messages.value = [...messages.value, message.text]; });
</script>

<template><p each:of="messages.value" each:as="text">{text}</p></template>
```

El HTML del servidor sale con la lista vacía; al montar, el navegador abre el canal y la continuación se suscribe a los mensajes.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `canal` | nombre de un canal | obligatorio | Uno de los archivos de `server/socket`, como `"chat"`. Un nombre que no existe es un error de tipos. |
| `opciones.roomId` | `string` | ninguna | Sala a la que se une (`?room=`); el canal la recibe en `authorize` y en sus handlers. |
| `opciones.baseUrl` | `string` | el origen del navegador | URL base HTTP(S) o WS(S). |
| `opciones.pathnamePrefix` | `string` | `"/_meeko/socket"` | Prefijo de las rutas de los canales. |
| `opciones.retryMs`, `opciones.maxRetryMs` | `number` | `500`, `30000` | Retroceso de reconexión: el primer retraso se duplica en cada intento hasta el máximo. |
| `opciones.maxMessageBytes` | `number` | 64 KiB | Tamaño máximo de un mensaje entrante. |
| `opciones.onError` | `(error: unknown) => void` | el observador más cercano | Mensajes inválidos, fallos de los listeners y rechazos de autorización. |

## Valor devuelto

Un `SocketClient` del contrato del canal:

| Propiedad | Tipo | Descripción |
| --- | --- | --- |
| `state` | `ReadonlySignal<"connecting" \| "open" \| "closed" \| "unauthorized">` | Estado de la conexión. `"unauthorized"` es terminal: el servidor rechazó la sesión o la autorización y el cliente no reintenta. |
| `emit(evento, datos)` | `Promise<void>` | Valida y envía un evento de `clientToServer`. Rechaza si el socket no está abierto o los datos no son válidos: no hay cola. |
| `on(evento, listener)` | `() => void` | Escucha un evento de `serverToClient` ya validado; devuelve la función que deja de escucharlo. |
| `close()` | `void` | Cierra la conexión y deja de reconectar. |

Con `await`, la promesa resuelve con el cliente cuando su estado es `"open"`.

## Ejemplos

### Enviar y recibir

```html
<script lang="ts">
const draft = signal("");
const messages = signal<{ text: string }[]>([]);
const chat = await useSocket("chat", { roomId: "general" });
chat.on("message", (message) => { messages.value = [...messages.value, message]; });
async function send(): Promise<void> {
  await chat.emit("message", { text: draft.value, roomId: "general" });
  draft.value = "";
}
</script>

<template>
  <p each:of="messages.value" each:as="message">{message.text}</p>
  <input model="draft">
</template>
```

`send` se declara tras el `await`, así que la plantilla no puede usarlo (`MEEK057`): llámalo desde código del navegador, o declara antes del `await` lo que la plantilla necesita.

### Sin `await`, con el estado de la conexión

Desde `1.7`, `useSocket` sin `await` también se puede llamar en el setup de un componente con SSR: en el servidor devuelve un cliente inerte que se queda en `"connecting"`, así que el HTML sale con el estado inicial y el navegador abre la conexión al montar. Hasta `1.6`, en SSR lanzaba un error y había que comprobar `window`. Pinta el estado:

```html
<script lang="ts">
const chat = useSocket("chat", { roomId: "general" });
const online = computed(() => chat.state.value === "open");
const send = (text: string) => chat.emit("message", { text, roomId: "general" });
</script>

<template><span class="dot" bind:data-online="String(online.value)">{online.value ? "Conectado" : "Conectando…"}</span></template>
```

### Un canal con autorización

<!-- no-check -->
```ts
// server/socket/room.ts
import { defineSocketChannel } from "@meekojs/meeko/server";
import { roomMessage } from "../../shared/schemas/room.js";

export default defineSocketChannel({
  clientToServer: { message: roomMessage },
  serverToClient: { message: roomMessage },
  auth: "required",
  authorize: ({ context, roomId }) => !!context.session.current && roomId === context.session.current.data.teamId,
  handlers: { message: async ({ payload, emit }) => emit("message", payload) },
});
```

Si `authorize` devuelve `false`, el cliente pasa a `"unauthorized"`, no reintenta y el observador de errores recibe un `ClientError` `403` (`FORBIDDEN`).

## Errores comunes

### Un canal o un evento que no existe

```ts bad
const chat = await useSocket("chats");
chat.on("mesage", (message) => console.log(message));
```

`meeko check` da `TS2345: Argument of type '"chats"' is not assignable to parameter of type '"chat"'` y, en el evento, `TS2345: Argument of type '"mesage"' is not assignable to parameter of type '"message"'`.

<!-- no-check -->
```ts good
const chat = await useSocket("chat");
chat.on("message", (message) => console.log(message.text));
```

### Usar en la plantilla un nombre declarado tras el `await`

```html bad
<script lang="ts">
const chat = await useSocket("chat", { roomId: "general" });
const messages = signal<string[]>([]);
</script>
<template><p>{messages.value.length}</p></template>
```

`meeko check` da `MEEK057: La plantilla no puede usar messages: se declara en la línea 3, después del primer await de navegador, y sólo existe en el navegador una vez montado el componente. Declara ese nombre antes de ese await`.

```html good
<script lang="ts">
const messages = signal<string[]>([]);
const chat = await useSocket("chat", { roomId: "general" });
</script>
<template><p>{messages.value.length}</p></template>
```

### Contar con que `emit` espere a la conexión

```ts bad
const chat = useSocket("chat");
void chat.emit("message", { text: "Hola", roomId: "general" }); // aún "connecting"
```

`emit` rechaza con `Socket is disconnected` mientras el socket no está abierto: no hay cola ni reenvío. Espera la conexión con `await useSocket(...)` o comprueba `state` antes de enviar.

<!-- no-check -->
```ts good
const chat = await useSocket("chat");
await chat.emit("message", { text: "Hola", roomId: "general" });
```

## Notas

- **SSR.** Nunca abre una conexión en el servidor: desde `1.7` devuelve ahí un cliente inerte en lugar de lanzar `useSocketClient() is only available in the browser`. En el navegador tampoco la abren el render que produce el HTML de un componente antes de montarlo ni las pasadas en seco: ahí devuelve un cliente que se queda en `"connecting"`, cuyo `emit` rechaza; la conexión la abre el montaje, una sola vez.
- **Continuación.** Tras `await useSocket(...)`, el resto del script sólo se ejecuta en el navegador, con el componente montado. Si el socket nunca llega a abrirse, la continuación sigue esperando; si el componente se desmonta mientras espera, no se reanuda.
- **Entrega.** A lo sumo una vez: sin cola ni reenvío. Los mensajes entrantes inválidos cierran el canal. La reconexión usa retroceso exponencial.
- **Seguridad.** El servidor comprueba ruta, `Origin` y sesión antes del upgrade, y valida cada evento con sus schemas. Los schemas que ve el cliente vienen de `shared/`.
- **Registro de aplicación.** `socket.chat` es una alternativa con alcance de aplicación, una conexión por aplicación montada; `useSocket` liga la conexión al componente.

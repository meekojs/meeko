---
title: useSocketClient
group: advanced
since: 1.1.0
description: Crea en un componente un cliente Socket con URL y contrato explícitos, que se cierra al desmontar el componente y usa su observador de errores.
symbols:
  - "@meekojs/meeko/framework#useSocketClient"
types:
  - "@meekojs/meeko/framework#SocketClient"
  - "@meekojs/meeko/framework#SocketClientOptions"
related:
  - "@meekojs/meeko/framework#createSocketClient"
  - "autoimport:useSocket"
  - "@meekojs/meeko/framework#useSocketChannel"
  - "@meekojs/meeko#provideErrorHandler"
  - docs/framework.md#clientes-con-url-y-contrato-explícitos
  - docs/framework.md#websocket
---

`useSocketClient` es [`createSocketClient`](/docs/reference/createsocketclient) ligado a un componente: crea el cliente con la URL y el contrato que le pases, lo cierra con `onCleanup` cuando el componente se desmonta (también al cambiar de página) y, sin `onError` propio, informa los fallos al `provideErrorHandler` más cercano o al `onError` de la aplicación.

Es la forma de bajo nivel, para un canal que no es de la propia aplicación o con una URL calculada. Para los canales de `server/socket`, el autoimport `useSocket("chat", opciones)` ya conoce la URL y el contrato generado; no es esta función. Desde `1.1`, `useSocket` de `@meekojs/meeko/framework` es un alias obsoleto de `useSocketClient`.

## Uso

```html
<!-- app/components/Ticker.meeko -->
<script lang="ts">
import { signal } from "@meekojs/meeko";
import { useSocketClient } from "@meekojs/meeko/framework";
import { tickerContract } from "../../shared/ticker";

const price = signal<number | undefined>(undefined);
const ticker = await useSocketClient("wss://precios.example.com/_meeko/socket/ticker?room=EURUSD", tickerContract);
ticker.on("price", (data) => { price.value = data.value; });
</script>

<template>
  <p>EUR/USD: {price.value ?? "…"}</p>
</template>
```

Con `await`, el servidor renderiza el componente hasta esa línea (aquí, `EUR/USD: …`) y el resto del setup continúa en el navegador cuando el socket está abierto.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `url` | texto | obligatorio | URL `ws:` o `wss:` del canal, con `?room=` si hace falta. |
| `contract` | `SocketContract` | obligatorio | Los schemas de cada evento en cada dirección. |
| `options` | `SocketClientOptions` | `{}` | `retryMs`, `maxRetryMs`, `maxMessageBytes`, `webSocketFactory` y `onError`. Sin `onError`, los fallos van al observador de errores del componente. |

## Valor devuelto

El mismo `SocketClient` de `createSocketClient` (`state`, `emit`, `on`, `close`), que se cierra solo al desmontar el componente. Con `await`, la expresión resuelve cuando el socket está abierto.

En un render que sólo produce HTML en el navegador devuelve un cliente inerte, sin conexión, cuyo `emit` rechaza con `Socket is disconnected`.

## Ejemplos

### Un chat con estado de conexión

```html
<!-- app/components/Chat.meeko -->
<script lang="ts">
import { effect, signal, untrack } from "@meekojs/meeko";
import { useSocketClient } from "@meekojs/meeko/framework";
import type { SocketClient } from "@meekojs/meeko/framework";
import { chatContract } from "../../shared/chat";

const props = defineProps<{ room: string }>();
const messages = signal<string[]>([]);
const draft = signal("");
const status = signal("connecting");
const connection: { client?: SocketClient<typeof chatContract> } = {};

async function send() {
  await connection.client?.emit("message", { text: draft.value });
  draft.value = "";
}

const room = untrack(() => props.room);
const chat = await useSocketClient(`wss://chat.example.com/_meeko/socket/chat?room=${encodeURIComponent(room)}`, chatContract, {
  onError: (error) => console.warn("chat", error),
});
connection.client = chat;
effect(() => { status.value = chat.state.value; });
chat.on("message", (data) => { messages.value = [...messages.value, data.text]; });
</script>

<template>
  <p if:when="status.value !== 'open'">Conectando…</p>
  <ul><li each:of="messages.value" each:as="text">{text}</li></ul>
  <form on:submit="(event) => { event.preventDefault(); void send(); }">
    <input model="draft" aria-label="Mensaje">
    <button type="submit">Enviar</button>
  </form>
</template>
```

Todo lo que usa la plantilla (`status`, `messages`, `draft`, `send`) se declara antes del `await`: lo posterior sólo existe en el navegador. `effect` copia el estado del socket a una señal que el servidor ya conoce.

### Una página que sólo existe en el navegador

```html
<!-- app/pages/live.meeko -->
<script server lang="ts">
export const route = definePage({ render: "client" });
</script>

<script lang="ts">
import { useSocketClient } from "@meekojs/meeko/framework";
import { feedContract } from "../../shared/feed";

const feed = useSocketClient("wss://feed.example.com/_meeko/socket/feed", feedContract);
</script>

<template><p>Estado: {feed.state.value}</p></template>
```

Con `render: "client"` el setup nunca se ejecuta en el servidor, así que el `await` no hace falta.

## Errores comunes

### Emitir sin `await` durante el setup

```html bad
<script lang="ts">
import { useSocketClient } from "@meekojs/meeko/framework";
const chat = useSocketClient("wss://example.com/_meeko/socket/chat", chatContract);
void chat.emit("message", { text: "hola" });
</script>
```

El setup se ejecuta también en el servidor, donde no hay sockets. Desde `1.7`, ahí `useSocketClient` devuelve un cliente inerte que se queda en `"connecting"` (hasta `1.6`, el render fallaba con `useSocketClient() is only available in the browser`), así que la llamada ya no rompe el SSR; pero en el servidor, y en el navegador antes de que el socket se abra, `emit` rechaza con `Socket is disconnected`.

```html good
<script lang="ts">
import { useSocketClient } from "@meekojs/meeko/framework";
const chat = await useSocketClient("wss://example.com/_meeko/socket/chat", chatContract);
void chat.emit("message", { text: "hola" });
</script>
```

Con `await`, el servidor se detiene antes de esa línea y el navegador continúa el setup con el socket abierto.

### Usar en la plantilla el cliente de después del `await`

```html bad
<script lang="ts">
const chat = await useSocketClient("wss://example.com/_meeko/socket/chat", chatContract);
</script>

<template><p>{chat.state.value}</p></template>
```

`meeko check` da `MEEK057: La plantilla no puede usar chat: se declara en la línea 2, después del primer await de navegador, y sólo existe en el navegador una vez montado el componente. Declara ese nombre antes de ese await`.

```html good
<script lang="ts">
import { effect, signal } from "@meekojs/meeko";
const status = signal("connecting");
const chat = await useSocketClient("wss://example.com/_meeko/socket/chat", chatContract);
effect(() => { status.value = chat.state.value; });
</script>

<template><p>{status.value}</p></template>
```

### Llamarlo fuera del setup

```ts bad
button.addEventListener("click", () => {
  const chat = useSocketClient(url, chatContract);
});
```

Fuera del setup de un componente no hay a quién ligar la limpieza: el cliente se cierra y la llamada lanza `onCleanup() requires an active component root`.

<!-- no-check -->
```ts good
button.addEventListener("click", () => {
  const chat = createSocketClient(url, chatContract);
  window.addEventListener("pagehide", () => chat.close(), { once: true });
});
```

### Confundirlo con el autoimport `useSocket`

```html bad
<script lang="ts">
const chat = useSocketClient("chat");
</script>
```

`useSocketClient` recibe una URL y un contrato: `meeko check` da `TS2554: Expected 2-3 arguments, but got 1`. El autoimport `useSocket` es el que recibe el nombre del canal y conoce su contrato.

```html good
<script lang="ts">
const chat = useSocket("chat");
</script>
```

## Notas

- **SSR.** Nunca abre una conexión en el servidor. Sin `await`, desde `1.7` la llamada devuelve en SSR un cliente inerte: `state` se queda en `"connecting"`, `on` no registra nada y `emit` rechaza; hasta `1.6`, lanzaba. Con `await`, el servidor renderiza lo anterior a esa línea y el navegador continúa; diseña la plantilla para que el primer render no dependa del socket.
- **Ciclo de vida.** El cliente se cierra con el componente: al navegar a otra página, al quitarlo con `if:when` o al cerrar la aplicación con `dispose()`.
- **Errores.** Sin `onError`, los mensajes inválidos y los fallos de los listeners llegan al `provideErrorHandler` más cercano o al `onError` de `mountClientApp`, como los demás errores del componente.
- **Obsoleto.** `useSocket` importado de `@meekojs/meeko/framework` es un alias de esta función desde `1.1` y desaparece en `2.0`; el editor lo marca tachado. El autoimport `useSocket(canal)` de las aplicaciones no está obsoleto.

---
title: useSocketChannel
group: composables
since: 1.0.0
description: Abre por nombre un canal de un registro de contratos Socket, ligado al componente; es la función con la que se genera el autoimport useSocket.
symbols:
  - "@meekojs/meeko/framework#useSocketChannel"
types:
  - "@meekojs/meeko/framework#SocketClient"
  - "@meekojs/meeko/framework#SocketRegistryOptions"
related:
  - "autoimport:useSocket"
  - "@meekojs/meeko/framework#useSocketClient"
  - "@meekojs/meeko/framework#createSocketClient"
  - "@meekojs/meeko/framework#createSocketRegistry"
  - "@meekojs/meeko/server#defineSocketChannel"
  - docs/framework.md#websocket
  - docs/framework.md#clientes-con-url-y-contrato-explícitos
---

`useSocketChannel(contratos, nombre, opciones?)` construye la URL del canal `nombre` (`/_meeko/socket/<nombre>`, con `?room=` si hay `roomId`) y abre un cliente ligado al componente con el contrato de ese canal, como [`useSocketClient`](/docs/reference/usesocketclient). Es la pieza con la que los clientes generados definen el autoimport [`useSocket`](/docs/reference/use-socket):

<!-- no-check -->
```ts
export const useSocket = (name, options) => useSocketChannel(socketContracts, name, options);
```

En una aplicación del framework usa `useSocket`. `useSocketChannel` sirve para un host propio o un paquete que tiene su propio registro de contratos (`socketContracts`) y quiere el mismo comportamiento. Se importa de `@meekojs/meeko/framework`.

## Uso

<!-- no-check -->
```ts
// src/socket.ts, en un host propio
import { useSocketChannel } from "@meekojs/meeko/framework";
import type { SocketRegistryOptions } from "@meekojs/meeko/framework";
import { socketContracts } from "./socket-contracts.js";

export const useChannel = <K extends keyof typeof socketContracts & string>(name: K, options?: SocketRegistryOptions) =>
  useSocketChannel(socketContracts, name, options);
```

```html
<script lang="ts">
import { useChannel } from "../socket";
const prices = useChannel("prices", { roomId: "eur" });
prices.on("price", (price) => console.log(price.symbol, price.value));
</script>
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `contracts` | `Record<string, SocketContract>` | obligatorio | Contratos públicos por nombre de canal, como el `socketContracts` que genera Meeko en `.meeko/generated/socket-contracts.ts`. |
| `name` | clave de `contracts` | obligatorio | Canal que se abre. Un nombre que no está en el registro es un error de tipos y, en ejecución, `TypeError: Unknown socket channel: <nombre>`. |
| `options` | `SocketRegistryOptions` | `{}` | `roomId`, `baseUrl` (por defecto, el origen del navegador), `pathnamePrefix` (`"/_meeko/socket"`), `retryMs`, `maxRetryMs`, `maxMessageBytes`, `webSocketFactory` y `onError`. |

## Valor devuelto

El `SocketClient` del contrato `contracts[name]`: `state`, `emit`, `on` y `close`, cerrado al desmontar el componente. En SSR y en un render que sólo produce HTML devuelve un cliente inerte que no conecta: se queda en `"connecting"`, `on` no registra nada y `emit` rechaza. Hasta `1.6`, en SSR lanzaba `Error: useSocketClient() is only available in the browser`.

## Ejemplos

### Un registro de canales de un paquete

<!-- no-check -->
```ts
// packages/live/src/index.ts
import { useSocketChannel } from "@meekojs/meeko/framework";
import type { SocketRegistryOptions } from "@meekojs/meeko/framework";
import { liveContracts } from "./contracts.js";

/** Abre un canal en vivo del servicio, con la URL de su servidor. */
export function useLive<K extends keyof typeof liveContracts & string>(name: K, options: SocketRegistryOptions = {}) {
  return useSocketChannel(liveContracts, name, { baseUrl: "wss://live.example.com", ...options });
}
```

### Elegir el canal en tiempo de ejecución

Con un nombre que llega como texto, compruébalo antes: TypeScript ya no puede.

<!-- no-check -->
```ts
import { useSocketChannel } from "@meekojs/meeko/framework";

declare const socketContracts: Record<"chat" | "presence", Parameters<typeof useSocketChannel>[0][string]>;

function isChannel(name: string): name is "chat" | "presence" {
  return Object.hasOwn(socketContracts, name);
}

export function openChannel(name: string) {
  if (!isChannel(name)) throw new TypeError(`Canal desconocido: ${name}`);
  return useSocketChannel(socketContracts, name);
}
```

## Errores comunes

### Un canal que no está en el registro

```ts bad
const feed = useSocketChannel(socketContracts, "feeds" as never);
```

En ejecución lanza `TypeError: Unknown socket channel: feeds`. Con un nombre literal, el error es de tipos; no lo tapes con una conversión:

<!-- no-check -->
```ts good
const feed = useSocketChannel(socketContracts, "feed");
```

### Esperar la conexión con `await`

```ts bad
// En el <script> de un componente
const chat = await useSocketChannel(socketContracts, "chat");
```

El compilador sólo divide el setup en el `await` de `useElementRef`, `useSocket` o `useSocketClient`: éste es `MEEK055`. Sin `await`, la llamada vale también en SSR (desde `1.7`, allí devuelve un cliente inerte; hasta `1.6`, lanzaba `useSocketClient() is only available in the browser`). Para continuar el setup con el socket abierto, use el autoimport `useSocket` con `await`:

<!-- no-check -->
```ts good
const chat = await useSocket("chat");
```

### Usarlo fuera de un componente

```ts bad
// app/utils/live.ts, evaluado al importar
export const chat = useSocketChannel(socketContracts, "chat");
```

El cliente necesita la raíz de un componente para cerrarse al desmontarlo: fuera de ella lo cierra en seguida y lanza `Error: onCleanup() requires an active component root`. Para un cliente independiente, que cierras tú, usa `createSocketClient`, o el registro `socket` de la aplicación:

<!-- no-check -->
```ts good
import { createSocketClient } from "@meekojs/meeko/framework";
export const chat = createSocketClient("wss://example.com/_meeko/socket/chat", socketContracts.chat);
```

### Esperarlo con `await`

```ts bad
const chat = await useSocketChannel(socketContracts, "chat");
```

`meeko check` da `MEEK055: El await de nivel superior sólo se admite sobre useElementRef, useSocket, useSocketClient, useApi, useRpcQuery; mueve el resto del trabajo asíncrono a una función o a onMounted`. En una aplicación, usa el autoimport `useSocket`, que sí admite `await`:

<!-- no-check -->
```ts good
const chat = await useSocket("chat");
```

## Notas

- **Igual que `useSocket`, salvo `await`.** Mismo ciclo de vida (ligado al componente, cerrado al desmontar) y mismo comportamiento en SSR y en las pasadas en seco. El compilador sólo divide el setup en un `await` de `useElementRef`, `useSocket` o `useSocketClient`; cualquier otro `await` de nivel superior, también el de `useSocketChannel` o una función propia que lo envuelve, es `MEEK055`.
- **URL.** `baseUrl` admite `http(s):` y `ws(s):`; por defecto, el origen del navegador, que es el que el servidor comprueba en `Origin`.
- **Contratos públicos.** Los contratos sólo llevan los schemas de `shared/`: nunca importan los handlers del servidor.

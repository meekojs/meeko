---
title: createSocketRoomClass
group: adapters
since: 1.0.0
description: Crea la clase Durable Object que aloja los WebSockets de una sala de Socket en Cloudflare Workers, con la API de hibernación, reconstrucción al despertar y límites por sala.
symbols:
  - "@meekojs/meeko/cloudflare#createSocketRoomClass"
types:
  - "@meekojs/meeko/cloudflare#SocketRoomOptions"
  - "@meekojs/meeko/cloudflare#MeekoSocketRoomClass"
related:
  - "@meekojs/meeko/cloudflare#createWorker"
  - "@meekojs/meeko/cloudflare#DurableObjectSocketPubSub"
  - "@meekojs/meeko/cloudflare#socketRoomName"
  - "@meekojs/meeko/server#defineSocketChannel"
  - docs/framework.md#socket-y-durable-objects
  - docs/framework.md#cloudflare-workers
---

`createSocketRoomClass(app, DurableObject, options)` devuelve la clase que se exporta desde el Worker para las salas de Socket: un Durable Object por par canal/sala. La sala acepta los WebSockets con la API de hibernación (`ctx.acceptWebSocket`), así que las conexiones inactivas no mantienen el objeto en memoria; al despertar, reconstruye cada conexión desde su *attachment* y el hub vuelve a autorizarla. Reparte las publicaciones a sus peers en orden.

`DurableObject` se importa de `cloudflare:workers` y se pasa como argumento para que `@meekojs/meeko/cloudflare` se pueda cargar fuera de Workers. `app` es la misma aplicación o fábrica que recibe `createWorker`.

## Uso

<!-- no-check -->
```ts
import { DurableObject } from "cloudflare:workers";
import { createSocketRoomClass, createWorker } from "@meekojs/meeko/cloudflare";

export default createWorker(createCloudflareApp);
export const MeekoSocketRoom = createSocketRoomClass(createCloudflareApp, DurableObject, {
  keepHeaders: ["accept-language"],
  rebuildTimeoutMs: 2_000,
});
```

El nombre exportado debe ser el de `wrangler.jsonc` (`server.socketClassName`, `MeekoSocketRoom` por defecto).

## Parámetros

`createSocketRoomClass(app, base, options?)`:

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `maxMessageBytes` | `number` | `socket.maxMessageBytes` de la aplicación, o `65536` | Mensaje entrante más grande; los mayores cierran el peer con `1009`. |
| `autoResponse` | `{ request, response } \| false` | `{ request: "ping", response: "pong" }` | Mensaje de texto que el runtime responde sin despertar el objeto. Los pings del protocolo se responden siempre. |
| `keepHeaders` | `readonly string[]` | `[]` | Cabeceras adicionales (en minúsculas) que el canal ve en `context.request` antes y después de hibernar. Por defecto se conservan la cookie de sesión, `origin` y `authorization`; `"cookie"` conserva la cabecera completa. |
| `maxPendingPublications` | `number` | `1024` | Publicaciones sin entregar que acepta una sala; por encima, `publish` rechaza con `SOCKET_BACKLOG_EXCEEDED` (`503`). |
| `rebuildTimeoutMs` | `number` | `5000` | Milisegundos que las publicaciones esperan a las conexiones que se reconstruyen tras hibernar. |
| `onError` | `(error, requestId) => void` | el de la aplicación | Observador de errores. |

## Valor devuelto

Una clase `MeekoSocketRoomClass<Env>` (`new (ctx, env) => MeekoSocketRoom`) con `fetch` (el upgrade que reenvía `createWorker`), `webSocketMessage`, `webSocketClose`, `webSocketError` y `meekoPublish` (el RPC de `DurableObjectSocketPubSub`).

## Ejemplos

### La declaración en `wrangler.jsonc`

```jsonc
// .meeko/output/cloudflare/wrangler.jsonc (generado; no lo edite)
{
  "main": "./worker.js",
  "durable_objects": { "bindings": [{ "name": "MEEKO_SOCKET", "class_name": "MeekoSocketRoom" }] },
  "migrations": [{ "tag": "meeko-socket-v1", "new_sqlite_classes": ["MeekoSocketRoom"] }]
}
```

Con un historial `migrations` propio en `server.wrangler`, añada esa entrada al final; el build se detiene con `server.wrangler.migrations does not create the Socket room class …; append { "tag": "meeko-socket-v1", "new_sqlite_classes": ["MeekoSocketRoom"] } at the end of server.wrangler.migrations` si falta.

### Un idioma por conexión que sobrevive a la hibernación

<!-- no-check -->
```ts
// worker.ts
export const MeekoSocketRoom = createSocketRoomClass(createCloudflareApp, DurableObject, { keepHeaders: ["accept-language"] });
```

<!-- no-check -->
```ts
// server/socket/support.ts
export default defineSocketChannel({
  clientToServer: { ask },
  serverToClient: { answer },
  handlers: {
    ask: async ({ payload, context, emit }) => {
      const language = context.request.headers.get("accept-language") ?? "es";
      await emit("answer", await answerIn(language, payload));
    },
  },
});
```

### Salas muy activas

<!-- no-check -->
```ts
export const MeekoSocketRoom = createSocketRoomClass(createCloudflareApp, DurableObject, {
  maxPendingPublications: 4096,
  maxMessageBytes: 8 * 1024,
  autoResponse: false,
});
```

Un Durable Object ejecuta su código en un solo hilo: reparta el tráfico en varias salas (por documento, por grupo) antes que subir los límites de una sala global.

## Errores comunes

### No pasar la clase `DurableObject`

```ts bad
export const MeekoSocketRoom = createSocketRoomClass(createCloudflareApp, undefined as never);
```

`TypeError: createSocketRoomClass requires DurableObject from cloudflare:workers`. Pásela desde el Worker.

<!-- no-check -->
```ts good
import { DurableObject } from "cloudflare:workers";
export const MeekoSocketRoom = createSocketRoomClass(createCloudflareApp, DurableObject);
```

### Cabeceras en mayúsculas

```ts bad
createSocketRoomClass(createCloudflareApp, DurableObject, { keepHeaders: ["Accept-Language"] });
```

`TypeError: keepHeaders must list lowercase header names: Accept-Language`.

<!-- no-check -->
```ts good
createSocketRoomClass(createCloudflareApp, DurableObject, { keepHeaders: ["accept-language"] });
```

### Un límite no válido

```ts bad
createSocketRoomClass(createCloudflareApp, DurableObject, { maxPendingPublications: 0, rebuildTimeoutMs: -1 });
```

`RangeError: Invalid maxPendingPublications`; con un valor válido, `RangeError: rebuildTimeoutMs must be a non-negative number`.

<!-- no-check -->
```ts good
createSocketRoomClass(createCloudflareApp, DurableObject, { maxPendingPublications: 512, rebuildTimeoutMs: 2_000 });
```

### Una cookie que no cabe en el *attachment*

```ts bad
createSocketRoomClass(createCloudflareApp, DurableObject, { keepHeaders: ["cookie"] }); // cookies de analítica de 20 KB
```

Cloudflare limita el *attachment* de un WebSocket a 16.384 bytes. Meeko estima el tamaño antes de aceptar: el upgrade responde `431` y `onError` recibe el error, en lugar de abrir una conexión que se cerraría con `1011`.

<!-- no-check -->
```ts good
createSocketRoomClass(createCloudflareApp, DurableObject); // sólo la cookie de sesión de Meeko
```

## Notas

- **Seguridad.** Por defecto sólo se guarda la cookie con el nombre de `SessionManager`, no el resto de la cabecera `Cookie`; al despertar, el hub vuelve a autorizar cada conexión con ella y cierra con `4401` o `4403` si ya no vale.
- **Entrega.** Cada publicación llega a los peers ya suscritos; una conexión que aún se autoriza no retrasa a las demás. Al despertar, las publicaciones esperan a las reconstruidas como mucho `rebuildTimeoutMs`.
- **Búfer.** Los WebSockets de Workers no informan de `bufferedAmount`: `socket.maxBufferBytes` no se aplica en las salas; `maxMessageBytes` y `maxPendingDeliveries` sí.
- **Configuración.** El Worker que genera `meeko build` usa los valores por defecto; para cambiar `keepHeaders`, `maxPendingPublications` o `rebuildTimeoutMs` hace falta un Worker propio.
- **Fallos al despertar.** Si la aplicación no puede crearse, la sala notifica el error y cierra con `1011` el WebSocket que la despertó.

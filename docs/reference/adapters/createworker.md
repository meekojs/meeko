---
title: createWorker
group: adapters
since: 1.0.0
description: Sirve una aplicación de Meeko desde un Worker de módulo de Cloudflare, creada una vez por aislado con los bindings, con los upgrades de Socket reenviados al Durable Object de su sala.
symbols:
  - "@meekojs/meeko/cloudflare#createWorker"
types:
  - "@meekojs/meeko/cloudflare#CloudflareWorkerOptions"
  - "@meekojs/meeko/cloudflare#CloudflareApp"
  - "@meekojs/meeko/cloudflare#CloudflareAppContext"
related:
  - "@meekojs/meeko/cloudflare#createSocketRoomClass"
  - "@meekojs/meeko/cloudflare#DurableObjectSocketPubSub"
  - "@meekojs/meeko/cloudflare#D1SessionDriver"
  - "@meekojs/meeko/cloudflare#createCloudflareAssetReader"
  - "@meekojs/meeko/cloudflare#createCloudflarePrerenderSource"
  - "config:server"
  - docs/framework.md#cloudflare-workers
  - docs/framework.md#socket-y-durable-objects
---

`createWorker(app, options)` devuelve el handler `{ fetch }` de un Worker de módulo (`export default createWorker(…)`). `app` puede ser una aplicación ya creada o, lo habitual, una fábrica `({ env, platform }) => ServerApp` que se ejecuta en el primer evento de cada aislado con los bindings del Worker; si falla, el siguiente evento la reintenta. Cada petición recibe `platform.waitUntil` sobre `ctx.waitUntil` y la IP de `CF-Connecting-IP`.

Los upgrades de Socket se comprueban en el propio Worker (ruta, `Origin`, sesión y autorización del canal) y se reenvían al Durable Object de su sala, `env.MEEKO_SOCKET.idFromName(canal + "\0" + sala)`. Es lo que genera `meeko build --adapter cloudflare` en `.meeko/output/cloudflare/worker.js`.

## Uso

<!-- no-check -->
```ts
// worker.ts de un Worker propio
import { DurableObject } from "cloudflare:workers";
import { createCloudflareAssetReader, createCloudflarePrerenderSource, createSocketRoomClass, createWorker } from "@meekojs/meeko/cloudflare";
import type { CloudflareAppContext } from "@meekojs/meeko/cloudflare";

function createCloudflareApp({ env, platform }: CloudflareAppContext<Env>) {
  return createApp({
    production: true,
    platform,
    assets: createCloudflareAssetReader({ binding: env.ASSETS, assets: manifest.assets ?? {} }),
    prerender: createCloudflarePrerenderSource({ binding: env.ASSETS }),
  });
}

export default createWorker(createCloudflareApp);
export const MeekoSocketRoom = createSocketRoomClass(createCloudflareApp, DurableObject);
```

## Parámetros

`createWorker(app, options?)`:

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `app` | `ServerApp` o `({ env, platform }) => ServerApp \| Promise<ServerApp>` | obligatorio | La aplicación, o su fábrica, que se ejecuta una vez por aislado. |
| `options.socketBinding` | `string` | `"MEEKO_SOCKET"` | El binding del namespace de Durable Objects de las salas. |
| `options.publicOrigin` | `string` | el de la aplicación, o el origen de la URL enrutada | Origen de la comprobación de `Origin` en HTTP y Socket. |
| `options.onError` | `(error, requestId) => void` | el de la aplicación | Observador de los fallos, también del arranque. |

## Valor devuelto

Un `CloudflareWorker` con `fetch(request, env, ctx)`:

| Caso | Respuesta |
| --- | --- |
| La fábrica falla | La respuesta de `errorResponse` (`500 INTERNAL_ERROR`) y el error en `onError` o en la consola (`[meeko] application startup failed <id>`). |
| La aplicación declara canales con un broker que no es `DurableObjectSocketPubSub` | La fábrica se rechaza: `500` en cada petición hasta corregirlo. |
| Upgrade rechazado por ruta, `Origin` o canal | `400`, `403` o `404` por HTTP. |
| Upgrade rechazado por sesión o autorización | `101` y cierre inmediato con `4401` o `4403`, sin despertar el Durable Object. |
| Upgrade aceptado | La respuesta del Durable Object de la sala. |
| Cualquier otra | `app.fetch`, con los assets y las páginas prerenderizadas del binding. |

## Ejemplos

### Configuración del adaptador

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  server: {
    adapter: "cloudflare",
    name: "mi-app",
    compatibilityDate: "2026-10-19",
    wrangler: {
      d1_databases: [{ binding: "DB", database_name: "mi-app", database_id: "<id>" }],
      vars: { MEEKO_PUBLIC_ORIGIN: "https://mi-app.example" },
    },
  },
});
```

```sh
npx meeko build --adapter cloudflare
npx meeko preview --adapter cloudflare   # wrangler dev sobre la salida
npx wrangler deploy --config .meeko/output/cloudflare/wrangler.jsonc
```

### El runtime con D1 y las salas

```ts
// server/runtime.ts
import { D1SessionDriver, DurableObjectSocketPubSub } from "@meekojs/meeko/cloudflare";
import type { D1DatabaseLike, DurableObjectNamespaceLike } from "@meekojs/meeko/cloudflare";
import { defineServerRuntime, MemorySessionStore, SessionManager, SqlSessionStore } from "@meekojs/meeko/server";

interface Env { readonly DB?: D1DatabaseLike; readonly MEEKO_SOCKET?: DurableObjectNamespaceLike }

export default defineServerRuntime<Env>(({ env, production, prerendering }) => {
  // El prerender se ejecuta en Node, sin bindings.
  const store = prerendering || !env.DB ? new MemorySessionStore() : new SqlSessionStore(new D1SessionDriver(env.DB, { rateLimitTable: "meeko_rate_limits" }));
  return {
    sessions: new SessionManager({ production: production && !prerendering, store }),
    ...(env.MEEKO_SOCKET ? { socket: { pubsub: new DurableObjectSocketPubSub(env.MEEKO_SOCKET) } } : {}),
  };
});
```

### Un binding de salas con otro nombre

<!-- no-check -->
```ts
export default createWorker(createCloudflareApp, { socketBinding: "ROOMS", publicOrigin: "https://mi-app.example" });
```

`wrangler.jsonc` debe declarar `ROOMS` hacia la clase de `createSocketRoomClass`.

## Errores comunes

### Sesiones con `MEEKO_REDIS_URL`

```ts bad
// server/runtime.ts sin sessions, con MEEKO_REDIS_URL en vars
export default defineServerRuntime(() => ({}));
```

Cada petición responde `500` y el arranque informa `MEEKO_REDIS_URL needs TCP connections, which Cloudflare Workers do not offer: return a SessionManager with SqlSessionStore(new D1SessionDriver(env.DB)), or RedisSessionStore over the Upstash REST API, from server/runtime.ts`. Sin la variable, `Production requires a persistent session store: …`.

<!-- no-check -->
```ts good
export default defineServerRuntime<Env>(({ env, production, prerendering }) => ({
  sessions: new SessionManager({ store: new SqlSessionStore(new D1SessionDriver(env.DB!)), production: production && !prerendering }),
}));
```

### Otro broker de Socket

```ts bad
socket: { pubsub: new RedisSocketPubSub({ publisher, subscriber, prefix: "app:" }) }
```

La aplicación no se crea: `Socket channels on Cloudflare Workers require DurableObjectSocketPubSub: leave runtime.socket.pubsub unset and bind MEEKO_SOCKET, or set it to new DurableObjectSocketPubSub(env.MEEKO_SOCKET). Other brokers cannot reach the WebSockets held by Socket room Durable Objects.`

<!-- no-check -->
```ts good
socket: env.MEEKO_SOCKET ? { pubsub: new DurableObjectSocketPubSub(env.MEEKO_SOCKET) } : {}
```

### Canales sin el binding de las salas

```text bad
wrangler.jsonc propio sin el binding MEEKO_SOCKET
```

Cada upgrade responde `500` y `onError` recibe `Socket channels require the MEEKO_SOCKET Durable Object binding`. El `wrangler.jsonc` que genera `meeko build` lo declara siempre.

```text good
npx wrangler deploy --config .meeko/output/cloudflare/wrangler.jsonc
```

### Un `publicOrigin` sin esquema

```ts bad
createWorker(createCloudflareApp, { publicOrigin: "mi-app.example" });
```

`TypeError: Invalid publicOrigin: mi-app.example`, al cargar el módulo.

<!-- no-check -->
```ts good
createWorker(createCloudflareApp, { publicOrigin: "https://mi-app.example" });
```

## Notas

- **Una aplicación por aislado.** La fábrica se ejecuta en el primer evento y se reutiliza; `server/runtime.ts` recibe como `env` el objeto de bindings y `platform` vale `"cloudflare"`.
- **Assets.** `wrangler.jsonc` declara `run_worker_first: true`: todas las peticiones llegan al Worker, que sólo sirve los archivos del manifiesto, con el `ETag` y la caché de los demás adaptadores. Las páginas prerenderizadas viven en `assets/_meeko/prerender/` y nunca se sirven como archivos.
- **IP.** `CF-Connecting-IP`, que el borde de Cloudflare fija y sustituye: un cliente no puede falsificarla. `MEEKO_TRUST_PROXY` sólo hace falta si hay otro proxy delante.
- **Fallos del proceso.** No hay proceso que cerrar: los rechazos sin manejar del aislado llegan a `onError`, y una excepción sólo hace fallar su petición o su tarea de `waitUntil`.
- **CSP y cabeceras (desde 1.7).** `server.contentSecurityPolicy` y `server.headers` se aplican igual que en Node; los hashes y el nonce usan Web Crypto.
- **Sin TCP.** Ni Redis por TCP ni `@meekojs/meeko/password` (scrypt agota la memoria del aislado): sesiones en D1 o Upstash, y la verificación de contraseñas en un servicio externo.
- **Conformidad.** La variante `workerd` construye con este adaptador y lo ejecuta con el runtime local de Wrangler, con D1 y Durable Objects en memoria, hibernación forzada incluida.

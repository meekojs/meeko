---
title: createServerApp
group: advanced
since: 1.0.0
description: Crea la aplicación de servidor portable (páginas, API, RPC, Socket, assets, sesiones y middleware) a partir del manifiesto del build y un cargador de módulos.
symbols:
  - "@meekojs/meeko/server#createServerApp"
types:
  - "@meekojs/meeko/server#ServerAppOptions"
  - "@meekojs/meeko/server#ServerApp"
  - "@meekojs/meeko/server#AppManifest"
related:
  - "@meekojs/meeko/node#serveNode"
  - "@meekojs/meeko/bun#createBunServer"
  - "@meekojs/meeko/deno#serveDeno"
  - "@meekojs/meeko/cloudflare#createWorker"
  - "@meekojs/meeko/server#defineServerRuntime"
  - "@meekojs/meeko/server#createFrameworkHandler"
  - docs/framework.md#runtime-de-servidor
  - docs/framework.md#build-despliegue-y-verificación
---

`createServerApp` es la aplicación de servidor de Meeko: recibe el manifiesto que fija el build (rutas, endpoints, canales, middleware y assets), un cargador que devuelve cada módulo por su clave y el runtime de `server/runtime.ts`, y devuelve un objeto con `fetch(request)` que atiende todo: middleware de servidor, archivos públicos, páginas prerenderizadas, SSR, payloads de navegación, API, RPC y el hub de Socket. Llama una vez a la fábrica del runtime y, si no declara `sessions`, crea las de por defecto.

Es lo que usan las entradas que genera `meeko build` para Node, Bun, Deno y Cloudflare. Se usa directamente para alojar la aplicación en un host propio o para probarla sin red, llamando a `app.fetch`.

## Uso

<!-- no-check -->
```ts
// server/host.ts, empaquetado con Vite y el plugin meeko()
import { createServerApp } from "@meekojs/meeko/server";
import { serveNode } from "@meekojs/meeko/node";
import { appName, load, loadRedis, manifest, plugins, runtime } from "virtual:meeko-server-app";

const app = await createServerApp({ manifest, load, runtime, plugins, appName, loadRedis, production: true });
const server = await serveNode(app, { port: 3000, handleSignals: true });
console.log(server.url);
```

`virtual:meeko-server-app` es el módulo que el plugin de Vite genera con el manifiesto y los cargadores del proyecto; es lo mismo que importa `.meeko/generated/entry-server.ts`.

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `manifest` | `AppManifest` | obligatorio | Rutas, endpoints, canales, middleware, assets del cliente y, desde `1.7`, `contentSecurityPolicy`, `headers` y `buildId`. Debe tener `version: 1`. |
| `load` | `(key) => Promise<unknown>` | obligatorio | Devuelve el módulo de cada clave del manifiesto (páginas, sidecars, API, RPC, canales, middleware). El servidor nunca lee el disco por su cuenta. |
| `production` | `boolean` | obligatorio | Exige un almacén de sesiones persistente, oculta los detalles de los errores y activa la caché de páginas y la CSP. |
| `runtime` | export por defecto de `server/runtime.ts` | ninguno | La fábrica de `defineServerRuntime`: servicios, sesiones, Socket, `onError`, `close`… |
| `platform` | `ServerPlatform` | `{ name: "node", env: {} }` | Nombre, entorno y `waitUntil` del runtime; lo recibe la fábrica y cada petición sin plataforma propia. |
| `assets` | `AssetReader` | ninguno | Lector de los archivos públicos del build, como `createNodeAssetReader`. Sin él, sólo responde la aplicación. |
| `prerender` | `PrerenderSource` | ninguno | Las páginas prerenderizadas, que se sirven desde su archivo sin loader ni render. |
| `document` | `DocumentOptions` | ninguno | HTML de confianza para `<head>` y el final de `<body>`, y el nonce del host. |
| `publicOrigin` | origen | `runtime.publicOrigin` | Origen público con el que se comprueba `Origin`. Sólo `http:` o `https:`. |
| `plugins` | `PluginRegistration[]` | ninguno | Los plugins de `app/plugins` y de los módulos, que se ejecutan en cada petición de página. |
| `appName`, `loadRedis` | | ninguno | El nombre de `package.json`, para el prefijo Redis por defecto, y el import del paquete `redis` para `MEEKO_REDIS_URL`. |
| `prerendering` | `boolean` | `false` | Lo activa `meeko build` al prerenderizar: sesiones en memoria aunque sea producción. |
| `defaultSocketPubSub` | `SocketPubSub` | `LocalSocketPubSub` | Broker de Socket si el runtime no declara ninguno. |

## Valor devuelto

Una promesa de `ServerApp`:

| Miembro | Descripción |
| --- | --- |
| `fetch(request, platform?)` | Atiende una petición y siempre resuelve con un `Response`. Una URL sin ruta, sin página de error, es `404 Not Found` en texto. |
| `socket` | `{ hub, pathnamePrefix, maxMessageBytes?, pubsub?, sessionCookieName? }` si la aplicación tiene canales; lo usa el adaptador para el upgrade. |
| `manifest` | El manifiesto recibido. |
| `publicOrigin` | El origen público resuelto, o `undefined`. |
| `reportError(error, requestId, info?)` | Envía un fallo del transporte al mismo observador que los de las peticiones. |
| `close()` | Espera las tareas de `waitUntil` y cierra sesiones y recursos del runtime. |

Rechaza con `TypeError` si el manifiesto es de otra versión (`Unsupported Meeko application manifest; rebuild the application`), falta el cargador (`createServerApp requires a module loader`), `publicOrigin` no es HTTP(S) o el runtime devuelve algo que no es un objeto o unas `sessions` que no son un `SessionManager`; y con `Error` en producción sin almacén persistente.

## Ejemplos

### Una aplicación mínima, sin red

```ts
import { createServerApp, defineApiRoute } from "@meekojs/meeko/server";
import type { AppManifest, Schema } from "@meekojs/meeko/server";

const health: Schema<{ ok: boolean }> = {
  "~standard": { version: 1, validate: (value) => ({ value: value as { ok: boolean } }) },
};
const modules: Record<string, unknown> = {
  "/server/api/health.get.ts": { default: defineApiRoute({ response: health, handler: () => ({ ok: true }) }) },
};
const manifest: AppManifest = {
  version: 1,
  routes: [],
  routeMiddleware: [],
  serverMiddleware: [],
  server: {
    api: [{ kind: "api", file: "/server/api/health.get.ts", pathname: "/api/health", method: "GET", clientKey: "health" }],
    rpc: [],
    socket: [],
  },
  client: { entry: "/assets/entry.js", css: [], preload: [] },
};

const app = await createServerApp({ manifest, load: async (key) => modules[key], production: false });
const response = await app.fetch(new Request("http://localhost/api/health"));
console.log(response.status, await response.json()); // 200 { ok: true }
await app.close();
```

Un `POST /api/health` responde `405` con `Allow: GET`, y `/otra` responde `404 Not Found`.

### Probar el build de Node sin abrir un puerto

<!-- no-check -->
```ts
// tests/smoke.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createNodeApp } from "../.meeko/output/node/index.mjs";

test("la portada responde", async () => {
  const app = await createNodeApp();
  const response = await app.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }));
  assert.equal(response.status, 200);
  await app.close();
});
```

`createNodeApp` del build llama a `createServerApp` con el manifiesto, los assets y las páginas prerenderizadas del build. Como es producción, necesita `MEEKO_REDIS_URL` o `sessions` en `server/runtime.ts`.

### Un host con su propio nonce

<!-- no-check -->
```ts
const app = await createServerApp({
  manifest, load, runtime, production: true,
  document: {
    nonce: (request) => request.headers.get("x-csp-nonce") ?? undefined,
    bodyEnd: ({ nonce }) => `<script nonce="${nonce ?? ""}" src="/analytics.js" defer></script>`,
  },
});
```

Con `server.contentSecurityPolicy` (desde `1.7`), Meeko genera un nonce por respuesta él mismo; `DocumentOptions.nonce` sólo hace falta cuando el host fija la CSP.

## Errores comunes

### Producción sin sesiones persistentes

```ts bad
const app = await createServerApp({ manifest, load, production: true });
```

Rechaza con `Production requires a persistent session store: set MEEKO_REDIS_URL (with the redis package installed), or return { sessions } with a persistent SessionStore from server/runtime.ts`.

<!-- no-check -->
```ts good
const app = await createServerApp({ manifest, load, runtime, production: true, platform: { name: "node", env: process.env } });
```

Con `MEEKO_REDIS_URL` en `platform.env` (y `loadRedis`), o con `sessions` en el runtime.

### Un manifiesto de otra versión de Meeko

```ts bad
import manifest from "./old-build/manifest.json";
await createServerApp({ manifest, load, production: false });
```

`TypeError: Unsupported Meeko application manifest; rebuild the application`. El manifiesto y el runtime deben venir del mismo `@meekojs/meeko`.

<!-- no-check -->
```ts good
// vuelve a ejecutar meeko build y usa el manifiesto nuevo
const app = await createServerApp({ manifest, load, production: false });
```

### Unas `sessions` que no son un `SessionManager`

```ts bad
const runtime = () => ({ sessions: new MemorySessionStore() });
```

`TypeError: server/runtime.ts must return { sessions: SessionManager } or omit sessions`: el almacén va dentro del gestor.

<!-- no-check -->
```ts good
const runtime = defineServerRuntime(() => ({ sessions: new SessionManager({ store: new MemorySessionStore() }) }));
```

## Notas

- **Portable.** Sólo usa Web APIs (`Request`, `Response`, Web Crypto) y `node:async_hooks`: la misma aplicación funciona en Node, Bun, Deno y Workers con el adaptador de cada uno.
- **Cierre.** `close()` espera las tareas de `waitUntil` y cierra el runtime; no cierra el servidor HTTP ni las conexiones Socket, que son del adaptador. `serveNode({ handleSignals: true })` lo hace todo en orden.
- **Cookies y cachés.** Toda respuesta con `Set-Cookie` y un `Cache-Control` `public` sale como `private, no-store` y sin `ETag`, para que ninguna caché compartida guarde la cookie.
- **CSP.** Desde `1.7`, con `manifest.contentSecurityPolicy`, cada respuesta en producción lleva su política: hashes en las páginas prerenderizadas, un nonce en SSR y `default-src 'none'` en el JSON. En desarrollo no se aplica.
- **Errores.** Los fallos de las peticiones van al `onError` del runtime (o a la consola, con el `requestId`); en producción, el navegador nunca recibe la traza.

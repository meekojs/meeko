---
title: meeko start
group: commands
since: 1.0.0
description: Arranca el servidor de producción de Node con la salida de meeko build, sin Vite ni las fuentes de la aplicación.
symbols:
  - "cli:start"
related:
  - "cli:build"
  - "cli:preview"
  - "@meekojs/meeko/node#serveNode"
  - "@meekojs/meeko/server#createServerApp"
  - docs/framework.md#build-despliegue-y-verificación
  - docs/framework.md#sesiones-sin-configuración
  - docs/framework.md#csp-y-cabeceras-en-los-adaptadores-con-servidor
---

`meeko start` importa `.meeko/output/node/index.mjs`, el servidor que escribe [`meeko build`](/docs/reference/meeko-build) con el adaptador `node`, y lo arranca: SSR, API, RPC, Socket, los archivos de `client/` y las páginas de `prerender/`, con sesiones, cierre ordenado y, desde `1.7`, la CSP y las cabeceras de `server`. No compila nada ni lee `app/`, `server/` o `meeko.config.ts`: sirve el build tal como quedó.

Es lo mismo que `node .meeko/output/node/index.mjs`; la CLI sólo añade la lectura del `.env` del proyecto y un mensaje claro si falta el build.

## Uso

```sh
meeko build
meeko start
```

```text
http://localhost:4173
```

El starter lo declara como `"start": "meeko start ."`, así que en el servidor basta con `npm start`.

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `[directorio]` | ruta | `.` | Raíz del proyecto, que contiene `.meeko/output/node/` y el `.env`. |
| `MEEKO_PORT` (o `PORT`) | número | `server.port` del build, o `4173` | Puerto HTTP. `PORT` vale siempre, porque lo inyectan muchas plataformas. |
| `MEEKO_HOST` | texto | `server.host` del build, o `127.0.0.1` | Dirección. Usa `0.0.0.0` para aceptar tráfico de otras máquinas (un contenedor, por ejemplo). |
| `MEEKO_PUBLIC_ORIGIN` | origen | ninguno | Origen público HTTPS tras un proxy, para las comprobaciones de `Origin` de HTTP y Socket. |
| `MEEKO_REDIS_URL` | URL | ninguna | Redis de las sesiones si `server/runtime.ts` no declara `sessions`. Necesita el paquete `redis` instalado. |
| `MEEKO_SESSION_TTL`, `MEEKO_SESSION_SAMESITE` | texto | `7d`, `Lax` | Duración y `SameSite` de las sesiones por defecto. |
| `MEEKO_TRUST_PROXY` | número o `true` | ninguno | Proxies de confianza para `X-Forwarded-For` (rate limit, `clientAddress`). |

`start` no admite banderas ni más argumentos: `meeko start . extra` termina con `Argumento de más para start: extra`.

## Resultado

- **En la salida estándar**, la URL para abrirla, como `http://localhost:4173`: desde `1.7.1`, loopback (`127.0.0.1`, `::1`) y todas las interfaces (`0.0.0.0`, `::`) se muestran como `localhost`, aunque el servidor escuche en la dirección configurada. Con `0.0.0.0` o `::` siguen líneas `Red: http://<IP>:4173` con las direcciones de red. La primera línea es siempre la URL local, sola, para los scripts que la leen.
- **El proceso** sigue en marcha hasta `SIGINT` o `SIGTERM`, que cierran Socket, HTTP, las tareas de `waitUntil` y el runtime, por ese orden. Las respuestas abiertas tienen `shutdownTimeout` milisegundos (10 000 por defecto) para terminar.
- **Las respuestas** llevan los assets con `ETag` (y `immutable` los que tienen hash), las páginas prerenderizadas desde su archivo y, desde `1.7`, `Content-Security-Policy` y las cabeceras de `server.headers`.

## Ejemplos

### Detrás de un proxy HTTPS

```sh
MEEKO_HOST=127.0.0.1 MEEKO_PORT=3000 \
MEEKO_PUBLIC_ORIGIN=https://tienda.example.com \
MEEKO_REDIS_URL=rediss://user:pass@redis.example.com:6380 \
MEEKO_TRUST_PROXY=1 \
meeko start
```

El proxy (nginx, Caddy) termina TLS y reenvía a `127.0.0.1:3000`. Sin `MEEKO_PUBLIC_ORIGIN`, las mutaciones que llegan con `Origin: https://tienda.example.com` se rechazan.

### En un contenedor

```dockerfile
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY .meeko/output/node ./.meeko/output/node
ENV MEEKO_HOST=0.0.0.0
CMD ["npx", "meeko", "start"]
```

Sólo hace falta la carpeta del build y las dependencias de producción, entre ellas `@meekojs/meeko` (y `redis` si lo usas). Sin `MEEKO_HOST=0.0.0.0`, el servidor escucha en el `127.0.0.1` del contenedor y no es accesible desde fuera.

### Un host propio con la salida del build

```js
// server.mjs
import { createNodeApp } from "./.meeko/output/node/index.mjs";
import { serveNode } from "@meekojs/meeko/node";

const app = await createNodeApp();
const server = await serveNode(app, { host: "0.0.0.0", port: 8080, handleSignals: true });
console.log(server.url);
```

`index.mjs` exporta `start()`, que es lo que llama `meeko start`, y `createNodeApp()`, para quien necesita su propio servidor HTTP.

### Sesiones persistentes declaradas en el runtime

<!-- no-check -->
```ts
// server/runtime.ts
import { createClient } from "redis";
import { defineServerRuntime, RedisSessionStore, SessionManager } from "@meekojs/meeko/server";

export default defineServerRuntime(async ({ env, production, prerendering }) => {
  const redis = createClient({ url: env.REDIS_URL });
  await redis.connect();
  return {
    sessions: new SessionManager({ store: new RedisSessionStore(redis, { prefix: "tienda:prod:session:" }), production: production && !prerendering }),
    close: async () => { await redis.quit(); },
  };
});
```

Con `sessions` en el runtime, `MEEKO_REDIS_URL` deja de leerse: el runtime decide.

## Errores comunes

### Ejecutarlo sin `meeko build`

```sh bad
meeko start
```

```text
No hay build de producción en C:\proyectos\tienda\.meeko\output\node\index.mjs; ejecuta meeko build
```

`.meeko/` no se versiona: en un despliegue nuevo, o tras `meeko clean`, no hay build. Construir con otro adaptador (`--adapter bun`) tampoco escribe `.meeko/output/node/`.

```sh good
meeko build && meeko start
```

### Producción sin sesiones persistentes

El starter no necesita `server/runtime.ts` en desarrollo, porque las sesiones viven en memoria. En producción, `meeko start` se niega a arrancar con memoria:

```sh bad
meeko start
```

```text
Production requires a persistent session store: set MEEKO_REDIS_URL (with the redis package installed), or return { sessions } with a persistent SessionStore from server/runtime.ts
```

El proceso termina con código `1` antes de escuchar.

```sh good
MEEKO_REDIS_URL=redis://127.0.0.1:6379 meeko start
```

O declara `sessions` en `server/runtime.ts` con `RedisSessionStore`, `SqlSessionStore` u otro store persistente.

### Usarlo con el adaptador `static`

```sh bad
# server: { adapter: "static" } en meeko.config.ts
meeko build && meeko start
```

`meeko start sirve el build de Node; el adaptador static genera archivos para un hosting estático: usa meeko preview`.

```sh good
meeko build && meeko preview
```

### La ruta de otro directorio

```sh bad
# desde la raíz del monorepo
meeko start
```

`start` busca el build en `./.meeko/output/node/index.mjs` del directorio que recibe y responde `No hay build de producción en C:\monorepo\.meeko\output\node\index.mjs; ejecuta meeko build`, aunque el build de la aplicación exista en otra carpeta.

```sh good
meeko start apps/tienda
```

## Notas

- **Sin TypeScript ni Vite.** El build de Node no los carga en ejecución; necesita Node 24 y `node_modules` con `@meekojs/meeko`. Para no depender de `node_modules`, construye con `--adapter bun` o `--adapter deno`.
- **Variables al arrancar.** `MEEKO_HOST`, `MEEKO_PORT` y `MEEKO_PUBLIC_ORIGIN` se leen al arrancar, así que el mismo build sirve para varios entornos. `HOST` y `PUBLIC_ORIGIN` siguen valiendo hasta `2.0`, con un aviso único.
- **`.env`.** `meeko start` lee el `.env` del directorio, como `dev`; `node .meeko/output/node/index.mjs` no lo lee. En producción, prefiere el entorno real o el gestor de secretos de la plataforma; el entorno siempre gana al `.env`.
- **Seguridad.** Pon el servidor detrás de un proxy HTTPS y define `MEEKO_PUBLIC_ORIGIN`. Las páginas llevan la CSP de `server.contentSecurityPolicy` desde `1.7`; antes de `1.7`, sólo el adaptador `static` la aplicaba.
- **Windows y POSIX.** En Windows, `Ctrl+C` envía `SIGINT` y el cierre es ordenado; un gestor de servicios que mata el proceso no lo es. En POSIX, `SIGTERM` (el de `docker stop` y systemd) cierra ordenadamente.
- **Rendimiento.** Las páginas prerenderizadas se leen del disco una vez y se sirven desde memoria con su `ETag` y su `304`; los assets con hash llevan `cache-control: public, max-age=31536000, immutable`.

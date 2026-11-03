---
title: meeko start
group: commands
since: 1.0.0
description: Starts the Node production server using meeko build output, without Vite or application sources.
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
source-hash: eb7a059992b846304a24d1480d2bf3b0b24b0bf09c748102b72857285af0ba37
---

`meeko start` imports `.meeko/output/node/index.mjs`, the server written by [`meeko build`](/en/docs/reference/meeko-build) with the `node` adapter, and starts it: SSR, API, RPC, Socket, files from `client/` and pages from `prerender/`, with sessions, graceful shutdown and, since `1.7`, the CSP and headers from `server`. It does not compile anything or read `app/`, `server/` or `meeko.config.ts`: it serves the build as written.

It is the same as `node .meeko/output/node/index.mjs`; the CLI only adds reading the project's `.env` and a clear message if the build is missing.

## Usage

```sh
meeko build
meeko start
```

```text
http://localhost:4173
```

The starter declares it as `"start": "meeko start ."`, so `npm start` is enough on the server.

## Options

| Option                                        | Type                           | Default                                   | Description                                                                                                                                          |
| --------------------------------------------- | ------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[directorio]`                                | path                           | `.`                                       | Project root, containing `.meeko/output/node/` and `.env`.                                                                                           |
| `MEEKO_PORT` (or `PORT`)                      | number                         | the build's `server.port`, or `4173`      | HTTP port. `PORT` always works because many platforms inject it.                                                                                     |
| `MEEKO_HOST`                                  | string                         | the build's `server.host`, or `127.0.0.1` | Address. Use `0.0.0.0` to accept traffic from other machines (a container, for example).                                                             |
| `MEEKO_PUBLIC_ORIGIN`                         | origin                         | none                                      | Public HTTPS origin behind a proxy, for HTTP and Socket `Origin` checks.                                                                             |
| `MEEKO_REDIS_URL`                             | URL                            | none                                      | Session Redis if `server/runtime.ts` does not declare `sessions`. Requires the `redis` package installed.                                            |
| `MEEKO_SESSION_TTL`, `MEEKO_SESSION_SAMESITE` | string                         | `7d`, `Lax`                               | Lifetime and `SameSite` of default sessions.                                                                                                         |
| `MEEKO_TRUST_PROXY`                           | number, `true` or `cloudflare` | none                                      | Trusted proxies for `X-Forwarded-For` (rate limiting, `clientAddress`). Since `1.8`, `cloudflare` reads `CF-Connecting-IP` behind Cloudflare Tunnel. |
| `MEEKO_TRUSTED_PROXIES`                       | comma-separated CIDR or IP     | loopback and private networks             | Since `1.8`, with `MEEKO_TRUST_PROXY=cloudflare`: networks for `cloudflared` and proxies, the only ones whose `CF-Connecting-IP` is read.            |

`start` accepts no flags or additional arguments: `meeko start . extra` exits with `Argumento de más para start: extra`.

## Result

- **On stdout**, the URL to open, such as `http://localhost:4173`: since `1.7.1`, loopback (`127.0.0.1`, `::1`) and all interfaces (`0.0.0.0`, `::`) display as `localhost`, although the server listens on the configured address. With `0.0.0.0` or `::`, lines `Red: http://<IP>:4173` follow with network addresses. The first line is always the local URL alone, for scripts that read it.
- **The process** keeps running until `SIGINT` or `SIGTERM`, which close Socket, HTTP, `waitUntil` tasks and the runtime, in that order. Open responses have `shutdownTimeout` milliseconds (10,000 by default) to finish.
- **Responses** carry assets with `ETag` (and `immutable` for hashed ones), prerendered pages from their files and, since `1.7`, `Content-Security-Policy` and `server.headers` headers. **They are not compressed:** see the next example.

## Examples

### Behind an HTTPS proxy

```sh
MEEKO_HOST=127.0.0.1 MEEKO_PORT=3000 \
MEEKO_PUBLIC_ORIGIN=https://tienda.example.com \
MEEKO_REDIS_URL=rediss://user:pass@redis.example.com:6380 \
MEEKO_TRUST_PROXY=1 \
meeko start
```

The proxy (nginx, Caddy) terminates TLS and forwards to `127.0.0.1:3000`. Without `MEEKO_PUBLIC_ORIGIN`, mutations arriving with `Origin: https://tienda.example.com` are rejected.

`meeko start` does not compress: in production, that proxy or a CDN must do it. See [Build, deployment and verification](/en/docs/framework#build-deployment-and-verification).

### In a container

```dockerfile
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY .meeko/output/node ./.meeko/output/node
ENV MEEKO_HOST=0.0.0.0
CMD ["npx", "meeko", "start"]
```

Only the build folder and production dependencies are needed, including `@meekojs/meeko` (and `redis` if you use it). Without `MEEKO_HOST=0.0.0.0`, the server listens on the container's `127.0.0.1` and is inaccessible from outside.

### A custom host using build output

```js
// server.mjs
import { createNodeApp } from "./.meeko/output/node/index.mjs";
import { serveNode } from "@meekojs/meeko/node";

const app = await createNodeApp();
const server = await serveNode(app, { host: "0.0.0.0", port: 8080, handleSignals: true });
console.log(server.url);
```

`index.mjs` exports `start()`, called by `meeko start`, and `createNodeApp()`, for those needing their own HTTP server.

### Persistent sessions declared in the runtime

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

With `sessions` in the runtime, `MEEKO_REDIS_URL` is no longer read: the runtime decides.

## Common mistakes

### Running it without `meeko build`

```sh bad
meeko start
```

```text
No hay build de producción en C:\proyectos\tienda\.meeko\output\node\index.mjs; ejecuta meeko build
```

`.meeko/` is not versioned: on a new deployment, or after `meeko clean`, there is no build. Building with another adapter (`--adapter bun`) does not write `.meeko/output/node/` either.

```sh good
meeko build && meeko start
```

### Production without persistent sessions

The starter does not need `server/runtime.ts` in development because sessions live in memory. In production, `meeko start` refuses to start with memory:

```sh bad
meeko start
```

```text
Production requires a persistent session store: set MEEKO_REDIS_URL (with the redis package installed), or return { sessions } with a persistent SessionStore from server/runtime.ts
```

The process exits with code `1` before listening.

```sh good
MEEKO_REDIS_URL=redis://127.0.0.1:6379 meeko start
```

Or declare `sessions` in `server/runtime.ts` with `RedisSessionStore`, `SqlSessionStore` or another persistent store.

### Using it with the `static` adapter

```sh bad
# server: { adapter: "static" } en meeko.config.ts
meeko build && meeko start
```

`meeko start sirve el build de Node; el adaptador static genera archivos para un hosting estático: usa meeko preview`.

```sh good
meeko build && meeko preview
```

### The path of another directory

```sh bad
# desde la raíz del monorepo
meeko start
```

`start` looks for the build in `./.meeko/output/node/index.mjs` under the given directory and responds with `No hay build de producción en C:\monorepo\.meeko\output\node\index.mjs; ejecuta meeko build`, even if the application build exists elsewhere.

```sh good
meeko start apps/tienda
```

## Notes

- **No TypeScript or Vite.** The Node build does not load them at runtime; it needs Node 24 and `node_modules` with `@meekojs/meeko`. To avoid depending on `node_modules`, build with `--adapter bun` or `--adapter deno`.
- **Startup variables.** `MEEKO_HOST`, `MEEKO_PORT` and `MEEKO_PUBLIC_ORIGIN` are read on startup, so the same build works for multiple environments. `HOST` and `PUBLIC_ORIGIN` remain supported until `2.0`, with a one-time warning.
- **`.env`.** `meeko start` reads the directory's `.env`, like `dev`; `node .meeko/output/node/index.mjs` does not. In production, prefer the actual environment or the platform's secret manager; the environment always takes precedence over `.env`.
- **Security.** Put the server behind an HTTPS proxy and set `MEEKO_PUBLIC_ORIGIN`. Pages carry the CSP from `server.contentSecurityPolicy` since `1.7`; before `1.7`, only the `static` adapter applied it.
- **Windows and POSIX.** On Windows, `Ctrl+C` sends `SIGINT`, and shutdown is graceful; a service manager that kills the process is not graceful. On POSIX, `SIGTERM` (from `docker stop` and systemd) shuts down gracefully.
- **Performance.** Prerendered pages are read from disk once and served from memory with their `ETag` and `304`; hashed assets carry `cache-control: public, max-age=31536000, immutable`.

---
title: SessionManager
group: server
since: 1.0.0
description: Gestor de las sesiones de la aplicación, con cookies opacas HttpOnly, rotación y revocación por familia, y comprobación de Origin y CSRF en las mutaciones autenticadas.
symbols:
  - "@meekojs/meeko/server#SessionManager"
types:
  - "@meekojs/meeko/server#SessionOptions"
  - "@meekojs/meeko/server#SessionStore"
  - "@meekojs/meeko/server#SessionRecord"
related:
  - "@meekojs/meeko/server#SessionHandle"
  - "@meekojs/meeko/server#MemorySessionStore"
  - "@meekojs/meeko/server#RedisSessionStore"
  - "@meekojs/meeko/server#SqlSessionStore"
  - "@meekojs/meeko/server#SessionSecurityError"
  - "@meekojs/meeko/server#defineServerRuntime"
  - docs/framework.md#sesiones-y-seguridad
  - docs/framework.md#sesiones-sin-configuración
  - docs/framework.md#autenticación
---

`SessionManager` es el gestor de sesiones de una aplicación de Meeko. Guarda las sesiones en un `SessionStore` y las identifica con una cookie opaca (`__Host-meeko.sid` por defecto) `HttpOnly`, host-only, `Secure` y `SameSite=Lax`. En cada petición, `load` lee la cookie y devuelve el `SessionHandle` que llega a páginas, API, RPC y Socket como `context.session`; en las mutaciones con cookie, `assertMutationAllowed` comprueba `Origin` y el token `x-meeko-csrf`.

Se declara en `sessions` de `server/runtime.ts`. Desde `1.2` es opcional: sin él, Meeko crea uno en memoria en desarrollo y en Redis con `MEEKO_REDIS_URL` en producción (véase [Sesiones sin configuración](/docs/framework#sesiones-sin-configuración)). Un `SessionManager` propio siempre gana.

## Uso

<!-- no-check -->
```ts
// server/runtime.ts
import { createClient } from "redis";
import { defineServerRuntime, RedisSessionStore, SessionManager } from "@meekojs/meeko/server";

export default defineServerRuntime(async ({ env, production, prerendering }) => {
  const redis = createClient({ url: env.MEEKO_REDIS_URL });
  await redis.connect();
  return {
    sessions: new SessionManager({
      store: new RedisSessionStore(redis, { prefix: "tienda:prod:session:" }),
      production: production && !prerendering,
    }),
    close: async () => { await redis.quit(); },
  };
});
```

`production && !prerendering`: durante el prerender de `meeko build` la fábrica también se ejecuta, sin tráfico de clientes, y ahí no hace falta un store persistente.

## Parámetros

`new SessionManager(options)` recibe un objeto `SessionOptions<T>`:

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `store` | `SessionStore<T>` | obligatorio | Dónde viven las sesiones: `MemorySessionStore`, `RedisSessionStore`, `SqlSessionStore` o uno propio. |
| `production` | `boolean` | `false` | Exige un store con `persistent: true`, `replace` y `revokeFamily`; si no, el constructor lanza. Desactiva además los avisos de desarrollo. |
| `ttlMs` | `number` | `604800000` (7 días) | Duración por defecto de cada sesión, un entero positivo de milisegundos. `session.create(data, { ttlMs })` la sustituye para una sesión. |
| `secure` | `boolean` | `true` | Atributo `Secure` de la cookie. Sin él, el nombre por defecto pasa a `meeko.sid`. |
| `sameSite` | `"Lax" \| "Strict" \| "None"` | `"Lax"` | Atributo `SameSite`. `"None"` exige `secure`. |
| `cookieName` | `string` | `"__Host-meeko.sid"`, o `"meeko.sid"` sin `secure` | Nombre de la cookie: letras, dígitos, `_`, `.` y `-`. Un nombre `__Host-…` exige `secure`. |
| `allowedOrigins` | `readonly string[]` | `[]` | Orígenes, además del propio, aceptados en las mutaciones autenticadas, en `origin: "required"` y en `session.create()`. |

## Valor devuelto

Una instancia con estos miembros:

| Miembro | Tipo | Descripción |
| --- | --- | --- |
| `store` | `SessionStore<T>` | El store de las opciones. |
| `ttlMs` | `number` | La duración por defecto. |
| `cookieName` | `string` | El nombre de la cookie. |
| `allowedOrigins` | `readonly string[]` | Los orígenes adicionales. |
| `load(request)` | `Promise<SessionHandle<T>>` | Lee la cookie de la petición y devuelve su handle, sin sesión si falta, no es válida o caducó. La primera llamada se suscribe a las revocaciones del store y espera la confirmación; si falla, rechaza y la siguiente lo reintenta. |
| `assertMutationAllowed(request, session, mutating?)` | `void` | En una mutación con sesión, comprueba que `Origin` sea el propio o uno de `allowedOrigins` y que `x-meeko-csrf` sea el token de la sesión. Lanza `SessionSecurityError` con `INVALID_ORIGIN` o `INVALID_CSRF`. Sin sesión, o en `GET`, `HEAD` y `OPTIONS`, no hace nada. |
| `serializeCookie(value, ttlMs)` | `string` | La cabecera `Set-Cookie` con la política del gestor; `ttlMs` `0` la borra. |
| `rateLimit(key, windowMs)` | `Promise<RateLimitHit>` | Desde `1.2`. Cuenta una petición en la ventana fija `key` con `store.rateLimit`, o en la memoria de la instancia si el store no lo tiene. |
| `close()` | `Promise<void>` | Cancela la suscripción a revocaciones y cierra el store; no cierra clientes externos como el de Redis. |

Con las opciones por defecto, la cookie es `__Host-meeko.sid=<id>; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure`.

## Ejemplos

### Sesiones en SQL con duración y orígenes propios

<!-- no-check -->
```ts
// server/runtime.ts
import { defineServerRuntime, SessionManager, SqlSessionStore } from "@meekojs/meeko/server";
import { createPool, sessionDriver } from "./utils/database";

export default defineServerRuntime(async ({ env, production, prerendering }) => {
  const pool = await createPool(env.DATABASE_URL);
  return {
    sessions: new SessionManager({
      store: new SqlSessionStore(sessionDriver(pool)),
      production: production && !prerendering,
      ttlMs: 12 * 60 * 60 * 1000,                  // 12 horas
      sameSite: "Strict",
      allowedOrigins: ["https://admin.example.com"], // el panel, en otro subdominio
    }),
    close: () => pool.end(),
  };
});
```

### Un tipo de sesión para toda la aplicación

`SessionManager<T>` acepta los datos de la sesión como parámetro de tipo, pero `context.session` sigue a `MeekoSession`. Declárela una vez y los datos quedan tipados en páginas, API, RPC y Socket:

```ts
// server/types/session.d.ts
import type {} from "@meekojs/meeko/server";
declare module "@meekojs/meeko/server" {
  interface MeekoSession { userId: string; role: "owner" | "staff" }
}
```

### Comprobar Origin y CSRF en un host propio

`createServerApp` ya hace esto en API y RPC. Un host que atiende sus propias rutas con la sesión de Meeko lo hace a mano:

```ts
import { MemorySessionStore, SessionManager, SessionSecurityError } from "@meekojs/meeko/server";

const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });

export async function handle(request: Request): Promise<Response> {
  const session = await sessions.load(request);
  try {
    sessions.assertMutationAllowed(request, session);
  } catch (error) {
    if (error instanceof SessionSecurityError) return Response.json({ code: error.code }, { status: 403 });
    throw error;
  }
  const headers = new Headers();
  if (session.cookieHeader) headers.append("set-cookie", session.cookieHeader);
  return new Response(session.current ? "con sesión" : "anónimo", { headers });
}
```

### Despliegue tras un proxy HTTPS

```sh
MEEKO_PUBLIC_ORIGIN=https://tienda.example.com   # el origen que ve el navegador
MEEKO_REDIS_URL=rediss://default:…@redis.example.com:6380
MEEKO_TRUST_PROXY=1                              # Traefik, Caddy o nginx delante
```

El navegador envía `Origin: https://tienda.example.com`; `createServerApp` construye la URL de la petición con `MEEKO_PUBLIC_ORIGIN`, así que `assertMutationAllowed` la acepta aunque el proxy hable HTTP con la aplicación.

## Errores comunes

### Un store en memoria en producción

```ts bad
new SessionManager({ store: new MemorySessionStore(), production: true });
```

El constructor lanza `Error: Persistent session storage with atomic rotation and family revocation is required in production` y la aplicación no arranca. Un store en memoria pierde las sesiones al reiniciar y no se comparte entre instancias.

<!-- no-check -->
```ts good
new SessionManager({ store: new RedisSessionStore(redis, { prefix: "app:prod:session:" }), production: production && !prerendering });
```

### Producción sin `sessions` ni `MEEKO_REDIS_URL`

```text bad
server/runtime.ts sin sessions, y el servidor arranca sin MEEKO_REDIS_URL
```

`meeko start` (y cada adaptador) se detiene con `Production requires a persistent session store: set MEEKO_REDIS_URL (with the redis package installed), or return { sessions } with a persistent SessionStore from server/runtime.ts`. En Workers, `MEEKO_REDIS_URL` tampoco vale: `MEEKO_REDIS_URL needs TCP connections, which Cloudflare Workers do not offer…`.

```text good
MEEKO_REDIS_URL=rediss://…  y  npm install redis
```

### `SameSite=None` o `__Host-` sin `Secure`

```ts bad
new SessionManager({ store, sameSite: "None", secure: false });
```

El constructor lanza `Error: SameSite=None requires Secure`. Con `cookieName: "__Host-sid"` y `secure: false`, `Error: __Host- cookies require Secure`. Los navegadores rechazan esas cookies.

<!-- no-check -->
```ts good
new SessionManager({ store, sameSite: "None", secure: true });
```

### Una duración que no es un entero

```ts bad
new SessionManager({ store, ttlMs: 1.5 * 24 * 60 * 60 * 1000 + 0.5 });
```

`RangeError: Invalid session TTL`. Use un entero positivo de milisegundos.

<!-- no-check -->
```ts good
new SessionManager({ store, ttlMs: 36 * 60 * 60 * 1000 });
```

## Notas

- **Sólo servidor.** Se importa de `@meekojs/meeko/server` y vive en `server/runtime.ts`; la cookie es `HttpOnly`, así que el navegador nunca ve el ID. El token CSRF llega por la meta `meeko-csrf-token` y la cabecera `x-meeko-csrf-token`, y los clientes `api.*` y `rpc.*` lo envían solos.
- **CSRF y Origin.** Las mutaciones (`POST`, `PUT`, `PATCH`, `DELETE`) con cookie exigen un `Origin` permitido y `x-meeko-csrf`; un fallo responde `403 INVALID_ORIGIN` o `403 INVALID_CSRF`. Sin sesión no hay token que comprobar: protege el inicio de sesión con `origin: "required"` (y, aunque falte, `session.create()` ya rechaza un `Origin` ajeno desde `1.2`).
- **Proxies.** El origen propio sale de `publicOrigin` o `MEEKO_PUBLIC_ORIGIN`, nunca de la cabecera `Host`. Si no lo configura tras un proxy que termina TLS, las mutaciones de un navegador fallan con `INVALID_ORIGIN`.
- **Variables de entorno.** `MEEKO_SESSION_TTL` y `MEEKO_SESSION_SAMESITE` sólo ajustan las sesiones que Meeko crea sin configuración; con un `SessionManager` propio no se aplican y Meeko lo avisa una vez.
- **Revocación entre instancias.** Con un store que implementa `subscribeRevocations` (`RedisSessionStore` con `subscriber`), revocar una familia aborta las peticiones y cierra los sockets de esa familia en todas las instancias. `SqlSessionStore` y D1 no notifican: las demás instancias lo detectan al releer la sesión.
- **Cierre.** `close()` libera el store, no el cliente Redis que creó la aplicación: ciérrelo en `close` de `server/runtime.ts`, que se ejecuta después.

> [!IMPORTANT]
> `Secure` exige HTTPS. En desarrollo por HTTP en `localhost` los navegadores aceptan la cookie `Secure`; en otra máquina o tras un proxy sin TLS, use HTTPS en lugar de desactivar `secure`.

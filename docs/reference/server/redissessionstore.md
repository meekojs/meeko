---
title: RedisSessionStore
group: server
since: 1.0.0
description: Store de sesiones persistente en Redis, con caducidad de Redis, rotación y revocación atómicas, revocación entre instancias y contadores de rateLimit compartidos.
symbols:
  - "@meekojs/meeko/server#RedisSessionStore"
types:
  - "@meekojs/meeko/server#RedisSessionStoreOptions"
  - "@meekojs/meeko/server#RedisSessionClient"
  - "@meekojs/meeko/server#RedisSubscriberClient"
related:
  - "@meekojs/meeko/server#SessionManager"
  - "@meekojs/meeko/server#RedisSocketPubSub"
  - "@meekojs/meeko/server#SqlSessionStore"
  - docs/framework.md#sesiones-y-seguridad
  - docs/framework.md#sesiones-sin-configuración
  - docs/framework.md#redis-mediante-la-api-rest-de-upstash
  - docs/framework.md#límite-de-peticiones-ratelimit
---

`RedisSessionStore` guarda cada sesión en Redis con su caducidad (`PX`) y un índice por familia que localiza la sesión activa. `set`, `replace`, `revokeFamily` y `rateLimit` son scripts Lua atómicos, así que varias instancias comparten sesiones, revocaciones y límites sin carreras. Con un `subscriber`, recibe las revocaciones que cualquier instancia publica y aborta en el acto las peticiones y los sockets de esa familia.

Es el store que Meeko crea sin configuración en producción con `MEEKO_REDIS_URL` (Node, Bun y Deno). Escríbalo a mano para un cliente propio, otro prefijo o Upstash en Workers.

## Uso

<!-- no-check -->
```ts
// server/runtime.ts
import { createClient } from "redis";
import { defineServerRuntime, RedisSessionStore, SessionManager } from "@meekojs/meeko/server";

export default defineServerRuntime(async ({ env, production, prerendering }) => {
  const redis = createClient({ url: env.MEEKO_REDIS_URL });
  await redis.connect();
  const subscriber = redis.duplicate(); // conexión dedicada en modo suscriptor
  await subscriber.connect();
  const store = new RedisSessionStore(redis, { prefix: "tienda:prod:session:", subscriber });
  return {
    sessions: new SessionManager({ store, production: production && !prerendering }),
    close: async () => { await subscriber.quit(); await redis.quit(); },
  };
});
```

## Parámetros

`new RedisSessionStore(client, options)`:

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `client` | `RedisSessionClient` | obligatorio | Un cliente conectado con `get`, `set(key, value, { PX })`, `del` y `eval(script, { keys, arguments })`. node-redis 4 o posterior lo cumple tal cual. |
| `options.prefix` | `string` | obligatorio | Prefijo de todas las claves, único por aplicación y entorno: no vacío, sin espacios y terminado en `:`. |
| `options.subscriber` | `RedisSubscriberClient` | ninguno | Conexión dedicada (`client.duplicate()`) para recibir las revocaciones de `<prefix>revoked`. La aplicación la abre y la cierra. |
| `options.closeClient` | `boolean` | `false` | Cierra `client` con `quit()` al cerrar el store, cuando el store es dueño de la conexión. |

## Valor devuelto

Un `SessionStore` persistente (`persistent: true`) con `replace`, `revokeFamily` y `rateLimit`, y `subscribeRevocations` sólo si recibe `subscriber`. Las claves que escribe:

| Clave | Contenido |
| --- | --- |
| `<prefix><id>` | El registro de la sesión en JSON, con `PX` igual a lo que le queda de vida. |
| `<prefix>family:<familyId>` | El ID activo de la familia, con el mismo `PX`. |
| `<prefix>ratelimit:<resumen>` | El contador de una ventana de `rateLimit`; la clave es un SHA-256 de la ruta y el sujeto, nunca la IP en claro. |
| `<prefix>revoked` | Canal pub/sub en el que `revokeFamily` publica el `familyId` en la misma operación atómica que borra la sesión. |

## Ejemplos

### Sesiones y Socket entre instancias con un solo Redis

<!-- no-check -->
```ts
// server/runtime.ts
import { createClient } from "redis";
import { defineServerRuntime, RedisSessionStore, RedisSocketPubSub, SessionManager } from "@meekojs/meeko/server";

export default defineServerRuntime(async ({ env, production, prerendering }) => {
  const redis = createClient({ url: env.MEEKO_REDIS_URL });
  await redis.connect();
  const subscriber = redis.duplicate();
  await subscriber.connect();
  return {
    sessions: new SessionManager({ store: new RedisSessionStore(redis, { prefix: "app:prod:session:", subscriber }), production: production && !prerendering }),
    socket: { pubsub: new RedisSocketPubSub({ publisher: redis, subscriber, prefix: "app:prod:" }) },
    close: async () => { await subscriber.quit(); await redis.quit(); },
  };
});
```

Un mismo `subscriber` sirve a los dos: cada uno se suscribe a sus propios canales.

### Upstash por su API REST, en Cloudflare Workers

Workers no abre conexiones TCP. La API REST de Upstash cubre las cuatro operaciones que el store necesita:

```ts
import { RedisSessionStore } from "@meekojs/meeko/server";
import type { RedisSessionClient } from "@meekojs/meeko/server";

function upstashClient(url: string, token: string): RedisSessionClient {
  const command = async (...args: Array<string | number>): Promise<unknown> => {
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    const body = await response.json() as { result?: unknown; error?: string };
    if (!response.ok || body.error) throw new Error(`Upstash ${String(args[0])} failed: ${body.error ?? response.status}`);
    return body.result;
  };
  return {
    get: async (key) => (await command("GET", key)) as string | null,
    set: (key, value, { PX }) => command("SET", key, value, "PX", PX),
    del: (key) => command("DEL", key),
    eval: (script, { keys, arguments: args }) => command("EVAL", script, keys.length, ...keys, ...args),
  };
}

export const createStore = (env: { UPSTASH_REDIS_REST_URL: string; UPSTASH_REDIS_REST_TOKEN: string }) =>
  new RedisSessionStore(upstashClient(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN), { prefix: "mi-app:prod:" });
```

La API REST no mantiene una suscripción: sin `subscriber`, las demás instancias detectan una revocación al releer la sesión.

### Sin `server/runtime.ts`

```sh
MEEKO_REDIS_URL=rediss://default:…@redis.example.com:6380
MEEKO_REDIS_PREFIX=tienda:prod:   # por defecto, meeko:<name de package.json>:prod:
```

Con `npm install redis` en el proyecto, `meeko start` conecta un cliente y un suscriptor antes de servir tráfico y cierra ambos al detenerse.

## Errores comunes

### Un prefijo sin `:` final

```ts bad
new RedisSessionStore(redis, { prefix: "app" });
```

`TypeError: Session Redis prefix must be nonempty, contain no whitespace, and end with ':'`.

<!-- no-check -->
```ts good
new RedisSessionStore(redis, { prefix: "app:prod:session:" });
```

### El mismo prefijo en dos aplicaciones o entornos

```text bad
staging y producción con prefix: "app:" en el mismo Redis
```

No hay error: las dos aplicaciones leen las sesiones de la otra, un `revokeFamily` publicado en `app:revoked` llega a ambas y comparten los contadores de `rateLimit`. Use un prefijo por aplicación y entorno, y nunca `FLUSHALL` ni `FLUSHDB` en un Redis compartido.

```text good
prefix: "app:staging:session:" y prefix: "app:prod:session:"
```

### Usar la conexión normal como `subscriber`

```ts bad
new RedisSessionStore(redis, { prefix: "app:prod:session:", subscriber: redis });
```

Una conexión de node-redis en modo suscriptor no admite otros comandos: las lecturas de sesión fallan. Cree una conexión aparte.

<!-- no-check -->
```ts good
const subscriber = redis.duplicate();
await subscriber.connect();
new RedisSessionStore(redis, { prefix: "app:prod:session:", subscriber });
```

### `MEEKO_REDIS_URL` sin el paquete `redis`

```sh bad
MEEKO_REDIS_URL=redis://127.0.0.1:6379 npm start   # sin npm install redis
```

El arranque se detiene con `MEEKO_REDIS_URL is set but the project does not install the redis package: add it with npm install redis (or pnpm add redis) and build again`. Una URL que no es `redis://` ni `rediss://` da `MEEKO_REDIS_URL must be a redis:// or rediss:// URL`, y un servidor inaccesible, `Could not connect to the Redis server of MEEKO_REDIS_URL`. Los mensajes nunca incluyen la URL, que lleva la contraseña.

```sh good
npm install redis && npm run build && MEEKO_REDIS_URL=rediss://… npm start
```

## Notas

- **Fail closed.** Si Redis no responde, la petición que lee la sesión falla con `500`; nunca se concede acceso sin el store. `rateLimit` también rechaza.
- **Registros antiguos.** Los registros sin `familyId` (anteriores a la revocación por familia) siguen siendo legibles y reciben una familia en la primera rotación.
- **Avisos falsificables.** Cualquiera con permiso `PUBLISH` sobre el Redis puede publicar un `familyId` en `<prefix>revoked`: no concede acceso, pero aborta peticiones y cierra sockets de esa familia. Restrinja ese canal con ACL.
- **Suscriptor desconectado.** Redis pub/sub no guarda mensajes: una revocación publicada mientras el `subscriber` de una instancia está caído no llega a ella. El borrado sí es atómico, así que la siguiente lectura la detecta; use `session.verify()` antes de efectos irreversibles.
- **Cierre.** El store no cierra el cliente salvo con `closeClient`; cierre `client` y `subscriber` en `close` de `server/runtime.ts`.

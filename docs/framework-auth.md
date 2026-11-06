# Autenticación y sesiones

Esta guía desarrolla [la visión general del framework](framework.md).

## Autenticación

Desde `1.2`, Meeko se ocupa de las piezas delicadas de un inicio de sesión: cookie opaca `HttpOnly`, `Secure` y host-only, sesiones en Redis entre instancias con revocación, Origin y CSRF, contraseñas con scrypt, límite de intentos y tipos de la sesión. La aplicación sólo decide quién puede entrar. Un panel privado para una cuenta queda así:

**1. Variables** (`.env` en desarrollo, ignorado por git; en producción, las del entorno):

```sh
MEEKO_PUBLIC_ORIGIN=https://example.com       # el origen exacto tras el proxy HTTPS
MEEKO_REDIS_URL=rediss://default:…@redis.example.com:6380
MEEKO_TRUST_PROXY=1                           # un proxy (Traefik, Caddy, nginx) delante
ADMIN_USERNAME=ada
ADMIN_PASSWORD_HASH=scrypt$131072$8$1$…       # npx meeko auth hash
```

Las dos últimas son de la aplicación, sin el prefijo `MEEKO_`, que queda reservado. Instale el cliente Redis con `npm install redis`; en desarrollo las sesiones viven en memoria y no hace falta Redis. No hay `server/runtime.ts`: véase [Sesiones sin configuración](#sesiones-sin-configuración).

**2. El tipo de la sesión**, una sola vez para páginas, API, RPC y Socket:

```ts
// server/types/session.d.ts
import type {} from '@meekojs/meeko/server'
declare module '@meekojs/meeko/server' {
	interface MeekoSession {
		user: string
		role: 'owner'
	}
}
```

**3. Inicio y cierre de sesión:**

```ts
// server/api/auth/login.post.ts
import { verifyPassword } from '@meekojs/meeko/password'
import { loginInput, okResult } from '../../../shared/schemas/auth.js'

export default defineApiRoute({
	body: loginInput,
	response: okResult,
	origin: 'required',
	rateLimit: { limit: 5, window: '5m' },
	handler: async ({ body, context }) => {
		const valid = await verifyPassword(body.password, process.env.ADMIN_PASSWORD_HASH ?? '')
		if (!valid || body.username !== process.env.ADMIN_USERNAME) throw new ApiError('INVALID_CREDENTIALS', 401)
		await context.session.create({ user: body.username, role: 'owner' })
		return { ok: true as const }
	},
})
```

```ts
// server/api/auth/logout.post.ts
export default defineApiRoute({
	auth: 'required',
	status: 204,
	handler: async ({ context }) => {
		await context.session.revoke()
	},
})
```

`verifyPassword` se ejecuta siempre, también con un usuario incorrecto, para que el tiempo de respuesta no revele cuál de los dos falló. `defineApiRoute` y `ApiError` se autoimportan en `server/`. Desde el navegador, `await api.auth.login.post({ body })` y `await api.auth.logout.post()`: el cliente envía Origin y el token CSRF.

**4. Una página protegida:**

```html
<!-- app/pages/dashboard.meeko -->
<script
	server
	lang="ts"
>
	const { context } = usePage()
	const session = context.session.current
	if (session?.data.role !== 'owner') redirect('/login')
	export const user = session.data.user
</script>

<template>
	<h1>Hola, {user}</h1>
</template>
```

Lo que hace Meeko por usted en este ejemplo:

- La cookie `__Host-meeko.sid` es opaca, `HttpOnly`, `Secure`, `SameSite=Lax` y host-only; `MEEKO_SESSION_TTL` y `MEEKO_SESSION_SAMESITE` la ajustan. El ID cambia al iniciar sesión y la familia completa se revoca al cerrarla, también en las demás instancias.
- La comprobación de `Origin` de toda mutación (desde `1.8`; `origin: "required"` la deja explícita) y el propio `session.create()` impiden el _login CSRF_ (véase [Origin en mutaciones anónimas](#origin-en-mutaciones-anónimas)); `auth: "required"` y el token CSRF protegen el cierre de sesión.
- `rateLimit` cuenta los intentos por IP en Redis (o, sin Redis, en SQL; véase [Rate limit en SQL](#rate-limit-en-sql)), y `MEEKO_TRUST_PROXY` hace que la IP sea la del cliente y no la del proxy.
- `verifyPassword` compara en tiempo constante y acepta los hashes que ya tenga con el mismo formato.

### Tipos de la sesión: `MeekoSession`

Sin declaración, `context.session.current.data` es `unknown`, como hasta `1.1`, y `session.create(data)` acepta cualquier valor serializable. Desde `1.2`, una aumentación de módulo de la interfaz `MeekoSession` de `@meekojs/meeko/server` fija la forma en toda la aplicación: `RequestContext.session` pasa a ser `SessionHandle<MeekoSession>`, así que `context.session.current?.data` y `create(data)` quedan tipados en el `<script server>` de las páginas (`usePage().context`), en API, RPC y Socket, y en `authorize` y `locals`. El tipo resultante se llama `SessionData`. Declárela en un archivo `.d.ts` de `server/` (por ejemplo, `server/types/session.d.ts`), que `meeko check` y el editor incluyen en todos los proyectos, y empiece por `import type {} from "@meekojs/meeko/server";`: así el archivo es un módulo y TypeScript carga siempre el módulo que amplía, aunque el código que lee la sesión sólo importe `@meekojs/meeko/framework` (con `export {}` la aumentación se perdería en esos archivos). El tipo no valida en ejecución: si cambia la forma, las sesiones guardadas antes conservan la anterior hasta que caducan o se crean de nuevo.

### Contraseñas

`@meekojs/meeko/password` (desde `1.2`) guarda y comprueba contraseñas con scrypt:

- `hashPassword(password)` devuelve `scrypt$<N>$<r>$<p>$<sal>$<hash>`, con N = 2^17, r = 8, p = 1 (128 MiB por cálculo), una sal aleatoria de 16 bytes y una clave de 32, ambas en base64url. El formato describe sus propios parámetros, así que un hash guardado sigue siendo válido aunque cambien los valores por defecto.
- `verifyPassword(password, hash)` recalcula con los parámetros del hash y compara en tiempo constante (`timingSafeEqual`). Acepta los hashes escritos a mano con el mismo formato, como `scrypt$131072$8$1$…` con una sal de 32 bytes y una clave de 64, sin regenerarlos. Un hash mal formado o con parámetros fuera de los límites (N potencia de dos entre 2^10 y 2^20, `r` hasta 32, `p` hasta 16) lanza `TypeError`: es un fallo de configuración, no una contraseña incorrecta. Una contraseña vacía o de más de 4096 bytes devuelve `false` sin calcular nada.
- `needsRehash(hash)` indica si el hash usa parámetros más débiles que los actuales; tras un inicio de sesión correcto, guarde `await hashPassword(password)` en su lugar.

Como mucho se calculan dos hashes a la vez por proceso, para acotar la memoria (256 MiB) y no ocupar todos los hilos de `libuv`; combine el inicio de sesión con [`rateLimit`](#límite-de-peticiones-ratelimit). Cuando el usuario no existe, compare igualmente contra un hash fijo para que el tiempo de respuesta no revele qué cuentas existen.

**Por qué una subruta aparte.** Web Crypto, la única criptografía de `@meekojs/meeko/server`, no ofrece funciones de derivación costosas en memoria (scrypt, Argon2), y una implementación en JavaScript sería decenas de veces más lenta, lo que obliga a bajar el coste. `node:crypto` las implementa en código nativo y existe en Node, Bun y Deno, así que `/password` lo importa y `/server` sigue siendo portable (Web APIs y `node:async_hooks`). No vale para Cloudflare Workers: aunque `nodejs_compat` ofrece scrypt, los 128 MiB de un cálculo con estos parámetros agotan la memoria de un aislado; en Workers, delegue la verificación en un servicio externo.

Para obtener un hash sin escribir código:

```sh
npx meeko auth hash                       # pide la contraseña dos veces, sin mostrarla
printf '%s' "$PASSWORD" | npx meeko auth hash   # o la lee de stdin
```

El comando escribe en stdout sólo la línea del hash, lista para `.env` (`ADMIN_PASSWORD_HASH=…`); los avisos van a stderr.

### Límite de peticiones: `rateLimit`

Desde `1.2`, `defineApiRoute` y `defineRpc` aceptan `rateLimit: { limit, window, key? }`: como mucho `limit` peticiones por ventana fija de `window` (milisegundos o un texto como `"30s"`, `"5m"`, `"1h"`). La petición que lo supera recibe `429 RATE_LIMITED` con `Retry-After` (segundos hasta la ventana siguiente), sin validar la entrada ni ejecutar el handler. Se comprueba tras Origin y CSRF y antes de `auth`, `authorize`, la entrada y `locals`, así que también frena a los clientes anónimos.

```ts
export default defineApiRoute({
	body: loginInput,
	response: okResult,
	origin: 'required',
	rateLimit: { limit: 5, window: '5m' },
	handler: async ({ body, context }) => {
		/* … */
	},
})
```

- **Clave.** Sin `key`, cada IP de cliente tiene su contador por ruta (las IPv6 por su red /64, porque un cliente dispone de toda una /64). La IP es `context.clientAddress`: la de la conexión que entrega el adaptador (Node, Bun, Deno; en Workers, `CF-Connecting-IP`, que fija Cloudflare). Si Meeko no la conoce, todos los clientes comparten el contador de la ruta. `key: (context) => string` cuenta por otro sujeto, como el usuario de la sesión; se ejecuta antes de validar la entrada, así que no recibe el cuerpo. Una ruta dinámica (`/api/users/[id]`) tiene un solo contador para todos sus valores.
- **Proxies.** `X-Forwarded-For` nunca se lee salvo con `MEEKO_TRUST_PROXY`, porque cualquier cliente puede enviarlo. Con un número `n`, la IP es la entrada que añadió el proxy de confianza más externo, la `n`-ésima desde la derecha: con un único proxy (Traefik en Coolify, Caddy, nginx) use `MEEKO_TRUST_PROXY=1`, y las entradas que el cliente falsificó a la izquierda se ignoran. `true` toma la entrada de la izquierda: sólo es seguro si el proxy de entrada sustituye la cabecera en lugar de añadirse. Una entrada con puerto, como la que escribe Azure Application Gateway (`203.0.113.7:5678` o `[2001:db8::1]:5678`), cuenta por su IP; si la entrada elegida no es una IP, la petición cuenta con la IP de la conexión (la del proxy), nunca con el contador compartido de los clientes desconocidos. Sin la variable, tras un proxy todos los clientes comparten el contador del proxy. Un valor no válido detiene el arranque.
- **Middleware y llamadas locales.** Un middleware de servidor que pasa a `next()` una petición nueva (`next(new Request(request, { headers }))`) conserva la IP de la conexión. `createLocalCalls` usa el contador de la ruta que usa el despachador HTTP y la IP del `context` que recibe, así que una llamada local no esquiva el límite de la ruta. Un host propio que crea sus `Request` sin un adaptador de Meeko (`serveNode`, `toNodeListener`, `createBunServer`, `serveDeno` o `createWorker`) no tiene IP de conexión: sus clientes comparten el contador de la ruta, salvo que declare `key`.
- **Almacenamiento.** Los contadores viven en el store de sesiones: en memoria con `MemorySessionStore` y, con `RedisSessionStore` (también el de [Sesiones sin configuración](#sesiones-sin-configuración)), en `<prefix>ratelimit:<resumen>`, con un script Lua que hace `INCR` y `PEXPIRE` de forma atómica para todas las instancias. La clave guarda un resumen SHA-256 de la ruta y el sujeto, nunca la IP ni la clave en claro. Si Redis falla, la petición se rechaza con `500` (_fail closed_) y el error llega a `onError`.
- **Store propio.** Un `SessionStore` puede implementar `rateLimit(key, windowMs)`, que cuenta una petición en la ventana fija `key` y resuelve `{ count, resetInMs }` (tipo `RateLimitHit`); debe ser atómico entre instancias y rechazar si falla. Desde `1.7`, `SqlSessionStore` lo implementa cuando su driver ofrece `rateLimit` (véase [Rate limit en SQL](#rate-limit-en-sql)); sin él, los contadores viven en la memoria de cada instancia o aislado, y Meeko lo avisa una vez en producción.
- Un `limit` que no es un entero positivo, una `window` no válida o una `key` vacía responden `500 INVALID_RATE_LIMIT`.

### Rate limit en SQL

Desde `1.7`, una aplicación sin Redis comparte los contadores de `rateLimit` entre instancias con su base de datos: `SqlSessionDriver.rateLimit(key, windowMs, now)` es opcional y, si el driver lo implementa, `SqlSessionStore` delega en él. Sin él todo sigue como hasta `1.6`: contadores en la memoria de cada instancia y un aviso en producción.

La semántica es la de Redis y la memoria: una **ventana fija** por clave. La primera petición abre la ventana (`count = 1`, `window_ends_at = now + windowMs`); las siguientes suman uno y conservan su final; la primera tras el final la reinicia. Una ruta que cambia `window` no acorta ni alarga una ventana ya abierta. El driver devuelve la fila resultante, `{ count, windowEndsAt }` (tipo `SqlRateLimitRow`; `Number()` acepta un `bigint` devuelto como texto); Meeko calcula `resetInMs = windowEndsAt - now` y, por encima del límite, responde `429` con `Retry-After` en segundos redondeados hacia arriba (como mínimo, 1). `now` es el reloj de la instancia, como en `replace`. Si la sentencia falla, la petición se rechaza con `500` (_fail closed_).

`key` llega como los 32 bytes del SHA-256 de la clave del contador, que Meeko ya calcula como un resumen SHA-256 de la ruta y el sujeto: la tabla nunca guarda una IP ni una clave en claro (tampoco las de `SessionManager.rateLimit` llamado a mano) y la columna tiene ancho fijo. La sentencia debe ser atómica frente a peticiones concurrentes de todas las instancias; en PostgreSQL basta un único `INSERT … ON CONFLICT DO UPDATE … RETURNING`:

```sql
-- Una vez, en una migración. UNLOGGED: sin WAL, más rápida; tras una caída del servidor
-- la tabla se vacía y los contadores vuelven a empezar, lo que es aceptable para un límite.
CREATE UNLOGGED TABLE IF NOT EXISTS meeko_rate_limits (
  key bytea PRIMARY KEY,
  window_ends_at bigint NOT NULL,
  count integer NOT NULL
);
CREATE INDEX IF NOT EXISTS meeko_rate_limits_window_ends_at ON meeko_rate_limits (window_ends_at);

-- Cada petición limitada: $1 = key, $2 = now, $3 = windowMs.
INSERT INTO meeko_rate_limits AS r (key, window_ends_at, count) VALUES ($1, $2::bigint + $3::bigint, 1)
ON CONFLICT (key) DO UPDATE SET
  count = CASE WHEN r.window_ends_at <= $2 THEN 1 ELSE r.count + 1 END,
  window_ends_at = CASE WHEN r.window_ends_at <= $2 THEN EXCLUDED.window_ends_at ELSE r.window_ends_at END
RETURNING count, window_ends_at;

-- Limpieza periódica (cron, pg_cron o una tarea de la aplicación): $1 = now.
DELETE FROM meeko_rate_limits WHERE window_ends_at <= $1;
```

Las dos asignaciones del `UPDATE` leen la fila anterior, así que el reinicio de `count` y el de `window_ends_at` coinciden. Un driver con `node-postgres`:

```ts
// server/runtime.ts (fragmento)
import pg from 'pg'
import type { SqlSessionDriver } from '@meekojs/meeko/server'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const rateLimitSql = `INSERT INTO meeko_rate_limits AS r …` // la sentencia de arriba

const driver: SqlSessionDriver = {
	// read, write, remove, replace y revokeFamily, como siempre.
	...sessionStatements(pool),
	async rateLimit(key, windowMs, now) {
		const { rows } = await pool.query<{ count: number; window_ends_at: string }>(rateLimitSql, [Buffer.from(key), now, windowMs])
		return { count: rows[0]!.count, windowEndsAt: Number(rows[0]!.window_ends_at) }
	},
}
```

En Cloudflare D1, `D1SessionDriver` lo implementa con la opción `rateLimitTable` (véase [Sesiones en D1](framework-deployment.md#sesiones-en-d1)).

### IP del cliente tras un proxy

La IP del cliente tiene dos vías, con la misma política que `rateLimit`:

- **`context.clientAddress`**, donde hay un `RequestContext`: API, RPC, el `<script server>` de las páginas, el middleware de ruta de servidor (`context.clientAddress`) y los canales Socket.
- **`clientAddress(request, env?)`** de `@meekojs/meeko/server` (desde `1.7`), donde sólo hay un `Request`: `defineServerMiddleware` y los handlers de `addServerHandler`.

```ts
// server/middleware/10-access-log.ts
import { clientAddress, defineServerMiddleware } from '@meekojs/meeko/server'

export default defineServerMiddleware(async (request, next) => {
	// Tras Traefik con MEEKO_TRUST_PROXY=1, la del visitante y no la del proxy.
	const ip = clientAddress(request) ?? 'desconocida'
	const response = await next()
	console.log(`${request.method} ${new URL(request.url).pathname} ${response.status} ${ip}`)
	return response
})
```

La política es siempre la misma:

- **Sin `MEEKO_TRUST_PROXY`**, la IP es la de la conexión que entrega el adaptador: el socket remoto en Node (`serveNode`, `toNodeListener`), `server.requestIP()` en Bun, `remoteAddr` en Deno y `CF-Connecting-IP` en Workers, una cabecera que fija el borde de Cloudflare y que sustituye la que envíe el cliente. `X-Forwarded-For` nunca se lee: tras un proxy, todos los clientes tienen la IP del proxy.
- **Con `MEEKO_TRUST_PROXY=n`**, la IP es la `n`-ésima entrada de `X-Forwarded-For` desde la derecha, la que añadió el proxy de confianza más externo, sin su puerto. Lo que el cliente escribió a su izquierda se ignora. Con Traefik (Coolify), Caddy o nginx como único proxy, `MEEKO_TRUST_PROXY=1`; con un CDN delante de Traefik que añade su entrada, `2`. `true` toma la entrada de la izquierda y sólo es seguro si el proxy de entrada sustituye la cabecera. Si la entrada elegida no es una IP, vale la de la conexión.
- **Con `MEEKO_TRUST_PROXY=cloudflare`** (desde `1.8`), la IP es la de `CF-Connecting-IP` (o, si falta, la de `True-Client-IP`), pero sólo si la conexión y cada salto de `X-Forwarded-For` vienen de las redes de `MEEKO_TRUSTED_PROXIES`; véase [Cloudflare Tunnel y Traefik](#cloudflare-tunnel-y-traefik). En Workers no cambia nada: la IP de la conexión ya es `CF-Connecting-IP`.
- La IP sale normalizada: IPv6 en minúsculas y sin zona, e IPv4 mapeada en IPv6 (`::ffff:192.0.2.1`) como IPv4. `undefined` si no se conoce, como en un host propio que crea sus `Request` sin un adaptador de Meeko.

Sin `env`, `clientAddress` aplica el `MEEKO_TRUST_PROXY` del entorno de la aplicación que atiende la petición (el `platform.env` que recibe `ServerApp.fetch`), también en la petición nueva que un middleware pasa a `next()`. Con una petición que no atiende un `ServerApp`, sólo usa la IP de la conexión, salvo que reciba el entorno: `clientAddress(request, process.env)`. Un `MEEKO_TRUST_PROXY` no válido lanza `TypeError` (y detiene el arranque de la aplicación); con `cloudflare`, también un `MEEKO_TRUSTED_PROXIES` no válido.

#### Cloudflare Tunnel y Traefik

Con Cloudflare Tunnel, la petición llega así: Cloudflare → `cloudflared` → un proxy como Traefik (Coolify) → el servidor. Traefik sin `trustedIPs` sustituye `X-Forwarded-For` por la IP de su par, `cloudflared`, así que con `MEEKO_TRUST_PROXY=1` todos los visitantes compartirían la IP de `cloudflared` y el `rateLimit` por cliente sería global. Cloudflare sí envía la IP del visitante en `CF-Connecting-IP`, y la sustituye si el cliente la manda:

```dotenv
MEEKO_TRUST_PROXY=cloudflare
# Opcional. Por defecto, loopback y redes privadas:
# MEEKO_TRUSTED_PROXIES=127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, ::1/128, fc00::/7
```

La cabecera sólo vale cuando la petición pasó únicamente por la infraestructura propia:

- **La conexión** debe venir de una red de `MEEKO_TRUSTED_PROXIES`, donde viven `cloudflared` y Traefik: una lista de CIDR o IP separadas por comas o espacios que sustituye a la de por defecto (redes RFC 1918, loopback y ULA `fc00::/7`). Si viene de fuera, o el adaptador no la conoce, la cabecera se ignora y vale la IP de la conexión.
- **Cada salto de `X-Forwarded-For`**, de derecha a izquierda, también debe venir de esas redes. El primero que no lo hace es el cliente que vio un proxy de confianza: si alguien llega directamente a la entrada pública de Traefik con un `CF-Connecting-IP` inventado, Traefik escribe su IP en `X-Forwarded-For` y Meeko usa esa. Un salto que no es una IP devuelve la IP de la conexión.
- **El valor** debe ser una única IPv4 o IPv6, sin puerto ni corchetes. Una lista o un texto cualquiera devuelven la IP de la conexión; `True-Client-IP` sólo se lee si `CF-Connecting-IP` falta.

Si el servidor comparte red privada con clientes en los que no confía, limita `MEEKO_TRUSTED_PROXIES` a las IP o subredes de `cloudflared` y del proxy, como la red Docker de Coolify (`MEEKO_TRUSTED_PROXIES=10.0.1.0/24, 172.17.0.1`). Incluye la dirección con la que `cloudflared` llega al proxy, que este escribe en `X-Forwarded-For`: si queda fuera, Meeko la toma por el cliente y todos los visitantes vuelven a compartir IP. Las redes por defecto no incluyen CGNAT (`100.64.0.0/10`, la de Tailscale) ni link-local: añádelas si `cloudflared` llega por ahí. `MEEKO_TRUSTED_PROXIES` sólo se lee en el modo `cloudflare`.

## Sesiones y seguridad

Las sesiones usan IDs opacos aleatorios en cookies `HttpOnly`, host-only, `Secure` por defecto y `SameSite=Lax` por defecto. Cada sesión nueva recibe también un `familyId` opaco que permanece al rotar su ID. `SessionHandle` permite crear, rotar y revocar; la rotación y la revocación de toda la familia requieren operaciones atómicas en el store. Así, un logout iniciado con un handle anterior invalida el ID activo aunque otra petición ya lo haya rotado. Las mutaciones autenticadas con cookie verifican Origin y `x-meeko-csrf`; desde `1.8`, las anónimas verifican Origin (véase [Origin en mutaciones anónimas](#origin-en-mutaciones-anónimas)). Las respuestas SSR y API entregan el token CSRF por meta o cabecera same-origin. La aplicación debe definir verificación de identidad y reglas de autorización; Meeko no guarda secretos de autenticación en el navegador.

`MemorySessionStore` sirve sólo en desarrollo. `SessionManager({ production: true, store })` exige `persistent: true`, `replace` atómico y `revokeFamily`; una aplicación sin `MEEKO_REDIS_URL` ni `sessions` propias no arranca en producción. `RedisSessionStore` acepta un cliente compatible con `get`, `set` con `PX`, `del` y `eval`; usa un índice de familia con el TTL de la sesión activa. Use un prefijo propio por aplicación y entorno. Los registros Redis anteriores sin `familyId` siguen siendo legibles y adquieren una familia en la primera rotación. `SqlSessionStore` acepta un `SqlSessionDriver` con `read`, `write`, `remove`, `replace` transaccional, `revokeFamily`, `close` opcional y, desde `1.7`, `rateLimit` opcional (véase [Rate limit en SQL](#rate-limit-en-sql)). El ejemplo ejecutable en `tests/fixtures/fullstack-consumer/server/runtime.ts` usa SQLite real; el framework no depende de una librería SQL ni de un motor de base de datos concreto. `SessionManager.close()` libera el store cuando el host es propietario del recurso.

Todo `SessionStore` persistente personalizado debe almacenar `familyId` y garantizar que `replace` y `revokeFamily` sean atómicos frente a peticiones concurrentes. Antes de actualizar, migre los registros existentes y los índices necesarios para localizar la sesión activa por familia. No despliegue el nuevo runtime sobre un store antiguo: en producción la construcción falla de forma deliberada cuando no puede garantizar rotación y revocación familiar seguras. Desde `1.2`, un store puede implementar además `rateLimit(key, windowMs)` para los contadores de [`rateLimit`](#límite-de-peticiones-ratelimit).

**Migración de drivers SQL existentes:** añada una columna de familia a la tabla (por ejemplo, `family_id`), rellene las filas existentes con `family_id = id` y cree un índice único sobre ella. `read` y `write` deben transferir `SqlSessionRow.familyId`; `replace` debe comprobar la misma familia y sustituir la fila en una transacción; `revokeFamily(familyId)` debe borrar la fila activa por familia. Migre el esquema antes de iniciar la nueva versión. Un driver antiguo sin `revokeFamily` falla al construir `SqlSessionStore`; no se admite silenciosamente en producción.

Sin `server/runtime.ts`, Meeko hace todo esto por usted con `MEEKO_REDIS_URL` (véase la sección siguiente). Para un cliente propio, instale `redis` en la aplicación, cree el cliente con `createClient({ url: process.env.MEEKO_REDIS_URL })`, llame `connect()` antes de servir tráfico y páselo a `RedisSessionStore` con un prefijo propio. El host debe cerrar su cliente con `quit()` al detenerse; `SessionManager.close()` cierra el store, pero no se apropia de clientes externos. La prueba de integración `tests/redis.integration.ts` usa un namespace aleatorio y sólo borra sus propias claves. Se ejecuta contra un Redis real con `MEEKO_REDIS_URL=redis://127.0.0.1:6379 pnpm exec tsx --test tests/redis.integration.ts`; CI dispone de un servicio Redis dedicado. La prueba local requiere un Redis accesible y no usa bases ajenas.

### Sesiones sin configuración

Desde `1.2`, una aplicación no necesita `server/runtime.ts` para tener sesiones seguras. Si el archivo no existe, o su fábrica no devuelve `sessions`, `createServerApp` las crea:

- **Desarrollo** (`meeko dev`) y el prerender de `meeko build`: `MemorySessionStore`.
- **Producción** en Node, Bun y Deno: con `MEEKO_REDIS_URL` (`redis://` o `rediss://`), Meeko importa el paquete `redis` del proyecto, conecta un cliente y un suscriptor dedicado (`client.duplicate()`) **antes de servir tráfico**, crea un `RedisSessionStore` con revocación entre instancias y cierra ambas conexiones al detenerse, después del `close` de la aplicación. Instale el paquete con `npm install redis`: el build sólo lo incluye si está instalado, y sin él el arranque falla con un mensaje que lo pide. Si la primera conexión falla, el arranque falla; si se corta después, el cliente reconecta y, mientras tanto, las peticiones que leen la sesión fallan en el acto en lugar de esperar (_fail closed_). Los mensajes nunca incluyen la URL, que lleva la contraseña.
- **Producción sin `MEEKO_REDIS_URL`**: la aplicación no arranca, como hasta ahora. En Workers no hay TCP, así que `MEEKO_REDIS_URL` también detiene el arranque: declare un `SessionManager` con D1 o con Upstash (véase [Cloudflare Workers](framework-deployment.md#cloudflare-workers)).

Las claves usan el prefijo de `MEEKO_REDIS_PREFIX` o, por defecto, `meeko:<name de package.json>:prod:`. `MEEKO_SESSION_TTL` (`30m`, `12h`, `7d`…; 7 días por defecto) y `MEEKO_SESSION_SAMESITE` (`Lax` por defecto, o `Strict`) ajustan esas sesiones, también en desarrollo; un valor no válido detiene el arranque. La cookie conserva los valores seguros: `__Host-meeko.sid`, `Secure`, `HttpOnly`, `Path=/` y sin `Domain` (host-only). Con unas `sessions` propias en `server/runtime.ts`, esas variables no se aplican y Meeko lo avisa una vez.

### Duración de cada sesión

`SessionManager({ ttlMs })` fija la duración por defecto (7 días). Desde `1.2`, `context.session.create(data, { ttlMs })` da a una sesión su propia duración, un entero positivo de milisegundos; por ejemplo, 30 días para los propietarios y 12 horas para el personal. Un valor no válido rechaza con `RangeError` sin tocar el store. Esa duración fija el `Max-Age` de la cookie y la caducidad en el store (`expiresAt`, que Redis aplica con `PX` y SQL y D1 guardan en `expires_at`), se guarda en `SessionRecord.ttlMs` y `rotate()` la conserva: cada rotación cuenta de nuevo esa duración desde el momento de rotar.

```ts
const ttlMs = user.role === 'staff' ? 12 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000
await context.session.create({ userId: user.id }, { ttlMs })
```

Las sesiones creadas sin `ttlMs`, y los registros escritos antes de `1.2`, usan la duración del gestor también al rotar. `SqlSessionStore` no necesita una columna nueva: deduce la duración de cada fila como `expiresAt - createdAt`, así que una fila anterior conserva al rotar la duración con la que se creó. Un `SessionStore` propio debe conservar el campo `ttlMs` del registro si quiere que la duración sobreviva a la rotación; si lo pierde, la sesión rota con la duración del gestor.

### Origin en mutaciones anónimas

Desde `1.8`, **toda mutación comprueba `Origin` por defecto**, haya o no cookie de sesión: los `POST`, `PUT`, `PATCH` y `DELETE` de `defineApiRoute`, todas las llamadas de `defineRpc` (siempre son `POST`) y los formularios nativos. Hasta `1.7`, una mutación sin sesión sólo lo comprobaba con `origin: "required"`, de modo que cualquier ruta anónima que aceptara JSON enviado como `text/plain`, o un formulario, quedaba expuesta al CSRF; y un endpoint que crea la sesión, como el inicio de sesión, al _login CSRF_: otra web podía iniciar sesión en el navegador de la víctima con una cuenta del atacante.

La regla es la de las mutaciones autenticadas:

- Se acepta el origen de la petición, que tras `createServerApp` es el `publicOrigin` configurado (o `MEEKO_PUBLIC_ORIGIN`), y los de `SessionManager({ allowedOrigins })`. `MEEKO_TRUST_PROXY` sólo decide qué dirección de `X-Forwarded-For` es la del cliente: ni `X-Forwarded-Host` ni `X-Forwarded-Proto` cambian el origen propio. Detrás de un proxy que termina TLS, configure `MEEKO_PUBLIC_ORIGIN`.
- Un `Origin` ausente, `null` o de otro origen (otro esquema, host o puerto) responde `403 INVALID_ORIGIN` antes de leer o validar la entrada, de `rateLimit` y del handler. `Sec-Fetch-Site` y `Referer` no sustituyen a `Origin`: los navegadores envían `Origin` en toda petición `POST`, `PUT`, `PATCH` y `DELETE`, también en las de su propio origen, así que `Sec-Fetch-Site: same-origin` sin `Origin` también es `403`, como con sesión. Al revés, un origen de `allowedOrigins` pasa aunque el navegador lo marque como `cross-site`.
- `GET`, `HEAD` y `OPTIONS` no se comprueban, porque una navegación no lleva `Origin`, y un callback de OAuth o un enlace mágico llegan desde otro sitio. Esos flujos deben validar su propio `state` o token de un solo uso.
- Las llamadas de los clientes `api.*` y `rpc.*` durante el SSR envían el origen de la petición en curso, así que el despacho local sigue funcionando. `createLocalCalls` hace lo mismo desde `1.8`: envía el origen de la aplicación en lugar del `Origin` de la petición original, así que una mutación local funciona aunque la página se pidiera con `GET` (sin `Origin`); con sesión sigue necesitando el token CSRF de la petición original.
- Una llamada desde fuera del navegador (un script, una prueba, una app nativa o un servicio) debe enviar una cabecera `Origin` permitida, o la ruta declarar `origin: "none"`.

`origin: "required"` (desde `1.2`) equivale al valor por defecto y sigue siendo válido para dejarlo explícito, por ejemplo en un inicio de sesión:

```ts
// server/rpc/auth/login.ts
export default defineRpc({
	input: loginInput,
	output: loginOutput,
	origin: 'required',
	handler: async ({ input, context }) => {
		/* … */
	},
})
```

**`origin: "none"` desactiva la comprobación en una ruta.** Es la salida para webhooks, APIs públicas y clientes que no envían `Origin`. Es **inseguro** frente al CSRF y al _login CSRF_: úselo sólo con otra prueba de que la petición no viene de otra web, como la firma de un webhook, un token de API en `authorization` o un secreto de la app que el navegador no tiene. Con `"none"`:

- una petición sin cookie de sesión se atiende con cualquier `Origin`, o sin él, y `session.create()` puede crear la sesión;
- una petición con sesión sigue exigiendo `Origin` y el token CSRF;
- un formulario nativo (`form`) sin sesión tampoco necesita `Origin`, para los webhooks que envían `application/x-www-form-urlencoded` (Twilio, Slack…); con sesión, sigue exigiendo `Origin` y `_csrf`.

```ts
// server/api/webhooks/payments.post.ts
export default defineApiRoute({
	origin: 'none',
	contentType: 'response',
	handler: async ({ context }) => {
		const payload = await context.request.text()
		if (!(await verifySignature(payload, context.request.headers.get('x-signature')))) throw new ApiError('INVALID_SIGNATURE', 401)
		return new Response(null, { status: 204 })
	},
})
```

Un webhook que envía `application/x-www-form-urlencoded` (Twilio, Slack) funciona igual: sin `form`, el handler con `contentType: "response"` lee el cuerpo con `context.request.formData()`; con `form` y `origin: "none"`, el envío sin sesión tampoco necesita `Origin` y el cuerpo se valida con `body` (añada `contentType: "response"` para que la respuesta sea la del handler y no un `303`).

Una API pública que otros orígenes llaman con `fetch` y CORS necesita, además de `origin: "none"`, las cabeceras CORS en su middleware o proxy; Meeko no las añade. Sin cookie de sesión (un token en `authorization`), el navegador del visitante no aporta credenciales que otra web pueda aprovechar.

**`session.create()` protege el inicio de sesión también fuera de las guardas.** Desde `1.2`, en una petición `POST`, `PUT`, `PATCH` o `DELETE`, `context.session.create()` sólo crea la sesión si el `Origin` de esa petición ya se comprobó (por la guarda de la ruta o en una mutación autenticada que superó Origin y CSRF) o si está permitido en ese momento; si no, rechaza con `403 INVALID_ORIGIN` sin tocar el store ni enviar la cookie. Desde `1.8`, la guarda de la ruta rechaza antes esas peticiones, así que esta comprobación cubre sobre todo a un host propio que llama a `SessionManager.load` sin pasar por `executeApiRoute` o `executeRpc`; en desarrollo, su primer rechazo escribe un aviso. Un `SessionHandle` que no cargó `SessionManager.load` (construido a mano) no conoce su petición y crea la sesión como antes.

Ambos son cambios incompatibles publicados en un minor como corrección de seguridad, según la [política de estabilidad](stability.md#excepciones-aprobadas): el de `1.2` para `session.create()` y el de `1.8` para todas las mutaciones. La [guía de `1.8`](migration-1.8.md#origin-en-todas-las-mutaciones) explica qué hacer con webhooks, APIs públicas y clientes de otros orígenes.

### Revocación durante una petición

Revocar una familia también detiene el trabajo que ya había pasado la autenticación:

- **Peticiones en curso.** `SessionHandle.signal` se aborta con `SessionRevokedError` cuando se revoca la familia de su sesión, y `RequestContext.signal` combina esa señal con la de la petición (`AbortSignal.any`, creada al leerla por primera vez). Ambas señales se abortan aunque el código sólo conserve la señal y no el handle ni el contexto. Pase `context.signal` a `fetch`, consultas y otras operaciones cancelables. `SessionRevokedError` es un `ApiError` con código `SESSION_REVOKED` y estado `401`; si escapa del handler, la respuesta es ese `401`. La petición que llama a `revoke()` no se aborta, porque debe enviar la cookie vacía.
- **Sockets abiertos.** Las conexiones Socket cuya sesión de handshake pertenece a la familia revocada se cierran de inmediato con `1008` ("Session revoked"), sin esperar a otro evento.
- **Otras instancias.** Dentro de la misma instancia, `revoke()` aborta siempre. Para alcanzar a otras instancias, el store implementa `subscribeRevocations(listener)`, que devuelve, o promete, un `Unsubscribe`. `RedisSessionStore` la ofrece cuando recibe `subscriber` (una conexión dedicada, por ejemplo `client.duplicate()`). El script de `revokeFamily` publica el `familyId` en `<prefix>revoked` en la misma operación atómica que borra la sesión. `MemorySessionStore` avisa a los `SessionManager` del mismo proceso que lo comparten. `SqlSessionStore` no tiene notificación: sin ella, las demás instancias sólo detectan la revocación al releer el store.
- **Inicio de la suscripción.** `SessionManager` se suscribe en la primera llamada a `load` y espera la confirmación antes de autenticar. Si la suscripción falla, `load` rechaza esa petición y la siguiente lo reintenta. `SessionManager.close()` cancela la suscripción.

La notificación es asíncrona: entre el borrado en el store y la llegada del aviso, otra instancia puede seguir ejecutando código. Antes de un efecto irreversible (un pago, un envío, un borrado), llame `await context.session.verify()`. Relee el store y lanza `SessionRevokedError` si la sesión fue revocada, reemplazada por una rotación o caducó; sin sesión no hace nada.

Límites conocidos de la notificación:

- **Suscriptor Redis desconectado.** Redis pub/sub no guarda mensajes: las revocaciones publicadas mientras el `subscriber` de una instancia está desconectado se pierden para esa instancia, aunque node-redis restablezca la suscripción al reconectar. El borrado en el store sí es atómico, así que esas sesiones dejan de valer en cuanto se releen: cada petición nueva y cada evento de Socket releen la sesión, y una entrega de broadcast la relee si pasó más de `sessionRefreshMs` desde la última lectura. Lo que no se detecta es el trabajo ya autenticado en esa instancia: una petición en curso no se aborta y un socket sin tráfico permanece abierto hasta su siguiente evento o entrega. Use `verify()` antes de efectos irreversibles y vigile los eventos de reconexión del cliente Redis.
- **Ventana de revocaciones recientes.** Cada instancia recuerda las familias revocadas durante 60 segundos, hasta 4096; con más revocaciones en esa ventana olvida primero las más antiguas. Un handle cuyo registro se leyó antes del aviso y se crea después de que su familia salga de esa memoria no se aborta al registrarse, pero `verify()` y la siguiente relectura sí detectan la revocación, porque el registro ya no existe.
- **Avisos falsificables.** Cualquiera con permiso `PUBLISH` sobre el Redis puede publicar un `familyId` en `<prefix>revoked`. El aviso no borra datos ni concede acceso, pero aborta las peticiones en curso y cierra los sockets de esa familia en todas las instancias (denegación de servicio). Restrinja con ACL de Redis quién puede publicar en ese canal.

Un almacenamiento caído propaga error y no concede acceso. No se debe usar un store en memoria en producción. `Secure` requiere HTTPS en despliegue; configure el proxy y `MEEKO_PUBLIC_ORIGIN` acorde al origen público.

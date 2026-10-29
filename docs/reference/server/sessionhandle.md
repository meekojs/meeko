---
title: SessionHandle
group: server
since: 1.0.0
description: La sesión de una petición, en context.session, para leerla, crearla, rotarla, revocarla y verificarla antes de un efecto irreversible.
symbols:
  - "@meekojs/meeko/server#SessionHandle"
types:
  - "@meekojs/meeko/server#SessionRecord"
  - "@meekojs/meeko/server#SessionCreateOptions"
  - "@meekojs/meeko/server#MeekoSession"
related:
  - "@meekojs/meeko/server#SessionManager"
  - "@meekojs/meeko/server#SessionRevokedError"
  - "@meekojs/meeko/server#SessionSecurityError"
  - "@meekojs/meeko/server#defineApiRoute"
  - docs/framework.md#autenticación
  - docs/framework.md#duración-de-cada-sesión
  - docs/framework.md#origin-en-mutaciones-anónimas
  - docs/framework.md#revocación-durante-una-petición
---

`SessionHandle` es la sesión de una petición. No se construye a mano: `SessionManager.load` la crea para cada petición y llega como `context.session` a los handlers de API y RPC, al `<script server>` de las páginas (`usePage().context.session`), al middleware de ruta de servidor (`session`) y a los canales Socket. `current` es la sesión activa, si la petición trae una válida; `create`, `rotate` y `revoke` la cambian y preparan la cookie de la respuesta.

Los datos tienen el tipo de `MeekoSession` cuando la aplicación lo declara (desde `1.2`), o `unknown`.

## Uso

<!-- no-check -->
```ts
// server/api/auth/login.post.ts
import { verifyPassword } from "@meekojs/meeko/password";
import { loginInput, okResult } from "#shared/schemas/auth";

export default defineApiRoute({
  body: loginInput,
  response: okResult,
  origin: "required",
  rateLimit: { limit: 5, window: "5m" },
  handler: async ({ body, context }) => {
    const user = await findUser(body.email);
    const valid = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) throw new ApiError("INVALID_CREDENTIALS", 401);
    // Sustituye la sesión anónima, si la hay, con un ID y un token CSRF nuevos.
    await context.session.create({ userId: user.id, role: user.role });
    return { ok: true as const };
  },
});
```

## Parámetros

No se construye en las aplicaciones. Sus miembros:

| Miembro | Tipo | Descripción |
| --- | --- | --- |
| `current` | `SessionRecord<T> \| undefined` | La sesión activa: `id`, `familyId`, `csrfToken`, `data`, `createdAt`, `expiresAt` y, si se fijó, `ttlMs`. `undefined` sin sesión. |
| `create(data, options?)` | `Promise<SessionRecord<T>>` | Crea una sesión con ID, familia y token CSRF aleatorios. Si ya había una, la sustituye de forma atómica conservando su familia. `options.ttlMs` (desde `1.2`) fija su duración. |
| `rotate()` | `Promise<SessionRecord<T>>` | Cambia el ID y el token CSRF conservando datos, familia y duración. La caducidad se cuenta desde la rotación. |
| `revoke()` | `Promise<void>` | Revoca toda la familia, también en las demás peticiones e instancias, y vacía la cookie. La petición que llama no se aborta. |
| `verify()` | `Promise<void>` | Relee el store y lanza `SessionRevokedError` si la sesión fue revocada, sustituida por una rotación o caducó. Sin sesión no hace nada. |
| `signal` | `AbortSignal` | Se aborta con `SessionRevokedError` cuando otra petición u otra instancia revoca la familia. `context.signal` la incluye. |
| `cookieHeader` | `string \| undefined` | La cabecera `Set-Cookie` pendiente tras crear, rotar o revocar. |

## Valor devuelto

`create` y `rotate` devuelven el `SessionRecord` nuevo, que pasa a ser `current`; la respuesta lleva su cookie y el nuevo token en `x-meeko-csrf-token`. `revoke` deja `current` en `undefined` y la cookie con `Max-Age=0`.

## Ejemplos

### Cerrar sesión

```ts
// server/api/auth/logout.post.ts
import { defineApiRoute } from "@meekojs/meeko/server";

export default defineApiRoute({
  auth: "required",
  status: 204,
  handler: async ({ context }) => { await context.session.revoke(); },
});
```

`auth: "required"` y el token CSRF protegen la ruta; las demás pestañas y los sockets abiertos de esa familia se cierran.

### Duración distinta por rol

<!-- no-check -->
```ts
const ttlMs = user.role === "staff" ? 12 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
await context.session.create({ userId: user.id, role: user.role }, { ttlMs });
```

La duración fija el `Max-Age` de la cookie y `expiresAt` en el store, y `rotate()` la conserva.

### Rotar tras elevar privilegios

<!-- no-check -->
```ts
// server/rpc/account/confirm-password.ts
export default defineRpc({
  input: passwordInput,
  output: okOutput,
  auth: "required",
  handler: async ({ input, context }) => {
    await checkPassword(context.session.current!.data.userId, input.password);
    await context.session.rotate(); // ID y token nuevos: un ID robado antes deja de valer
    return { ok: true };
  },
});
```

### Verificar antes de cobrar

<!-- no-check -->
```ts
handler: async ({ body, context }) => {
  await context.session.verify();                 // 401 SESSION_REVOKED si ya no vale
  await payments.charge(body.orderId, { signal: context.signal });
  return { ok: true };
},
```

La revocación entre instancias llega de forma asíncrona; `verify()` relee el store justo antes del efecto.

### Una página que exige sesión

```html
<!-- app/pages/dashboard.meeko -->
<script server lang="ts">
const { context } = usePage();
const session = context.session.current;
if (!session) redirect("/login");
export const userId = session.data.userId;
</script>

<template><h1>Hola, {userId}</h1></template>
```

## Errores comunes

### Iniciar sesión desde un script sin `Origin`

```sh bad
curl -X POST https://app.example.com/api/auth/login -H 'content-type: application/json' -d '{"email":"…","password":"…"}'
```

Desde `1.2`, `create()` en un `POST`, `PUT`, `PATCH` o `DELETE` exige un `Origin` permitido: responde `403 INVALID_ORIGIN` sin tocar el store. En desarrollo, el primer rechazo escribe el aviso `[meeko] session.create() rechazó una petición sin un Origin permitido (403 INVALID_ORIGIN)…`.

```sh good
curl -X POST https://app.example.com/api/auth/login -H 'origin: https://app.example.com' -H 'content-type: application/json' -d '{"email":"…","password":"…"}'
```

`origin: "none"` en la ruta desactiva la comprobación, pero deja el inicio de sesión expuesto al *login CSRF*.

### Crear la sesión después del primer byte de un stream

```ts bad
// render: "stream": el valor diferido se resuelve cuando el documento ya empezó a enviarse
load: async ({ context }) => ({
  user: defer(context.session.create({ userId }).then(() => userId)),
}),
```

Las cabeceras ya salieron: `create`, `rotate` y `revoke` rechazan con `500 SESSION_LOCKED: the session cookie was already sent with the response headers; create, rotate or revoke the session in the loader, before any deferred work`.

<!-- no-check -->
```ts good
// En el loader o en la parte crítica, antes del primer byte; mejor aún, en una API.
await context.session.create({ userId });
```

### Rotar sin sesión

```ts bad
await context.session.rotate(); // en una petición anónima
```

Lanza `Error: No active session to rotate`, que la respuesta convierte en `500 INTERNAL_ERROR`. Si la sesión caducó o se revocó entre la lectura y la rotación, el error es `Session has expired or been revoked`.

<!-- no-check -->
```ts good
if (context.session.current) await context.session.rotate();
```

### Una duración no válida

```ts bad
await context.session.create(data, { ttlMs: 0 });
```

Rechaza con `RangeError: Invalid session TTL` sin tocar el store.

<!-- no-check -->
```ts good
await context.session.create(data, { ttlMs: 60 * 60 * 1000 });
```

## Notas

- **Servidor.** Existe sólo en el servidor. El navegador nunca recibe el ID (cookie `HttpOnly`) y no guarda secretos de autenticación.
- **Login CSRF.** `create()` protege por sí misma el inicio de sesión frente a otra web que intente colocar su sesión en el navegador de la víctima; `GET`, `HEAD` y `OPTIONS` no se comprueban, porque los callbacks de OAuth y los enlaces mágicos llegan como navegación sin `Origin`: esos flujos validan su propio `state` o token de un solo uso.
- **Rotación y revocación atómicas.** Un logout desde un handle anterior invalida el ID activo aunque otra petición ya lo rotara, porque `revokeFamily` borra la sesión activa de la familia.
- **Cancelación.** Pase `context.signal` a `fetch` y a las consultas: se aborta si el cliente se va o si la sesión se revoca. El aborto es cooperativo.
- **Streaming.** Con `render: "stream"`, cambie la sesión antes del primer byte o en una ruta de API.
- **Tipos.** Los datos no se validan en ejecución: si cambia la forma de `MeekoSession`, las sesiones ya guardadas conservan la anterior hasta que caducan.

---
title: SessionRevokedError
group: server
since: 1.0.0
description: El ApiError 401 SESSION_REVOKED de una sesión revocada, rotada o caducada durante la petición, y el motivo de aborto de context.signal.
symbols:
  - "@meekojs/meeko/server#SessionRevokedError"
related:
  - "@meekojs/meeko/server#SessionHandle"
  - "@meekojs/meeko/server#ApiError"
  - "@meekojs/meeko/server#SessionSecurityError"
  - "@meekojs/meeko/framework#isClientError"
  - docs/framework.md#revocación-durante-una-petición
---

`SessionRevokedError` es un `ApiError` con código `SESSION_REVOKED` y estado `401`. Meeko lo usa en dos sitios:

- `context.session.verify()` lo lanza si la sesión de la petición fue revocada, sustituida por una rotación o caducó desde que se leyó;
- `context.session.signal`, y con ella `context.signal`, se aborta con él cuando otra petición u otra instancia revoca la familia de esa sesión.

Si escapa de un handler de API o RPC, la respuesta es `401 {"code":"SESSION_REVOKED", …}`; en el navegador llega como un `ClientError` con ese código.

## Uso

<!-- no-check -->
```ts
// server/api/orders/[id]/pay.post.ts
import { SessionRevokedError } from "@meekojs/meeko/server";

export default defineApiRoute({
  auth: "required",
  params: orderParams,
  response: okResult,
  handler: async ({ params, context }) => {
    try {
      await context.session.verify();
      await payments.charge(params.id, { signal: context.signal });
    } catch (error) {
      if (error instanceof SessionRevokedError) console.warn("sesión revocada antes del cobro", context.requestId);
      throw error; // 401 SESSION_REVOKED
    }
    return { ok: true as const };
  },
});
```

## Parámetros

`new SessionRevokedError()` no recibe argumentos. Hereda de `ApiError`:

| Propiedad | Valor |
| --- | --- |
| `code` | `"SESSION_REVOKED"` |
| `status` | `401` |
| `message` | `"Session revoked"` (interno; no se envía al cliente) |
| `name` | `"SessionRevokedError"` |

## Valor devuelto

Un `Error` que es también `ApiError`. `errorResponse` lo convierte en `401` con `{"code":"SESSION_REVOKED","status":401,"requestId":"…"}`.

## Ejemplos

### Cancelar el trabajo largo de una sesión revocada

<!-- no-check -->
```ts
handler: async ({ context }) => {
  // context.signal se aborta si el cliente se va o si otra pestaña cierra la sesión.
  const report = await fetch("https://reports.internal/generate", { method: "POST", signal: context.signal });
  return report.json();
},
```

Si la familia se revoca a mitad, `fetch` rechaza con el motivo del aborto, un `SessionRevokedError`, y la respuesta es `401`.

### Distinguir el motivo de un aborto

```ts
import { SessionRevokedError } from "@meekojs/meeko/server";

export function abortReason(signal: AbortSignal): "revoked" | "client" | "none" {
  if (!signal.aborted) return "none";
  return signal.reason instanceof SessionRevokedError ? "revoked" : "client";
}
```

### Llevar al inicio de sesión en el navegador

```ts
// El onError de mountClientApp, o el de un plugin de aplicación.
import { isClientError } from "@meekojs/meeko/framework";

export function onError(error: unknown): void {
  if (isClientError(error, "SESSION_REVOKED") || isClientError(error, "UNAUTHENTICATED")) location.assign("/login");
}
```

## Errores comunes

### Capturarlo y seguir

```ts bad
try { await context.session.verify(); } catch { /* seguimos */ }
await payments.charge(order);
```

El cobro se hace con una sesión que ya no vale. `verify()` existe para cortar antes de un efecto irreversible.

<!-- no-check -->
```ts good
await context.session.verify(); // si lanza, la respuesta es 401 y no se cobra
await payments.charge(order);
```

### Ignorar `context.signal`

```ts bad
const rows = await db.query(longReportSql); // sin señal
```

No hay error: la revocación aborta la señal, pero el aborto es cooperativo y el código que no la observa sigue hasta el final.

<!-- no-check -->
```ts good
const rows = await db.query(longReportSql, { signal: context.signal });
```

## Notas

- **Servidor.** Se importa de `@meekojs/meeko/server`. En el cliente se comprueba con `isClientError(error, "SESSION_REVOKED")`.
- **Entre instancias.** El aborto de una petición en otra instancia necesita un store con `subscribeRevocations` (`RedisSessionStore` con `subscriber`). Con SQL o D1, sólo `verify()` y la siguiente lectura lo detectan.
- **Socket.** Las conexiones de una familia revocada se cierran con `1008` («Session revoked»), sin esperar a otro evento.
- **La petición que revoca.** `revoke()` no aborta su propia petición, porque debe enviar la cookie vacía.
- **Sólo `4xx`.** Un `401` es una respuesta prevista: no llega a `onError` del runtime.

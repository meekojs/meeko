---
title: SessionSecurityError
group: server
since: 1.0.0
description: Una mutación no superó la comprobación de Origin o de CSRF de la sesión, con el código INVALID_ORIGIN o INVALID_CSRF; las respuestas de API y RPC la convierten en 403.
symbols:
  - "@meekojs/meeko/server#SessionSecurityError"
related:
  - "@meekojs/meeko/server#SessionManager"
  - "@meekojs/meeko/server#SessionHandle"
  - "@meekojs/meeko/server#SessionRevokedError"
  - "@meekojs/meeko/server#errorResponse"
  - docs/framework.md#sesiones-y-seguridad
  - docs/framework.md#origin-en-mutaciones-anónimas
---

`SessionSecurityError` señala que una petición que cambia datos no superó una comprobación de la sesión. Su `code` es:

- `INVALID_ORIGIN`: la cabecera `Origin` falta, es `null` o no es el origen de la aplicación ni uno de `SessionManager.allowedOrigins`;
- `INVALID_CSRF`: la petición trae la cookie de sesión, pero no la cabecera `x-meeko-csrf` con el token de esa sesión.

La lanzan `SessionManager.assertMutationAllowed` y, desde `1.2`, `session.create()` en una mutación sin un `Origin` permitido. API, RPC y `errorResponse` la convierten en `403` con su código.

## Uso

```ts
import { MemorySessionStore, SessionManager, SessionSecurityError } from "@meekojs/meeko/server";

const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });

export async function guard(request: Request): Promise<Response | undefined> {
  const session = await sessions.load(request);
  try {
    sessions.assertMutationAllowed(request, session);
    return undefined;
  } catch (error) {
    if (error instanceof SessionSecurityError) return Response.json({ code: error.code }, { status: 403 });
    throw error;
  }
}
```

## Parámetros

`new SessionSecurityError(code)`:

| Parámetro | Tipo | Descripción |
| --- | --- | --- |
| `code` | `"INVALID_ORIGIN" \| "INVALID_CSRF"` | El motivo; también es el `message`. |

## Valor devuelto

Un `Error` con `code`. No hereda de `ApiError`, pero `errorResponse` lo reconoce: `403 {"code":"INVALID_CSRF","status":403,"requestId":"…"}`.

## Ejemplos

### Una petición de otro origen

```http
POST /api/profile HTTP/1.1
Host: app.example.com
Origin: https://evil.example
Cookie: __Host-meeko.sid=…
```

Respuesta: `403 {"code":"INVALID_ORIGIN",…}`, antes de validar la entrada o ejecutar el handler.

### Un script que llama a la API con la cookie

```js
// Desde el navegador, en la misma aplicación: el cliente api.* ya lo hace.
const token = document.querySelector('meta[name="meeko-csrf-token"]').content;
await fetch("/api/profile", {
  method: "PUT",
  headers: { "content-type": "application/json", "x-meeko-csrf": token },
  body: JSON.stringify({ name: "Ada" }),
});
```

El navegador añade `Origin` por sí mismo. Tras cada respuesta que rota la sesión, el token nuevo llega en `x-meeko-csrf-token`.

### Aceptar el panel de otro subdominio

<!-- no-check -->
```ts
new SessionManager({ store, production, allowedOrigins: ["https://admin.example.com"] });
```

## Errores comunes

### Llamar a la API con `fetch` sin el token

```js bad
await fetch("/api/profile", { method: "PUT", body: JSON.stringify({ name: "Ada" }) });
```

Con sesión, la respuesta es `403 INVALID_CSRF`. Use el cliente generado (`api.profile.put({ body })`), que envía el token, o añada `x-meeko-csrf`.

<!-- no-check -->
```ts good
await api.profile.put({ body: { name: "Ada" } });
```

### Un proxy sin `MEEKO_PUBLIC_ORIGIN`

```text bad
Navegador → https://app.example.com → proxy TLS → http://127.0.0.1:4173 (sin MEEKO_PUBLIC_ORIGIN)
```

La aplicación ve su propio origen como `http://127.0.0.1:4173`; el `Origin` del navegador (`https://app.example.com`) no coincide y cada mutación autenticada responde `403 INVALID_ORIGIN`.

```text good
MEEKO_PUBLIC_ORIGIN=https://app.example.com
```

### Un cliente nativo sin `Origin`

```sh bad
curl -X POST https://app.example.com/api/auth/login -d '{…}'
```

Una ruta con `origin: "required"`, o `session.create()` en esa ruta, responde `403 INVALID_ORIGIN`. Envíe el origen de la aplicación.

```sh good
curl -X POST https://app.example.com/api/auth/login -H 'origin: https://app.example.com' -H 'content-type: application/json' -d '{…}'
```

## Notas

- **Qué protege.** Origin y CSRF son la defensa frente a una web ajena que envía formularios o `fetch` con la cookie del usuario. Una petición sin cookie no tiene token: para el inicio de sesión, use `origin: "required"`.
- **Métodos.** `GET`, `HEAD` y `OPTIONS` no se comprueban: no deben cambiar datos.
- **Socket.** Un upgrade con un `Origin` ajeno responde `403 INVALID_ORIGIN` por HTTP y nunca llega a la sesión.
- **Respuesta prevista.** Un `403` no llega a `onError` del runtime.

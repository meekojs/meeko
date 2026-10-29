---
title: errorResponse
group: server
since: 1.0.0
description: Convierte cualquier error en la respuesta JSON pública de Meeko, { code, status, requestId }, sin filtrar el mensaje de los errores inesperados.
symbols:
  - "@meekojs/meeko/server#errorResponse"
related:
  - "@meekojs/meeko/server#ApiError"
  - "@meekojs/meeko/server#SessionRevokedError"
  - "@meekojs/meeko/server#SessionSecurityError"
  - "@meekojs/meeko/framework#ClientError"
  - docs/framework.md#errores
  - docs/framework.md#api-y-rpc
  - docs/framework.md#errores-de-validación-en-formularios
---

`errorResponse(error, requestId)` es la forma única en que Meeko responde a un fallo de API, RPC, del despacho local o de un adaptador: un `Response` JSON con `{ code, status, requestId }` y la cabecera `x-request-id`. Un `ApiError` conserva su código y su estado; cualquier otro error es `500 INTERNAL_ERROR`, sin su mensaje ni su traza, que sólo ven los observadores del servidor.

Úselo en un host propio o en un middleware de servidor para que sus errores tengan la misma forma que los de Meeko y el cliente los reciba como un `ClientError` con su `code`.

## Uso

```ts
import { ApiError, errorResponse } from "@meekojs/meeko/server";

const response = errorResponse(new ApiError("NOT_FOUND", 404), crypto.randomUUID());
// 404 {"code":"NOT_FOUND","status":404,"requestId":"…"} con x-request-id
```

## Parámetros

| Parámetro | Tipo | Descripción |
| --- | --- | --- |
| `error` | `unknown` | El error capturado. |
| `requestId` | `string` | El ID de la petición: va en el cuerpo y en `x-request-id`, y es el que `onError` recibe con el error privado. |

## Valor devuelto

Un `Response` con `content-type: application/json; charset=utf-8` y `x-request-id`:

| Error | Estado | Cuerpo |
| --- | --- | --- |
| `ApiError("CODE", status)` | `status` | `{"code":"CODE","status":…,"requestId":"…"}` |
| `ApiError` con `issues` y estado `4xx` (desde `1.5`) | `status` | Añade `issues: [{ path, message }]`, como mucho 20. En un `5xx` no se envían. |
| Entrada que no supera su schema | `400` | `INVALID_PARAMS`, `INVALID_QUERY`, `INVALID_BODY` o `INVALID_INPUT`, con `issues` (desde `1.2`). |
| `rateLimit` superado | `429` | `RATE_LIMITED`, con `Retry-After` en segundos (desde `1.2`). |
| `SessionRevokedError` | `401` | `SESSION_REVOKED` |
| `SessionSecurityError` | `403` | `INVALID_ORIGIN` o `INVALID_CSRF` |
| Cualquier otro | `500` | `INTERNAL_ERROR`, sin mensaje |

## Ejemplos

### Un middleware que corta con la forma de Meeko

```ts
// server/middleware/05-api-key.ts
import { ApiError, defineServerMiddleware, errorResponse } from "@meekojs/meeko/server";

export default defineServerMiddleware(async (request, next) => {
  const { pathname } = new URL(request.url);
  if (pathname.startsWith("/api/partners/") && request.headers.get("x-api-key") !== process.env.PARTNER_API_KEY) {
    return errorResponse(new ApiError("INVALID_API_KEY", 401), crypto.randomUUID());
  }
  return next();
});
```

En el navegador, `api.partners.*` rechaza con un `ClientError` cuyo `code` es `INVALID_API_KEY`.

### Errores por campo que llegan a `useForm`

```ts
import { ApiError, errorResponse } from "@meekojs/meeko/server";

export const conflict = errorResponse(
  new ApiError("EMAIL_TAKEN", 409, { issues: [{ path: "email", message: "Ese correo ya tiene una cuenta." }] }),
  crypto.randomUUID(),
);
// 409 {"code":"EMAIL_TAKEN","status":409,"requestId":"…","issues":[{"path":"email","message":"Ese correo ya tiene una cuenta."}]}
```

### Un handler de un host propio que nunca rechaza

<!-- no-check -->
```ts
async function handle(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    return await route(request);
  } catch (error) {
    logger.error({ requestId, error }); // el mensaje privado, sólo en el servidor
    return errorResponse(error, requestId);
  }
}
```

## Errores comunes

### Enviar el mensaje del error al cliente

```ts bad
catch (error) { return Response.json({ error: String(error) }, { status: 500 }); }
```

Un error de base de datos o de un servicio puede llevar consultas, rutas o datos personales. `errorResponse` sólo publica el código; el detalle va a `onError` con el mismo `requestId`, que el usuario puede citar.

<!-- no-check -->
```ts good
catch (error) { app.reportError(error, requestId); return errorResponse(error, requestId); }
```

### Lanzar un `Error` con un estado

```ts bad
throw Object.assign(new Error("No encontrado"), { status: 404 });
```

Sólo `ApiError` conserva el estado: esto responde `500 INTERNAL_ERROR` y llega a `onError` como un fallo del servidor.

<!-- no-check -->
```ts good
throw new ApiError("NOT_FOUND", 404);
```

### `issues` en un `5xx`

```ts bad
throw new ApiError("BROKEN", 503, { issues: [{ path: "email", message: "El servicio de correo falló." }] });
```

La respuesta es `503 {"code":"BROKEN",…}` sin `issues`: los mensajes por campo sólo viajan con un estado `4xx`.

<!-- no-check -->
```ts good
throw new ApiError("MAIL_UNAVAILABLE", 503);
```

## Notas

- **Seguridad.** Nunca escribe el mensaje, la traza ni la causa de un error que no sea `ApiError`. El mensaje de un `ApiError` (su tercer argumento) también es interno.
- **Observadores.** `errorResponse` no informa a nadie: el despacho de Meeko llama además a `onError` para los `5xx`. En un host propio, informe usted del error con el mismo `requestId`.
- **Cliente.** El navegador recibe el cuerpo como `ClientError` (`code`, `status`, `requestId`, `issues`); `isClientError(error, "CODE")` lo comprueba.

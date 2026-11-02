---
title: errorResponse
group: server
since: 1.0.0
description: Converts any error into Meeko's public JSON response, { code, status, requestId }, without leaking unexpected error messages.
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
source-hash: 749c259e8ec9bb77700a5f8f1b3a3d83a60ef9fe3eac43716947c98058f01e9b
---

`errorResponse(error, requestId)` is the single format Meeko uses to respond to API, RPC, local dispatch or adapter failures: a JSON `Response` with `{ code, status, requestId }` and the `x-request-id` header. An `ApiError` keeps its code and status; any other error becomes `500 INTERNAL_ERROR`, without its message or stack trace, which only server observers see.

Use it in a custom host or server middleware so your errors have the same shape as Meeko's and the client receives them as a `ClientError` with their `code`.

## Usage

```ts
import { ApiError, errorResponse } from "@meekojs/meeko/server";

const response = errorResponse(new ApiError("NOT_FOUND", 404), crypto.randomUUID());
// 404 {"code":"NOT_FOUND","status":404,"requestId":"…"} con x-request-id
```

## Parameters

| Parameter   | Type      | Description                                                                                                |
| ----------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| `error`     | `unknown` | The caught error.                                                                                          |
| `requestId` | `string`  | The request ID: included in the body and `x-request-id`, and received by `onError` with the private error. |

## Return value

A `Response` with `content-type: application/json; charset=utf-8` and `x-request-id`:

| Error                                                   | Status   | Body                                                                                               |
| ------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `ApiError("CODE", status)`                              | `status` | `{"code":"CODE","status":…,"requestId":"…"}`                                                       |
| `ApiError` with `issues` and `4xx` status (since `1.5`) | `status` | Adds at most 20 `issues: [{ path, message }]`. Not sent for a `5xx`.                               |
| Input that fails its schema                             | `400`    | `INVALID_PARAMS`, `INVALID_QUERY`, `INVALID_BODY` or `INVALID_INPUT`, with `issues` (since `1.2`). |
| `rateLimit` exceeded                                    | `429`    | `RATE_LIMITED`, with `Retry-After` in seconds (since `1.2`).                                       |
| `SessionRevokedError`                                   | `401`    | `SESSION_REVOKED`                                                                                  |
| `SessionSecurityError`                                  | `403`    | `INVALID_ORIGIN` or `INVALID_CSRF`                                                                 |
| Anything else                                           | `500`    | `INTERNAL_ERROR`, without a message                                                                |

## Examples

### Middleware that stops execution using Meeko's format

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

In the browser, `api.partners.*` rejects with a `ClientError` whose `code` is `INVALID_API_KEY`.

### Field errors that reach `useForm`

```ts
import { ApiError, errorResponse } from "@meekojs/meeko/server";

export const conflict = errorResponse(
  new ApiError("EMAIL_TAKEN", 409, { issues: [{ path: "email", message: "Ese correo ya tiene una cuenta." }] }),
  crypto.randomUUID(),
);
// 409 {"code":"EMAIL_TAKEN","status":409,"requestId":"…","issues":[{"path":"email","message":"Ese correo ya tiene una cuenta."}]}
```

### A custom host handler that never rejects

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

## Common mistakes

### Send the error message to the client

```ts bad
catch (error) { return Response.json({ error: String(error) }, { status: 500 }); }
```

A database or service error may contain queries, paths or personal data. `errorResponse` only publishes the code; details go to `onError` with the same `requestId`, which the user can quote.

<!-- no-check -->

```ts good
catch (error) { app.reportError(error, requestId); return errorResponse(error, requestId); }
```

### Throw an `Error` with a status

```ts bad
throw Object.assign(new Error("No encontrado"), { status: 404 });
```

Only `ApiError` keeps the status: this responds with `500 INTERNAL_ERROR` and reaches `onError` as a server failure.

<!-- no-check -->

```ts good
throw new ApiError("NOT_FOUND", 404);
```

### `issues` in a `5xx`

```ts bad
throw new ApiError("BROKEN", 503, { issues: [{ path: "email", message: "El servicio de correo falló." }] });
```

The response is `503 {"code":"BROKEN",…}` without `issues`: field messages only travel with a `4xx` status.

<!-- no-check -->

```ts good
throw new ApiError("MAIL_UNAVAILABLE", 503);
```

## Notes

- **Security.** Never writes the message, stack trace or cause of an error other than `ApiError`. An `ApiError`'s message (its third argument) is also internal.
- **Observers.** `errorResponse` does not notify anyone: Meeko's dispatcher also calls `onError` for `5xx` responses. In a custom host, report the error yourself with the same `requestId`.
- **Client.** The browser receives the body as a `ClientError` (`code`, `status`, `requestId`, `issues`); `isClientError(error, "CODE")` checks it.

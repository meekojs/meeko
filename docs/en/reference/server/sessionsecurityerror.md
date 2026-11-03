---
title: SessionSecurityError
group: server
since: 1.0.0
description: A mutation failed the session's Origin or CSRF check, with code INVALID_ORIGIN or INVALID_CSRF; API and RPC responses convert it to 403.
symbols:
  - "@meekojs/meeko/server#SessionSecurityError"
related:
  - "@meekojs/meeko/server#SessionManager"
  - "@meekojs/meeko/server#SessionHandle"
  - "@meekojs/meeko/server#SessionRevokedError"
  - "@meekojs/meeko/server#errorResponse"
  - docs/framework.md#sesiones-y-seguridad
  - docs/framework.md#origin-en-mutaciones-anónimas
source-hash: f130ce59dc5ac5edad569e930e544f5b0496574141fa5fd06498b03bb7e67e2c
---

`SessionSecurityError` indicates that a request changing data failed a session check. Its `code` is:

- `INVALID_ORIGIN`: the `Origin` header is missing, is `null` or is neither the application's origin nor one of `SessionManager.allowedOrigins`;
- `INVALID_CSRF`: the request carries the session cookie but not the `x-meeko-csrf` header with that session's token.

Thrown by `SessionManager.assertMutationAllowed` and, since `1.2`, `session.create()` on a mutation without an allowed `Origin`. API, RPC and `errorResponse` convert it to `403` with its code.

## Usage

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

## Parameters

`new SessionSecurityError(code)`:

| Parameter | Type                                 | Description                     |
| --------- | ------------------------------------ | ------------------------------- |
| `code`    | `"INVALID_ORIGIN" \| "INVALID_CSRF"` | The reason; also the `message`. |

## Return value

An `Error` with `code`. It does not extend `ApiError`, but `errorResponse` recognizes it: `403 {"code":"INVALID_CSRF","status":403,"requestId":"…"}`.

## Examples

### A request from another origin

```http
POST /api/profile HTTP/1.1
Host: app.example.com
Origin: https://evil.example
Cookie: __Host-meeko.sid=…
```

Response: `403 {"code":"INVALID_ORIGIN",…}`, before validating input or executing the handler.

### A script calling the API with the cookie

```js
// From the browser, in the same application: the api.* client already does this.
const token = document.querySelector('meta[name="meeko-csrf-token"]').content;
await fetch("/api/profile", {
  method: "PUT",
  headers: { "content-type": "application/json", "x-meeko-csrf": token },
  body: JSON.stringify({ name: "Ada" }),
});
```

The browser adds `Origin` itself. After each response rotating the session, the new token arrives in `x-meeko-csrf-token`.

### Accept a dashboard on another subdomain

<!-- no-check -->

```ts
new SessionManager({ store, production, allowedOrigins: ["https://admin.example.com"] });
```

## Common mistakes

### Calling the API with `fetch` without the token

```js bad
await fetch("/api/profile", { method: "PUT", body: JSON.stringify({ name: "Ada" }) });
```

With a session, the response is `403 INVALID_CSRF`. Use the generated client (`api.profile.put({ body })`), which sends the token, or add `x-meeko-csrf`.

<!-- no-check -->

```ts good
await api.profile.put({ body: { name: "Ada" } });
```

### A proxy without `MEEKO_PUBLIC_ORIGIN`

```text bad
Browser → https://app.example.com → TLS proxy → http://127.0.0.1:4173 (without MEEKO_PUBLIC_ORIGIN)
```

The application sees its own origin as `http://127.0.0.1:4173`; the browser's `Origin` (`https://app.example.com`) does not match and every authenticated mutation returns `403 INVALID_ORIGIN`.

```text good
MEEKO_PUBLIC_ORIGIN=https://app.example.com
```

### A native client without `Origin`

```sh bad
curl -X POST https://app.example.com/api/auth/login -d '{…}'
```

Since `1.8`, every mutation without `Origin` returns `403 INVALID_ORIGIN`, also without a session (previously only with `origin: "required"` or in `session.create()`). Send the application's origin, or declare `origin: "none"` on a route that cannot receive it and verify another proof, such as a signature.

```sh good
curl -X POST https://app.example.com/api/auth/login -H 'origin: https://app.example.com' -H 'content-type: application/json' -d '{…}'
```

## Notes

- **What it protects.** Origin and CSRF defend against another website sending forms or `fetch` requests with the user's cookie. A request without a cookie has no token, so since `1.8` only its `Origin` is checked, on every mutation except with `origin: "none"`.
- **Methods.** `GET`, `HEAD` and `OPTIONS` are not checked: they must not change data.
- **Socket.** An upgrade with a foreign `Origin` returns `403 INVALID_ORIGIN` over HTTP and never reaches the session.
- **Expected response.** A `403` does not reach the runtime's `onError`.

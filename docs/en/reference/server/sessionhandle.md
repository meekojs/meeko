---
title: SessionHandle
group: server
since: 1.0.0
description: A request's session, in context.session, to read, create, rotate, revoke and verify before an irreversible effect.
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
source-hash: 82cede0e6d88693244aeb0583d79db66dfab1f320ac9bd43d2cf97382516231f
---

`SessionHandle` is a request's session. Do not construct it manually: `SessionManager.load` creates it for each request and it reaches API and RPC handlers as `context.session`, pages' `<script server>` (`usePage().context.session`), server route middleware (`session`) and Socket channels. `current` is the active session if the request carries a valid one; `create`, `rotate` and `revoke` change it and prepare the response cookie.

Data has the `MeekoSession` type when declared by the application (since `1.2`), or `unknown`.

## Usage

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
    // Replaces the anonymous session, if any, with a new ID and CSRF token.
    await context.session.create({ userId: user.id, role: user.role });
    return { ok: true as const };
  },
});
```

## Parameters

Applications do not construct it. Its members:

| Member                   | Type                            | Description                                                                                                                                                                            |
| ------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `current`                | `SessionRecord<T> \| undefined` | The active session: `id`, `familyId`, `csrfToken`, `data`, `createdAt`, `expiresAt` and, if set, `ttlMs`. `undefined` without a session.                                               |
| `create(data, options?)` | `Promise<SessionRecord<T>>`     | Creates a session with a random ID, family and CSRF token. If one already exists, replaces it atomically while preserving its family. `options.ttlMs` (since `1.2`) sets its lifetime. |
| `rotate()`               | `Promise<SessionRecord<T>>`     | Changes the ID and CSRF token while preserving data, family and lifetime. Expiration is counted from rotation.                                                                         |
| `revoke()`               | `Promise<void>`                 | Revokes the entire family, including in other requests and instances, and clears the cookie. The calling request is not aborted.                                                       |
| `verify()`               | `Promise<void>`                 | Rereads the store and throws `SessionRevokedError` if the session was revoked, replaced by rotation or expired. Does nothing without a session.                                        |
| `signal`                 | `AbortSignal`                   | Aborted with `SessionRevokedError` when another request or instance revokes the family. `context.signal` includes it.                                                                  |
| `cookieHeader`           | `string \| undefined`           | The pending `Set-Cookie` header after creation, rotation or revocation.                                                                                                                |

## Return value

`create` and `rotate` return the new `SessionRecord`, which becomes `current`; the response carries its cookie and the new token in `x-meeko-csrf-token`. `revoke` sets `current` to `undefined` and the cookie to `Max-Age=0`.

## Examples

### Log out

```ts
// server/api/auth/logout.post.ts
import { defineApiRoute } from "@meekojs/meeko/server";

export default defineApiRoute({
  auth: "required",
  status: 204,
  handler: async ({ context }) => { await context.session.revoke(); },
});
```

`auth: "required"` and the CSRF token protect the route; other tabs and open sockets belonging to that family close.

### Different lifetimes per role

<!-- no-check -->

```ts
const ttlMs = user.role === "staff" ? 12 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
await context.session.create({ userId: user.id, role: user.role }, { ttlMs });
```

The lifetime sets the cookie's `Max-Age` and the store's `expiresAt`, and `rotate()` preserves it.

### Rotate after elevating privileges

<!-- no-check -->

```ts
// server/rpc/account/confirm-password.ts
export default defineRpc({
  input: passwordInput,
  output: okOutput,
  auth: "required",
  handler: async ({ input, context }) => {
    await checkPassword(context.session.current!.data.userId, input.password);
    await context.session.rotate(); // new ID and token: a previously stolen ID becomes invalid
    return { ok: true };
  },
});
```

### Verify before charging

<!-- no-check -->

```ts
handler: async ({ body, context }) => {
  await context.session.verify();                 // 401 SESSION_REVOKED si ya no vale
  await payments.charge(body.orderId, { signal: context.signal });
  return { ok: true };
},
```

Cross-instance revocation arrives asynchronously; `verify()` rereads the store immediately before the effect.

### A page that requires a session

```html
<!-- app/pages/dashboard.meeko -->
<script server lang="ts">
const { context } = usePage();
const session = context.session.current;
if (!session) redirect("/login");
export const userId = session.data.userId;
</script>

<template><h1>Hello, {userId}</h1></template>
```

## Common mistakes

### Logging in from a script without `Origin`

```sh bad
curl -X POST https://app.example.com/api/auth/login -H 'content-type: application/json' -d '{"email":"…","password":"…"}'
```

Since `1.2`, `create()` in a `POST`, `PUT`, `PATCH` or `DELETE` requires an allowed `Origin`: it returns `403 INVALID_ORIGIN` without touching the store. In development, the first rejection writes the warning `[meeko] session.create() rechazó una petición sin un Origin permitido (403 INVALID_ORIGIN)…`.

```sh good
curl -X POST https://app.example.com/api/auth/login -H 'origin: https://app.example.com' -H 'content-type: application/json' -d '{"email":"…","password":"…"}'
```

`origin: "none"` on the route disables the check, but leaves login exposed to _login CSRF_.

### Creating the session after a stream's first byte

```ts bad
// render: "stream": the deferred value resolves after the document has started sending
load: async ({ context }) => ({
  user: defer(context.session.create({ userId }).then(() => userId)),
}),
```

Headers have already been sent: `create`, `rotate` and `revoke` reject with `500 SESSION_LOCKED: the session cookie was already sent with the response headers; create, rotate or revoke the session in the loader, before any deferred work`.

<!-- no-check -->

```ts good
// In the loader or critical part, before the first byte; better still, in an API.
await context.session.create({ userId });
```

### Rotating without a session

```ts bad
await context.session.rotate(); // in an anonymous request
```

Throws `Error: No active session to rotate`, which the response converts to `500 INTERNAL_ERROR`. If the session expired or was revoked between reading and rotation, the error is `Session has expired or been revoked`.

<!-- no-check -->

```ts good
if (context.session.current) await context.session.rotate();
```

### An invalid lifetime

```ts bad
await context.session.create(data, { ttlMs: 0 });
```

Rejects with `RangeError: Invalid session TTL` without touching the store.

<!-- no-check -->

```ts good
await context.session.create(data, { ttlMs: 60 * 60 * 1000 });
```

## Notes

- **Server.** Exists only on the server. The browser never receives the ID (`HttpOnly` cookie) and stores no authentication secrets.
- **Login CSRF.** `create()` protects login itself against another website attempting to place its session in the victim's browser; `GET`, `HEAD` and `OPTIONS` are not checked, because OAuth callbacks and magic links arrive as navigation without `Origin`: those flows validate their own `state` or single-use token.
- **Atomic rotation and revocation.** A logout from an earlier handle invalidates the active ID even if another request has already rotated it, because `revokeFamily` deletes the family's active session.
- **Cancellation.** Pass `context.signal` to `fetch` and queries: it aborts if the client leaves or the session is revoked. Aborting is cooperative.
- **Streaming.** With `render: "stream"`, change the session before the first byte or in an API route.
- **Types.** Data is not validated at runtime: if you change the shape of `MeekoSession`, stored sessions retain the previous shape until they expire.

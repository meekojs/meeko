---
title: SessionRevokedError
group: server
since: 1.0.0
description: The 401 SESSION_REVOKED ApiError for a session revoked, rotated or expired during the request, and the abort reason of context.signal.
symbols:
  - "@meekojs/meeko/server#SessionRevokedError"
related:
  - "@meekojs/meeko/server#SessionHandle"
  - "@meekojs/meeko/server#ApiError"
  - "@meekojs/meeko/server#SessionSecurityError"
  - "@meekojs/meeko/framework#isClientError"
  - docs/framework.md#revocación-durante-una-petición
source-hash: c4039d2d245fb0e4e9c0b6d360ae09bac5176e8e3badc119a4fde8cbe5c87d13
---

`SessionRevokedError` is an `ApiError` with code `SESSION_REVOKED` and status `401`. Meeko uses it in two places:

- `context.session.verify()` throws it if the request's session was revoked, replaced by rotation or expired since it was read;
- `context.session.signal`, and with it `context.signal`, is aborted with it when another request or instance revokes that session's family.

If it escapes an API or RPC handler, the response is `401 {"code":"SESSION_REVOKED", …}`; in the browser it arrives as a `ClientError` with that code.

## Usage

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
      if (error instanceof SessionRevokedError) console.warn("session revoked before charging", context.requestId);
      throw error; // 401 SESSION_REVOKED
    }
    return { ok: true as const };
  },
});
```

## Parameters

`new SessionRevokedError()` takes no arguments. It inherits from `ApiError`:

| Property  | Value                                                  |
| --------- | ------------------------------------------------------ |
| `code`    | `"SESSION_REVOKED"`                                    |
| `status`  | `401`                                                  |
| `message` | `"Session revoked"` (internal; not sent to the client) |
| `name`    | `"SessionRevokedError"`                                |

## Return value

An `Error` that is also an `ApiError`. `errorResponse` converts it into `401` with `{"code":"SESSION_REVOKED","status":401,"requestId":"…"}`.

## Examples

### Cancel long-running work for a revoked session

<!-- no-check -->

```ts
handler: async ({ context }) => {
  // context.signal is aborted if the client leaves or another tab logs out.
  const report = await fetch("https://reports.internal/generate", { method: "POST", signal: context.signal });
  return report.json();
},
```

If the family is revoked midway, `fetch` rejects with the abort reason, a `SessionRevokedError`, and the response is `401`.

### Distinguish the reason for an abort

```ts
import { SessionRevokedError } from "@meekojs/meeko/server";

export function abortReason(signal: AbortSignal): "revoked" | "client" | "none" {
  if (!signal.aborted) return "none";
  return signal.reason instanceof SessionRevokedError ? "revoked" : "client";
}
```

### Send the browser to sign-in

```ts
// mountClientApp's onError, or an application plugin's.
import { isClientError } from "@meekojs/meeko/framework";

export function onError(error: unknown): void {
  if (isClientError(error, "SESSION_REVOKED") || isClientError(error, "UNAUTHENTICATED")) location.assign("/login");
}
```

## Common mistakes

### Catch it and continue

```ts bad
try { await context.session.verify(); } catch { /* continue */ }
await payments.charge(order);
```

The charge is made using a session that is no longer valid. `verify()` exists to stop execution before an irreversible side effect.

<!-- no-check -->

```ts good
await context.session.verify(); // if it throws, the response is 401 and no charge is made
await payments.charge(order);
```

### Ignore `context.signal`

```ts bad
const rows = await db.query(longReportSql); // without a signal
```

There is no error: revocation aborts the signal, but aborting is cooperative and code that does not observe it continues to completion.

<!-- no-check -->

```ts good
const rows = await db.query(longReportSql, { signal: context.signal });
```

## Notes

- **Server.** Import it from `@meekojs/meeko/server`. On the client, check with `isClientError(error, "SESSION_REVOKED")`.
- **Across instances.** Aborting a request in another instance requires a store with `subscribeRevocations` (`RedisSessionStore` with `subscriber`). With SQL or D1, only `verify()` and the next read detect it.
- **Socket.** Connections in a revoked family close with `1008` (“Session revoked”), without waiting for another event.
- **The revoking request.** `revoke()` does not abort its own request, because it must send the empty cookie.
- **Only `4xx`.** A `401` is an expected response: it does not reach the runtime's `onError`.

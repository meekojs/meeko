---
title: ApiError
group: utils
since: 1.0.0
description: Public API, RPC, Socket and loader error, delivered to the client with its code, status and, since 1.5, field messages and, since 1.10, public data.
symbols:
  - "@meekojs/meeko/server#ApiError"
types:
  - "@meekojs/meeko/server#ApiErrorDetails"
related:
  - "@meekojs/meeko/framework#ClientError"
  - "@meekojs/meeko/framework#isClientError"
  - "@meekojs/meeko/server#defineApiRoute"
  - "@meekojs/meeko/server#defineRpc"
  - "@meekojs/meeko/framework#useForm"
  - docs/framework.md#errores-de-un-campo-apierror-con-issues
  - docs/framework.md#datos-públicos-de-un-error-apierror-con-details
  - docs/framework.md#errores
source-hash: bc5e4fbaf4c9c400c12d0e210366023c1de23fadf40cbe0238f6cf815b33313e
---

`new ApiError(code, status, mensaje?)` is the error the server **can disclose** to the client. When thrown from an endpoint, RPC procedure, Socket channel, loader or `defer`, the response carries its `code` and `status`, plus the request's `requestId`. Any other error is returned as `INTERNAL_ERROR`/`500` without exposing its message.

Since `1.5`, the third argument also accepts `{ message, issues }`: `issues` contains public field messages, shaped like those from a validation `400`, which `useForm` displays beside each field. Since `1.10`, `details` adds structured public data (a JSON object) so the client can react to the error. `message` is always internal.

It is auto-imported in server code.

## Usage

<!-- no-check -->

```ts
// server/rpc/users/get.ts
import { ApiError, defineRpc } from "@meekojs/meeko/server";
import { userParams, userSchema } from "../../../shared/schemas/user";

export default defineRpc({
  input: userParams,
  output: userSchema,
  handler: async ({ input }) => {
    const user = await findUser(input.id);
    if (!user) throw new ApiError("USER_NOT_FOUND", 404);
    return user;
  },
});
```

The response is `404` with `{ "code": "USER_NOT_FOUND", "status": 404, "requestId": "…" }`, and `rpc.users.get(…)` rejects with a `ClientError` with that `code` and `status`.

## Parameters

| Parameter | Type                                          | Default  | Description                                                                                                                                                                     |
| --------- | --------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code`    | `string`                                      | required | Stable public code the client can compare: `"NOT_FOUND"`, `"EMAIL_TAKEN"`.                                                                                                      |
| `status`  | `number`                                      | required | HTTP response status, usually a `4xx`.                                                                                                                                          |
| `message` | `string` or `{ message?, issues?, details? }` | `code`   | The internal message, which is never sent. Since `1.5`, `issues: [{ path, message }]` adds public field messages, and since `1.10`, `details` (`ApiErrorDetails`), public data. |

Each issue needs a string `path` (keys joined with `.`, or `""` for the whole form) and a nonempty `message`. `details` is a JSON object (strings, finite numbers, booleans, `null`, arrays and plain objects, at most 32 levels); any other value throws a `TypeError`, and the error keeps a frozen copy.

## Return value

An `Error` instance with `name: "ApiError"`, `code`, `status`, `message`, `issues` and `details`. What reaches the client:

| Field            | Transferred              | Notes                                           |
| ---------------- | ------------------------ | ----------------------------------------------- |
| `code`, `status` | Yes                      | Plus `requestId` and the `x-request-id` header. |
| `issues`         | Only with a `4xx` status | At most 20.                                     |
| `details`        | Only with a `4xx` status | Since `1.10`; in `ClientError.details`.         |
| `message`        | Never                    | Use it for server logs.                         |

## Examples

### A field conflict

<!-- no-check -->

```ts
// server/api/signup.post.ts
import { ApiError, defineApiRoute } from "@meekojs/meeko/server";
import { signupInput, signupResult } from "../../shared/schemas/signup";

export default defineApiRoute({
  body: signupInput,
  response: signupResult,
  status: 201,
  handler: async ({ body }) => {
    if (await emailTaken(body.email)) {
      throw new ApiError("EMAIL_TAKEN", 409, {
        message: `duplicate key for ${body.email}`, // interno
        issues: [{ path: "email", message: "That email already has an account." }],
      });
    }
    return createUser(body);
  },
});
```

On the client, `useForm`'s `form.errors.value.email` is “That email already has an account.”.

### Data the client can react to

Since `1.10`, an optimistic concurrency conflict sends the current version so the client can reload or retry:

<!-- no-check -->

```ts
// server/rpc/visits/update.ts
import { ApiError, defineRpc } from "@meekojs/meeko/server";

export default defineRpc({
  input: visitUpdate,
  output: visitSchema,
  handler: async ({ input }) => {
    const visit = await visits.find(input.id);
    if (visit.version !== input.version) {
      throw new ApiError("VERSION_CONFLICT", 409, { message: `visit ${visit.id} is stale`, details: { actualVersion: visit.version } });
    }
    return visits.update(visit, input);
  },
});
```

The response is `409` with `{ "code": "VERSION_CONFLICT", …, "details": { "actualVersion": 8 } }`, and `isClientError(error, "VERSION_CONFLICT")` gives access to `error.details` (see [`isClientError`](/en/docs/reference/isclienterror)).

### A `404` from a loader

An `ApiError` with status `404` in a loader shows the nearest error page with `{ status: 404, message: "NOT_FOUND" }`:

<!-- no-check -->

```ts
// app/pages/products/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";
import { ApiError } from "@meekojs/meeko/server";

export const route = definePage({
  load: async ({ params }) => {
    const product = await catalog.find(params.slug);
    if (!product) throw new ApiError("NOT_FOUND", 404);
    return { name: product.name };
  },
});
```

### Permission errors from `locals`

<!-- no-check -->

```ts
locals: async ({ session }) => {
  const user = await findUser((session.current!.data as { userId: string }).userId);
  if (!user) throw new ApiError("UNAUTHENTICATED", 401);
  if (!user.active) throw new ApiError("ACCOUNT_DISABLED", 403);
  return { user };
},
```

## Common mistakes

### Putting private data in the code or `issues`

`code` and `issues` reach the browser; `message` does not. Private data in the public part leaks without any error.

```ts bad
throw new ApiError(`USER_${user.email}_LOCKED`, 403);
```

<!-- no-check -->

```ts good
throw new ApiError("ACCOUNT_LOCKED", 403, { message: `locked: ${user.email}` });
```

### Passing a non-JSON object to `details`

```ts bad
throw new ApiError("BOOKING_TAKEN", 409, { details: { until: new Date() } });
```

`meeko check` reports a `TS2322` on `until`. Without types, creating the error throws `TypeError: ApiError details must be a plain JSON object: …`. Convert the date to text, and never pass the original error or a whole database row to `details`: everything in it reaches the browser.

<!-- no-check -->

```ts good
throw new ApiError("BOOKING_TAKEN", 409, { details: { until: booking.until.toISOString() } });
```

### An issue without `message`

```ts bad
throw new ApiError("INVALID", 409, { issues: [{ path: "email" }] });
```

`meeko check` reports `TS2741: Property 'message' is missing in type '{ path: string; }' but required in type 'ApiErrorIssue'.` Without types, creating the error throws `TypeError: Each ApiError issue needs a string path and a nonempty string message`.

<!-- no-check -->

```ts good
throw new ApiError("INVALID", 409, { issues: [{ path: "email", message: "Check the email address." }] });
```

### Throwing a regular `Error` expecting it to reach the client

```ts bad
throw new Error("That email already has an account");
```

The response is `500` `INTERNAL_ERROR`, without the message, and the server logs it as an internal failure.

<!-- no-check -->

```ts good
throw new ApiError("EMAIL_TAKEN", 409, { issues: [{ path: "email", message: "That email already has an account." }] });
```

## Notes

- **Security.** This is the boundary between what the server knows and what it discloses. Write `issues` for the user and leave details in `message`, which never leaves the server.
- **`4xx` and `5xx`.** `issues` and `details` are only transferred with a `4xx`: a `5xx` is a server failure and responds without them. `4xx` responses are not logged as internal failures.
- **Other copies.** An `ApiError` from another module graph (Vite) preserves its `issues` and `details`. A similarly shaped error from another source (an SDK's `ApiError`, a `ClientError` from another service) sends neither.
- **Forms without JavaScript.** The `303` of a route with `form` does not carry `details`, only the code, status and `issues`.
- **Where it is not used.** In a component, `ApiError` is `MEEK108`: the browser receives errors as `ClientError`.

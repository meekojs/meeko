---
title: ApiError
group: utils
since: 1.0.0
description: Public API, RPC, Socket and loader error, delivered to the client with its code, status and, since 1.5, field messages.
symbols:
  - "@meekojs/meeko/server#ApiError"
related:
  - "@meekojs/meeko/framework#ClientError"
  - "@meekojs/meeko/framework#isClientError"
  - "@meekojs/meeko/server#defineApiRoute"
  - "@meekojs/meeko/server#defineRpc"
  - "@meekojs/meeko/framework#useForm"
  - docs/framework.md#errores-de-un-campo-apierror-con-issues
  - docs/framework.md#errores
source-hash: 72fe1432b320283f15357c6be3797364c5ea01117e9101be176af29f8015dda1
---

`new ApiError(code, status, mensaje?)` is the error the server **can disclose** to the client. When thrown from an endpoint, RPC procedure, Socket channel, loader or `defer`, the response carries its `code` and `status`, plus the request's `requestId`. Any other error is returned as `INTERNAL_ERROR`/`500` without exposing its message.

Since `1.5`, the third argument also accepts `{ message, issues }`: `issues` contains public field messages, shaped like those from a validation `400`, which `useForm` displays beside each field. `message` is always internal.

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

| Parameter | Type                                | Default  | Description                                                                                                       |
| --------- | ----------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `code`    | `string`                            | required | Stable public code the client can compare: `"NOT_FOUND"`, `"EMAIL_TAKEN"`.                                        |
| `status`  | `number`                            | required | HTTP response status, usually a `4xx`.                                                                            |
| `message` | `string` or `{ message?, issues? }` | `code`   | The internal message, which is never sent. Since `1.5`, `issues: [{ path, message }]` adds public field messages. |

Each issue needs a string `path` (keys joined with `.`, or `""` for the whole form) and a nonempty `message`.

## Return value

An `Error` instance with `name: "ApiError"`, `code`, `status`, `message` and `issues`. What reaches the client:

| Field            | Transferred              | Notes                                           |
| ---------------- | ------------------------ | ----------------------------------------------- |
| `code`, `status` | Yes                      | Plus `requestId` and the `x-request-id` header. |
| `issues`         | Only with a `4xx` status | At most 20.                                     |
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
- **`4xx` and `5xx`.** `issues` are only transferred with a `4xx`: a `5xx` is a server failure and responds without them. `4xx` responses are not logged as internal failures.
- **Other copies.** An `ApiError` from another module graph (Vite) preserves its `issues`. A similarly shaped error from another source (an SDK's `ApiError`, a `ClientError` from another service) does not send its `issues`.
- **Where it is not used.** In a component, `ApiError` is `MEEK108`: the browser receives errors as `ClientError`.

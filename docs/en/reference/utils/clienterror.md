---
title: ClientError
group: utils
since: 1.0.0
description: The error API, RPC and Socket clients use to reject an error response from the server, with its code, status, requestId, per-field issues and the error's public data.
symbols:
  - "@meekojs/meeko/framework#ClientError"
types:
  - "@meekojs/meeko/framework#ValidationIssue"
  - "@meekojs/meeko/framework#ClientErrorDetails"
related:
  - "@meekojs/meeko/framework#isClientError"
  - "@meekojs/meeko/server#ApiError"
  - "autoimport:api"
  - "autoimport:rpc"
  - "@meekojs/meeko/framework#useForm"
  - docs/framework.md#errores-de-validación-en-formularios
  - docs/framework.md#errores
source-hash: b515d9eccf29270f20e31c36b19529bd96face004c5f04da3b41f1b70ecacd43
---

`ClientError` is what the browser and server code receive when an `api.*`, `rpc.*`, `useApi`, `useRpcQuery`, `useApiMutation` or `useRpcMutation` call ends in an error response. It is the other side of `ApiError`: it carries the public `code` and `status`, the request's `requestId` and, if present, per-field `issues` and, since `1.10`, public `details`. A Socket channel rejected due to session or authorization also delivers a `ClientError` (`401 UNAUTHENTICATED` or `403 FORBIDDEN`).

Its `message` is the code. An error response without a `code` uses `HTTP_ERROR`, and a successful response that is not JSON uses `INVALID_RESPONSE`.

## Usage

```ts
import { ClientError } from "@meekojs/meeko/framework";

export async function rename(call: () => Promise<unknown>): Promise<string | null> {
  try {
    await call();
    return null;
  } catch (error) {
    if (error instanceof ClientError && error.status === 409) return "That name already exists.";
    if (error instanceof ClientError) console.warn(error.code, error.requestId);
    throw error;
  }
}
```

## Parameters

`new ClientError(code, status, requestId?, issues?, details?)`. You do not normally create it manually: Meeko clients create it.

| Parameter   | Type                           | Default  | Description                                                                 |
| ----------- | ------------------------------ | -------- | --------------------------------------------------------------------------- |
| `code`      | `string`                       | required | The public code, which is also the `message`.                               |
| `status`    | `number`                       | required | The HTTP status.                                                            |
| `requestId` | `string`                       | none     | The request ID, the same as the `x-request-id` header and server logs.      |
| `issues`    | `readonly { path, message }[]` | none     | Per-field messages from a validation `400` or an `ApiError` with `issues`.  |
| `details`   | `unknown`                      | none     | Since `1.10`, the public data of a `4xx` `ApiError` with `details`, frozen. |

## Return value

An `Error` instance with `name: "ClientError"`, `code`, `status`, `requestId`, `issues` and `details`, all read-only. `issues` and `details` are `undefined` if the response does not include them; `details` also on a `5xx` or if it is not a JSON object. Its type is `unknown`: `isClientError(error, code)` narrows it with the `ClientErrorDetails` registry (see [`isClientError`](/en/docs/reference/isclienterror#typed-public-data)).

## Examples

### Per-field messages without `useForm`

```ts
import { ClientError } from "@meekojs/meeko/framework";

export function fieldMessage(error: unknown, path: string): string | undefined {
  return error instanceof ClientError ? error.issues?.find((issue) => issue.path === path)?.message : undefined;
}
```

With `useRpcMutation`, `fieldMessage(login.error.value, "password")` returns the schema's message for that field. `useForm` handles this distribution for you.

### Distinguish an expected error from a network failure

`fetch` rejects with a `TypeError` when there is no network; the server error is a `ClientError`:

```ts
import { isClientError } from "@meekojs/meeko/framework";

export function errorText(failure: unknown): string {
  if (isClientError(failure, "RATE_LIMITED")) return "Too many attempts. Wait a moment.";
  if (isClientError(failure)) return `Could not save (${failure.code}).`;
  return "Could not connect. Try again.";
}
```

This is the typical form of `useForm`'s `errorMessage`.

## Common mistakes

### Read `message` expecting the server's text

`message` is the code, not the internal `ApiError` message, which never leaves the server.

```ts bad
alert(error.message); // "EMAIL_TAKEN"
```

<!-- no-check -->

```ts good
alert(error.issues?.[0]?.message ?? "Could not create the account.");
```

### Read properties of an `unknown` without checking

In a `catch` or error observer, the error is `unknown`.

```ts bad
try { await save(); } catch (error) { console.log(error.code); }
```

`TS18046: 'error' is of type 'unknown'.`

<!-- no-check -->

```ts good
try { await save(); } catch (error) { if (isClientError(error)) console.log(error.code); else throw error; }
```

### `instanceof` with two copies of Meeko

With two copies of the package on the same page (a linked package, a duplicated dependency), `instanceof ClientError` fails for an error from the other copy, without any warning.

```ts bad
if (error instanceof ClientError && error.code === "UNAUTHENTICATED") location.assign("/login");
```

<!-- no-check -->

```ts good
if (isClientError(error, "UNAUTHENTICATED")) location.assign("/login");
```

## Notes

- **Origin.** Generated clients create it from the error JSON `{ code, status, requestId, issues?, details? }`. An unknown `500` arrives as `INTERNAL_ERROR`, without details.
- **Observers.** A `ClientError` is an expected response: `useForm` does not send it to the component's error observer, but does send any other failure.
- **Support.** Display or log `requestId`: it is the same ID the server writes in its logs, so you can find the failure.

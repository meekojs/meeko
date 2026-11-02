---
title: ClientError
group: utils
since: 1.0.0
description: The error API, RPC and Socket clients use to reject an error response from the server, with its code, status, requestId and per-field issues.
symbols:
  - "@meekojs/meeko/framework#ClientError"
types:
  - "@meekojs/meeko/framework#ValidationIssue"
related:
  - "@meekojs/meeko/framework#isClientError"
  - "@meekojs/meeko/server#ApiError"
  - "autoimport:api"
  - "autoimport:rpc"
  - "@meekojs/meeko/framework#useForm"
  - docs/framework.md#errores-de-validación-en-formularios
  - docs/framework.md#errores
source-hash: 6f1f3843008b81917aa23e3bbc7df26a0d21553d9bba11139e8e2604e838e02c
---

`ClientError` is what the browser and server code receive when an `api.*`, `rpc.*`, `useApi`, `useRpcQuery`, `useApiMutation` or `useRpcMutation` call ends in an error response. It is the other side of `ApiError`: it carries the public `code` and `status`, the request's `requestId` and, if present, per-field `issues`. A Socket channel rejected due to session or authorization also delivers a `ClientError` (`401 UNAUTHENTICATED` or `403 FORBIDDEN`).

Its `message` is the code. An error response without a `code` uses `HTTP_ERROR`, and a successful response that is not JSON uses `INVALID_RESPONSE`.

## Usage

```ts
import { ClientError } from "@meekojs/meeko/framework";

export async function rename(call: () => Promise<unknown>): Promise<string | null> {
  try {
    await call();
    return null;
  } catch (error) {
    if (error instanceof ClientError && error.status === 409) return "Ese nombre ya existe.";
    if (error instanceof ClientError) console.warn(error.code, error.requestId);
    throw error;
  }
}
```

## Parameters

`new ClientError(code, status, requestId?, issues?)`. You do not normally create it manually: Meeko clients create it.

| Parameter   | Type                           | Default  | Description                                                                |
| ----------- | ------------------------------ | -------- | -------------------------------------------------------------------------- |
| `code`      | `string`                       | required | The public code, which is also the `message`.                              |
| `status`    | `number`                       | required | The HTTP status.                                                           |
| `requestId` | `string`                       | none     | The request ID, the same as the `x-request-id` header and server logs.     |
| `issues`    | `readonly { path, message }[]` | none     | Per-field messages from a validation `400` or an `ApiError` with `issues`. |

## Return value

An `Error` instance with `name: "ClientError"`, `code`, `status`, `requestId` and `issues`, all read-only. `issues` is `undefined` if the response does not include them.

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
  if (isClientError(failure, "RATE_LIMITED")) return "Demasiados intentos. Espera un momento.";
  if (isClientError(failure)) return `No se pudo guardar (${failure.code}).`;
  return "No se pudo conectar. Inténtalo de nuevo.";
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
alert(error.issues?.[0]?.message ?? "No se pudo crear la cuenta.");
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

- **Origin.** Generated clients create it from the error JSON `{ code, status, requestId, issues? }`. An unknown `500` arrives as `INTERNAL_ERROR`, without details.
- **Observers.** A `ClientError` is an expected response: `useForm` does not send it to the component's error observer, but does send any other failure.
- **Support.** Display or log `requestId`: it is the same ID the server writes in its logs, so you can find the failure.

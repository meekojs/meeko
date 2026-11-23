---
title: isClientError
group: utils
since: 1.3.0
description: Checks whether an unknown value is a ClientError and optionally has a specific code, including across two copies of Meeko.
symbols:
  - "@meekojs/meeko/framework#isClientError"
types:
  - "@meekojs/meeko/framework#ClientErrorDetails"
related:
  - "@meekojs/meeko/framework#ClientError"
  - "@meekojs/meeko/server#ApiError"
  - "@meekojs/meeko#provideErrorHandler"
  - "@meekojs/meeko/framework#mountClientApp"
  - docs/framework.md#errores
source-hash: ef6c29ba253c24aef76dc1d9becbe6544fc986c178154931ea65381b61b48a9e
---

`isClientError(error, code?)` checks whether `error` is a [`ClientError`](/en/docs/reference/clienterror) and, with `code`, whether it has that code. It is a _type guard_: in the true branch, TypeScript knows that `error` is a `ClientError` (and, with `code`, that `error.code` is that literal and, since `1.10`, that `error.details` has the type registered for that code).

Use it where an error arrives as `unknown`: a `catch`, `provideErrorHandler`, `mountClientApp`'s `onError` or `useForm`'s `errorMessage`. Unlike `instanceof`, it also recognizes a `ClientError` from another copy of Meeko on the same page.

## Usage

```ts
import { isClientError } from "@meekojs/meeko/framework";

export function describe(error: unknown): string {
  if (isClientError(error, "UNAUTHENTICATED")) return "Your session has expired.";
  if (isClientError(error)) return `Error ${error.status} (${error.code}), request ${error.requestId ?? "unknown"}`;
  return "Unexpected error";
}
```

## Parameters

| Parameter | Type      | Default  | Description                                                                                     |
| --------- | --------- | -------- | ----------------------------------------------------------------------------------------------- |
| `error`   | `unknown` | required | The value to check.                                                                             |
| `code`    | `string`  | any      | The expected code, such as `"NOT_FOUND"`. With a literal, narrows `error.code` to that literal. |

With a code registered in `ClientErrorDetails`, `error.details` is that type or `undefined`; with another code or no code, `unknown`.

## Return value

`true` if `error` is a `ClientError` (from this copy of Meeko or another) and, with `code`, its code matches; `false` otherwise, including for an `Error` whose `message` is the code or an object with only `code` and `status`.

## Examples

### An application error observer

<!-- no-check -->

```ts
import { isClientError, mountClientApp } from "@meekojs/meeko/framework";

await mountClientApp({
  ...options,
  onError(error, source) {
    if (isClientError(error, "UNAUTHENTICATED")) location.assign("/login");
    else if (isClientError(error)) console.warn(source, error.code, error.requestId);
    else console.error(source, error);
  },
});
```

### A form's message

```html
<script lang="ts">
const form = useForm({
  initial: { name: "" },
  submit: (values) => api.users({ id: "me" }).patch({ body: values }),
  errorMessage: (failure) => isClientError(failure, "RATE_LIMITED")
    ? "Too many attempts. Wait a moment."
    : isClientError(failure) ? "Could not send." : "Could not connect.",
});
</script>

<template>
  <form on:submit="form.submit">
    <input model="form.fields.name" aria-label="Name">
    <p if:when="form.error.value" role="alert">{form.error.value}</p>
  </form>
</template>
```

### React to a `404` in a component

```html
<script lang="ts">
const props = defineProps<{ id: string }>();
const user = useApi("/api/users/[id]", () => ({ params: { id: props.id } }));
const missing = computed(() => isClientError(user.error.value, "NOT_FOUND"));
</script>

<template>
  <MeekoAwait for="user">
    <p if:when="user.data.value">{user.data.value?.name}</p>
  </MeekoAwait>
  <p if:when="missing.value">That user does not exist.</p>
</template>
```

### Typed public data

Since `1.10`, an `ApiError` can send `details` with a `4xx`. Register their type per code by extending `ClientErrorDetails`, once, in an application `.d.ts`:

<!-- no-check -->

```ts
// app/types/errors.d.ts
declare module "@meekojs/meeko/framework" {
  interface ClientErrorDetails {
    VERSION_CONFLICT: { readonly actualVersion: number };
  }
}
export {};
```

<!-- no-check -->

```ts
const save = useRpcMutation("visits.update");

async function submit(items: Item[]) {
  try {
    await save.mutate({ id: visit.id, version: visit.version, items });
  } catch (error) {
    if (!isClientError(error, "VERSION_CONFLICT")) throw error;
    const actual = error.details?.actualVersion; // number | undefined
    if (actual !== undefined) await reload(actual);
  }
}
```

The server does not check the registry: it describes what the `ApiError` instances with that code send, which is why `details` remains optional.

## Common mistakes

### Compare `message` instead of the code

A regular `Error` with the same text is not a `ClientError`.

```ts bad
if (error instanceof Error && error.message === "NOT_FOUND") showNotFound();
```

This is not a compilation error, but it also accepts errors that do not come from the server.

<!-- no-check -->

```ts good
if (isClientError(error, "NOT_FOUND")) showNotFound();
```

### Read `code` without checking the type

```ts bad
provideErrorHandler((error) => console.warn(error.code));
```

`meeko check` reports `TS18046: 'error' is of type 'unknown'.`

<!-- no-check -->

```ts good
provideErrorHandler((error) => { if (isClientError(error)) console.warn(error.code); });
```

## Notes

- **Two copies.** With a linked package or duplicated dependency, `instanceof ClientError` fails for errors from the other copy; `isClientError` does not.
- **Codes.** Meeko's codes are stable: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `INVALID_PARAMS`, `INVALID_QUERY`, `INVALID_BODY`, `INVALID_INPUT`, `INTERNAL_ERROR`, `HTTP_ERROR`, `INVALID_RESPONSE`. Your own codes are those of your `ApiError` instances.
- **Performance.** This is a cheap check, without network access or reflection: use it in every branch of an observer.

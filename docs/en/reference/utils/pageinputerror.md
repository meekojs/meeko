---
title: PageInputError
group: utils
since: 1.0.0
description: The error for a page whose params or search fail the definePage schemas, returned by the server as 400 and displayed in the browser through the error page.
symbols:
  - "@meekojs/meeko/framework#PageInputError"
related:
  - "@meekojs/meeko/framework#definePage"
  - "@meekojs/meeko/framework#notFound"
  - "@meekojs/meeko/server#ApiError"
  - "@meekojs/meeko/server#createFrameworkHandler"
  - docs/framework.md#opciones-de-ruta-con-definepage
source-hash: 24d8065b15f68412ad83b7a0fe8c8d13cb824933618d2ccb7fdf05c62c928b69
---

`PageInputError` is the error Meeko throws when a URL's `params` or `search` fail the schemas declared by the page in `definePage`. It occurs after route middleware and before the loader and top-level code, which never receive invalid input.

The server responds with `400` and its code (`INVALID_PARAMS` or `INVALID_SEARCH`), and browser navigation displays the nearest error page with that status. Do not throw it yourself: validate with schemas. It is exported for custom hosts or tests that need to recognize it.

## Usage

```ts
import { PageInputError } from "@meekojs/meeko/framework";

export function statusOf(error: unknown): number {
  return error instanceof PageInputError ? 400 : 500;
}
```

## Parameters

`new PageInputError(code)`:

| Parameter | Type                                   | Default  | Description                                      |
| --------- | -------------------------------------- | -------- | ------------------------------------------------ |
| `code`    | `"INVALID_PARAMS" \| "INVALID_SEARCH"` | required | The input that failed. It is also the `message`. |

## Return value

An `Error` instance with `code` and `message` equal to the code. Since `1.7`, its `name` is `"PageInputError"`, like `ClientError` and `ApiError` (previously `"Error"`); to distinguish it in code, use `instanceof PageInputError` or its `code`.

## Examples

### The page that triggers it

```html
<!-- app/pages/orders/[id].meeko -->
<script server lang="ts">
import * as v from "valibot";

export const route = definePage({
  params: v.object({ id: v.pipe(v.string(), v.regex(/^\d+$/)) }),
  search: v.object({ tab: v.optional(v.picklist(["items", "history"])) }),
});

const { params } = usePage();
export const order = { id: Number(params.id) };
</script>

<template><h1>Pedido {order.id}</h1></template>
```

`/orders/abc` responds with `400 INVALID_PARAMS` and `/orders/7?tab=x` with `400 INVALID_SEARCH`, without running the block.

### A custom message in the error page

```html
<!-- app/pages/orders/+error.meeko -->
<script lang="ts">
const props = defineProps<{ status: number; message: string }>();
</script>

<template>
  <h1 if:when="props.status === 400">Esa dirección no es válida</h1>
  <p if:when="props.message === 'INVALID_SEARCH'">Revisa los filtros de la URL.</p>
  <h1 if:when="props.status !== 400">Algo ha fallado</h1>
</template>
```

## Common mistakes

### Validate manually inside the page

Without schemas, `params` is unchecked text and the page code must defend itself, without any warning if you forget.

```html bad
<script server lang="ts">
const { params } = usePage();
export const order = await findOrder(Number(params.id)); // NaN con /orders/abc
</script>
```

```html good
<script server lang="ts">
import * as v from "valibot";
export const route = definePage({ params: v.object({ id: v.pipe(v.string(), v.regex(/^\d+$/)) }) });
const { params } = usePage();
export const order = await findOrder(Number(params.id));
</script>
```

### Throw it to respond with `400`

`PageInputError` only accepts `INVALID_PARAMS` and `INVALID_SEARCH`, and belongs in schema validation.

```ts bad
throw new PageInputError("INVALID_DATE");
```

`meeko check` reports `TS2345: Argument of type '"INVALID_DATE"' is not assignable to parameter of type '"INVALID_PARAMS" | "INVALID_SEARCH"'.` For another `400`, throw an `ApiError`.

<!-- no-check -->

```ts good
throw new ApiError("INVALID_DATE", 400);
```

## Notes

- **When.** Validation runs on each request, after route middleware (including server route middleware, which receives unvalidated `params` and `search`) and before `load` and top-level code.
- **Security.** The `params` and `search` schemas validate URL input: with them, page code receives types that have already been checked.
- **Navigation.** In the browser, the data request responds with `400` and the nearest `+error.meeko`, or `app/error.meeko`, is displayed with `status: 400` and `message` equal to the code.

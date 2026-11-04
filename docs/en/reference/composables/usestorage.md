---
title: useStorage
group: composables
since: 1.2.0
description: Returns a writable signal stored as JSON in localStorage or sessionStorage, without hydration mismatches and synchronized across tabs.
symbols:
  - "@meekojs/meeko/framework#useStorage"
types:
  - "@meekojs/meeko/framework#StorageOptions"
related:
  - "@meekojs/meeko/framework#useState"
  - "@meekojs/meeko#signal"
  - "@meekojs/meeko/framework#useTheme"
  - "autoimport:useRpcMutation"
  - docs/framework.md#estado-persistente-usestorage
  - docs/framework.md#mutaciones-seguras-ante-reintentos
source-hash: 26905a1c1ebb337721fc32e3225a6f402882e4f0471c04a6203887db92f6592c
---

`useStorage(key, initial, options?)` returns a signal whose value is saved in browser storage: `localStorage` by default or `sessionStorage` with `storage: "session"`. Use it for browser state that must survive a reload or be shared across tabs: an open ticket, the selected register, a draft, a view preference.

The server never reads storage: HTML and hydration use `initial`, and the saved value is applied as soon as hydration finishes, before `onMounted`. This avoids mismatches. It is auto-imported in `.meeko` files and called while a component's script runs (at top level or in a composable it calls).

## Usage

```html
<!-- app/components/ViewToggle.meeko -->
<script lang="ts">
const view = useStorage("products:view", "grid");
</script>

<template>
  <button type="button" bind:aria-pressed="String(view.value === 'grid')" on:click="() => view.value = 'grid'">Grid</button>
  <button type="button" bind:aria-pressed="String(view.value === 'list')" on:click="() => view.value = 'list'">List</button>
</template>
```

The selected view returns after a reload; another open tab changes at the same time.

## Parameters

| Parameter         | Type                        | Default   | Description                                                                                                                                    |
| ----------------- | --------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`             | `string`                    | required  | Storage key, such as `"pos:ticket"`. Include what distinguishes it across users or accounts if they share a browser. Empty throws `TypeError`. |
| `initial`         | `T`                         | required  | Value in SSR, during hydration, when nothing is saved and when saved data is invalid. Determines `T`.                                          |
| `options.storage` | `"local" \| "session"`      | `"local"` | `"local"` persists across sessions and tabs; `"session"` only in the current tab.                                                              |
| `options.schema`  | synchronous Standard Schema | none      | Validates reads, including data from another tab. With it, the signal type comes from the schema.                                              |

## Return value

A `Signal<T>` shared by all components using the same key and storage. Each assignment is saved immediately; assigning `undefined` removes the key and the next read returns to `initial`.

Outside a component's script, it throws `Error: useStorage("<clave>") must be called while a component script runs`.

## Examples

### A ticket surviving a reload

```html
<!-- app/pages/pos.meeko -->
<script lang="ts">
interface TicketLine { productId: string; quantity: number }
const lines = useStorage("pos:ticket", [] as TicketLine[]);
const add = (productId: string): void => { lines.value = [...lines.value, { productId, quantity: 1 }]; };
const clear = (): void => { lines.value = []; };
</script>

<template>
  <p>{lines.value.length} items on the receipt</p>
  <button type="button" on:click="clear">Empty</button>
</template>
```

### Validate reads

Another script, a previous application version or the user can leave unexpected data in storage. With `schema`, an invalid value is ignored and the signal holds `initial`:

<!-- no-check -->

```ts
import * as v from "valibot";

const density = useStorage("table:density", "normal", { schema: v.picklist(["compact", "normal", "comfortable"]) });
// density: Signal<"compact" | "normal" | "comfortable">
```

### A draft per tab

```html
<script lang="ts">
const draft = useStorage<string | undefined>("comment:draft", undefined, { storage: "session" });
const discard = (): void => { draft.value = undefined; }; // deletes the key
</script>

<template>
  <textarea bind:value="draft.value ?? ''" on:input="(event) => draft.value = event.currentTarget.value"></textarea>
  <button type="button" on:click="discard">Discard</button>
</template>
```

## Common mistakes

### Mutate the stored value

```ts bad
lines.value.push(line);
```

There is no error, but the signal does not notify and storage is not written: after reloading, the line is missing. Assign a new value:

<!-- no-check -->

```ts good
lines.value = [...lines.value, line];
```

### Assign another type

```ts bad
const theme = useStorage("theme", "light");
theme.value = 1;
```

`meeko check` reports `TS2322: Type 'number' is not assignable to type 'string'`: `initial` determines the type. For a union, write it explicitly: `useStorage<"light" | "dark">("theme", "light")`.

<!-- no-check -->

```ts good
theme.value = "dark";
```

### Call it in a handler

```ts bad
function remember(id: string): void {
  useStorage("last:item", "").value = id;
}
```

At runtime it throws `Error: useStorage("last:item") must be called while a component script runs`. Create the signal in the script and write to it in the handler:

<!-- no-check -->

```ts good
const lastItem = useStorage("last:item", "");
function remember(id: string): void { lastItem.value = id; }
```

### Store secrets

```ts bad
const token = useStorage("auth:token", "");
```

Any script on the page can read `localStorage`: a token stored there is exposed to any XSS. Meeko's session already lives in an `HttpOnly` cookie; do not store credentials in storage.

<!-- no-check -->

```ts good
const lastSearch = useStorage("search:last", ""); // only preferences and non-sensitive state
```

## Notes

- **SSR and hydration.** The server never reads storage and the signal is not transferred in the payload. A component mounted later (an opening `if:when`, a page after navigation) already renders the stored value on its first render.
- **Blocked storage.** In private mode, without permission or with a full quota, it never throws: the signal keeps working in memory. Only an unexpected failure (a value JSON cannot represent, such as a `BigInt` or a cycle, or a `schema` that throws or is asynchronous) reaches the nearest `provideErrorHandler`.
- **Other tabs.** While any component uses the key, another tab's `storage` event updates the signal, with the same validation; `localStorage.clear()` returns it to `initial`.
- **One signal per key.** Two components with the same key and storage share one signal; the first determines `initial` and `schema`. When none uses it, the next reads storage again.
- **Choose.** Shared state matching in SSR and the browser: [`useState`](/en/docs/reference/usestate). Browser state surviving reloads: `useStorage`. Server-owned data: [`useApi`](/en/docs/reference/use-api).

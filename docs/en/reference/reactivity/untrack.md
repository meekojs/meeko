---
title: untrack
group: reactivity
since: 1.0.0
description: Runs a function that reads signals without tracking them as dependencies of the active observer.
symbols:
  - "@meekojs/meeko#untrack"
related:
  - "@meekojs/meeko#effect"
  - "@meekojs/meeko#computed"
  - "@meekojs/meeko#batch"
  - docs/api.md#reactividad
source-hash: 82d9419a9b02f7bed661b4a6a1fbd4255fdea6008f80cc98a2110bf263b47997
---

Inside an `effect`, a `computed` or the template, reading `signal.value` subscribes the observer: it runs again when the signal changes. `untrack(fn)` runs `fn` with no active observer, so the signals read inside it are not tracked. Use it to read a contextual value (the user, the current page, an option) without changes to that value triggering the work.

It is exported from `@meekojs/meeko` and auto-imported in framework applications.

## Usage

```ts
import { effect, signal, untrack } from "@meekojs/meeko";

const query = signal("");
const page = signal(1);

// Se repite al cambiar query; page se lee sin suscribirse.
effect(() => {
  console.log(`Buscar "${query.value}" desde la página ${untrack(() => page.value)}`);
});

page.value = 2;     // sin log
query.value = "a";  // log: Buscar "a" desde la página 2
```

## Parameters

| Parameter | Type      | Default  | Description                                             |
| --------- | --------- | -------- | ------------------------------------------------------- |
| `fn`      | `() => T` | required | Function that reads signals. It runs immediately, once. |

## Return value

The return value of `fn`. Outside an observer, `untrack(fn)` is equivalent to calling `fn()`.

## Examples

### Logging an event with data that should not repeat it

```ts
import { effect, signal, untrack } from "@meekojs/meeko";

const route = signal("/");
const userId = signal("anon");

effect(() => {
  const path = route.value; // la dependencia
  void fetch("/api/analytics", {
    method: "POST",
    body: JSON.stringify({ path, user: untrack(() => userId.value) }),
  });
});
```

Changing users does not send a new visit; changing routes does.

### An initial value that should not follow the prop

In a `computed`, `untrack` determines what should not cause recalculation:

```html
<!-- app/components/Draft.meeko -->
<script lang="ts">
const props = defineProps<{ text: string; locale: string }>();
const draft = signal(untrack(() => props.text)); // copia inicial, a propósito
const words = computed(() => draft.value.trim().split(/\s+/).filter(Boolean).length);
</script>

<template>
  <textarea model="draft"></textarea>
  <p>{words.value} palabras</p>
</template>
```

`props.text` is read only once; the user edits the copy in `draft`.

### Calling external code from an effect

A library function can read signals you do not control. `untrack` prevents the effect from depending on them:

```ts
import { effect, signal, untrack } from "@meekojs/meeko";

declare function notify(message: string): void; // puede leer señales internas

const saved = signal(0);
effect(() => {
  if (saved.value > 0) untrack(() => notify(`Guardado ${saved.value}`));
});
```

## Common mistakes

### Returning the signal instead of its value

`untrack` only prevents subscription while `fn` runs. If it returns the signal, the read happens later, outside `untrack`, and is tracked.

```ts bad
effect(() => {
  const current = untrack(() => page);
  console.log(query.value, current.value); // page vuelve a ser dependencia
});
```

There is no error: the effect runs again when `page` changes. Read `.value` inside the function:

<!-- no-check -->

```ts good
effect(() => {
  console.log(query.value, untrack(() => page.value));
});
```

### Using it to hide a loop

If an effect writes to a signal it also reads, `untrack` around the read prevents the error `Reactive update cycle exceeded 1000 iterations`, but leaves manually derived state.

```ts bad
effect(() => {
  total.value = untrack(() => total.value) + price.value;
});
```

`total` accumulates every change to `price` and never goes back. If the value depends on others, use a `computed`:

<!-- no-check -->

```ts good
const total = computed(() => items.value.reduce((sum, item) => sum + item.price, 0));
```

## Notes

- **Server and browser.** It works the same in both.
- **Writes.** `untrack` does not change writes: an assignment inside `fn` notifies observers as usual. To group them, use [`batch`](/en/docs/reference/batch).
- **Meeko callbacks.** `onMounted` and functions Meeko runs after hydration already run without tracking: you do not need `untrack` inside them.
- **Template.** In a template expression, `untrack` prevents that binding from updating when the signal changes. You rarely need it; it usually indicates that the data should be a constant.

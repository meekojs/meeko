---
title: computed
group: reactivity
since: 1.0.0
description: Derives a read-only value from other signals and recalculates it as soon as any signal it read changes.
symbols:
  - "@meekojs/meeko#computed"
types:
  - "@meekojs/meeko#ReadonlySignal"
related:
  - "@meekojs/meeko#signal"
  - "@meekojs/meeko#effect"
  - "@meekojs/meeko#batch"
  - "@meekojs/meeko#untrack"
  - docs/api.md#reactividad
source-hash: 4e6698a55272f560539583f342defc18766a8b60f1299327224f7877a6f62768
---

`computed(fn)` returns a read-only signal whose value is the result of `fn`. Meeko runs `fn` on creation, tracks the signals it reads and runs it again whenever one of them changes; readers of the `computed` (the template, another `computed`, an `effect`) update in turn. Use it for anything calculated from state: totals, filters, formatted text, conditions.

A `computed` is not state: it is neither transferred in the payload nor preserved by HMR, because hydration recalculates it from the signals that are transferred. It is exported from `@meekojs/meeko` and auto-imported in framework applications.

## Usage

```html
<!-- app/components/Cart.meeko -->
<script lang="ts">
const items = signal([{ name: "Café", price: 3 }, { name: "Té", price: 2 }]);
const total = computed(() => items.value.reduce((sum, item) => sum + item.price, 0));
</script>

<template>
  <p>{items.value.length} productos, {total.value} €</p>
</template>
```

Assigning `items.value` recalculates `total`, and the template displays the new amount.

## Parameters

| Parameter | Type      | Default  | Description                                                                                                                                                       |
| --------- | --------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fn`      | `() => T` | required | Pure function that reads signals and returns the value. It runs as soon as the `computed` is created, then whenever a signal it read during its last run changes. |

## Return value

A `ReadonlySignal<T>` whose `value` is the latest result of `fn`. Reading it tracks the dependency, as with any signal; assigning it is a type error.

The `computed` only notifies its readers when the result changes according to `Object.is`: if `fn` returns the same number, nothing renders again.

## Examples

### Filtering a list

```ts
import { computed, signal } from "@meekojs/meeko";

interface Task { title: string; done: boolean }

const tasks = signal<Task[]>([{ title: "Escribir", done: true }, { title: "Revisar", done: false }]);
const showDone = signal(false);
const visible = computed(() => showDone.value ? tasks.value : tasks.value.filter((task) => !task.done));

showDone.value = true; // visible.value vuelve a incluir las tareas hechas
```

### A condition for the template

```html
<script lang="ts">
const password = signal("");
const confirm = signal("");
const mismatch = computed(() => confirm.value !== "" && password.value !== confirm.value);
</script>

<template>
  <input type="password" model="password">
  <input type="password" model="confirm" bind:aria-invalid="mismatch.value ? 'true' : null">
  <p if:when="mismatch.value" role="alert">Las contraseñas no coinciden.</p>
</template>
```

### Deriving from props and data

Props from `defineProps` have been reactive since `1.2`: a `computed` that reads them follows the parent without remounting the child.

```html
<!-- app/components/Price.meeko -->
<script lang="ts">
const props = defineProps<{ cents: number; currency: string }>();
const label = computed(() => new Intl.NumberFormat("es", { style: "currency", currency: props.currency }).format(props.cents / 100));
</script>

<template><span class="price">{label.value}</span></template>
```

### Deriving a value that cannot be serialized

State signals are transferred as JSON, so they store serializable data; the `computed` creates the object on each side:

```ts
import { computed, signal } from "@meekojs/meeko";

const isoDate = signal("2026-10-29T10:00:00.000Z");
const date = computed(() => new Date(isoDate.value));
const weekday = computed(() => date.value.toLocaleDateString("es", { weekday: "long" }));
```

## Common mistakes

### Assigning `value`

```ts bad
const double = computed(() => count.value * 2);
double.value = 10;
```

`meeko check` reports `TS2540: Cannot assign to 'value' because it is a read-only property`. At runtime, since `1.7`, the assignment throws `TypeError: Meeko computed values are read-only: change the signals it reads, or use a signal`, including in untyped JavaScript (through `1.6`, it overwrote the value until the next recalculation). Write to the source signal:

<!-- no-check -->

```ts good
count.value = 5; // double.value pasa a 10
```

### Side effects inside `fn`

`fn` runs on creation and on every change, including in SSR and during a navigation dry run, where `effect` callbacks do not run but `computed` callbacks do.

```ts bad
const total = computed(() => {
  localStorage.setItem("total", String(price.value * quantity.value));
  return price.value * quantity.value;
});
```

In SSR on Node 24 it throws `ReferenceError: localStorage is not defined`, and in the browser it writes on every recalculation, including discarded passes. Calculate in the `computed` and write outside it, in an [`effect`](/en/docs/reference/effect) or with [`useStorage`](/en/docs/reference/usestorage):

<!-- no-check -->

```ts good
const total = computed(() => price.value * quantity.value);
effect(() => localStorage.setItem("total", String(total.value)));
```

### An asynchronous `computed`

```ts bad
const user = computed(async () => (await fetch(`/api/users/${id.value}`)).json());
```

It does not produce an error, but `user.value` is a `Promise`, not the data, and reads after `await` are not tracked. For server data, use [`useApi`](/en/docs/reference/use-api) or [`useRpcQuery`](/en/docs/reference/use-rpc-query), which reload when their signals change:

<!-- no-check -->

```ts good
const user = useApi("/api/users/[id]", () => ({ params: { id: id.value } }));
```

### Reading a `computed` inside `batch`

Inside [`batch`](/en/docs/reference/batch), observers wait until the end, and a `computed` is an observer: its value does not change until the batch finishes.

```ts bad
batch(() => {
  count.value = 5;
  console.log(double.value); // todavía el valor anterior
});
```

Read the result after `batch`, or calculate from the signals you just wrote:

<!-- no-check -->

```ts good
batch(() => { count.value = 5; });
console.log(double.value); // 10
```

## Notes

- **Eager, not lazy.** The `computed` is calculated on creation and as soon as a dependency changes, even if nobody reads it. Keep `fn` cheap; for expensive work that is not always needed, use a regular function that the template calls only where needed.
- **SSR and hydration.** It is calculated the same way on the server and in the browser from the same signals, so the HTML matches. It is not part of the transferred state, and HMR does not preserve it.
- **Dynamic dependencies.** Each run only counts what `fn` read: in `a.value ? b.value : c.value`, the `computed` does not depend on `c` while `a` is true.
- **Lifecycle.** It belongs to the active root (the component) and stops recalculating when it unmounts. Created outside a root, it lives as long as its signals.
- **Equality.** It only notifies its readers if the result changes according to `Object.is`; a `computed` that returns a new object on every run always notifies.

---
title: signal
group: reactivity
since: 1.0.0
description: Creates an observable, writable value with .value; writing a different value notifies the template, computed values and effects that read it.
symbols:
  - "@meekojs/meeko#signal"
types:
  - "@meekojs/meeko#Signal"
  - "@meekojs/meeko#ReadonlySignal"
related:
  - "@meekojs/meeko#computed"
  - "@meekojs/meeko#effect"
  - "@meekojs/meeko#batch"
  - "@meekojs/meeko#untrack"
  - "syntax:model"
  - "@meekojs/meeko/framework#useState"
  - docs/api.md#reactividad
  - docs/api.md#módulo-generado
source-hash: 00423b8ab61981fb64427a253e4c31aad6805e1e0ad0b7a604d0da67fc1ee00c
---

`signal(initial)` creates Meeko's most basic state: an object with a `value` property. Reading `value` in a template, [`computed`](/en/docs/reference/computed) or [`effect`](/en/docs/reference/effect) registers the dependency; assigning a different value notifies only those that read it. There is no virtual DOM: the compiled template updates exactly the node or attribute depending on the signal.

In a component's `<script>`, top-level signals are also **component state**: the server serializes them with the HTML (`renderWithState`), hydration restores them and HMR preserves them by name. It is exported from `@meekojs/meeko` and auto-imported in framework applications.

## Usage

```html
<!-- app/components/Counter.meeko -->
<script lang="ts">
const count = signal(0);
</script>

<template>
  <button type="button" on:click="() => count.value++">Pulsado {count.value} veces</button>
</template>
```

Each click assigns a new number to `count.value` and Meeko updates only the button text.

## Parameters

| Parameter | Type | Default  | Description                                                                                                                                                                |
| --------- | ---- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initial` | `T`  | required | Initial value. `T` is inferred from it: `signal(0)` is `Signal<number>`. For a union or empty value, write the type: `signal<User \| null>(null)`, `signal<string[]>([])`. |

## Return value

A `Signal<T>`, an object with a single property:

| Property | Type | Description                                                                                                                                                                                                                                    |
| -------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `value`  | `T`  | Read: returns the current value and, if there is an active observer (the template, a `computed`, an `effect`), subscribes it. Write: if the new value differs according to `Object.is`, stores it and immediately runs observers that read it. |

`Signal<T>` is assignable to `ReadonlySignal<T>`, the read-only type returned by `computed` and composables: use it to expose a signal without allowing others to write it.

## Examples

### Explicitly typed state

```ts
import { signal } from "@meekojs/meeko";

interface User { id: string; name: string }

const user = signal<User | null>(null);
const tags = signal<string[]>([]);

user.value = { id: "1", name: "Ada" };
tags.value = [...tags.value, "admin"]; // un array nuevo: avisa a los observadores
```

### A form control with `model`

`model` creates a two-way binding between a control and a writable signal of the control's type:

```html
<script lang="ts">
const name = signal("");
const accepted = signal(false);
</script>

<template>
  <input model="name" placeholder="Tu nombre">
  <label><input type="checkbox" model="accepted"> Acepto</label>
  <button bind:disabled="!accepted.value || !name.value.trim()">Enviar</button>
</template>
```

### Expose a read-only signal from a composable

```ts
// app/composables/counter.ts
import { signal } from "@meekojs/meeko";
import type { ReadonlySignal } from "@meekojs/meeko";

export function useCounter(start = 0): { count: ReadonlySignal<number>; increment: () => void } {
  const count = signal(start);
  return { count, increment: () => { count.value++; } };
}
```

The caller can read `count.value`, but assigning it is a type error (`TS2540`).

### Component state transferred to the browser

```html
<!-- app/components/Tabs.meeko -->
<script lang="ts">
const props = defineProps<{ initial: "perfil" | "actividad" }>();
const tab = signal(props.initial);
</script>

<template>
  <button type="button" on:click="() => tab.value = 'perfil'" bind:aria-pressed="String(tab.value === 'perfil')">Perfil</button>
  <button type="button" on:click="() => tab.value = 'actividad'" bind:aria-pressed="String(tab.value === 'actividad')">Actividad</button>
</template>
```

Server HTML uses the `initial` tab, the `tab` signal travels in component state and hydration restores it before claiming the HTML: there is no mismatch.

## Common mistakes

### Mutate a signal's object or array

A signal only notifies when assigned a different value (`Object.is`). `push` or changing a property modifies the same object: nobody is notified and there is no error.

```ts bad
items.value.push(item);
user.value.name = "Grace";
```

Assigning the same object afterward does not notify either, because `Object.is(objeto, objeto)` is `true`. Always assign a new value:

<!-- no-check -->

```ts good
items.value = [...items.value, item];
user.value = { ...user.value, name: "Grace" };
```

### Forget `.value`

The signal is an object; its value is in `value`.

```html bad
<button on:click="() => count++">{count.value}</button>
```

`meeko check` reports `TS2588: Cannot assign to 'count' because it is a constant`. In a condition, `if:when="count > 0"` produces `TS2365: Operator '>' cannot be applied to types 'Signal<number>' and 'number'`.

```html good
<button on:click="() => count.value++">{count.value}</button>
```

### Write to a `computed`

```ts bad
const double = computed(() => count.value * 2);
double.value = 4;
```

`meeko check` reports `TS2540: Cannot assign to 'value' because it is a read-only property`, and since `1.7` assignment throws `TypeError` at runtime. Write to the source signal:

<!-- no-check -->

```ts good
count.value = 2; // double.value pasa a 4
```

### Store a value JSON cannot represent in state

Top-level script signals travel as JSON with server HTML.

```ts bad
const when = signal(new Date());
```

Rendering fails with the component and signal names, such as `app/pages/agenda.meeko: the signal "when" cannot be sent to the browser with the SSR state (Non-plain object at $.when)`. Store a serializable value and derive the object:

<!-- no-check -->

```ts good
const when = signal(new Date().toISOString());
const date = computed(() => new Date(when.value));
```

## Notes

- **Server and browser.** In SSR the signal works the same, but HTML is sent only once: writes after rendering do not reach the browser. Template updates occur in the browser after hydration.
- **Transferred state.** Only writable top-level script signals travel. A `computed`, a constant or a signal stored in an object is not part of state; an `undefined` does travel since `1.5`. For state shared by multiple components, use [`useState`](/en/docs/reference/usestate).
- **HMR.** When editing a component in `meeko dev`, Meeko preserves its writable signals by name; `computed` values are recalculated.
- **Synchronous updates.** Each write immediately runs affected observers in creation order. To group multiple writes into one round, use [`batch`](/en/docs/reference/batch).
- **Equality.** `NaN` equals `NaN` and `-0` differs from `0`, as in `Object.is`. Writing the same value does nothing.
- **Loops.** An observer writing the signal it reads repeats until Meeko stops it with `Reactive update cycle exceeded 1000 iterations`.

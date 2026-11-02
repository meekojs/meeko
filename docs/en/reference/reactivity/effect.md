---
title: effect
group: reactivity
since: 1.0.0
description: Runs a synchronous function now and whenever a signal it read changes; returns the function that stops it.
symbols:
  - "@meekojs/meeko#effect"
types:
  - "@meekojs/meeko#ReadonlySignal"
related:
  - "@meekojs/meeko#computed"
  - "@meekojs/meeko#onCleanup"
  - "@meekojs/meeko#onMounted"
  - "@meekojs/meeko#untrack"
  - "@meekojs/meeko#batch"
  - "@meekojs/meeko#provideErrorHandler"
  - docs/api.md#reactividad
  - docs/api.md#ciclo-de-vida
source-hash: d8a9ae4ed064a343cf63fc76b1e28614e597b9c6ef83d9cb97266e6b570e943d
---

`effect(fn)` bridges signals and the outside world: it runs `fn` immediately, records the signals it reads and reruns it when any changes. Use it to synchronize something Meeko does not render (the document title, a third-party library, `localStorage`, a connection) with state. To calculate a value, use [`computed`](/en/docs/reference/computed); to render, use the template.

In a component script, the effect belongs to the component and stops on unmount. It is exported from `@meekojs/meeko` and auto-imported in framework applications.

## Usage

```html
<!-- app/components/SearchBox.meeko -->
<script lang="ts">
const query = signal("");
effect(() => {
  if (typeof document === "undefined") return;
  document.title = query.value ? `Buscar: ${query.value}` : "Buscar";
});
</script>

<template><input type="search" model="query"></template>
```

The first run occurs when the effect is created; every letter the user types changes `query` and reruns it in the browser.

## Parameters

| Parameter | Type            | Default  | Description                                                                                                                        |
| --------- | --------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `fn`      | `() => unknown` | required | **Synchronous** callback reading signals. A callback returning a promise (`async`) is a type error and, at runtime, a `TypeError`. |
| `source`  | `EffectSource`  | none     | Expression location for DevTools. Added by the compiler in development; do not write it yourself.                                  |

## Return value

A `() => void` function that stops the effect: it stops observing its signals and never runs again. In a component, you need not call it because the effect stops on unmount; use it to stop earlier, or for an effect created outside a root.

## Examples

### Stop an effect

```ts
import { effect, signal } from "@meekojs/meeko";

const count = signal(0);
const seen: number[] = [];
const stop = effect(() => { seen.push(count.value); });

count.value = 1;
stop();
count.value = 2; // seen sigue siendo [0, 1]
```

### Synchronize an external library and dispose of it

`onCleanup` inside a component disposes of the resource on unmount; the effect reapplies the option when the signal changes:

```html
<!-- app/components/Chart.meeko -->
<script lang="ts">
import { createChart } from "../lib/chart";

const props = defineProps<{ points: number[] }>();
const canvas = useElementRef("canvas");
onMounted(() => {
  const chart = createChart(canvas.value!);
  effect(() => chart.update(props.points));
  return () => chart.destroy();
});
</script>

<template><canvas ref:canvas width="400" height="200"></canvas></template>
```

The effect created inside `onMounted` still belongs to the component: Meeko stops it with the component.

### Asynchronous work from a synchronous effect

The effect reads signals synchronously and starts the request; cancellation and errors are your responsibility:

```ts
import { effect, signal } from "@meekojs/meeko";

const query = signal("");
const results = signal<string[]>([]);
let controller: AbortController | undefined;

effect(() => {
  const q = query.value.trim(); // la dependencia se registra aquí, antes de cualquier await
  controller?.abort();
  if (!q) { results.value = []; return; }
  const current = new AbortController();
  controller = current;
  fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: current.signal })
    .then((response) => response.json() as Promise<string[]>)
    .then((list) => { results.value = list; })
    .catch((error: unknown) => { if (!current.signal.aborted) console.error(error); });
});
```

In a framework component, [`useRpcQuery`](/en/docs/reference/use-rpc-query) or [`useApi`](/en/docs/reference/use-api) with `debounceMs` and `enabled` (since `1.7`) already handle this, with cancellation, SSR and hydration.

### Read a signal without depending on it

```ts
import { effect, signal, untrack } from "@meekojs/meeko";

const query = signal("");
const page = signal(1);
// Se repite al cambiar query, no al cambiar page.
effect(() => console.log(query.value, untrack(() => page.value)));
```

## Common mistakes

### An `async` callback

```ts bad
effect(async () => {
  const response = await fetch(`/api/users?q=${query.value}`);
  users.value = await response.json();
});
```

`meeko check` reports `TS2345: Argument of type '() => Promise<void>' is not assignable to parameter of type 'never'` and, at runtime, the effect throws `TypeError: Meeko effect callbacks must be synchronous`. Reads after an `await` would not be recorded. Read signals first and start the promise without returning it:

<!-- no-check -->

```ts good
effect(() => {
  const q = query.value;
  void fetch(`/api/users?q=${q}`).then((response) => response.json()).then((list) => { users.value = list; });
});
```

### Write the signal the effect reads

```ts bad
effect(() => {
  count.value = count.value + 1;
});
```

Each write triggers the effect again, and Meeko stops it with `Error: Reactive update cycle exceeded 1000 iterations`. If a value depends on another, it is a `computed`:

<!-- no-check -->

```ts good
const next = computed(() => count.value + 1);
```

### Use `effect` to derive state

```ts bad
const total = signal(0);
effect(() => { total.value = price.value * quantity.value; });
```

This works, but `total` is another writable signal: it travels in component state, someone can write it and it is briefly out of sync. A computed value is a `computed`:

<!-- no-check -->

```ts good
const total = computed(() => price.value * quantity.value);
```

### Access the DOM or browser APIs without checking

The effect also runs once in SSR.

```ts bad
effect(() => { window.scrollTo(0, offset.value); });
```

In SSR it throws `ReferenceError: window is not defined` and the page fails. Check the environment, or create the effect in `onMounted`, which only runs in the browser:

<!-- no-check -->

```ts good
onMounted(() => {
  effect(() => { window.scrollTo(0, offset.value); });
});
```

## Notes

- **SSR.** On the server, the effect runs only the first time, on creation. It does not run during a client navigation's dry run (the preliminary render loading the new page's data).
- **Order.** Pending effects run in creation order: a parent effect, such as an `if:when` effect, runs before those it created. Multiple successive writes run the effect multiple times; group them with [`batch`](/en/docs/reference/batch).
- **Errors.** An exception in an effect created during setup fails rendering. One occurring in reaction to a write propagates to the writer (for example, the `on:click` handler), which sends it to the nearest [`provideErrorHandler`](/en/docs/reference/provideerrorhandler). If multiple observers fail in the same round, they are grouped in an `AggregateError`.
- **Lifecycle.** Inside a component, the effect stops on unmount, page change or when its `if:when` or `each:of` row disappears. Outside a root (a module or test), it lives until you call its returned function, or create it inside [`createRoot`](/en/docs/reference/createroot).
- **No `onUpdated`.** Meeko has no update hook: an effect reading signals is how you react to their changes.

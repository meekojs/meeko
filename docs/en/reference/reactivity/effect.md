---
title: effect
group: reactivity
since: 1.0.0
description: Runs a synchronous function now and whenever a signal it read changes; it can return a cleanup, and returns the function that stops it.
symbols:
  - "@meekojs/meeko#effect"
types:
  - "@meekojs/meeko#ReadonlySignal"
  - "@meekojs/meeko#EffectResult"
related:
  - "@meekojs/meeko#computed"
  - "@meekojs/meeko#onCleanup"
  - "@meekojs/meeko#onMounted"
  - "@meekojs/meeko#untrack"
  - "@meekojs/meeko#batch"
  - "@meekojs/meeko#provideErrorHandler"
  - docs/api.md#reactividad
  - docs/api.md#ciclo-de-vida
source-hash: 2f4c0a438b1ffd401c3b1705089278e7e7efdbefa61cf928f6e6f708f7a47e96
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
  document.title = query.value ? `Search: ${query.value}` : "Search";
});
</script>

<template><input type="search" model="query"></template>
```

The first run occurs when the effect is created; every letter the user types changes `query` and reruns it in the browser.

## Parameters

| Parameter | Type                         | Default  | Description                                                                                                                                                                                                 |
| --------- | ---------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fn`      | `() => void \| (() => void)` | required | **Synchronous** callback reading signals that can return a cleanup (since `1.10`). A callback returning a promise (`async`), or a cleanup that returns one, is a type error and, at runtime, a `TypeError`. |
| `source`  | `EffectSource`               | none     | Expression location for DevTools. Added by the compiler in development; do not write it yourself.                                                                                                           |

## Return value

A `() => void` function that stops the effect: it stops observing its signals, never runs again and runs the cleanup of its last run. In a component, you need not call it because the effect stops on unmount; use it to stop earlier, or for an effect created outside a root.

## Per-run cleanup

Since `1.10`, each run of the effect owns what it registers, as in Solid or React's `useEffect`:

- the function `fn` returns;
- the [`onCleanup`](/en/docs/reference/oncleanup) calls it makes;
- the `effect`, `computed` and [`createRoot`](/en/docs/reference/createroot) it creates.

All of it is released **before the next run** and **when the effect stops** (with the function it returns, when its component unmounts or when its root is disposed of), in registration order, with the returned function last. In SSR the effect runs once and its cleanup runs when rendering finishes, when the root is disposed of, just like a script `onCleanup`.

Any other returned value (a number, an object) is ignored. A returned promise stops the effect and throws `TypeError` (see [An `async` callback](#an-async-callback)).

Until `1.9` the returned function was ignored and `onCleanup` inside the effect registered on the component, which ran it only once, on unmount; see [Approved exceptions](/en/docs/stability#approved-exceptions).

## Examples

### Release what each run creates

```ts
import { effect, signal } from "@meekojs/meeko";

const delay = signal(1_000);
const tick = (): void => console.log("tick");
effect(() => {
  const id = setInterval(tick, delay.value);
  return () => clearInterval(id);
});
delay.value = 500; // stops the 1 s interval before creating the 500 ms one
```

The cleanup also runs when the component unmounts or the effect stops, so you need no extra `onCleanup` outside.

### Stop an effect

```ts
import { effect, signal } from "@meekojs/meeko";

const count = signal(0);
const seen: number[] = [];
const stop = effect(() => { seen.push(count.value); });

count.value = 1;
stop();
count.value = 2; // seen remains [0, 1]
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

The effect reads signals synchronously, starts the request and returns its cancellation; errors are your responsibility:

```ts
import { effect, signal } from "@meekojs/meeko";

const query = signal("");
const results = signal<string[]>([]);

effect(() => {
  const q = query.value.trim(); // the dependency is tracked here, before any await
  if (!q) { results.value = []; return; }
  const controller = new AbortController();
  fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
    .then((response) => response.json() as Promise<string[]>)
    .then((list) => { results.value = list; })
    .catch((error: unknown) => { if (!controller.signal.aborted) console.error(error); });
  return () => controller.abort();
});
```

Each new search aborts the previous one, and unmounting the component aborts the last one.

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

### Return a function that is not a cleanup

```ts bad
effect(() => props.onSelect);
```

Since `1.10`, a returned function is that run's cleanup: Meeko calls it before the next run and when the effect stops. An expression-bodied effect that only meant to read a value that is a function would call it. Use a block body:

<!-- no-check -->

```ts good
effect(() => {
  void props.onSelect;
});
```

### `onCleanup` after an `await`

```ts bad
effect(() => {
  void connect(url.value).then((socket) => {
    onCleanup(() => socket.close());
  });
});
```

The `then` runs after the effect has finished its run: there is no active owner, so `onCleanup` throws `Error: onCleanup() requires an active component root…` (and, in development, warns in the console). Register the cleanup during the run and let it check what exists:

<!-- no-check -->

```ts good
effect(() => {
  let socket: Socket | undefined;
  let released = false;
  void connect(url.value).then((opened) => {
    if (released) opened.close();
    else socket = opened;
  });
  return () => { released = true; socket?.close(); };
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
- **Cleanup.** Since `1.10`, the returned function, the `onCleanup` calls and whatever each run creates are released before the next run and when the effect stops (see [Per-run cleanup](#per-run-cleanup)). A failing cleanup reaches whoever wrote the signal, like an effect failure, and does not prevent the new run. An effect that creates another effect, a `computed` or a `createRoot` recreates them on every run: create them outside if they must live longer.
- **No `onUpdated`.** Meeko has no update hook: an effect reading signals is how you react to their changes.

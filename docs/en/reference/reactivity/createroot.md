---
title: createRoot
group: reactivity
since: 1.0.0
description: Creates a reactive root whose effects, cleanups and contexts are disposed of together when you call dispose.
symbols:
  - "@meekojs/meeko#createRoot"
related:
  - "@meekojs/meeko#effect"
  - "@meekojs/meeko#onCleanup"
  - "@meekojs/meeko#provide"
  - "@meekojs/meeko#inject"
  - docs/api.md#reactividad
source-hash: 706e7a976789cb316262c864aab369dfff32bbf4c40d62771124a6372d808dd7
---

Everything reactive belongs to a root: `effect`, `computed`, `onCleanup` cleanups and `provide` values. Meeko creates one for each component and disposes of it on unmount, so a component script almost never needs another. `createRoot(fn)` creates a root manually for code outside a component (a test, a custom host, a manually mounted widget) or a group of effects that must be disposable before the component.

`fn` receives `dispose`, the function that disposes of everything created inside. It is exported from `@meekojs/meeko` and, since `1.7`, is auto-imported in applications like `effect` or `onCleanup` (your own export named `createRoot` takes priority).

## Usage

```ts
import { createRoot, effect, signal } from "@meekojs/meeko";

const count = signal(0);
const seen: number[] = [];

const dispose = createRoot((dispose) => {
  effect(() => { seen.push(count.value); });
  return dispose;
});

count.value = 1; // seen: [0, 1]
dispose();
count.value = 2; // seen remains [0, 1]
```

## Parameters

| Parameter | Type                         | Default  | Description                                                                                     |
| --------- | ---------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `fn`      | `(dispose: () => void) => T` | required | Runs immediately, with the new root active. Everything reactive it creates belongs to the root. |

## Return value

Whatever `fn` returns. Typically `dispose` or an object containing it.

`dispose()` runs cleanups and child roots in registration order, stops effects and clears contexts. If multiple cleanups fail, it throws an `AggregateError` containing all of them. If `fn` throws, the root disposes of itself before propagating the error; if a cleanup also fails, the error is an `AggregateError` with both causes.

## Examples

### Test a composable

```ts
import { createRoot, onCleanup, signal } from "@meekojs/meeko";

function useCounter(): { count: { readonly value: number }; increment(): void } {
  const count = signal(0);
  onCleanup(() => { count.value = 0; });
  return { count, increment: () => { count.value++; } };
}

createRoot((dispose) => {
  const counter = useCounter();
  counter.increment();
  console.assert(counter.count.value === 1);
  dispose();
});
```

### Nested roots

A root created inside another is its child: disposing of the outer root also disposes of the inner one, and the inner one sees the outer one's contexts.

```ts
import { createContext, createRoot, inject, onCleanup, provide } from "@meekojs/meeko";

const log: string[] = [];
const nameKey = createContext<string>("name");

const disposeOuter = createRoot((dispose) => {
  provide(nameKey, "outer");
  createRoot(() => {
    log.push(inject(nameKey));
    onCleanup(() => log.push("inner released"));
  });
  return dispose;
});

disposeOuter(); // log: ["outer", "inner released"]
```

### Effects disposed of before the component

In a component, a custom root lets you stop a group of effects (for example, tracking while a panel is open) without unmounting anything:

```html
<script lang="ts">
import { createRoot } from "@meekojs/meeko";

const tracking = signal(false);
const position = signal(0);
let stopTracking: (() => void) | undefined;
// The root is created in a handler without an active root: the component releases it on unmount.
onCleanup(() => stopTracking?.());

function toggle(): void {
  if (stopTracking) { stopTracking(); stopTracking = undefined; tracking.value = false; return; }
  stopTracking = createRoot((dispose) => {
    const update = (): void => { position.value = window.scrollY; };
    window.addEventListener("scroll", update);
    onCleanup(() => window.removeEventListener("scroll", update));
    return dispose;
  });
  tracking.value = true;
}
</script>

<template><button type="button" on:click="toggle">{tracking.value ? `Scroll: ${position.value}` : "Track scrolling"}</button></template>
```

## Common mistakes

### Never call `dispose`

```ts bad
createRoot(() => {
  effect(() => { document.title = title.value; });
});
```

There is no error, but the effect lives forever: a root that nobody disposes of retains its effects and everything they read. Save `dispose` and call it when the work ends, or let the component do it with `onCleanup`:

<!-- no-check -->

```ts good
const dispose = createRoot((dispose) => {
  effect(() => { document.title = title.value; });
  return dispose;
});
onCleanup(dispose);
```

## Notes

- **Components.** Each component is already a root, a child of its parent's root. A root created in its script is its child: it is disposed of with the component even if you do not call `dispose`. One created in an event handler has no active root and no parent: dispose of it yourself.
- **Contexts.** The new root inherits the active root's contexts, and only its descendants can see what it publishes with `provide`.
- **Server and browser.** Works the same in both. In SSR, the root's effects only run once.
- **Errors.** A failure in `fn` disposes of the root before propagating, without leaving partially created effects.

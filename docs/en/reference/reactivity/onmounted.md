---
title: onMounted
group: reactivity
since: 1.1.0
description: Runs a function once in the browser after the component has hydrated or mounted; never in SSR.
symbols:
  - "@meekojs/meeko#onMounted"
types:
  - "@meekojs/meeko#ErrorSource"
related:
  - "@meekojs/meeko#onCleanup"
  - "@meekojs/meeko#effect"
  - "syntax:useelementref"
  - "@meekojs/meeko#provideErrorHandler"
  - docs/api.md#ciclo-de-vida
  - docs/api.md#composables-de-nivel-superior-y-await
source-hash: f426d2c5e37397f9d4792c4184b94883ed363970d15a4e11ebcd082e91112a8d
---

`onMounted(fn)` registers work that only makes sense in the browser with the DOM ready: measuring an element, focusing a field, subscribing to `window`, starting a library. `fn` runs once when component hydration or mounting finishes, with bindings and `ref:` values already assigned. It never runs on the server, so code inside can use `window` and `document` without checking.

If `fn` returns a function, Meeko registers it as component cleanup, like [`onCleanup`](/en/docs/reference/oncleanup). It is exported from `@meekojs/meeko` and auto-imported in framework applications.

## Usage

```html
<!-- app/components/WindowWidth.meeko -->
<script lang="ts">
const width = signal(0);
onMounted(() => {
  const update = (): void => { width.value = window.innerWidth; };
  update();
  window.addEventListener("resize", update);
  return () => window.removeEventListener("resize", update);
});
</script>

<template><p>{width.value}px</p></template>
```

Server HTML displays `0px`; on hydration, `onMounted` measures the window and the template updates. When the component unmounts, the returned function removes the listener.

## Parameters

| Parameter | Type                                              | Default  | Description                                                                                                        |
| --------- | ------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `fn`      | `() => void \| (() => void) \| PromiseLike<void>` | required | Runs once after mounting. Can return synchronous cleanup or be `async`; an `async` function cannot return cleanup. |

## Return value

`void`. Throws `Error: onMounted() must be called while a component script runs` if called outside a component script, and `TypeError: onMounted() expects a function` if `fn` is not a function.

## Examples

### Focus a field when it appears

```html
<script lang="ts">
const field = useElementRef("search");
onMounted(() => field.value?.focus());
</script>

<template><input ref:search type="search" placeholder="Buscar"></template>
```

### A library that needs the element

```html
<!-- app/components/Map.meeko -->
<script lang="ts">
import { createMap } from "../lib/map";

const props = defineProps<{ lat: number; lng: number }>();
const container = useElementRef("map");
onMounted(() => {
  const map = createMap(container.value!, { center: [props.lat, props.lng] });
  effect(() => map.setCenter([props.lat, props.lng]));
  return () => map.destroy();
});
</script>

<template><div ref:map class="map"></div></template>
```

The `effect` created inside tracks props and stops with the component.

### Asynchronous work with its own cleanup

An `async` function cannot return cleanup: register it with `onCleanup` before the first `await`.

```html
<script lang="ts">
const stats = signal<{ visits: number } | null>(null);
onMounted(async () => {
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  const response = await fetch("/api/stats", { signal: controller.signal });
  stats.value = (await response.json()) as { visits: number };
});
</script>

<template><p if:when="stats.value">{stats.value.visits} visitas</p></template>
```

If the request fails, the error reaches the error observer with source `"mounted"`.

### Parent and child ordering

Within the same hydration or mount operation, children run their `onMounted` before the parent, and multiple callbacks in a component run in registration order. A child can therefore emit an event in its `onMounted` and the parent's bindings are already ready to receive it.

## Common mistakes

### Return cleanup from an `async` function

```ts bad
onMounted(async () => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
});
```

`meeko check` reports `TS2345: Argument of type '() => Promise<() => void>' is not assignable to parameter of type '() => MountedResult'`: cleanup would arrive inside a promise and Meeko would not run it. Use `onCleanup` before the first `await`, or a synchronous function:

<!-- no-check -->

```ts good
onMounted(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
});
```

### Call it outside setup

```ts bad
async function open(): Promise<void> {
  await loadPanel();
  onMounted(() => panel.value?.focus());
}
```

At runtime it throws `Error: onMounted() must be called while a component script runs`. Call it at the script's top level, or do the work directly in the handler, where the component is already mounted:

<!-- no-check -->

```ts good
async function open(): Promise<void> {
  await loadPanel();
  panel.value?.focus();
}
```

### Use it in `<script server>`

`onMounted` belongs to the component, which runs in the browser; a page's server block is not mounted.

```html bad
<script server lang="ts">
onMounted(() => console.log("listo"));
</script>
```

`meeko check` reports `MEEK108: onMounted() sólo existe en el <script> de un componente: <script server> se ejecuta fuera del componente, antes de renderizar la página. Muévelo al <script lang="ts">`.

```html good
<script lang="ts">
onMounted(() => console.log("listo"));
</script>
```

## Notes

- **SSR.** Never runs on the server or in an HTML-only render: a navigation's dry run or the render before mounting a region in the browser.
- **Timing.** At the end of the current hydration or mount operation, once everything that operation created exists: the component, its later siblings and its parent's bindings. A component appearing later (a satisfied `if:when`, a new `each:of` row, a navigation's page) follows the same rule in its own mount operation.
- **Restored values.** `useStorage`, `useTheme` and controls with `model` edited by the user before hydration apply their values just before `onMounted` callbacks, so the callback already sees them.
- **No tracking.** Callbacks run without subscribing to signals they read: reading `count.value` inside does not repeat them. To react to changes, create an [`effect`](/en/docs/reference/effect).
- **Errors.** A synchronous failure or rejected promise reaches the nearest [`provideErrorHandler`](/en/docs/reference/provideerrorhandler) (or the application's `onError`) with source `"mounted"`; it does not stop other callbacks or undo hydration. If hydration fails, or the component is disposed of before mounting finishes, its callbacks do not run.
- **After a browser `await`.** In the continuation of `await useElementRef(...)` or `await useSocket(...)`, the component is already mounted, and `onMounted` runs the callback immediately.

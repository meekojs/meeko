---
title: onCleanup
group: reactivity
since: 1.0.0
description: Registers synchronous resource cleanup in the active root, executed when the component unmounts or is disposed of.
symbols:
  - "@meekojs/meeko#onCleanup"
related:
  - "@meekojs/meeko#onMounted"
  - "@meekojs/meeko#effect"
  - "@meekojs/meeko#createRoot"
  - "@meekojs/meeko#provideErrorHandler"
  - docs/api.md#reactividad
  - docs/api.md#ciclo-de-vida
source-hash: a2e73b12628a1a0c60fbe5293a6087e78fa9e3928ba1297704e3482618535168
---

`onCleanup(release)` tells Meeko what to do when the component ceases to exist: stop a timer, remove a `window` listener, close a connection, destroy a library instance. The function is registered in the active root (the component whose script is running, or a [`createRoot`](/en/docs/reference/createroot) root) and runs when that root is disposed of: when the component unmounts, on page changes, when its `if:when` or `each:of` row disappears, and also if rendering or hydration fails.

Use it to write composables that clean up their resources. It is exported from `@meekojs/meeko` and auto-imported in framework applications.

## Usage

```ts
// app/composables/now.ts
import { onCleanup, signal } from "@meekojs/meeko";
import type { ReadonlySignal } from "@meekojs/meeko";

export function useNow(intervalMs = 1_000): ReadonlySignal<number> {
  const now = signal(Date.now());
  const timer = typeof window === "undefined" ? undefined : setInterval(() => { now.value = Date.now(); }, intervalMs);
  onCleanup(() => clearInterval(timer));
  return now;
}
```

Any component calling `useNow()` in its script has a clock that stops when it unmounts.

## Parameters

| Parameter | Type         | Default  | Description                                                                                                           |
| --------- | ------------ | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `release` | `() => void` | required | **Synchronous** function releasing the resource. Returning a promise is a type error and, on disposal, a `TypeError`. |

## Return value

`void`. Without an active root it throws `Error: onCleanup() requires an active component root`.

## Examples

### A browser listener

```html
<!-- app/components/ShortcutHelp.meeko -->
<script lang="ts">
const open = signal(false);
onMounted(() => {
  const onKey = (event: KeyboardEvent): void => { if (event.key === "?") open.value = !open.value; };
  window.addEventListener("keydown", onKey);
  onCleanup(() => window.removeEventListener("keydown", onKey));
});
</script>

<template><aside if:when="open.value">Atajos de teclado…</aside></template>
```

Returning the function from `onMounted` is equivalent; `onCleanup` also works from composables and code outside that callback.

### Release a composable's connection

```ts
// app/composables/ticker.ts
import { onCleanup, signal } from "@meekojs/meeko";
import type { ReadonlySignal } from "@meekojs/meeko";

export function useTicker(url: string): ReadonlySignal<number | null> {
  const price = signal<number | null>(null);
  if (typeof EventSource !== "undefined") {
    const source = new EventSource(url);
    source.onmessage = (event) => { price.value = Number(event.data); };
    onCleanup(() => source.close());
  }
  return price;
}
```

### Multiple cleanups

Each call adds a cleanup. Disposing of the root runs all of them in registration order; if several fail, Meeko continues with the others and throws an `AggregateError` with all causes.

```ts
import { createRoot, onCleanup } from "@meekojs/meeko";

const log: string[] = [];
const dispose = createRoot((dispose) => {
  onCleanup(() => log.push("timer"));
  onCleanup(() => log.push("socket"));
  return dispose;
});
dispose(); // log: ["timer", "socket"]
```

## Common mistakes

### Use browser APIs in cleanup that also runs in SSR

```html bad
<!-- app/components/Sticky.meeko -->
<script lang="ts">
let frame = 0;
let observer: ResizeObserver | undefined;
const scheduleUpdate = (): void => {};
onCleanup(() => {
  cancelAnimationFrame(frame);
  observer?.disconnect();
  window.removeEventListener("resize", scheduleUpdate);
});
</script>
```

A component's script also runs on the server and, in SSR, the root is disposed of when rendering finishes: cleanup runs in Node, where `window` and `cancelAnimationFrame` do not exist, and throws `ReferenceError`. `meeko check` and the editor report warning [`MEEK128`](/en/docs/stability) (an error in `2.0`) when a top-level script `onCleanup`, one in an `effect` or in a setup-called function (a composable) uses a browser-only API without checking first. The editor offers “Move to `onMounted`”. Create the resource and its cleanup in `onMounted`, which only runs in the browser:

<!-- no-check -->

```ts good
let frame = 0;
let observer: ResizeObserver | undefined;
onMounted(() => {
  window.addEventListener("resize", scheduleUpdate);
  onCleanup(() => {
    cancelAnimationFrame(frame);
    observer?.disconnect();
    window.removeEventListener("resize", scheduleUpdate);
  });
});
```

There is no warning for cleanup guarded by `typeof window`, `typeof document` or `import.meta.env.SSR` (in a condition or with an early return), cleanup registered in `onMounted`, an event handler or after the first browser `await`, or optional chaining on your own variable (`observer?.disconnect()`). On the global it does not protect you: `window?.scrollTo()` also throws on the server. A local variable named `window` is not the global.

### Asynchronous cleanup

```ts bad
onCleanup(async () => {
  await connection.close();
});
```

`meeko check` reports `TS2345: Argument of type '() => Promise<void>' is not assignable to parameter of type 'never'`. In JavaScript, disposal delivers `TypeError: Meeko cleanup callbacks must be synchronous` and the component does not await the promise. Start closing and observe its error yourself:

<!-- no-check -->

```ts good
onCleanup(() => {
  connection.close().catch((error: unknown) => console.error("No se pudo cerrar", error));
});
```

### Call it outside a root

```ts bad
// app/utils/clock.ts, evaluado al importar el módulo
const timer = setInterval(tick, 1000);
onCleanup(() => clearInterval(timer));
```

Importing the module throws `Error: onCleanup() requires an active component root`: a module does not unmount. A project's `meeko check` reports warning `MEEK130` in `app/`, `shared/` and `server/` modules. Call `onCleanup` inside a function invoked by the component's script (a composable), or create a root with [`createRoot`](/en/docs/reference/createroot):

<!-- no-check -->

```ts good
export function useClock(): void {
  const timer = setInterval(tick, 1000);
  onCleanup(() => clearInterval(timer));
}
```

### Register it after an `await`

Inside an `async` function, code after an `await` no longer runs in the component's script.

```ts bad
onMounted(async () => {
  const socket = await connect();
  onCleanup(() => socket.close());
});
```

If the component unmounts while waiting, the socket stays open, and after `await` there is no active root. `meeko check` and the editor report warning `MEEK129`. Register cleanup before the first `await` and let it check what exists:

<!-- no-check -->

```ts good
onMounted(async () => {
  let socket: Socket | undefined;
  let released = false;
  onCleanup(() => { released = true; socket?.close(); });
  socket = await connect();
  if (released) socket.close();
});
```

## Notes

- **Server.** In SSR, the component root is disposed of when rendering finishes, so cleanups run too: do not leave server timers open, or create them only in the browser (`typeof window`, `onMounted`). Such cleanup using browser APIs triggers warning `MEEK128`; see [Use browser APIs in cleanup that also runs in SSR](#use-browser-apis-in-cleanup-that-also-runs-in-ssr).
- **Failed render.** If rendering or hydration fails, Meeko disposes of everything registered so far. If cleanup also fails, it delivers an `AggregateError` with both causes.
- **Errors.** A throwing cleanup does not prevent others. A rejection from cleanup mistakenly returning a promise reaches the nearest [`provideErrorHandler`](/en/docs/reference/provideerrorhandler) with source `"cleanup"`.
- **Effects.** You do not need `onCleanup` for the component's `effect` and `computed` calls: they belong to the same root and stop automatically.

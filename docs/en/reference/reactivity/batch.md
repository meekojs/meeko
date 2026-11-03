---
title: batch
group: reactivity
since: 1.0.0
description: Groups multiple signal writes into a single round of notifications when the function finishes.
symbols:
  - "@meekojs/meeko#batch"
related:
  - "@meekojs/meeko#signal"
  - "@meekojs/meeko#effect"
  - "@meekojs/meeko#computed"
  - "@meekojs/meeko#untrack"
  - docs/api.md#reactividad
source-hash: a5da4ace07a06d8b51ca9ec1f90b47023e4cb9b75789c01f49478a2e60267191
---

Each signal write immediately runs the observers that read it. If you change three signals in succession, an `effect` that reads all three runs three times and sees two intermediate states. `batch(fn)` delays those notifications until `fn` finishes: affected observers run once, after all writes are complete.

It is exported from `@meekojs/meeko` and auto-imported in framework applications.

## Usage

```ts
import { batch, effect, signal } from "@meekojs/meeko";

const first = signal("Ada");
const last = signal("Lovelace");
const log: string[] = [];
effect(() => { log.push(`${first.value} ${last.value}`); });

batch(() => {
  first.value = "Grace";
  last.value = "Hopper";
});
// log: ["Ada Lovelace", "Grace Hopper"], without the intermediate "Grace Lovelace"
```

## Parameters

| Parameter | Type      | Default  | Description                                                                              |
| --------- | --------- | -------- | ---------------------------------------------------------------------------------------- |
| `fn`      | `() => T` | required | Function that writes signals. It runs immediately; notifications wait until it finishes. |

## Return value

The return value of `fn`. If `fn` throws, `batch` still runs pending observers and rethrows the error; if an observer also fails, it throws an `AggregateError` with both causes.

## Examples

### A handler that changes multiple signals

```html
<!-- app/components/Filters.meeko -->
<script lang="ts">
const category = signal("todas");
const minPrice = signal(0);
const page = signal(1);

function reset(): void {
  batch(() => {
    category.value = "todas";
    minPrice.value = 0;
    page.value = 1;
  });
}
</script>

<template>
  <button type="button" on:click="reset">Clear filters</button>
</template>
```

A `useApi` that reads all three signals in its `query` requests data once, rather than three times.

### A consistent state for an effect

```ts
import { batch, effect, signal } from "@meekojs/meeko";

const status = signal<"idle" | "done" | "error">("idle");
const message = signal("");

effect(() => {
  // Never sees status "error" with an empty message.
  if (status.value === "error") console.warn(message.value);
});

batch(() => {
  message.value = "Could not save";
  status.value = "error";
});
```

### Nested batches

A `batch` inside another batch does not notify when it finishes: notifications wait for the outer batch.

```ts
import { batch, signal } from "@meekojs/meeko";

const a = signal(0);
const b = signal(0);

function setA(value: number): void { batch(() => { a.value = value; }); }

batch(() => {
  setA(1);       // not notified yet
  b.value = 1;
}); // observers of a and b run here, once
```

## Common mistakes

### An asynchronous `batch`

The batch ends when `fn` returns, and an `async` function returns at its first `await`.

```ts bad
batch(async () => {
  a.value = 10;
  await save();
  b.value = 20;
});
```

There is no type or runtime error, but the write after `await` falls outside the batch: an effect that reads `a` and `b` runs twice. Perform the asynchronous work first and group only the writes:

<!-- no-check -->

```ts good
const saved = await save();
batch(() => {
  a.value = 10;
  b.value = saved.total;
});
```

### Reading a computed value inside the batch

A `computed` is also an observer: inside `batch` it keeps its previous value until the batch ends.

```ts bad
const double = computed(() => count.value * 2);
batch(() => {
  count.value = 5;
  send(double.value); // sends twice the previous value
});
```

Read the `computed` after the batch, or calculate from the values you just wrote:

<!-- no-check -->

```ts good
batch(() => { count.value = 5; });
send(double.value); // 10
```

## Notes

- **When you need it.** Each write is synchronous and cheap; `batch` only matters when an observer reads several signals you change together, or when the intermediate state is invalid.
- **Already batched.** Meeko batches its own simultaneous writes: the states of `useApi` and `useRpcQuery` (`data`, `error`, `pending`, `refreshing`) and those of `useRpcMutation` and `useApiMutation`. An `effect` that reads them never sees a mixed state.
- **Server and browser.** It works the same in both; in SSR, effects already stop after their first run.
- **Errors.** All failures from pending observers are collected: a single failure is thrown as is, and multiple failures are thrown in an `AggregateError`.

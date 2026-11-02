---
title: <MeekoAwait>
group: components
since: 1.5.0
description: A region for data arriving after the first paint, with loading, error and refresh states, and reserved height to prevent layout shifts.
symbols:
  - "syntax:meekoawait"
types:
  - "@meekojs/meeko/framework#MeekoAwaitProps"
  - "@meekojs/meeko/framework#MeekoAwaitSnippets"
  - "@meekojs/meeko/framework#AwaitResource"
related:
  - docs/como-elegir.md
  - "autoimport:useApi"
  - "autoimport:useRpcQuery"
  - "@meekojs/meeko/framework#DataResource"
  - "@meekojs/meeko/framework#useNavigation"
  - docs/framework.md#meekoawait
  - docs/framework.md#evitar-saltos-de-altura-cls
  - docs/framework.md#datos-anteriores-durante-una-recarga-keepprevious
source-hash: 33028289e8999cbbff7f08b985f0b255318b219113b65af6c2667c079373d223
---

A `useApi` or `useRpcQuery` **without** `await` lets the component render immediately and requests data in the browser on mount. `<MeekoAwait for="recurso">` wraps that data region and handles its states: the `pending` snippet on initial load, the `error` snippet (with a retry button) on failure, and its content when data exists. A refresh keeps content mounted. With `reserve`, while waiting it occupies the height it last had with data, so the page does not jump.

No import is needed: the compiler recognizes it, and a project component with the same name takes priority (`MEEK106`). Inside its content, `meeko check` and the editor read `items.data.value` as loaded.

## Usage

```html
<!-- app/components/ItemsCard.meeko -->
<script lang="ts">
const items = useApi("/api/items");
</script>

<template>
  <section class="card">
    <h2>Items</h2>
    <MeekoAwait for="items" reserve>
      <snippet name="pending"><ItemsSkeleton /></snippet>
      <snippet name="error" params="error, retry"><p role="alert">No se pudo cargar. <button on:click="retry">Reintentar</button></p></snippet>
      <ItemsList bind:items="items.data.value" />
    </MeekoAwait>
  </section>
</template>
```

`items.data.value` is `Item[]` inside the tag, without `!` or `?.`.

## Props

| Attribute                   | Type                                        | Default                                                                        | Description                                                                                                                                                              |
| --------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `for` or `bind:for`         | `AwaitResource \| readonly AwaitResource[]` | required                                                                       | The resource, as an expression (like `each:of`): `for="items"` or a list, `for="[items, stats]"`. Missing it is `MEEK116`.                                               |
| `reserve` or `bind:reserve` | `boolean \| string`                         | no reservation                                                                 | `reserve` remembers the region's height with data and applies it while waiting again; `reserve="320px"` (any CSS length) also sets a minimum, including the first visit. |
| `bind:messages`             | `{ error?: string; retry?: string }`        | “No se pudieron cargar los datos.”, “Reintentar” (Could not load data., Retry) | Default error alert text, without an `error` snippet.                                                                                                                    |
| `class`, `id`               | `string`                                    | none                                                                           | For the container, a `<div>`.                                                                                                                                            |

| Snippet             | Parameters                          | When it renders                                                                                                                                    |
| ------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default` (content) | `[refreshing: boolean]`             | When all resources have data; `refreshing` is `true` during a refresh.                                                                             |
| `pending`           | none                                | On initial load: a resource without data that is loading or has not started yet.                                                                   |
| `error`             | `[error: Error, retry: () => void]` | When a resource without data failed. `retry` requests failed resources again. Without it, a `<p role="alert">` with a “Reintentar” (Retry) button. |

## Result

An unstyled `<div>` that never changes its element, with:

- `data-meeko-await="pending|error|ready"`;
- `aria-busy="true"` while loading or refreshing;
- `data-meeko-refreshing` during a refresh;
- with `reserve`, `data-meeko-reserve` and `data-meeko-reserve-min`.

A resource failure takes priority over another still loading, offering `retry` as soon as possible. If focus was on a node that disappears on a state change (the “Reintentar”, Retry, button), it moves to the container (`tabindex="-1"`, without scrolling) instead of being lost.

## Examples

### Multiple resources

```html
<script lang="ts">
const users = useApi("/api/users");
const stats = useRpcQuery("stats.summary");
</script>

<template>
  <MeekoAwait for="[users, stats]">
    <snippet name="pending"><p>Cargando…</p></snippet>
    <p>{users.data.value.length} usuarios · {stats.data.value.orders} pedidos</p>
  </MeekoAwait>
</template>
```

### A discreet indicator during refresh

Content receives `refreshing`; data stays on screen:

```html
<script lang="ts">
const page = signal("1");
const orders = useApi("/api/orders", { query: { page } });
</script>

<template>
  <MeekoAwait for="orders">
    <snippet name="default" params="refreshing">
      <ul bind:class="refreshing ? 'dimmed' : undefined">
        <li each:of="orders.data.value" each:as="order" each:key="order.id">{order.total}</li>
      </ul>
    </snippet>
  </MeekoAwait>
  <button type="button" on:click="() => page.value = String(Number(page.value) + 1)">Siguiente</button>
</template>
```

### A skeleton with the same height

`reserve` cannot predict height on the tab's first visit. A skeleton with the same rows, or an explicit minimum, also prevents that shift:

```html
<MeekoAwait for="items" reserve="320px">
  <snippet name="pending"><ul class="skeleton"><li each:of="[1, 2, 3, 4]" each:as="row"></li></ul></snippet>
  <ul><li each:of="items.data.value" each:as="item" each:key="item.id">{item.name}</li></ul>
</MeekoAwait>
```

### Translated messages

```html
<MeekoAwait for="items" bind:messages="{ error: 'Could not load the items.', retry: 'Retry' }">
  <ItemsList bind:items="items.data.value" />
</MeekoAwait>
```

## Common mistakes

### Forget `for`

```html bad
<MeekoAwait><ItemsList bind:items="items.data.value" /></MeekoAwait>
```

`meeko check` reports `MEEK116: <MeekoAwait> necesita for="recurso": el resultado de useApi o useRpcQuery sin await, o una lista, como for="[items, stats]"`.

```html good
<MeekoAwait for="items"><ItemsList bind:items="items.data.value" /></MeekoAwait>
```

### Pass data instead of the resource

```html bad
<MeekoAwait for="items.data"><ItemsList bind:items="items.data.value" /></MeekoAwait>
```

`meeko check` reports `TS2322: Type 'ReadonlySignal<Item[] | null>' is not assignable to type 'AwaitResource | readonly AwaitResource[]'`: the tag needs the whole resource, with `data`, `error`, `pending` and `refresh`. At runtime this would be a `TypeError`.

```html good
<MeekoAwait for="items"><ItemsList bind:items="items.data.value" /></MeekoAwait>
```

### Read data outside the tag

Only `<MeekoAwait>` content reads `data` as loaded.

```html bad
<MeekoAwait for="items"><p>{items.data.value.length}</p></MeekoAwait>
<p>Total: {items.data.value.length}</p>
```

In the second `<p>`, `meeko check` reports `TS18047: 'items.data.value' is possibly 'null'`. Move the read inside, or check it:

```html good
<MeekoAwait for="items"><p>{items.data.value.length}</p><p>Total: {items.data.value.length}</p></MeekoAwait>
```

### A `reserve` that is not a length

```html bad
<MeekoAwait for="items" reserve="mucho">…</MeekoAwait>
```

`meeko check` accepts it, but rendering throws `TypeError: <MeekoAwait>: reserve must be empty or a CSS length such as reserve="320px", not "mucho"`.

```html good
<MeekoAwait for="items" reserve="20rem">…</MeekoAwait>
```

## Notes

- **SSR.** Without `await`, the request is not made on the server: HTML contains the `pending` snippet and `aria-busy`, and hydration changes nothing until data arrives. If the resource already has data on the server (an `await useApi`, also valid in `for`), HTML contains the content.
- **`await` or `<MeekoAwait>`.** For content visible on page load, `await useApi(...)` is better: SSR renders the data and nothing grows. `<MeekoAwait>` is for secondary data, off-screen regions or components mounted later.
- **Reservation and CSP.** Height is applied through a constructed stylesheet, without `style` attributes: it works with strict CSP. On a full load, a `<head>` script applies it before the first paint; the `reserve="320px"` minimum goes in a `<style>` with the request's nonce or, on a static site, its hash.
- **Height memory.** Stored in `sessionStorage` (`meeko:await`) by route, request and region order, keeping the 100 most recent. If the browser blocks storage, it lives while the page is open.
- **Accessibility.** `aria-busy` announces loading. The default error alert has `role="alert"`; add it to your `error` snippet too.
- **`MEEK117`.** `meeko check` warns about a page or layout rendering non-awaited `useApi` data in an `each:of` without handling loading; wrapping the list in `<MeekoAwait>` resolves it.

---
title: useRpcQuery
group: composables
since: 1.1.0
description: Reads a server/rpc procedure from a component, with SSR, hydration, reactive input reloading and contract types.
symbols:
  - "autoimport:useRpcQuery"
types:
  - "@meekojs/meeko/framework#UseRpcQuery"
  - "@meekojs/meeko/framework#DataResource"
  - "@meekojs/meeko/framework#DataResourceOptions"
related:
  - "autoimport:useApi"
  - "autoimport:useRpcMutation"
  - "syntax:meekoawait"
  - "@meekojs/meeko/server#defineRpc"
  - "autoimport:rpc"
  - "@meekojs/meeko/framework#createUseRpcQuery"
  - docs/framework.md#datos-en-componentes-useapi-userpcquery-y-userpcmutation
  - docs/framework.md#búsqueda-mientras-se-escribe-debouncems-y-enabled
source-hash: 3866f13d5c029f7432cd4cc274a541f4c3ef9950ee844eb052d0d7ad47fb1075
---

`useRpcQuery(procedimiento, input?, recarga?)` is [`useApi`](/en/docs/reference/use-api) for `server/rpc` procedures: it calls the procedure with `input` and returns the same resource, with `data`, `error`, `pending`, `refreshing` and `refresh`. Name the procedure by its dotted ID (`server/rpc/users/activity.ts` is `"users.activity"`) and TypeScript checks `input` and the shape of `data` against its contract.

With `await`, SSR waits for data and hydration reads it from the payload; without `await`, the request starts in the browser on mount. `input` can contain signals or be a function reading them: a change requests the data again. Application clients generate it and it is auto-imported in `.meeko` files; call it only at the top level of `<script>`.

## Usage

```html
<!-- app/pages/users/[id]/activity.meeko -->
<script lang="ts">
const props = defineProps<{ params: { id: string }; search: Record<string, string | string[]> }>();
const tab = signal("all");
const activity = await useRpcQuery("users.activity", () => ({ id: props.params.id, tab: tab.value }));
</script>

<template>
  <button type="button" on:click="() => tab.value = 'comments'">Comentarios</button>
  <p>{activity.data.value.length} eventos</p>
</template>
```

Changing `tab` calls the procedure again; meanwhile, the previous list remains on screen.

## Parameters

| Parameter              | Type                                                               | Default                        | Description                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `procedimiento`        | a procedure ID                                                     | required                       | Such as `"users.activity"`. The editor completes application procedures.                                                             |
| `input`                | procedure input, with fields that can be signals, or `() => input` | `{}` if accepted by the schema | Validated against the procedure's `input` schema. If the schema accepts `{}`, you can omit it and `{}` is sent.                      |
| `recarga.keepPrevious` | `boolean`                                                          | `true`                         | Since `1.5`. With `false`, an input change clears `data`.                                                                            |
| `recarga.debounceMs`   | `number`                                                           | `0`                            | Since `1.7`. Waits for input to settle before requesting; does not delay initial loading, `refresh()` or SSR.                        |
| `recarga.enabled`      | `boolean`, signal or `() => boolean`                               | `true`                         | Since `1.7`. While `false`, no request is made and any in-flight request is canceled. A resource with `await` cannot start disabled. |

## Return value

A `DataResource<T>`, where `T` is the procedure's output; with `await`, a `LoadedResource<T>` whose `data` is never `null`. Its properties are those of [`useApi`](/en/docs/reference/use-api): `data`, `error`, `pending`, `refreshing` and `refresh()`.

## Examples

### Search as you type (since 1.7)

```html
<script lang="ts">
const query = signal("");
const results = useRpcQuery("docs.search", () => ({ q: query.value.trim() }), {
  debounceMs: 200,
  enabled: () => query.value.trim().length >= 2,
});
</script>

<template>
  <input type="search" model="query" aria-controls="results">
  <ul id="results" bind:aria-busy="results.pending.value ? 'true' : undefined">
    <li each:of="results.data.value?.hits ?? []" each:as="hit" each:key="hit.url"><a bind:href="hit.url">{hit.title}</a></li>
  </ul>
</template>
```

Each change cancels the in-flight request; with fewer than two letters, nothing is requested.

### A summary without input

<!-- no-check -->

```ts
// En el <script> de app/components/Stats.meeko
const stats = await useRpcQuery("stats.summary"); // el schema acepta {}: envía {}
```

### Multiple resources in one region

```html
<script lang="ts">
const users = useRpcQuery("users.list");
const totals = useRpcQuery("stats.summary");
</script>

<template>
  <MeekoAwait for="[users, totals]" reserve>
    <snippet name="pending"><p>Cargando…</p></snippet>
    <p>{users.data.value.length} usuarios, {totals.data.value.orders} pedidos</p>
  </MeekoAwait>
</template>
```

`<MeekoAwait>` renders its content when both have data, and inside, `meeko check` reads `data` as loaded.

### Reactive fields in input

Instead of a function, each `input` field can be a signal:

```html
<script lang="ts">
const page = signal(1);
const list = useRpcQuery("users.page", { page });
</script>

<template><button type="button" on:click="() => page.value++">Más</button></template>
```

## Common mistakes

### A procedure that does not exist

```ts bad
const activity = useRpcQuery("users.activiti", { id: "1", tab: "a" });
```

`meeko check` reports `TS2345: Argument of type '"users.activiti"' is not assignable to parameter of type '"docs.search" | "users.activity" | "users.rename"'`, with the list of procedures.

<!-- no-check -->

```ts good
const activity = useRpcQuery("users.activity", { id: "1", tab: "a" });
```

### Incomplete input

```ts bad
const activity = useRpcQuery("users.activity", { id: "1" });
```

`meeko check` reports `TS2345: Argument of type '{ id: string; }' is not assignable to parameter of type 'RpcQueryInput<{ id: string; tab: string; }>'`, with `Property 'tab' is missing`.

<!-- no-check -->

```ts good
const activity = useRpcQuery("users.activity", { id: "1", tab: "all" });
```

### Call it inside an `effect`

```ts bad
effect(() => {
  useRpcQuery("users.activity", { id: "1", tab: tab.value });
});
```

`meeko check` reports `MEEK054: useRpcQuery() debe llamarse en el nivel superior de <script>, no dentro de una función, un handler, un effect ni onMounted`. Reloading is already reactive: pass a function reading the signal.

<!-- no-check -->

```ts good
const activity = useRpcQuery("users.activity", () => ({ id: "1", tab: tab.value }));
```

### Input the browser cannot reproduce

```ts bad
const feed = await useRpcQuery("feed.latest", { since: Date.now() });
```

The server requests data with its own `Date.now()` and the browser uses another during hydration: the key does not match and hydration fails with `MEEKO_RESOURCE_MISSING: useRpcQuery("feed.latest") (…) is not in the page payload; the server and the browser requested different data…`. Make input depend only on props, route data or state:

<!-- no-check -->

```ts good
const feed = await useRpcQuery("feed.latest", { since: props.data.since });
```

## Notes

- **SSR and hydration.** Like `useApi`: with `await`, the server waits for data (at most 10 passes) and sends it in `resources`; without `await`, the request is never made on the server.
- **Request key.** The procedure and input in stable JSON form the application cache key: a component mounting later with the same input reuses the data.
- **Session and security.** The request carries the user's session; the procedure applies its guards (`auth`, `authorize`). Validate everything arriving in `input` on the server.
- **Writes.** `useRpcQuery` is for reading: it may repeat during navigation, hydration or input changes. To change data, use [`useRpcMutation`](/en/docs/reference/use-rpc-mutation).

---
title: useApi
group: composables
since: 1.1.0
description: Reads a server/api GET endpoint from a component, with SSR, hydration without repeating the request, reactive reloading and contract types.
symbols:
  - "autoimport:useApi"
types:
  - "@meekojs/meeko/framework#UseApi"
  - "@meekojs/meeko/framework#DataResource"
  - "@meekojs/meeko/framework#DataResourceOptions"
  - "@meekojs/meeko/framework#ApiQueryOptions"
related:
  - "autoimport:useRpcQuery"
  - "autoimport:useApiMutation"
  - "syntax:meekoawait"
  - "@meekojs/meeko/server#defineApiRoute"
  - "autoimport:api"
  - "@meekojs/meeko/framework#createUseApi"
  - docs/framework.md#datos-en-componentes-useapi-userpcquery-y-userpcmutation
  - docs/framework.md#búsqueda-mientras-se-escribe-debouncems-y-enabled
  - docs/api.md#composables-de-nivel-superior-y-await
source-hash: 729d2b2096dfd3a9bf56c8aae3ffd8e323b7419da42cd344ea442326ad302738
---

`useApi(ruta, opciones?, recarga?)` requests data from a `server/api` `GET` endpoint and returns a resource with `data`, `error`, `pending`, `refreshing` and `refresh`. Write the route as described by `server/api`, with dynamic segments in brackets (`"/api/users/[id]"`), and TypeScript checks `params`, `query` and the shape of `data` against the endpoint contract. It uses the same session, CSRF and validation as `api.*`.

With `await`, the component does not render until data is available, including in SSR, and hydration reads it from the payload without repeating the request. Without `await`, it renders immediately with `data` as `null` and the request starts in the browser on mount. If options read signals, a change requests data again. Application clients generate it and it is auto-imported in `.meeko` files; call it only at the top level of `<script>`.

## Usage

```html
<!-- app/pages/users/[id].meeko -->
<script lang="ts">
const props = defineProps<{ params: { id: string }; search: Record<string, string | string[]> }>();
const user = await useApi("/api/users/[id]", { params: { id: props.params.id } });
</script>

<template><h1>{user.data.value.name}</h1></template>
```

With `await`, `user.data.value` is never `null` in its type.

## Parameters

| Parameter              | Type                                                 | Default                                     | Description                                                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ruta`                 | a `GET` endpoint path                                | required                                    | Such as `"/api/users"` or `"/api/users/[id]"`. Only the application's `GET` routes; the editor completes them.                                                                                |
| `opciones`             | `{ params?, query? }` or `() => { params?, query? }` | no options if the contract requires nothing | `params` is required for a dynamic route; `query` if the contract requires a field. Each field can be a signal, or the entire value a function reading signals: a change requests data again. |
| `recarga.keepPrevious` | `boolean`                                            | `true`                                      | Since `1.5`. With `false`, an input change clears `data` and becomes initial loading again.                                                                                                   |
| `recarga.debounceMs`   | `number`                                             | `0`                                         | Since `1.7`. Milliseconds input must settle before requesting: a burst of changes makes one request. Does not delay initial loading, `refresh()` or SSR.                                      |
| `recarga.enabled`      | `boolean`, signal or `() => boolean`                 | `true`                                      | Since `1.7`. While `false`, no request is made, even with `refresh()`, and the in-flight request is canceled.                                                                                 |

## Return value

A `DataResource<T>`, where `T` is the endpoint response. With `await`, a `LoadedResource<T>` whose `data` is never `null`.

| Property     | Type                            | Description                                                                                                    |
| ------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `data`       | `ReadonlySignal<T \| null>`     | Latest successfully loaded data, or `null` before the first load. Reloading retains it until new data arrives. |
| `error`      | `ReadonlySignal<Error \| null>` | Latest load's failure, or `null`. A server error response is a `ClientError`.                                  |
| `pending`    | `ReadonlySignal<boolean>`       | `true` while loading (or waiting for `debounceMs`).                                                            |
| `refreshing` | `ReadonlySignal<boolean>`       | Since `1.5`. `true` while reloading with previous data; initial loading is `pending` without `refreshing`.     |
| `refresh()`  | `Promise<void>`                 | Requests again with current input; failure only updates `error`.                                               |

## Examples

### Without `await`, with a loading indicator

```html
<script lang="ts">
const users = useApi("/api/users");
</script>

<template>
  <p if:when="users.pending.value">Cargando…</p>
  <p if:when="users.error.value" role="alert">No se pudieron cargar los usuarios.</p>
  <ul if:when="users.data.value">
    <li each:of="users.data.value" each:as="user" each:key="user.id">{user.name}</li>
  </ul>
</template>
```

To avoid a height jump when data arrives, wrap the region in [`<MeekoAwait for="users" reserve>`](/en/docs/reference/meekoawait).

### A paginated list that reloads automatically

```html
<script lang="ts">
const page = signal("1");
const orders = useApi("/api/orders", { query: { page } });
</script>

<template>
  <ul bind:class="orders.refreshing.value ? 'dimmed' : undefined">
    <li each:of="orders.data.value ?? []" each:as="order" each:key="order.id">{order.total}</li>
  </ul>
  <button type="button" on:click="() => page.value = String(Number(page.value) + 1)">Siguiente</button>
</template>
```

While the next page arrives, the previous list stays on screen, dimmed.

### Search as you type (since 1.7)

```html
<script lang="ts">
const q = signal("");
const results = useApi("/api/users", () => ({ query: { q: q.value.trim() } }), {
  debounceMs: 250,
  enabled: () => q.value.trim().length >= 2,
});
</script>

<template>
  <input type="search" model="q" aria-controls="results">
  <ul id="results" bind:aria-busy="results.pending.value ? 'true' : undefined">
    <li each:of="results.data.value ?? []" each:as="user" each:key="user.id">{user.name}</li>
  </ul>
</template>
```

A burst of keystrokes makes one request, with the latest text; with fewer than two letters, nothing is requested and `pending` is `false`.

### Reload after a mutation

```html
<script lang="ts">
const props = defineProps<{ params: { id: string }; search: Record<string, string | string[]> }>();
const note = await useApi("/api/notes/[id]", { params: { id: props.params.id } });
const save = useApiMutation("/api/notes/[id]", "PUT");
async function rename(text: string): Promise<void> {
  await save.mutate({ params: { id: props.params.id }, body: { text } });
  await note.refresh();
}
</script>
```

### Another record without showing the previous one

```html
<script lang="ts">
const props = defineProps<{ params: { id: string }; search: Record<string, string | string[]> }>();
const user = useApi("/api/users/[id]", () => ({ params: { id: props.params.id } }), { keepPrevious: false });
</script>
```

Navigating from `/users/1` to `/users/2` resets `data` to `null` instead of showing user 1's record while user 2's arrives.

## Common mistakes

### Call it inside a function

```html bad
<script lang="ts">
function load() { return useApi("/api/users"); }
</script>
```

`meeko check` reports `MEEK054: useApi() debe llamarse en el nivel superior de <script>, no dentro de una función, un handler, un effect ni onMounted`. Call it once at the top level and use `refresh()` or signals in options to request again:

```html good
<script lang="ts">
const users = useApi("/api/users");
const reload = () => users.refresh();
</script>
```

### A nonexistent route, or one without its `params`

```ts bad
const users = useApi("/api/user", {});
const user = useApi("/api/users/[id]");
```

`meeko check` reports `TS2345: Argument of type '"/api/user"' is not assignable to parameter of type '"/api/users" | "/api/users/[id]"'` for the first, listing `GET` routes, and `TS2554: Expected 2-3 arguments, but got 1` for the second, because a dynamic route requires `params`. A nonexistent route without options also produces `TS2554`.

<!-- no-check -->

```ts good
const user = useApi("/api/users/[id]", { params: { id: props.params.id } });
```

### Iterate `data` without `await` or a check

```html bad
<li each:of="users.data.value" each:as="user" each:key="user.id">{user.name}</li>
```

Without `await`, `data` is `null` until data arrives: `meeko check` reports `TS2345: Argument of type 'User[] | null' is not assignable to parameter of type 'Iterable<User>'`. Await data, check the list or wrap it in `<MeekoAwait>`:

```html good
<li each:of="users.data.value ?? []" each:as="user" each:key="user.id">{user.name}</li>
```

### Read `.value` in options

```ts bad
const id = signal("1");
const user = useApi("/api/users/[id]", { params: { id: id.value } });
```

`meeko check` accepts this, but reads the value once: changing `id` does not request data again. Pass the signal, or a function reading it:

<!-- no-check -->

```ts good
const user = useApi("/api/users/[id]", { params: { id } });
const same = useApi("/api/users/[id]", () => ({ params: { id: id.value } }));
```

### An `await` inside an expression

```ts bad
const count = (await useApi("/api/users")).data.value.length;
```

`meeko check` reports `MEEK055: await useApi(...) debe ser una sentencia completa o el inicializador completo de una declaración, como const value = await useApi(...)`.

<!-- no-check -->

```ts good
const users = await useApi("/api/users");
const count = computed(() => users.data.value.length);
```

### An awaited resource that starts disabled

```ts bad
const results = await useApi("/api/users", { query: { q } }, { enabled: false });
```

Throws `useApi("/api/users") is disabled (enabled is false): an awaited resource needs its data. Leave out await, or enable it`, on both server and browser. Remove `await` for a resource that may start disabled.

<!-- no-check -->

```ts good
const results = useApi("/api/users", { query: { q } }, { enabled: () => q.value.length >= 2 });
```

## Notes

- **SSR with `await`.** The server renders the page, awaits requests from each `await` and rerenders with data until no pass suspends (at most 10). Requests dispatch locally through the same pipeline as `api.*`, with the request's session.
- **Hydration.** Data travels in the payload's `resources` field, keyed by request. Input to `await useApi` must depend only on props, route data and state: if the browser requests a key the server did not load, hydration fails with `MEEKO_RESOURCE_MISSING`.
- **Without `await`.** The request is never made on the server: HTML has `pending` as `true` and `data` as `null` (or `pending` as `false` if initially disabled). `meeko check` warns with `MEEK117` for a page rendering the list without handling loading.
- **Navigation.** Before committing navigation, the browser loads the new page's `await` resources in a dry run, with `useNavigation().pending` as `true`. An `await` failure displays the error page, like a loader failure; a reload failure only updates `error`.
- **Late-mounting components.** A component appearing later (an `if:when`, a new row) and awaiting uncached data leaves its region empty while loading, without an error.
- **Cancellation.** Input changes cancel the in-flight request; canceled request results are discarded.
- **`head`.** The route's `head` is calculated from loader or `<script server>` data, not `useApi` data: if `<title>` depends on data, load it there.

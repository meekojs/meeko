---
title: useRpcQuery
group: composables
since: 1.1.0
description: Lee un procedimiento de server/rpc desde un componente, con SSR, hidratación, recarga reactiva de la entrada y tipos del contrato.
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
---

`useRpcQuery(procedimiento, input?, recarga?)` es [`useApi`](/docs/reference/use-api) para los procedimientos de `server/rpc`: llama al procedimiento con `input` y devuelve el mismo recurso, con `data`, `error`, `pending`, `refreshing` y `refresh`. El procedimiento se nombra por su ID con puntos (`server/rpc/users/activity.ts` es `"users.activity"`) y TypeScript comprueba `input` y la forma de `data` contra su contrato.

Con `await`, el SSR espera los datos y la hidratación los lee del payload; sin `await`, la petición empieza en el navegador al montar. `input` puede contener señales o ser una función que las lee: un cambio vuelve a pedir los datos. Lo generan los clientes de la aplicación y se autoimporta en los `.meeko`; sólo se llama en el nivel superior del `<script>`.

## Uso

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

Cambiar `tab` vuelve a llamar al procedimiento; mientras tanto, la lista anterior sigue en pantalla.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `procedimiento` | ID de un procedimiento | obligatorio | Como `"users.activity"`. El editor completa los de la aplicación. |
| `input` | la entrada del procedimiento, con campos que pueden ser señales, o `() => input` | `{}` si el schema lo acepta | Se valida con el schema `input` del procedimiento. Si el schema acepta `{}`, se puede omitir y se envía `{}`. |
| `recarga.keepPrevious` | `boolean` | `true` | Desde `1.5`. Con `false`, un cambio de la entrada vacía `data`. |
| `recarga.debounceMs` | `number` | `0` | Desde `1.7`. Espera a que la entrada se quede quieta antes de pedir; no retrasa la primera carga, `refresh()` ni el SSR. |
| `recarga.enabled` | `boolean`, señal o `() => boolean` | `true` | Desde `1.7`. Mientras vale `false` no hay petición, y la que estaba en curso se cancela. Un recurso con `await` no puede empezar desactivado. |

## Valor devuelto

Un `DataResource<T>`, donde `T` es la salida del procedimiento; con `await`, un `LoadedResource<T>` cuyo `data` nunca es `null`. Sus propiedades son las de [`useApi`](/docs/reference/use-api): `data`, `error`, `pending`, `refreshing` y `refresh()`.

## Ejemplos

### Búsqueda mientras se escribe (desde 1.7)

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

Cada cambio cancela la petición en curso; con menos de dos letras no se pide nada.

### Un resumen sin entrada

<!-- no-check -->
```ts
// En el <script> de app/components/Stats.meeko
const stats = await useRpcQuery("stats.summary"); // el schema acepta {}: envía {}
```

### Varios recursos en una zona

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

`<MeekoAwait>` pinta su contenido cuando los dos tienen datos, y dentro `meeko check` lee `data` como cargado.

### Campos reactivos en la entrada

En lugar de una función, cada campo de `input` puede ser una señal:

```html
<script lang="ts">
const page = signal(1);
const list = useRpcQuery("users.page", { page });
</script>

<template><button type="button" on:click="() => page.value++">Más</button></template>
```

## Errores comunes

### Un procedimiento que no existe

```ts bad
const activity = useRpcQuery("users.activiti", { id: "1", tab: "a" });
```

`meeko check` da `TS2345: Argument of type '"users.activiti"' is not assignable to parameter of type '"docs.search" | "users.activity" | "users.rename"'`, con la lista de procedimientos.

<!-- no-check -->
```ts good
const activity = useRpcQuery("users.activity", { id: "1", tab: "a" });
```

### Una entrada incompleta

```ts bad
const activity = useRpcQuery("users.activity", { id: "1" });
```

`meeko check` da `TS2345: Argument of type '{ id: string; }' is not assignable to parameter of type 'RpcQueryInput<{ id: string; tab: string; }>'`, con `Property 'tab' is missing`.

<!-- no-check -->
```ts good
const activity = useRpcQuery("users.activity", { id: "1", tab: "all" });
```

### Llamarlo dentro de un `effect`

```ts bad
effect(() => {
  useRpcQuery("users.activity", { id: "1", tab: tab.value });
});
```

`meeko check` da `MEEK054: useRpcQuery() debe llamarse en el nivel superior de <script>, no dentro de una función, un handler, un effect ni onMounted`. La recarga ya es reactiva: pasa una función que lee la señal.

<!-- no-check -->
```ts good
const activity = useRpcQuery("users.activity", () => ({ id: "1", tab: tab.value }));
```

### Una entrada que el navegador no puede repetir

```ts bad
const feed = await useRpcQuery("feed.latest", { since: Date.now() });
```

El servidor pide los datos con su `Date.now()` y el navegador, al hidratar, con otro: la clave no coincide y la hidratación falla con `MEEKO_RESOURCE_MISSING: useRpcQuery("feed.latest") (…) is not in the page payload; the server and the browser requested different data…`. Haz que la entrada dependa sólo de props, datos de la ruta o estado:

<!-- no-check -->
```ts good
const feed = await useRpcQuery("feed.latest", { since: props.data.since });
```

## Notas

- **SSR e hidratación.** Como `useApi`: con `await`, el servidor espera los datos (como mucho 10 pasadas) y los envía en `resources`; sin `await`, la petición nunca se hace en el servidor.
- **Clave de petición.** El procedimiento y la entrada en JSON estable forman la clave de la caché de la aplicación: un componente que se monta después con la misma entrada reutiliza los datos.
- **Sesión y seguridad.** La petición lleva la sesión del usuario; el procedimiento aplica sus guardas (`auth`, `authorize`). Valida en el servidor todo lo que llega en `input`.
- **Escrituras.** `useRpcQuery` es para leer: puede repetirse al navegar, al hidratar o al cambiar la entrada. Para cambiar datos, [`useRpcMutation`](/docs/reference/use-rpc-mutation).

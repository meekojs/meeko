---
title: useApi
group: composables
since: 1.1.0
description: Lee un endpoint GET de server/api desde un componente, con SSR, hidratación sin repetir la petición, recarga reactiva y tipos del contrato.
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
---

`useApi(ruta, opciones?, recarga?)` pide los datos de un endpoint `GET` de `server/api` y devuelve un recurso con `data`, `error`, `pending`, `refreshing` y `refresh`. La ruta se escribe como la describe `server/api`, con los segmentos dinámicos entre corchetes (`"/api/users/[id]"`), y TypeScript comprueba `params`, `query` y la forma de `data` contra el contrato del endpoint. Usa la misma sesión, CSRF y validación que `api.*`.

Con `await`, el componente no se renderiza hasta tener los datos, también en SSR, y la hidratación los lee del payload sin repetir la petición. Sin `await`, se renderiza enseguida con `data` en `null` y la petición empieza en el navegador al montar. Si las opciones leen señales, un cambio vuelve a pedir los datos. Lo generan los clientes de la aplicación y se autoimporta en los `.meeko`; sólo se llama en el nivel superior del `<script>`.

## Uso

```html
<!-- app/pages/users/[id].meeko -->
<script lang="ts">
const props = defineProps<{ params: { id: string }; search: Record<string, string | string[]> }>();
const user = await useApi("/api/users/[id]", { params: { id: props.params.id } });
</script>

<template><h1>{user.data.value.name}</h1></template>
```

Con `await`, `user.data.value` nunca es `null` en su tipo.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `ruta` | ruta de un endpoint `GET` | obligatorio | Como `"/api/users"` o `"/api/users/[id]"`. Sólo las rutas `GET` de la aplicación; el editor las completa. |
| `opciones` | `{ params?, query? }` o `() => { params?, query? }` | sin opciones si el contrato no exige nada | `params` es obligatorio en una ruta dinámica; `query`, si el contrato exige algún campo. Cada campo puede ser una señal, o todo una función que las lee: un cambio vuelve a pedir los datos. |
| `recarga.keepPrevious` | `boolean` | `true` | Desde `1.5`. Con `false`, un cambio de la entrada vacía `data` y vuelve a ser una primera carga. |
| `recarga.debounceMs` | `number` | `0` | Desde `1.7`. Milisegundos que la entrada debe quedarse quieta antes de pedir: una ráfaga de cambios hace una sola petición. No retrasa la primera carga, `refresh()` ni el SSR. |
| `recarga.enabled` | `boolean`, señal o `() => boolean` | `true` | Desde `1.7`. Mientras vale `false` no hay petición, tampoco con `refresh()`, y la que estaba en curso se cancela. |

## Valor devuelto

Un `DataResource<T>`, donde `T` es la respuesta del endpoint. Con `await`, un `LoadedResource<T>` cuyo `data` nunca es `null`.

| Propiedad | Tipo | Descripción |
| --- | --- | --- |
| `data` | `ReadonlySignal<T \| null>` | Datos de la última carga correcta, o `null` antes de la primera. Una recarga los conserva hasta que llegan los nuevos. |
| `error` | `ReadonlySignal<Error \| null>` | Fallo de la última carga, o `null`. Una respuesta de error del servidor es un `ClientError`. |
| `pending` | `ReadonlySignal<boolean>` | `true` mientras hay una carga en curso (o esperando `debounceMs`). |
| `refreshing` | `ReadonlySignal<boolean>` | Desde `1.5`. `true` durante una recarga con datos anteriores; la primera carga es `pending` sin `refreshing`. |
| `refresh()` | `Promise<void>` | Vuelve a pedir con la entrada actual; un fallo sólo actualiza `error`. |

## Ejemplos

### Sin `await`, con un indicador de carga

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

Para no saltar de altura al llegar los datos, envuelve la zona en [`<MeekoAwait for="users" reserve>`](/docs/reference/meekoawait).

### Una lista paginada que se recarga sola

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

Mientras llega la página siguiente, la lista anterior sigue en pantalla, atenuada.

### Búsqueda mientras se escribe (desde 1.7)

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

Una ráfaga de teclas hace una sola petición, con el último texto; con menos de dos letras no se pide nada y `pending` vale `false`.

### Recargar tras una mutación

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

### Otra ficha sin mostrar la anterior

```html
<script lang="ts">
const props = defineProps<{ params: { id: string }; search: Record<string, string | string[]> }>();
const user = useApi("/api/users/[id]", () => ({ params: { id: props.params.id } }), { keepPrevious: false });
</script>
```

Al navegar de `/users/1` a `/users/2`, `data` vuelve a `null` en lugar de mostrar la ficha del usuario 1 mientras llega la del 2.

## Errores comunes

### Llamarlo dentro de una función

```html bad
<script lang="ts">
function load() { return useApi("/api/users"); }
</script>
```

`meeko check` da `MEEK054: useApi() debe llamarse en el nivel superior de <script>, no dentro de una función, un handler, un effect ni onMounted`. Llámalo una vez en el nivel superior y usa `refresh()` o señales en las opciones para volver a pedir:

```html good
<script lang="ts">
const users = useApi("/api/users");
const reload = () => users.refresh();
</script>
```

### Una ruta que no existe, o sin sus `params`

```ts bad
const users = useApi("/api/user", {});
const user = useApi("/api/users/[id]");
```

`meeko check` da `TS2345: Argument of type '"/api/user"' is not assignable to parameter of type '"/api/users" | "/api/users/[id]"'` en la primera, con la lista de rutas `GET`, y `TS2554: Expected 2-3 arguments, but got 1` en la segunda, porque la ruta dinámica exige `params`. Una ruta inexistente sin opciones también da `TS2554`.

<!-- no-check -->
```ts good
const user = useApi("/api/users/[id]", { params: { id: props.params.id } });
```

### Recorrer `data` sin `await` ni comprobación

```html bad
<li each:of="users.data.value" each:as="user" each:key="user.id">{user.name}</li>
```

Sin `await`, `data` es `null` hasta que llegan los datos: `meeko check` da `TS2345: Argument of type 'User[] | null' is not assignable to parameter of type 'Iterable<User>'`. Espera los datos, comprueba la lista o envuélvela en `<MeekoAwait>`:

```html good
<li each:of="users.data.value ?? []" each:as="user" each:key="user.id">{user.name}</li>
```

### Leer `.value` en las opciones

```ts bad
const id = signal("1");
const user = useApi("/api/users/[id]", { params: { id: id.value } });
```

`meeko check` lo acepta, pero el valor se lee una vez: cambiar `id` no vuelve a pedir los datos. Pasa la señal, o una función que la lee:

<!-- no-check -->
```ts good
const user = useApi("/api/users/[id]", { params: { id } });
const same = useApi("/api/users/[id]", () => ({ params: { id: id.value } }));
```

### Un `await` dentro de una expresión

```ts bad
const count = (await useApi("/api/users")).data.value.length;
```

`meeko check` da `MEEK055: await useApi(...) debe ser una sentencia completa o el inicializador completo de una declaración, como const value = await useApi(...)`.

<!-- no-check -->
```ts good
const users = await useApi("/api/users");
const count = computed(() => users.data.value.length);
```

### Un recurso con `await` que empieza desactivado

```ts bad
const results = await useApi("/api/users", { query: { q } }, { enabled: false });
```

Lanza `useApi("/api/users") is disabled (enabled is false): an awaited resource needs its data. Leave out await, or enable it`, en el servidor y en el navegador. Quita el `await` para un recurso que puede empezar desactivado.

<!-- no-check -->
```ts good
const results = useApi("/api/users", { query: { q } }, { enabled: () => q.value.length >= 2 });
```

## Notas

- **SSR con `await`.** El servidor renderiza la página, espera las peticiones de cada `await` y vuelve a renderizar con los datos, hasta que ninguna pasada se suspende (como mucho 10). Las peticiones se despachan localmente por el mismo pipeline que `api.*`, con la sesión de la petición.
- **Hidratación.** Los datos viajan en el campo `resources` del payload, por clave de petición. La entrada de un `await useApi` debe depender sólo de props, datos de la ruta y estado: si el navegador pide una clave que el servidor no cargó, la hidratación falla con `MEEKO_RESOURCE_MISSING`.
- **Sin `await`.** La petición nunca se hace en el servidor: el HTML lleva `pending` en `true` y `data` en `null` (o `pending` en `false` si empieza desactivado). `meeko check` avisa con `MEEK117` de una página que pinta la lista sin ocuparse de la carga.
- **Navegación.** Antes de confirmar una navegación, el navegador carga los `await` de la página nueva en una pasada en seco, con `useNavigation().pending` en `true`. Un fallo de un `await` muestra la página de error, como un fallo del loader; un fallo de una recarga sólo actualiza `error`.
- **Componentes que se montan tarde.** Un componente que aparece después (un `if:when`, una fila nueva) y hace un `await` de datos que no están en caché deja su zona vacía mientras carga, sin error.
- **Cancelación.** Un cambio de la entrada cancela la petición en curso; el resultado de una petición cancelada se descarta.
- **`head`.** El `head` de la ruta se calcula con los datos del loader o de `<script server>`, no con los de `useApi`: si el `<title>` depende de un dato, cárgalo allí.

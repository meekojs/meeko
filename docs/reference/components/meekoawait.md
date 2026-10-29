---
title: <MeekoAwait>
group: components
since: 1.5.0
description: Zona de unos datos que llegan después del primer pintado, con sus estados de carga, error y recarga, y una reserva de altura que evita saltos.
symbols:
  - "syntax:meekoawait"
types:
  - "@meekojs/meeko/framework#MeekoAwaitProps"
  - "@meekojs/meeko/framework#MeekoAwaitSnippets"
  - "@meekojs/meeko/framework#AwaitResource"
related:
  - "autoimport:useApi"
  - "autoimport:useRpcQuery"
  - "@meekojs/meeko/framework#DataResource"
  - "@meekojs/meeko/framework#useNavigation"
  - docs/framework.md#meekoawait
  - docs/framework.md#evitar-saltos-de-altura-cls
  - docs/framework.md#datos-anteriores-durante-una-recarga-keepprevious
---

Un `useApi` o un `useRpcQuery` **sin** `await` deja que el componente se pinte enseguida y pide los datos en el navegador al montar. `<MeekoAwait for="recurso">` envuelve la zona de esos datos y se ocupa de sus estados: el snippet `pending` en la primera carga, el snippet `error` (con un botón para reintentar) si falla, y su contenido cuando hay datos. Una recarga conserva el contenido montado. Con `reserve`, mientras espera ocupa la altura que tuvo con datos la última vez, así que la página no salta.

No se importa: el compilador la reconoce, y un componente del proyecto con el mismo nombre tiene prioridad (`MEEK106`). Dentro de su contenido, `meeko check` y el editor leen `items.data.value` como cargado.

## Uso

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

`items.data.value` es `Item[]` dentro de la etiqueta, sin `!` ni `?.`.

## Props

| Atributo | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `for` o `bind:for` | `AwaitResource \| readonly AwaitResource[]` | obligatorio | El recurso, como expresión (igual que `each:of`): `for="items"` o una lista, `for="[items, stats]"`. Sin él es `MEEK116`. |
| `reserve` o `bind:reserve` | `boolean \| string` | sin reserva | `reserve` recuerda la altura que tuvo la zona con datos y la aplica mientras espera otra vez; `reserve="320px"` (cualquier longitud CSS) fija además un mínimo, también en la primera visita. |
| `bind:messages` | `{ error?: string; retry?: string }` | «No se pudieron cargar los datos.», «Reintentar» | Textos del aviso de error por defecto, sin snippet `error`. |
| `class`, `id` | `string` | ninguno | Del contenedor, un `<div>`. |

| Snippet | Parámetros | Cuándo se pinta |
| --- | --- | --- |
| `default` (el contenido) | `[refreshing: boolean]` | Cuando todos los recursos tienen datos; `refreshing` es `true` durante una recarga. |
| `pending` | ninguno | En la primera carga: un recurso sin datos que carga o aún no empezó. |
| `error` | `[error: Error, retry: () => void]` | Cuando un recurso sin datos falló. `retry` vuelve a pedir los que fallaron. Sin él, un `<p role="alert">` con un botón «Reintentar». |

## Resultado

Un `<div>` sin estilos que nunca cambia de elemento, con:

- `data-meeko-await="pending|error|ready"`;
- `aria-busy="true"` mientras carga o recarga;
- `data-meeko-refreshing` durante una recarga;
- con `reserve`, `data-meeko-reserve` y `data-meeko-reserve-min`.

Un fallo de un recurso gana a otro que todavía carga, para ofrecer `retry` cuanto antes. Si el foco estaba en un nodo que desaparece al cambiar de estado (el botón «Reintentar»), pasa al contenedor (`tabindex="-1"`, sin desplazar la página) en lugar de perderse.

## Ejemplos

### Varios recursos

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

### Un indicador discreto durante la recarga

El contenido recibe `refreshing`; los datos siguen en pantalla:

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

### Un esqueleto de la misma altura

`reserve` no puede adivinar la altura en la primera visita de la pestaña. Un esqueleto con las mismas filas, o un mínimo explícito, evita también ese salto:

```html
<MeekoAwait for="items" reserve="320px">
  <snippet name="pending"><ul class="skeleton"><li each:of="[1, 2, 3, 4]" each:as="row"></li></ul></snippet>
  <ul><li each:of="items.data.value" each:as="item" each:key="item.id">{item.name}</li></ul>
</MeekoAwait>
```

### Mensajes traducidos

```html
<MeekoAwait for="items" bind:messages="{ error: 'Could not load the items.', retry: 'Retry' }">
  <ItemsList bind:items="items.data.value" />
</MeekoAwait>
```

## Errores comunes

### Olvidar `for`

```html bad
<MeekoAwait><ItemsList bind:items="items.data.value" /></MeekoAwait>
```

`meeko check` da `MEEK116: <MeekoAwait> necesita for="recurso": el resultado de useApi o useRpcQuery sin await, o una lista, como for="[items, stats]"`.

```html good
<MeekoAwait for="items"><ItemsList bind:items="items.data.value" /></MeekoAwait>
```

### Pasar los datos en lugar del recurso

```html bad
<MeekoAwait for="items.data"><ItemsList bind:items="items.data.value" /></MeekoAwait>
```

`meeko check` da `TS2322: Type 'ReadonlySignal<Item[] | null>' is not assignable to type 'AwaitResource | readonly AwaitResource[]'`: la etiqueta necesita el recurso entero, con `data`, `error`, `pending` y `refresh`. En ejecución sería un `TypeError`.

```html good
<MeekoAwait for="items"><ItemsList bind:items="items.data.value" /></MeekoAwait>
```

### Leer los datos fuera de la etiqueta

Sólo el contenido de `<MeekoAwait>` lee `data` como cargado.

```html bad
<MeekoAwait for="items"><p>{items.data.value.length}</p></MeekoAwait>
<p>Total: {items.data.value.length}</p>
```

En el segundo `<p>`, `meeko check` da `TS18047: 'items.data.value' is possibly 'null'`. Mueve la lectura dentro, o compruébala:

```html good
<MeekoAwait for="items"><p>{items.data.value.length}</p><p>Total: {items.data.value.length}</p></MeekoAwait>
```

### Un `reserve` que no es una longitud

```html bad
<MeekoAwait for="items" reserve="mucho">…</MeekoAwait>
```

`meeko check` lo acepta, pero el render lanza `TypeError: <MeekoAwait>: reserve must be empty or a CSS length such as reserve="320px", not "mucho"`.

```html good
<MeekoAwait for="items" reserve="20rem">…</MeekoAwait>
```

## Notas

- **SSR.** Sin `await`, la petición no se hace en el servidor: el HTML lleva el snippet `pending` y `aria-busy`, y la hidratación no cambia nada hasta que llegan los datos. Si el recurso ya tiene datos en el servidor (un `await useApi`, que también vale en `for`), el HTML lleva el contenido.
- **`await` o `<MeekoAwait>`.** Para lo que se ve al cargar la página, `await useApi(...)` es mejor: el SSR pinta los datos y no hay nada que crezca. `<MeekoAwait>` es para datos secundarios, zonas fuera de pantalla o componentes que se montan más tarde.
- **Reserva y CSP.** La altura se aplica con una hoja de estilos construida, sin atributos `style`: funciona con una CSP estricta. En una carga completa la aplica un script de `<head>` antes del primer pintado; el mínimo de `reserve="320px"` va en un `<style>` con el nonce de la petición o, en un sitio estático, con su hash.
- **Memoria de la altura.** Se guarda en `sessionStorage` (`meeko:await`) por ruta, petición y orden de la zona, con las 100 más recientes. Si el navegador bloquea el almacenamiento, vive mientras la página está abierta.
- **Accesibilidad.** `aria-busy` avisa de la carga. El aviso de error por defecto lleva `role="alert"`; ponlo también en tu snippet `error`.
- **`MEEK117`.** `meeko check` avisa de una página o un layout que pinta en un `each:of` los datos de un `useApi` sin `await` sin ocuparse de su carga; envolver la lista en `<MeekoAwait>` lo resuelve.

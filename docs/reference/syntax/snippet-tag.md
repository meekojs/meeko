---
title: <snippet>
group: syntax
since: 1.1.0
description: Llena, desde el padre, un snippet con nombre que un componente hijo declara con defineSnippets, con sus parámetros tipados.
symbols:
  - "syntax:snippet-tag"
related:
  - "syntax:definesnippets"
  - "syntax:render-tag"
  - "syntax:component-tag"
  - "@meekojs/meeko#Snippet"
  - docs/api.md#snippets-con-definesnippets
---

`<snippet name="x">` va dentro de la etiqueta de un componente y llena su snippet `x`: un trozo de plantilla del padre que el hijo pinta donde quiere, con `<render>`, y al que puede pasar argumentos. Es el equivalente de los *slots* con nombre de Vue o de los *snippets* de Svelte.

El contenido suelto de la etiqueta (lo que no está en un `<snippet>`) llena el snippet `default`. El contenido pertenece al padre: lee sus señales y funciones y sigue siendo reactivo.

## Uso

```html
<!-- app/pages/settings.meeko -->
<script lang="ts">
const message = signal("¿Borrar la cuenta?");
</script>

<template>
  <AppDialog>
    <p>{message.value}</p>
    <snippet name="title">Confirmar</snippet>
    <snippet name="actions" params="close">
      <button type="button" on:click="close">Cancelar</button>
    </snippet>
  </AppDialog>
</template>
```

`<AppDialog>` declara `defineSnippets<{ default: []; title?: []; actions?: [close: () => void] }>()`: el párrafo llena `default`, `title` no recibe argumentos y `actions` recibe `close`, de tipo `() => void`.

## Atributos

| Atributo | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `name` | identificador | obligatorio | El snippet que llena, una clave del `defineSnippets` del hijo. |
| `params` | lista de identificadores | sin parámetros | Nombres de los argumentos, separados por comas, con los tipos de la tupla del hijo: `params="item, index"`. |
| `if:when` | expresión | siempre | Desde `1.4`. Pasa el snippet sólo mientras la expresión es verdadera; el hijo debe declararlo opcional. |

## Resultado

Un `Snippet<Args>` que el hijo recibe en `snippets.x` y pinta con `<render snippet="snippets.x" args="…" />`. El contenido se pinta dentro del DOM del hijo, entre comentarios de marca, pero se evalúa en el ámbito del padre: sus señales, sus funciones y los `params` que le pasa el hijo. Cuando cambian los argumentos, el contenido se actualiza sin volver a pintarse.

Con `if:when` falso, para el hijo el snippet no existe: `snippets.x` es `undefined`, su `if:when="snippets.x"` es falso y un `<render>` no pinta nada.

## Ejemplos

### Filas de una tabla genérica

Un componente genérico pasa cada fila al snippet; el padre recibe la fila con su tipo:

```html
<!-- app/components/DataTable.meeko -->
<script lang="ts" generic="T extends { id: string }">
const props = defineProps<{ rows: T[] }>();
const snippets = defineSnippets<{ row: [row: T, index: number]; empty?: [] }>();
</script>

<template>
  <ul if:when="props.rows.length">
    <li each:of="props.rows" each:as="row" each:key="row.id" each:index="i"><render snippet="snippets.row" args="row, i" /></li>
  </ul>
  <render if:when="!props.rows.length" snippet="snippets.empty" />
</template>
```

```html
<!-- app/pages/users.meeko -->
<script lang="ts">
const users = signal([{ id: "1", email: "ana@example.com" }]);
</script>

<template>
  <DataTable bind:rows="users.value">
    <snippet name="row" params="user, index">{index + 1}. {user.email}</snippet>
    <snippet name="empty">Todavía no hay usuarios.</snippet>
  </DataTable>
</template>
```

`user` es `{ id: string; email: string }`, inferido de `rows`.

### Reenviar un snippet opcional con `if:when`

Un componente que envuelve a otro le pasa sus snippets. Con `if:when`, la card sólo recibe `footer` si el panel recibió `actions`, y no pinta un pie vacío:

```html
<!-- app/components/AppPanel.meeko -->
<script lang="ts">
const snippets = defineSnippets<{ default: []; actions?: [close: () => void] }>();
const open = signal(true);
function close(): void {
  open.value = false;
}
</script>

<template>
  <AppCard if:when="open.value">
    <render snippet="snippets.default" />
    <snippet name="footer" if:when="snippets.actions"><render snippet="snippets.actions" args="close" /></snippet>
  </AppCard>
</template>
```

La condición se evalúa en el ámbito del padre, igual en el servidor y al hidratar, y es reactiva: cuando cambia, el hijo sigue montado y sólo cambia lo que lee `snippets.footer`. Estrecha los tipos dentro del snippet, así que `snippets.actions` no es `undefined` en su `<render>`.

### Un `default` con condición

El contenido suelto no admite condición. Para condicionarlo, escríbelo en `<snippet name="default">`, siempre que el hijo lo declare opcional:

```html
<!-- app/components/AppCard.meeko declara defineSnippets<{ default?: []; footer?: [] }>() -->
<AppCard>
  <snippet name="default" if:when="details.value"><p>{details.value}</p></snippet>
</AppCard>
```

## Errores comunes

### Un `<snippet>` fuera de una etiqueta de componente

```html bad
<div>
  <snippet name="title">Confirmar</snippet>
</div>
```

`MEEK061: <snippet> debe ser hijo directo de una etiqueta de componente, como <AppDialog><snippet name="title">...</snippet></AppDialog>`.

```html good
<AppDialog>
  <snippet name="title">Confirmar</snippet>
</AppDialog>
```

### Un snippet que el hijo no declara, o que falta

```html bad
<AppDialog>
  <snippet name="footer">Pie</snippet>
</AppDialog>
```

`meeko check` da `TS2741: Property 'default' is missing in type …` (el hijo exige `default`) y `TS2353: Object literal may only specify known properties, and '"footer"' does not exist in type 'SnippetMap<…>'.`

```html good
<AppDialog>
  <p>Texto</p>
  <snippet name="title">Confirmar</snippet>
</AppDialog>
```

### Parámetros que no coinciden con la tupla

```html bad
<snippet name="actions" params="close, extra"><button on:click="close">Cerrar</button></snippet>
```

`meeko check` da `TS2345` con `Target signature provides too few arguments. Expected 2 or more, but got 1.`

```html good
<snippet name="actions" params="close"><button on:click="close">Cerrar</button></snippet>
```

### `if:when` en un snippet obligatorio

```html bad
<AppDialog>
  <snippet name="default" if:when="show.value"><p>Hola</p></snippet>
</AppDialog>
```

`MEEK110: if:when en <snippet name="default"> deja de pasar el snippet cuando la condición es falsa, pero el hijo declara default como obligatorio. Decláralo opcional en el defineSnippets del hijo (default?: [...]) o quita if:when`.

```html good
<AppDialog>
  <p if:when="show.value">Hola</p>
</AppDialog>
```

### Contenido suelto junto a `<snippet name="default">`

```html bad
<AppDialog>
  <p>Hola</p>
  <snippet name="default"><p>Otra</p></snippet>
</AppDialog>
```

`MEEK061: El contenido fuera de <snippet> ya llena default; muévelo dentro de <snippet name="default"> o quita ese snippet`.

```html good
<AppDialog>
  <snippet name="default"><p>Hola</p><p>Otra</p></snippet>
</AppDialog>
```

## Notas

- **Ámbito.** El contenido ve el ámbito del padre, no el del hijo: para usar un valor del hijo, el hijo debe pasarlo en `args` y el padre nombrarlo en `params`.
- **SSR e hidratación.** El servidor pinta el snippet dentro del HTML del hijo, entre marcas `<!--meeko:snippet:N-->`, y el navegador lo hidrata en el mismo sitio. Se libera cuando se libera el padre o el hijo.
- **Reactividad.** Un cambio en las señales del padre o en los argumentos actualiza sólo los enlaces del snippet; no se reconstruye cuando cambian otras props del hijo.
- **Restricciones.** Un `<snippet>` admite sólo `name`, `params` e `if:when` (`MEEK061`), no puede repetirse y puede cerrarse solo (`<snippet name="x" />`, un snippet vacío). Una `ref:` dentro de su contenido da `MEEK052`, porque el hijo puede pintarlo varias veces.
- **`<component is>`.** Desde `1.5`, su contenido también son snippets del componente, como en su etiqueta.

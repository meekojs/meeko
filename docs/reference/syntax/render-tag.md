---
title: <render>
group: syntax
since: 1.1.0
description: Pinta, en un componente, un snippet que le pasa el padre, con los argumentos que el hijo le da.
symbols:
  - "syntax:render-tag"
related:
  - "syntax:definesnippets"
  - "syntax:snippet-tag"
  - "syntax:if-when"
  - "@meekojs/meeko#Snippet"
  - docs/api.md#snippets-con-definesnippets
---

`<render snippet="snippets.x" args="a, b" />` pinta en la plantilla de un componente el snippet `x` que le pasó el padre, con esos argumentos. Es la otra mitad de [`<snippet>`](/docs/reference/snippet-tag): el hijo decide dónde va el contenido y qué datos recibe, y el padre, qué se pinta.

Un `<render>` de un snippet opcional que el padre no pasó no pinta nada.

## Uso

```html
<!-- app/components/AppDialog.meeko -->
<script lang="ts">
const snippets = defineSnippets<{ default: []; title?: []; actions?: [close: () => void] }>();
const open = signal(true);
function close(): void {
  open.value = false;
}
</script>

<template>
  <section if:when="open.value" role="dialog" aria-modal="false">
    <h2 if:when="snippets.title"><render snippet="snippets.title" /></h2>
    <render snippet="snippets.default" />
    <footer if:when="snippets.actions"><render snippet="snippets.actions" args="close" /></footer>
  </section>
</template>
```

## Atributos

| Atributo | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `snippet` | `Snippet<Args> \| undefined` | obligatorio | El snippet que se pinta, normalmente una clave de `defineSnippets`: `snippets.title`. |
| `args` | lista de expresiones | sin argumentos | Los argumentos, separados por comas, con los tipos de la tupla del snippet: `args="row, i"`. |

`<render>` puede cerrarse solo y no admite contenido: no hay contenido «por defecto» dentro de la etiqueta. Para un texto alternativo, usa `if:when` con la condición contraria.

## Resultado

El contenido del snippet, entre los comentarios `<!--meeko:snippet:N-->` y `<!--/meeko:snippet:N-->`, dentro del DOM del hijo. Pertenece al ámbito reactivo del padre: lee sus señales y se actualiza cuando cambian, o cuando cambian los argumentos, sin volver a pintarse. Con un snippet ausente, sólo quedan las marcas.

## Ejemplos

### Un texto alternativo

Si el padre no pasa `title`, el hijo pinta el suyo:

```html
<!-- app/components/AppSection.meeko -->
<script lang="ts">
const props = defineProps<{ fallbackTitle: string }>();
const snippets = defineSnippets<{ default: []; title?: [] }>();
</script>

<template>
  <section>
    <h2 if:when="snippets.title"><render snippet="snippets.title" /></h2>
    <h2 if:when="!snippets.title">{props.fallbackTitle}</h2>
    <render snippet="snippets.default" />
  </section>
</template>
```

### Pasar datos y acciones al padre

Los argumentos pueden ser valores, señales o funciones del hijo. El padre los recibe con `params`:

```html
<!-- app/components/AppList.meeko -->
<script lang="ts" generic="T extends { id: string }">
const props = defineProps<{ items: T[] }>();
const emit = defineEmits<{ remove: [id: string] }>();
const snippets = defineSnippets<{ item: [item: T, remove: () => void] }>();
</script>

<template>
  <ul>
    <li each:of="props.items" each:as="item" each:key="item.id">
      <render snippet="snippets.item" args="item, () => emit('remove', item.id)" />
    </li>
  </ul>
</template>
```

```html
<AppList bind:items="notes.value" on:remove="(id) => removeNote(id)">
  <snippet name="item" params="note, remove">
    {note.title} <button type="button" on:click="remove">Borrar</button>
  </snippet>
</AppList>
```

### El mismo snippet varias veces

Un snippet puede pintarse en varios sitios; cada `<render>` es una copia independiente del contenido:

```html
<script lang="ts">
const snippets = defineSnippets<{ default: []; logo: [] }>();
</script>

<template>
  <header><render snippet="snippets.logo" /></header>
  <main><render snippet="snippets.default" /></main>
  <footer><render snippet="snippets.logo" /></footer>
</template>
```

Por eso una `ref:` dentro del contenido de un snippet no se admite (`MEEK052`).

## Errores comunes

### `<render>` sin `snippet`

```html bad
<render />
```

`MEEK062: <render> necesita snippet="expression", como <render snippet="snippets.title" />`.

```html good
<render snippet="snippets.title" />
```

### Contenido dentro de `<render>`

```html bad
<render snippet="snippets.title">Sin título</render>
```

`MEEK062: <render> no admite contenido; escribe <render snippet="..." />`.

```html good
<render snippet="snippets.title" />
<span if:when="!snippets.title">Sin título</span>
```

### `bind:args` u otros atributos

`args` ya es una lista de expresiones: no lleva `bind:`.

```html bad
<render snippet="snippets.row" bind:args="[row]" />
```

`MEEK062: <render> admite snippet y args; bind:args no se admite`.

```html good
<render snippet="snippets.row" args="row" />
```

### Argumentos que no coinciden con la tupla

```html bad
<render snippet="snippets.actions" />
<render snippet="snippets.row" args="1" />
```

Con `actions: [close: () => void]` y `row: [name: string]`, `meeko check` da `TS2345: Argument of type '[]' is not assignable to parameter of type '[close: () => void]'.` y `TS2322: Type 'number' is not assignable to type 'string'.`

```html good
<render snippet="snippets.actions" args="close" />
<render snippet="snippets.row" args="String(1)" />
```

### Un snippet que no está declarado

```html bad
<render snippet="snippets.rows" args="'a'" />
```

`meeko check` da `TS2551: Property 'rows' does not exist on type 'SnippetMap<{ row: [name: string]; }>'. Did you mean 'row'?`

```html good
<render snippet="snippets.row" args="'a'" />
```

## Notas

- **SSR e hidratación.** El servidor pinta el snippet en su sitio y el navegador lo hidrata con las mismas marcas. Los argumentos deben valer lo mismo en los dos lados.
- **Snippets opcionales.** `if:when="snippets.x"` en un elemento contenedor evita pintar un contenedor vacío cuando el padre no pasa el snippet.
- **Reactividad.** Cambiar los argumentos no vuelve a crear el contenido: el padre ve los valores nuevos en sus `params`. Para un argumento que cambia, pasa una señal o un valor derivado del estado del hijo.
- **Tipos.** `meeko check` y el editor comprueban `args` contra la tupla del snippet; en el padre, los `params` reciben esos tipos.

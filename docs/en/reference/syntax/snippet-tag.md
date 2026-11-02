---
title: <snippet>
group: syntax
since: 1.1.0
description: Fills a named snippet declared by a child component with defineSnippets from the parent, with typed parameters.
symbols:
  - "syntax:snippet-tag"
related:
  - "syntax:definesnippets"
  - "syntax:render-tag"
  - "syntax:component-tag"
  - "@meekojs/meeko#Snippet"
  - docs/api.md#snippets-con-definesnippets
source-hash: 2d8a9576c66b56377de16dc42ce52eb3ffd4cdff6b3936eb747d37343b4f4fc8
---

`<snippet name="x">` goes inside a component tag and fills its `x` snippet: a piece of the parent's template the child renders wherever it chooses with `<render>`, optionally passing arguments. It is equivalent to Vue's named _slots_ or Svelte's _snippets_.

Loose tag content (anything outside `<snippet>`) fills the `default` snippet. Content belongs to the parent: it reads its signals and functions and remains reactive.

You can also provide table rows and cells to a custom component, for example `<AppTable><tr><td>Ana</td></tr></AppTable>`. The compiler preserves those tags in snippets and lets the child render them with `<render>` inside `<thead>`, `<tbody>` or `<tfoot>`. Resulting HTML must respect table structure: sections receive rows and rows receive cells.

## Usage

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

`<AppDialog>` declares `defineSnippets<{ default: []; title?: []; actions?: [close: () => void] }>()`: the paragraph fills `default`, `title` takes no arguments and `actions` receives `close`, of type `() => void`.

## Attributes

| Attribute | Type                              | Default       | Description                                                                                                                                                                                                          |
| --------- | --------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`    | identifier or hyphenated segments | required      | The snippet to fill, a key of the child's `defineSnippets`. Since `1.8`, accepts hyphen-joined segments (`cell-email`, `header-created-at`), without trailing or double hyphens: `/^[A-Za-z_$][\w$]*(?:-[\w$]+)*$/`. |
| `params`  | identifier list                   | no parameters | Comma-separated argument names, with types from the child's tuple: `params="item, index"`.                                                                                                                           |
| `if:when` | expression                        | always        | Since `1.4`. Passes the snippet only while the expression is truthy; the child must declare it optional.                                                                                                             |

## Result

A `Snippet<Args>` received by the child in `snippets.x` and rendered with `<render snippet="snippets.x" args="…" />`. Content renders in the child's DOM, between marker comments, but is evaluated in the parent's scope: its signals, functions and the `params` passed by the child. When arguments change, content updates without rendering again.

With a falsy `if:when`, the snippet does not exist for the child: `snippets.x` is `undefined`, its `if:when="snippets.x"` is falsy and a `<render>` renders nothing.

## Examples

### Generic table rows

A generic component passes each row to the snippet; the parent receives the typed row:

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

`user` is `{ id: string; email: string }`, inferred from `rows`.

### One cell per column (`cell-<clave>`)

Since `1.8`, a generic child can declare snippets whose names come from row keys (see [`defineSnippets`](/en/docs/reference/definesnippets)). `UITable` declares `cell-<clave>` and `header-<clave>`:

```html
<UITable bind:rows="users.value" bind:columns="columns" rowKey="id">
  <snippet name="cell-email" params="row, value"><a bind:href="'mailto:' + value">{value}</a></snippet>
  <snippet name="header-status">Estado</snippet>
</UITable>
```

`value` has the column type (`string` for `email`). A key absent from the row, such as `name="cell-nope"`, produces `TS2353` in `meeko check` and the editor, which also completes possible names.

### Forward an optional snippet with `if:when`

A wrapper component passes its snippets to its child. With `if:when`, the card receives `footer` only if the panel received `actions`, avoiding an empty footer:

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

The condition is evaluated in the parent's scope, identically on server and hydration, and is reactive: when it changes, the child remains mounted and only what reads `snippets.footer` changes. It narrows types inside the snippet, so `snippets.actions` is not `undefined` in its `<render>`.

### A conditional `default`

Loose content cannot have a condition. To make it conditional, write it in `<snippet name="default">`, provided the child declares it optional:

```html
<!-- app/components/AppCard.meeko declara defineSnippets<{ default?: []; footer?: [] }>() -->
<AppCard>
  <snippet name="default" if:when="details.value"><p>{details.value}</p></snippet>
</AppCard>
```

## Common mistakes

### A `<snippet>` outside a component tag

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

### A name that is neither an identifier nor hyphenated segments

```html bad
<UITable bind:rows="users.value" bind:columns="columns" rowKey="id">
  <snippet name="cell-">…</snippet>
</UITable>
```

`MEEK061: <snippet> necesita name con el nombre del snippet del hijo que llena: un identificador o segmentos unidos por guiones, como name="title" o name="cell-email"`.

```html good
<UITable bind:rows="users.value" bind:columns="columns" rowKey="id">
  <snippet name="cell-email" params="row, value">{value}</snippet>
</UITable>
```

### A snippet not declared by the child, or a missing snippet

```html bad
<AppDialog>
  <snippet name="footer">Pie</snippet>
</AppDialog>
```

`meeko check` reports `TS2741: Property 'default' is missing in type …` (the child requires `default`) and `TS2353: Object literal may only specify known properties, and '"footer"' does not exist in type 'SnippetMap<…>'.`

```html good
<AppDialog>
  <p>Texto</p>
  <snippet name="title">Confirmar</snippet>
</AppDialog>
```

### Parameters that do not match the tuple

```html bad
<snippet name="actions" params="close, extra"><button on:click="close">Cerrar</button></snippet>
```

`meeko check` reports `TS2345` with `Target signature provides too few arguments. Expected 2 or more, but got 1.`

```html good
<snippet name="actions" params="close"><button on:click="close">Cerrar</button></snippet>
```

### `if:when` on a required snippet

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

### Loose content alongside `<snippet name="default">`

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

## Notes

- **Scope.** Content sees the parent's scope, not the child's: to use a child value, the child must pass it in `args` and the parent name it in `params`.
- **SSR and hydration.** The server renders the snippet inside the child's HTML, between `<!--meeko:snippet:N-->` markers, and the browser hydrates it in the same place. It is disposed of when either parent or child is disposed of.
- **Reactivity.** A change in parent signals or arguments updates only snippet bindings; it is not rebuilt when other child props change.
- **Whitespace.** Since `1.8`, text at the edges of a `<snippet>` that has only spaces and at least one line break is not rendered: it is file formatting, and the snippet may end up inside a sentence. A space on the same line (`<snippet name="a"> <b>x</b> </snippet>`) is content.
- **Restrictions.** A `<snippet>` only accepts `name`, `params` and `if:when` (`MEEK061`), cannot be repeated and can be self-closing (`<snippet name="x" />`, an empty snippet). A `ref:` in its content produces `MEEK052`, because the child can render it multiple times.
- **`<component is>`.** Since `1.5`, its content also forms component snippets, as with its tag.

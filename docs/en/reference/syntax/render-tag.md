---
title: <render>
group: syntax
since: 1.1.0
description: Renders a snippet passed by the parent inside a component, with the arguments supplied by the child.
symbols:
  - "syntax:render-tag"
related:
  - "syntax:definesnippets"
  - "syntax:snippet-tag"
  - "syntax:if-when"
  - "@meekojs/meeko#Snippet"
  - docs/api.md#snippets-con-definesnippets
source-hash: a767e5c7bbf3aa5907184bf48e05b7c3326be3ce907f29ce8f15ba510732fcd4
---

`<render snippet="snippets.x" args="a, b" />` renders snippet `x`, passed by the parent, in a component's template with those arguments. It is the other half of [`<snippet>`](/en/docs/reference/snippet-tag): the child decides where content goes and which data it receives, and the parent decides what renders.

A `<render>` for an optional snippet not passed by the parent renders nothing.

## Usage

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

## Attributes

| Attribute | Type                         | Default      | Description                                                                 |
| --------- | ---------------------------- | ------------ | --------------------------------------------------------------------------- |
| `snippet` | `Snippet<Args> \| undefined` | required     | The snippet to render, normally a `defineSnippets` key: `snippets.title`.   |
| `args`    | expression list              | no arguments | Comma-separated arguments, with the snippet tuple's types: `args="row, i"`. |

`<render>` can be self-closing and does not accept content: there is no “default” content inside the tag. For fallback text, use `if:when` with the opposite condition.

## Result

The snippet content, between the `<!--meeko:snippet:N-->` and `<!--/meeko:snippet:N-->` comments, inside the child's DOM. It belongs to the parent's reactive scope: it reads its signals and updates when they or the arguments change, without rendering again. With a missing snippet, only the markers remain.

## Examples

### Fallback text

If the parent does not pass `title`, the child renders its own:

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

### Pass data and actions to the parent

Arguments can be values, signals or functions from the child. The parent receives them through `params`:

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

### The same snippet multiple times

You can render a snippet in multiple places; each `<render>` is an independent copy of the content:

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

This is why a `ref:` inside snippet content is not allowed (`MEEK052`).

## Common mistakes

### `<render>` without `snippet`

```html bad
<render />
```

`MEEK062: <render> necesita snippet="expression", como <render snippet="snippets.title" />`.

```html good
<render snippet="snippets.title" />
```

### Content inside `<render>`

```html bad
<render snippet="snippets.title">Sin título</render>
```

`MEEK062: <render> no admite contenido; escribe <render snippet="..." />`.

```html good
<render snippet="snippets.title" />
<span if:when="!snippets.title">Sin título</span>
```

### `bind:args` or other attributes

`args` is already an expression list: it does not take `bind:`.

```html bad
<render snippet="snippets.row" bind:args="[row]" />
```

`MEEK062: <render> admite snippet y args; bind:args no se admite`.

```html good
<render snippet="snippets.row" args="row" />
```

### Arguments that do not match the tuple

```html bad
<render snippet="snippets.actions" />
<render snippet="snippets.row" args="1" />
```

With `actions: [close: () => void]` and `row: [name: string]`, `meeko check` reports `TS2345: Argument of type '[]' is not assignable to parameter of type '[close: () => void]'.` and `TS2322: Type 'number' is not assignable to type 'string'.`

```html good
<render snippet="snippets.actions" args="close" />
<render snippet="snippets.row" args="String(1)" />
```

### An undeclared snippet

```html bad
<render snippet="snippets.rows" args="'a'" />
```

`meeko check` reports `TS2551: Property 'rows' does not exist on type 'SnippetMap<{ row: [name: string]; }>'. Did you mean 'row'?`

```html good
<render snippet="snippets.row" args="'a'" />
```

## Notes

- **SSR and hydration.** The server renders the snippet in place and the browser hydrates it with the same markers. Arguments must have the same values on both sides.
- **Optional snippets.** `if:when="snippets.x"` on a wrapper element avoids rendering an empty wrapper when the parent does not pass the snippet.
- **Reactivity.** Changing arguments does not recreate the content: the parent sees new values in its `params`. For a changing argument, pass a signal or a value derived from the child's state.
- **Types.** `meeko check` and the editor check `args` against the snippet tuple; in the parent, `params` receives those types.

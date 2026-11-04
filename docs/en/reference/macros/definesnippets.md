---
title: defineSnippets
group: macros
since: 1.1.0
description: Declares a component's snippets, template content written by the parent between its tags, with typed parameters.
symbols:
  - "syntax:definesnippets"
related:
  - "syntax:snippet-tag"
  - "syntax:render-tag"
  - "syntax:defineprops"
  - "syntax:generic"
  - "@meekojs/meeko#Snippet"
  - docs/api.md#snippets-con-definesnippets
  - docs/framework.md#tipos-de-cada-componente
source-hash: 701c0a0e017b9e270fa5b6778e1e6eed01b4ce95689922a8ee69b8a63a658f47
---

`defineSnippets<T>()` declares the component's snippets: pieces of template the parent writes between child tags and the child renders wherever it chooses with `<render>`. Each key of `T` is a snippet and its value is the parameter tuple passed by the child; `?` makes it optional. It is a compile-time macro: you do not import it.

Loose content between tags is the `default` snippet; write others with [`<snippet name="…">`](/en/docs/reference/snippet-tag).

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
  <section if:when="open.value">
    <h2 if:when="snippets.title"><render snippet="snippets.title" /></h2>
    <render snippet="snippets.default" />
    <footer if:when="snippets.actions"><render snippet="snippets.actions" args="close" /></footer>
  </section>
</template>
```

```html
<AppDialog>
  <p>Delete the note?</p>
  <snippet name="title">Confirm</snippet>
  <snippet name="actions" params="close"><button type="button" on:click="close">Cancel</button></snippet>
</AppDialog>
```

## Parameters

| Parameter           | Type                                         | Default  | Description                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | -------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `T` (type argument) | `{ [nombre]: [...params] \| Snippet<Args> }` | required | Each key is a snippet and its value the parameter tuple (`[]` without parameters). Since `1.4`, the value can also be `Snippet<Args>`, treated as `Args`. Since `1.8`, keys can come from a mapped type over a generic (`` `cell-${K}` ``). An optional key (`title?:`) makes the snippet optional. Omitting the type argument produces `MEEK060`. |

Does not accept runtime arguments (`MEEK060`).

## Return value

An object with a `Snippet<Args>` per key (`undefined` if the parent omits an optional one). Used in the template:

- `<render snippet="snippets.x" args="a, b" />` renders the snippet with those arguments;
- `if:when="snippets.x"` checks whether the parent passed it.

Snippets are not props: they do not appear in `ComponentProps`. The compiled module exports their type as `ComponentSnippets`, and each auto-imported component also has `<Nombre>Snippets` (`AppDialogSnippets`).

## Examples

### A list with row and empty state

```html
<!-- app/components/AppList.meeko -->
<script lang="ts" generic="T extends { id: string }">
const props = defineProps<{ items: T[] }>();
const snippets = defineSnippets<{ item: [item: T, index: number]; empty?: [] }>();
</script>

<template>
  <ul if:when="props.items.length">
    <li each:of="props.items" each:as="item" each:key="item.id" each:index="i"><render snippet="snippets.item" args="item, i" /></li>
  </ul>
  <div if:when="!props.items.length"><render snippet="snippets.empty" /></div>
</template>
```

```html
<AppList bind:items="notes.value">
  <snippet name="item" params="note, index">{index + 1}. {note.title}</snippet>
  <snippet name="empty">No notes yet.</snippet>
</AppList>
```

### Reuse another component's snippets

Since `1.4`, `T` can start from another component's snippet type and narrow or extend it. A modal wrapping a card declares the card's snippets except `footer`, adds `actions` and forwards them:

```html
<!-- app/components/AppModal.meeko -->
<script lang="ts">
const open = defineModel<boolean>();
const snippets = defineSnippets<Omit<AppCardSnippets, "footer"> & { actions?: [close: () => void] }>();
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

`AppCardSnippets` is auto-imported with the tag name. Each snippet retains its parameters and `?`.

### Per-column snippets with names from a generic

Since `1.8`, `T` keys can come from a type parameter using a mapped type and template literal. A generic grid declares `cell-<clave>`, with the column's value type, `header-<clave>` and a fallback `cell`:

```html
<!-- app/components/AppGrid.meeko -->
<script lang="ts" generic="Row extends object">
import type { Snippet } from "@meekojs/meeko";
type Column<R extends object> = { key: Extract<keyof R, string>; label: string };
const props = defineProps<{ rows: readonly Row[]; columns: readonly Column<Row>[] }>();
const snippets = defineSnippets<
  { [K in Extract<keyof Row, string> as `cell-${K}`]?: [row: Row, value: Row[K]] } &
  { [K in Extract<keyof Row, string> as `header-${K}`]?: [column: Column<Row>] } &
  { cell?: [row: Row, column: Column<Row>, value: unknown] }
>();
// For Row, TypeScript cannot read a computed name: the child reads it through a view.
const byName = snippets as { readonly [name: string]: Snippet<never> | undefined };
function cellOf(column: Column<Row>): Snippet<[row: Row, value: unknown]> | undefined {
  return byName[`cell-${column.key}`] as Snippet<[row: Row, value: unknown]> | undefined;
}
</script>

<template>
  <p each:of="props.rows" each:as="row">
    <span each:of="props.columns" each:as="column">
      <render if:when="cellOf(column)" snippet="cellOf(column)" args="row, row[column.key]" />
      <render if:when="!cellOf(column)" snippet="snippets.cell" args="row, column, row[column.key]" />
    </span>
  </p>
</template>
```

```html
<AppGrid bind:rows="users.value" bind:columns="columns">
  <snippet name="cell-email" params="row, value"><a bind:href="'mailto:' + value">{value}</a></snippet>
  <snippet name="header-email">Email</snippet>
</AppGrid>
```

`value` is `string`, the type of `User["email"]`; `name="cell-nope"` produces `TS2353` and excess `params` produce `TS2345`. The editor completes possible names and shows signatures. Inside the child, `snippets.cell` retains its tuple (the compiler reads the intersection member by member), but a computed name needs the cast view.

### A snippet with multiple actions

Parameters can be child functions, used by the parent without knowing its state:

```html
<!-- app/components/AppStepper.meeko -->
<script lang="ts">
const props = defineProps<{ steps: number }>();
const snippets = defineSnippets<{ step: [index: number, next: () => void, back: () => void] }>();
const current = signal(0);
const next = (): void => { current.value = Math.min(current.value + 1, props.steps - 1); };
const back = (): void => { current.value = Math.max(current.value - 1, 0); };
</script>

<template><render snippet="snippets.step" args="current.value, next, back" /></template>
```

## Common mistakes

### Runtime arguments, or no type argument

```html bad
<script lang="ts">
const snippets = defineSnippets<{ default: [] }>({ default: [] });
</script>
```

`MEEK060: defineSnippets no admite argumentos en tiempo de ejecución; declara los snippets en su argumento de tipo`. Without a type argument: `MEEK060: defineSnippets necesita un argumento de tipo, como defineSnippets<{ default: [] }>()`.

```html good
<script lang="ts">
const snippets = defineSnippets<{ default: [] }>();
</script>
```

### Render a snippet without its arguments

```html bad
<render snippet="snippets.actions" />
```

With `actions: [close: () => void]`, `meeko check` reports `TS2345: Argument of type '[]' is not assignable to parameter of type '[close: () => void]'.`

```html good
<render snippet="snippets.actions" args="close" />
```

### Omit a required snippet or pass a nonexistent one

```html bad
<AppDialog>
  <snippet name="footer">Footer</snippet>
</AppDialog>
```

`meeko check` reports `TS2741: Property 'default' is missing in type …` and `TS2353: Object literal may only specify known properties, and '"footer"' does not exist in type 'SnippetMap<{ default: []; title?: []; actions?: [close: () => void]; }>'.`

```html good
<AppDialog>
  <p>Text</p>
  <snippet name="title">Footer</snippet>
</AppDialog>
```

### Content for a component without snippets

A component without `defineSnippets` does not accept content.

```html bad
<!-- app/components/AppBox.meeko, without defineSnippets -->
<AppBox><p>Hello</p></AppBox>
```

`meeko check` reports `TS2322: Type 'Snippet<any[]>' is not assignable to type '"this component declares no defineSnippets, so it accepts no children or <snippet>"'.` Declare `default` in the child:

```html good
<!-- app/components/AppBox.meeko -->
<script lang="ts">
const snippets = defineSnippets<{ default: [] }>();
</script>

<template><div class="box"><render snippet="snippets.default" /></div></template>
```

## Notes

- **Scope.** Snippet content belongs to the parent: it reads its signals and functions, remains reactive and is disposed of with parent or child. Anything the child wants to provide goes in arguments.
- **SSR and hydration.** The snippet renders inside the child's DOM between marker comments, identically on server and browser.
- **Setup copies.** As with props, `const hasFooter = Boolean(snippets.footer)` retains the initial value: read it in the template or a `computed`, because the parent can start or stop passing it with `<snippet if:when>`.
- **Location.** Once, in its own top-level `const` declaration with a simple name (`MEEK059`), before the first browser `await` (`MEEK058`).
- **Types.** A value that is neither a tuple nor a `Snippet` produces `TS2344`. Named tuples (`[close: () => void]`) name parameters in the editor.
- **Names.** A key is an identifier or, since `1.8`, hyphen-joined segments (`cell-email`); the child reads it as `snippets['cell-email']`.

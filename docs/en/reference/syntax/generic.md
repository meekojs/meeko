---
title: generic
group: syntax
since: 1.1.0
description: Declares component type parameters in its script, inferred by the parent from props and used to type events, models, snippets and refs.
symbols:
  - "syntax:generic"
related:
  - "syntax:defineprops"
  - "syntax:defineemits"
  - "syntax:definesnippets"
  - "syntax:definemodel"
  - "syntax:defineexpose"
  - docs/api.md#componentes-genéricos-generic
source-hash: 0e072f59abdf1acaaea4b6c65d7610f72c5465eb952d5cb8d6c01a189d091bf3
---

The `generic` attribute on `<script lang="ts">` declares component type parameters, like a generic TypeScript function. Its value is a parameter list with constraints (`extends`), defaults and parameters depending on others: `generic="T extends object, K extends keyof T"`.

The parent does not write type arguments: each tag infers them from its props and, using that type, checks its events, models, snippets and `ref:`. A table, list or select can then handle any row without losing types.

## Usage

```html
<!-- app/components/DataTable.meeko -->
<script lang="ts" generic="T extends { id: string }">
const props = defineProps<{ rows: T[] }>();
const emit = defineEmits<{ select: [row: T] }>();
const snippets = defineSnippets<{ row: [row: T] }>();
</script>

<template>
  <ul>
    <li each:of="props.rows" each:as="row" each:key="row.id" on:click="() => emit('select', row)">
      <render snippet="snippets.row" args="row" />
    </li>
  </ul>
</template>
```

```html
<!-- app/pages/users.meeko -->
<script lang="ts">
interface User { id: string; email: string }
const users = signal<User[]>([{ id: "1", email: "ana@example.com" }]);
function open(email: string): void {
  console.log(email);
}
</script>

<template>
  <DataTable bind:rows="users.value" on:select="(user) => open(user.email)">
    <snippet name="row" params="user"><span>{user.email}</span></snippet>
  </DataTable>
</template>
```

With `rows: User[]`, `T` is `User`: the `on:select` handler and the snippet's `user` parameter are `User`.

## Attributes

| Attribute | Type                | Default | Description                                                                                                                                                    |
| --------- | ------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generic` | type parameter list | none    | The component's parameters, with TypeScript syntax between `<` and `>`: `T`, `T extends X`, `T = X`, `K extends keyof T`. No `const`, `in` or `out` modifiers. |

## Result

- **In the script.** Parameters exist throughout `<script>`: in type arguments for `defineProps`, `defineEmits`, `defineModel` and `defineSnippets`, in the `defineExpose` value and in variable and function annotations.
- **In the parent.** Each tag infers parameters once, from its props (including `on:` handlers with annotated parameters), and checks the rest with them.
- **In the compiled module.** `ComponentProps<T>`, `ComponentModels<T>`, `ComponentSnippets<T>` and `ComponentExposed<T>` carry the same parameters, and `renderWithState`, `renderToString`, `hydrate` and `hydrateScope` are generic. `.d.meeko.ts` declarations from `meeko types` preserve them.
- **At runtime.** Nothing: types disappear during compilation.

## Examples

### A key chosen by the parent

A parameter can depend on another. Here `K` is a key of `T` and the parent chooses it through a static prop:

```html
<!-- app/components/AppPicker.meeko -->
<script lang="ts" generic="T extends Record<string, unknown>, K extends keyof T & string">
const props = defineProps<{ items: T[]; labelKey: K }>();
const selected = defineModel<T | null>({ default: null });
</script>

<template>
  <ul role="listbox" aria-label="Opciones">
    <li each:of="props.items" each:as="item" role="option" on:click="() => selected.value = item">{String(item[props.labelKey])}</li>
  </ul>
</template>
```

```html
<AppPicker bind:items="countries.value" labelKey="name" model="country" />
```

With `countries` of type `{ code: string; name: string }[]`, `labelKey="nombre"` is a type error, and `country` must be a `Signal<{ code: string; name: string } | null>`.

### A generic helper type

The script's `interface` and `type` declarations are declared at module level, where `T` does not exist. Make them generic and pass the parameter:

```html
<script lang="ts" generic="T">
type Rows<U> = readonly U[];
const props = defineProps<{ rows: Rows<T>; empty?: string }>({ empty: "Sin datos" });
</script>

<template>
  <p if:when="props.rows.length === 0">{props.empty}</p>
</template>
```

### Expose values with the parent's type

`defineExpose` also uses `T`, and the parent's `ref:` receives the value with the inferred `T`:

```html
<!-- app/components/AppList.meeko -->
<script lang="ts" generic="T extends { id: string }">
const props = defineProps<{ items: T[] }>();
defineExpose({ first: (): T | undefined => props.items[0] });
</script>

<template><ul><li each:of="props.items" each:as="item" each:key="item.id">{item.id}</li></ul></template>
```

```html
<script lang="ts">
const notes = signal([{ id: "n1", title: "Hola" }]);
const list = useElementRef("list");
function firstTitle(): string | undefined {
  return list.value?.first()?.title;
}
</script>

<template><AppList ref:list bind:items="notes.value" /></template>
```

## Common mistakes

### An `interface` using the parameter

```html bad
<script lang="ts" generic="T extends { id: string }">
interface Props { rows: T[] }
const props = defineProps<Props>();
</script>
```

`MEEK100: Esta declaración de tipo usa T, un parámetro de generic, pero los tipos del script se declaran a nivel de módulo, donde T no existe; escríbela en el argumento de la macro (defineProps<{ rows: T[] }>()) o hazla genérica (type Rows<T> = ...) y pásale T`.

```html good
<script lang="ts" generic="T extends { id: string }">
const props = defineProps<{ rows: T[] }>();
</script>
```

### A `const`, `in` or `out` modifier

```html bad
<script lang="ts" generic="const T">
```

`MEEK100: generic no admite el modificador const; escribe sólo el nombre, la restricción y el valor por defecto`. An empty `generic=""` reports `MEEK100: generic necesita al menos un parámetro de tipo, como generic="T" o generic="T extends { id: string }"`.

```html good
<script lang="ts" generic="T">
```

### A generic page or layout

Meeko passes its props to pages, layouts, `app/app.meeko` and error pages: it cannot choose their type parameters.

```html bad
<!-- app/pages/list.meeko -->
<script lang="ts" generic="T">
const props = defineProps<{ rows: T[] }>();
</script>
```

The project's `meeko check` reports `MEEK100: Las páginas, los layouts, app.meeko y las páginas de error no pueden ser genéricos: Meeko les pasa sus props y no puede elegir sus parámetros de tipo; quita generic o lleva el contenido genérico a un componente de app/components`. A `<script server>` cannot have `generic` either.

```html good
<!-- app/pages/list.meeko -->
<script lang="ts">
const rows = signal([{ id: "a1" }, { id: "b2" }]);
</script>

<template><DataTable bind:rows="rows.value"><snippet name="row" params="row">{row.id}</snippet></DataTable></template>
```

### Props that fail the constraint

```html bad
<DataTable bind:rows="plain.value">
  <snippet name="row" params="row"><span>{row.email}</span></snippet>
</DataTable>
```

With `plain` of type `Signal<{ email: string }[]>`, `meeko check` reports `TS2322: Type '{ email: string; }[]' is not assignable to type '{ id: string; }[]'.` on `bind:rows`, and the snippet is checked against the constraint: `TS2339: Property 'email' does not exist on type '{ id: string; }'.`

```html good
<DataTable bind:rows="users.value">
  <snippet name="row" params="row"><span>{row.email}</span></snippet>
</DataTable>
```

## Notes

- **Inference.** `T` is only inferred from props. Models, snippets and refs are checked with the `T` supplied by props; if no prop determines it, TypeScript uses the constraint (or `unknown`).
- **Lists.** A `ref:` on a generic tag inside `each:of` types each row's exposed value with the constraint of `T`, rather than the inferred `T`.
- **Literals.** A static prop preserves its literal: with `generic="T extends string"`, `<Chip value="draft" />` infers `T = "draft"`.
- **`<component is>`.** Since `1.5`, it supports content as snippets, so a generic component with required snippets can be used through `<component is>` just like its tag.
- **Editor.** Hovering over the tag shows resolved parameters (`T = User`) and the grammar highlights the `generic` value as TypeScript.
- **Cost.** Parameters exist only during type checking: they add no bundle code and do not change SSR or hydration.

---
title: <component is>
group: components
since: 1.0.0
description: Renders a component chosen by an expression, or since 1.5 an HTML tag, with type-checked props, events and snippets.
symbols:
  - "syntax:component-tag"
types:
  - "@meekojs/meeko#Component"
related:
  - docs/como-elegir.md
  - "syntax:meekooutlet"
  - "syntax:defineprops"
  - "syntax:snippet-tag"
  - "syntax:bind"
  - "syntax:on"
  - docs/api.md#etiquetas-de-componente-appbutton-
  - docs/api.md#etiquetas-html-en-component-is
  - docs/api.md#nombres-de-componente-en-is
  - docs/api.md#atributos-en-bloque-con-bind
  - docs/api.md#props-estáticas
source-hash: 0f20da1eb33a2f71ce68d11900a76846d876b7ece91591c72eef6a853783d715
---

`<component is="expresión">` renders the component returned by the expression: a prop receiving a component, one from a view table, one chosen by a condition. Each `bind:` passes a typed prop, each `on:` an event from its `defineEmits`, and `meeko check` checks required props, names and types. If `is` changes, Meeko disposes of the previous instance and renders and hydrates the new one in the same place.

For a fixed component, its named tag is shorter: `<AppButton bind:label="'Guardar'" />` is equivalent to `<component is="AppButton" bind:label="'Guardar'"></component>`. Since `1.5`, `is` also accepts an **HTML tag** (`is="props.href ? 'a' : 'button'"`), with its attributes, events and content. Since `1.8`, a PascalCase literal names a component known at compile time, including `<MeekoLink>`: `is="to ? 'MeekoLink' : 'button'"`.

## Usage

```html
<!-- app/components/Card.meeko -->
<script lang="ts">
import type { Component } from "@meekojs/meeko";
const props = defineProps<{ content: Component<{ label: string }>; label: string }>();
</script>

<template>
  <section class="card">
    <component is="props.content" bind:label="props.label"></component>
  </section>
</template>
```

`Component<{ label: string }>` requires the received component to accept `label`: the parent cannot pass one needing another prop.

## Attributes

| Attribute               | Type                                               | Description                                                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `is`                    | `Component<Props>`, an HTML tag or a union of both | Only on `<component>`. A disallowed tag (`script`, `iframe`, `style`…) produces `MEEK112`. Since `1.8`, also PascalCase literals naming a component (`'MeekoLink'`, `'UICard'`); an unknown one produces `MEEK132`. |
| `bind:prop`             | prop type                                          | A prop with an expression's value. An optional prop accepts `undefined`, equivalent to omitting it.                                                                                                                 |
| `prop="texto"`          | literal                                            | Static prop: text as a literal (`variant="primary"`) or `true` without a value. Hyphenated names are not props (`MEEK032`).                                                                                         |
| `bind="objeto"`         | props or attributes                                | Since `1.5`, props (or tag attributes) from an object, without `on*` keys; explicit values win (`MEEK113`).                                                                                                         |
| `on:evento`             | `(…args) => unknown`                               | The `onEvento` callback prop for a `defineEmits` event.                                                                                                                                                             |
| `model`, `model:nombre` | `Signal<T>`                                        | Child models from `defineModel`.                                                                                                                                                                                    |
| `ref:nombre`            |                                                    | Names the instance for `useElementRef`; its type comes from the child's `defineExpose`.                                                                                                                             |

Content between tags forms component snippets (`<snippet name="…">` and loose content, `default`) or, with an HTML tag, its children.

## Result

With a component, its HTML between child component comment markers; child state travels with it and hydration claims it. With an HTML tag whose value is known syntactically (literals in `?:` branches), the element unchanged, without markers. Each attribute is written only while the current tag accepts it: `href` on `<a>`, `type` and `disabled` on `<button>`.

## Examples

### Interchangeable views

```html
<script lang="ts">
import * as GridView from "./GridView.meeko";
import * as ListView from "./ListView.meeko";

const props = defineProps<{ items: { id: string; name: string }[] }>();
const mode = signal<"grid" | "list">("grid");
const views = { grid: GridView, list: ListView };
</script>

<template>
  <button type="button" on:click="() => mode.value = mode.value === 'grid' ? 'list' : 'grid'">Cambiar vista</button>
  <component is="views[mode.value]" bind:items="props.items"></component>
</template>
```

Changing `mode` disposes of the previous view and mounts the new one in its place.

### A button that is a link (since 1.5)

```html
<!-- app/components/AppButton.meeko -->
<script lang="ts">
const props = defineProps<{ href?: string; type?: "button" | "submit" }>();
const snippets = defineSnippets<{ default: [] }>();
</script>

<template>
  <component is="props.href ? 'a' : 'button'" class="button" bind:href="props.href" bind:type="props.type ?? 'button'">
    <render snippet="snippets.default" />
  </component>
</template>
```

Without `href`, renders `<button class="button" type="button">`; with it, `<a class="button" href="…">`. `type` is not written on `<a>` nor `href` on `<button>`.

### A route, link or button with `'MeekoLink'` (since 1.8)

```html
<!-- app/components/AppAction.meeko -->
<script lang="ts">
const props = defineProps<{ to?: RouteId; href?: string }>();
const snippets = defineSnippets<{ default: [] }>();
</script>

<template>
  <component is="props.to !== undefined ? 'MeekoLink' : props.href !== undefined ? 'a' : 'button'" class="action" bind:to="props.to" bind:href="props.href" type="button">
    <render snippet="snippets.default" />
  </component>
</template>
```

With `to`, the `'MeekoLink'` branch renders `<MeekoLink>`'s `<a>`, with typed `href` and `aria-current`; `meeko check` checks it after `props.to !== undefined`, so `to` is a route. `href` only reaches the second branch's `<a>` and `type` the `<button>`. Each name resolves at compile time, like its tag; see [Component names in `is`](../../api.md#component-names-in-is).

### A section with a tag chosen by the parent

```html
<script lang="ts">
const props = defineProps<{ as?: "section" | "article" | "aside"; title: string }>();
const snippets = defineSnippets<{ default: [] }>();
</script>

<template>
  <component is="props.as ?? 'section'" class="block" bind:aria-label="props.title">
    <render snippet="snippets.default" />
  </component>
</template>
```

### Snippets in a dynamic component

```html
<component is="props.dialog" bind:title="'Confirmar'">
  <p>¿Seguro que quieres borrar «{item.name}»?</p>
  <snippet name="actions" params="close"><button on:click="close">Cancelar</button></snippet>
</component>
```

## Common mistakes

### A tag that cannot be rendered

```html bad
<script lang="ts">
const tag = signal<"a" | "script">("a");
</script>
<template><component is="tag.value">x</component></template>
```

`meeko check` reports `MEEK112: <script> no es una etiqueta que <component is> pueda renderizar`. A tag name never injects markup: a disallowed value arriving at runtime throws `TypeError` before writing HTML.

```html good
<script lang="ts">
const tag = signal<"a" | "button">("a");
</script>
<template><component is="tag.value">x</component></template>
```

### `MeekoLink` as an `is` value

```html bad
<component is="internal ? MeekoLink : 'a'" to="/about">Acerca</component>
```

`meeko check` reports `TS2304: Cannot find name 'MeekoLink'`: `<MeekoLink>` is a compiler tag, not a script value. Since `1.8`, name it with a literal like any component:

```html good
<component is="internal ? 'MeekoLink' : 'a'" to="/about" href="https://example.com">Acerca</component>
```

### Omit a required prop

```html bad
<Card />
```

With `defineProps<{ title: string; count?: number }>()` in `Card`, `meeko check` reports `TS2345: Argument of type '{}' is not assignable to parameter of type '{ title: string; count?: number | undefined; } & ExtraProps'`, with `Property 'title' is missing`.

```html good
<Card title="Hola" />
```

### A static prop where another type is expected

```html bad
<Card title="Hola" count="3" />
```

`meeko check` reports `TS2322: Type 'string' is not assignable to type 'number'`: an unprefixed attribute passes text `"3"`. For a number, use `bind:`:

```html good
<Card title="Hola" bind:count="3" />
```

### The same prop statically and with `bind:`

```html bad
<Card title="Hola" bind:title="'Adiós'" />
```

`meeko check` reports `MEEK090: title y bind:title pasan los dos la prop title; deja sólo el texto estático o sólo bind:title`.

```html good
<Card bind:title="'Adiós'" />
```

### A hyphenated attribute on a component

```html bad
<Card title="Hola" data-test="card" />
```

`meeko check` reports `MEEK032: Las props de un componente se pasan con prop="texto", bind:prop="expresión" u on:evento="manejador"; is, ref, html y los nombres con guiones no son props`. A component has no root element to pass attributes to: declare it as a prop or put it on a wrapping element.

```html good
<div data-test="card"><Card title="Hola" /></div>
```

## Notes

- **SSR and hydration.** The server renders the chosen component with its state; hydration claims the same HTML. If `is` changes in the browser, the previous instance is disposed of (effects, cleanups and events) and the new one mounts in the same markers.
- **Tag changes.** With an HTML tag, changing `is` creates a new element and **moves** children into it, preserving their state and focus.
- **Data navigation.** A component chosen at runtime forces the browser to perform navigation's preliminary pass, because it could await data with `await useApi`.
- **Known name or runtime name.** A literal in `is` resolves at compile time and appears in SSR HTML. A name arriving at runtime loads with [`resolveComponent`](componentregistry.md), returning a promise of the module for `is`.
- **Security.** `is` never interprets text as HTML: only component modules or allowlisted tags. Custom elements (`x-card`) and SVG tags are not supported as `is` values.
- **Outlet.** In layouts, [`<MeekoOutlet />`](/en/docs/reference/meekooutlet) is equivalent to `<component is="props.outlet">` without declaring the prop.

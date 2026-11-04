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
source-hash: 054a54cbdcb8c7571df9ce6f2ad61f086788b72d0f7a442cfe66982c368d6e01
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
| `bind="objeto"`         | props or attributes                                | Since `1.5`, props or attributes of what `is` can be, from an object, without `on*` keys; explicit values win (`MEEK113`).                                                                                          |
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
  <button type="button" on:click="() => mode.value = mode.value === 'grid' ? 'list' : 'grid'">Change view</button>
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
<component is="props.dialog" bind:title="'Confirm'">
  <p>Are you sure you want to delete “{item.name}”?</p>
  <snippet name="actions" params="close"><button on:click="close">Cancel</button></snippet>
</component>
```

### A list with one component per row

```html
<script lang="ts">
import * as AppInput from "./AppInput.meeko";
import * as AppSelect from "./AppSelect.meeko";

type Option =
  | { id: string; component: typeof AppSelect; props: AppSelectProps }
  | { id: string; component: typeof AppInput; props: AppInputProps };

const options: Option[] = [
  { id: "role", component: AppSelect, props: { label: "Role", options: ["admin", "user"] } },
  { id: "name", component: AppInput, props: { placeholder: "Name" } },
];
</script>

<template>
  <component each:of="options" each:as="option" each:key="option.id" is="option.component" bind="option.props" />
</template>
```

`is` and `bind` read the same object, so `meeko check` checks each entry against its own component. With the type written, wrong props fail in the list itself. Without it, as in `const options = [{ … }]`, TypeScript also keeps the relation between each entry's `component` and `props`, and the error appears on `bind`: `{ component: AppInput, props: { label: "Name" } }` gives `MEEK113: label no es una prop del componente de esa entrada`. This works with any property path that starts the same in both, such as `current.value.component` and `current.value.props`, and also with an HTML tag in one of the entries.

If `is` and `bind` do not read the same object (`is="views[mode.value]" bind="attrs"`), TypeScript cannot relate them: the object must be valid for every possible component.

Use `AppSelectProps`, not `ComponentProps<"AppSelect">`: the latter includes the `defineEmits` events, and `bind` does not accept `on*` keys (`MEEK113`). Events are passed with `on:`, and the content between the tags is each row's `default` snippet.

On a generic component, `meeko check` checks its names and required props, not the type of its values: only its tag can infer its type parameters, and a list of different modules cannot call it entry by entry. Alone in the list, they are checked.

A module is not data that can be sent to the browser, so it does not go in a `signal` or in `useState`: `meeko check` gives `MEEK136`, and rendering on the server would be an error. If the list changes, store in the signal which entries are painted and read them with a `computed`:

```html
<script lang="ts">
import * as AppInput from "./AppInput.meeko";
import * as AppSelect from "./AppSelect.meeko";

const entries = {
  role: { component: AppSelect, props: { label: "Role", options: ["admin", "user"] } },
  name: { component: AppInput, props: { placeholder: "Name" } },
};
const visible = signal<("role" | "name")[]>(["role", "name"]);
const options = computed(() => visible.value.map((id) => ({ id, ...entries[id] })));
</script>

<template>
  <component each:of="options.value" each:as="option" each:key="option.id" is="option.component" bind="option.props" />
</template>
```

Each row keeps its instance when reordered. If a row's component changes, Meeko disposes of the previous one and mounts the new one in its place; if only its props change, the same instance receives them.

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
<component is="internal ? MeekoLink : 'a'" to="/about">About</component>
```

`meeko check` reports `TS2304: Cannot find name 'MeekoLink'`: `<MeekoLink>` is a compiler tag, not a script value. Since `1.8`, name it with a literal like any component:

```html good
<component is="internal ? 'MeekoLink' : 'a'" to="/about" href="https://example.com">About</component>
```

### A component name as text in the data

```html bad
<script lang="ts">
const options = [{ id: "role", component: "AppSelect", props: { label: "Role", options: ["admin"] } }] as const;
</script>
<template><component each:of="options" each:as="option" each:key="option.id" is="option.component" bind="option.props" /></template>
```

`meeko check` gives `MEEK112: <AppSelect> no es una etiqueta que <component is> pueda renderizar: is nunca convierte un texto en un componente`, and says what to do. Without `as const`, the value is a `string` and the message starts with `is es un string cualquiera`. There are three ways out: the literal in the template (`is="kind === 'select' ? 'AppSelect' : 'AppInput'"`), the imported module in the data, or [`resolveComponent`](componentregistry.md) to load it at runtime.

```html good
<script lang="ts">
import * as AppSelect from "./AppSelect.meeko";

const options = [{ id: "role", component: AppSelect, props: { label: "Role", options: ["admin"] } }];
</script>
<template><component each:of="options" each:as="option" each:key="option.id" is="option.component" bind="option.props" /></template>
```

### Omit a required prop

```html bad
<Card />
```

With `defineProps<{ title: string; count?: number }>()` in `Card`, `meeko check` reports `TS2345: Argument of type '{}' is not assignable to parameter of type '{ title: string; count?: number | undefined; } & ExtraProps'`, with `Property 'title' is missing`.

```html good
<Card title="Hello" />
```

### A static prop where another type is expected

```html bad
<Card title="Hello" count="3" />
```

`meeko check` reports `TS2322: Type 'string' is not assignable to type 'number'`: an unprefixed attribute passes text `"3"`. For a number, use `bind:`:

```html good
<Card title="Hello" bind:count="3" />
```

### The same prop statically and with `bind:`

```html bad
<Card title="Hello" bind:title="'Goodbye'" />
```

`meeko check` reports `MEEK090: title y bind:title pasan los dos la prop title; deja sólo el texto estático o sólo bind:title`.

```html good
<Card bind:title="'Goodbye'" />
```

### A hyphenated attribute on a component

```html bad
<Card title="Hello" data-test="card" />
```

`meeko check` reports `MEEK032: Las props de un componente se pasan con prop="texto", bind:prop="expresión" u on:evento="manejador"; is, ref, html y los nombres con guiones no son props`. A component has no root element to pass attributes to: declare it as a prop or put it on a wrapping element.

```html good
<div data-test="card"><Card title="Hello" /></div>
```

## Notes

- **SSR and hydration.** The server renders the chosen component with its state; hydration claims the same HTML. If `is` changes in the browser, the previous instance is disposed of (effects, cleanups and events) and the new one mounts in the same markers.
- **Tag changes.** With an HTML tag, changing `is` creates a new element and **moves** children into it, preserving their state and focus.
- **Data navigation.** A component chosen at runtime forces the browser to perform navigation's preliminary pass, because it could await data with `await useApi`.
- **Known name or runtime name.** A literal in `is` resolves at compile time and appears in SSR HTML. A name arriving at runtime loads with [`resolveComponent`](componentregistry.md), returning a promise of the module for `is`.
- **Security.** `is` never interprets text as HTML: only component modules or allowlisted tags. Custom elements (`x-card`) and SVG tags are not supported as `is` values.
- **Outlet.** In layouts, [`<MeekoOutlet />`](/en/docs/reference/meekooutlet) is equivalent to `<component is="props.outlet">` without declaring the prop.

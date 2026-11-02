---
title: ref:nombre
group: syntax
since: 1.0.0
description: Names a template element or component so the script can read it with useElementRef, typed from its tag or defineExpose.
symbols:
  - "syntax:ref"
related:
  - "syntax:useelementref"
  - "syntax:defineexpose"
  - "syntax:each"
  - "@meekojs/meeko#onMounted"
  - docs/api.md#referencias-a-elementos-ref-y-useelementref
source-hash: 33f38d6cefbf9902cadc1d290290aa9a7a34ee11be2d8ff6e0d0b18d61e215b3
---

`ref:nombre`, without a value, names a template element or component. The script reads it with [`useElementRef("nombre")`](/en/docs/reference/useelementref), whose type comes from the tag: `HTMLInputElement` for an `<input>`, `SVGSVGElement` for an `<svg>` and, for a component, its `defineExpose` value.

Use it for what the template cannot express: focusing a field, measuring an element, scrolling to it or calling a method exposed by a child component.

## Usage

```html
<!-- app/components/SearchPanel.meeko -->
<script lang="ts">
const input = useElementRef("input");

onMounted(() => {
  input.value?.focus();
});
</script>

<template>
  <input ref:input type="search" aria-label="Buscar">
</template>
```

## Attributes

| Attribute      | Type     | Default | Description                                                         |
| -------------- | -------- | ------- | ------------------------------------------------------------------- |
| `ref:<nombre>` | no value | none    | Names the tag. `<nombre>` is an identifier, unique in the template. |

Valid on HTML and SVG elements, component tags and `<component is>`. Not valid on `<template>` or inside `<snippet>` content (or loose content inside a component tag, which is the `default` snippet).

## Result

Nothing in HTML. In the script, `useElementRef("nombre")` returns:

| Location of `ref:` | Without `await`                                                                                   | With `await`                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| An element         | `ReadonlySignal<Elemento \| null>`: `null` in SSR, before hydration and while hidden by `if:when` | The element, never `null`; the rest of setup continues only in the browser |
| A component        | `ReadonlySignal<Expuesto \| null>`, with its `defineExpose` value                                 | The exposed value                                                          |
| Inside `each:of`   | `ReadonlySignal<readonly Elemento[]>`, in document order                                          | Does not support `await` (`MEEK056`)                                       |

## Examples

### Call a child component

The child publishes what the parent can use with `defineExpose`; the parent names it with `ref:`:

```html
<!-- app/components/SearchBox.meeko -->
<script lang="ts">
const query = signal("");
function clear(): void {
  query.value = "";
}
defineExpose({ query, clear });
</script>

<template><input type="search" model="query" aria-label="Buscar"></template>
```

```html
<!-- app/components/Toolbar.meeko -->
<script lang="ts">
const box = useElementRef("box");
function reset(): void {
  box.value?.clear();
}
</script>

<template>
  <SearchBox ref:box />
  <button type="button" on:click="reset">Limpiar</button>
</template>
```

### List rows

A single `ref:` inside `each:of` names all rows:

```html
<script lang="ts">
const items = signal(["Té", "Café", "Agua"]);
const rows = useElementRef("row");
function focusLast(): void {
  rows.value.at(-1)?.focus();
}
</script>

<template>
  <ul>
    <li each:of="items.value" each:as="item" ref:row tabindex="-1">{item}</li>
  </ul>
  <button type="button" on:click="focusLast">Ir al último</button>
</template>
```

### An element mounted later

With `await`, setup waits until the element exists, including under an `if:when` that is still false. What follows only runs in the browser:

```html
<script lang="ts">
const width = signal(0);
const chart = await useElementRef("chart");
const observer = new ResizeObserver(([entry]) => {
  width.value = entry?.contentRect.width ?? 0;
});
observer.observe(chart);
onCleanup(() => observer.disconnect());
</script>

<template><div ref:chart class="chart"></div></template>
```

The template cannot read `observer`, declared after `await`, but it can read `width`, declared before it.

## Common mistakes

### Give it a value

```html bad
<h2 ref:title="heading">Buscar</h2>
```

`MEEK052: ref:title no lleva valor; escribe ref:title`.

```html good
<h2 ref:title>Buscar</h2>
```

### Write `ref="x"` as in Vue

`ref="x"` is a literal HTML attribute, not the directive.

```html bad
<h2 ref="title">Buscar</h2>
```

With `useElementRef("title")` in the script, `meeko check` reports `MEEK056: La plantilla no tiene ref:title; añade ref:title a un elemento o a un componente`. On a component, `ref="x"` produces `MEEK032`.

```html good
<h2 ref:title>Buscar</h2>
```

### The same name in two places

```html bad
<h2 ref:title>Buscar</h2>
<p ref:title>Resultados</p>
```

`MEEK053: ref:title ya se usa en la línea 1; una ref nombra un solo lugar de la plantilla (las filas de each:of la comparten)`. Two `ref:` directives on the same element produce `MEEK052: Un elemento o componente admite una sola directiva ref:`.

```html good
<h2 ref:title>Buscar</h2>
<p ref:results>Resultados</p>
```

### A `ref:` inside a component's content

A component tag's content is a snippet, which the child can render multiple times.

```html bad
<AppDialog><p ref:body>Texto</p></AppDialog>
```

`MEEK052: ref: no se admite dentro del contenido de <snippet>, que el hijo puede renderizar cualquier número de veces`.

```html good
<AppDialog ref:dialog><p>Texto</p></AppDialog>
```

Put `ref:` on the component and let it expose what you need, or on an element outside it.

### A name that is not an identifier

```html bad
<h2 ref:main-title>Buscar</h2>
```

`MEEK052: Nombre de ref no válido: "main-title"; usa un identificador, como ref:input`.

```html good
<h2 ref:mainTitle>Buscar</h2>
```

## Notes

- **SSR.** A `ref:` does not exist on the server: the signal is `null` in SSR and at the start of hydration. When `onMounted` runs, each visible `ref:` already has its value.
- **Types.** The type comes from the template, not an annotation: an `<input>` gives `HTMLInputElement`, without casts. For `<component is>` with tags, it is the union of their elements; for a generic component, the exposed value with the `T` inferred by the tag.
- **Hydration.** Do not use `ref:` to write to the DOM before mounting: changes outside Meeko are not preserved if the region is recreated (`if:when`, `each:of`).
- **Accessibility.** When moving focus with `ref:`, do so in response to a user action; focusing a field on page load disorients screen reader users.
- **Other forms.** `bind:ref` on a component passes a prop named `ref`; on an element, a `ref` attribute.

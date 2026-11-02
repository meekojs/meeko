---
title: useElementRef
group: macros
since: 1.1.0
description: Reads the template element or component named with ref: from the script, as a signal or, with await, already mounted.
symbols:
  - "syntax:useelementref"
related:
  - "syntax:ref"
  - "syntax:defineexpose"
  - "@meekojs/meeko#onMounted"
  - "@meekojs/meeko#ReadonlySignal"
  - docs/api.md#referencias-a-elementos-ref-y-useelementref
  - docs/api.md#composables-de-nivel-superior-y-await
source-hash: 476862c725a8b7b2a425029f579d16a9d1c34d670be50f5c21f58d0cbb38385f
---

`useElementRef("nombre")` reads the element or component named `ref:nombre` in the template. Its type comes from the template: `HTMLInputElement` for an `<input>`, `SVGSVGElement` for an `<svg>` and, for a component, its `defineExpose` value. It is a compile-time macro: do not import it, and call it only at the top level of `<script>`.

Without `await`, it returns a signal whose value is `null` until the element exists. With `await`, it returns the mounted element, and the rest of setup continues only in the browser.

## Usage

```html
<!-- app/components/SearchPanel.meeko -->
<script lang="ts">
const input = useElementRef("input");

onMounted(() => {
  input.value?.focus();
});
</script>

<template><input ref:input type="search" aria-label="Buscar"></template>
```

`input` is `ReadonlySignal<HTMLInputElement | null>`; in `onMounted`, each visible `ref:` already has its value.

## Parameters

| Parameter | Type           | Default  | Description                                                                                                                         |
| --------- | -------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `name`    | string literal | required | The name of a template `ref:`, such as `"input"`. A variable, template literal or name absent from the template produces `MEEK056`. |

## Return value

| Form                       | Target                  | Returns                                                                                                           |
| -------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `useElementRef("x")`       | an element              | `ReadonlySignal<Elemento \| null>`: `null` in SSR, before hydration, while hidden by `if:when` and after disposal |
| `useElementRef("x")`       | a component             | `ReadonlySignal<Expuesto \| null>`, with its `defineExpose` value (`null` without it)                             |
| `useElementRef("x")`       | inside `each:of`        | `ReadonlySignal<readonly Elemento[]>`, in document order                                                          |
| `await useElementRef("x")` | an element or component | The element or exposed value, never `null`. Waits until it exists, including under a still-false `if:when`        |

## Examples

### Measure an element

An observer is created in the browser and disposed of with the component:

```html
<script lang="ts">
const box = useElementRef("box");
const width = signal(0);

onMounted(() => {
  const target = box.value;
  if (!target) return;
  const observer = new ResizeObserver(([entry]) => {
    width.value = entry?.contentRect.width ?? 0;
  });
  observer.observe(target);
  onCleanup(() => observer.disconnect());
});
</script>

<template><div ref:box class="box">{Math.round(width.value)} px</div></template>
```

### List rows

```html
<script lang="ts">
const items = signal(["Té", "Café", "Agua"]);
const rows = useElementRef("row");
function focusFirst(): void {
  rows.value[0]?.focus();
}
</script>

<template>
  <ul><li each:of="items.value" each:as="item" ref:row tabindex="-1">{item}</li></ul>
  <button type="button" on:click="focusFirst">Primera</button>
</template>
```

### Await the element with `await`

The first browser `await` splits setup: code before it runs in SSR and hydration; code after it only runs in the browser once the component is mounted.

```html
<script lang="ts">
const status = signal("Preparando el gráfico…");
const canvas = await useElementRef("chart");
const context = canvas.getContext("2d");
context?.fillRect(0, 0, canvas.width / 2, canvas.height);
status.value = "Listo";
</script>

<template>
  <p role="status">{status.value}</p>
  <canvas ref:chart width="320" height="160"></canvas>
</template>
```

`canvas` is `HTMLCanvasElement`, without `null`. The template can read `status`, declared before `await`, but not `context`, which only exists in the browser.

## Common mistakes

### Call it inside a function

```html bad
<script lang="ts">
onMounted(() => {
  const title = useElementRef("title");
  title.value?.focus();
});
</script>
```

`MEEK054: useElementRef() debe llamarse en el nivel superior de <script>, no dentro de una función, un handler, un effect ni onMounted`. Inside an `if`, loop or block, the message is `… debe llamarse sin condiciones en el nivel superior de <script>…`.

```html good
<script lang="ts">
const title = useElementRef("title");
onMounted(() => {
  title.value?.focus();
});
</script>
```

### A name that is not a literal or does not exist

```html bad
<script lang="ts">
const title = useElementRef("tittle");
</script>
<template><h2 ref:title>Buscar</h2></template>
```

`MEEK056: La plantilla no tiene ref:tittle; sus refs son "title"`. With a variable: `MEEK056: useElementRef necesita un literal de texto con el nombre de una directiva ref: de la plantilla, como useElementRef("input")`.

```html good
<script lang="ts">
const title = useElementRef("title");
</script>
<template><h2 ref:title>Buscar</h2></template>
```

### Read `.value` without checking `null`

```html bad
<script lang="ts">
const title = useElementRef("title");
title.value.focus();
</script>
```

`meeko check` reports `TS18047: 'title.value' is possibly 'null'.` At the top level, it would also run in SSR, where the element does not exist.

```html good
<script lang="ts">
const title = useElementRef("title");
onMounted(() => title.value?.focus());
</script>
```

### Use a name declared after `await` in the template

```html bad
<script lang="ts">
const input = await useElementRef("input");
const label = signal("Hola");
</script>
<template><input ref:input><p>{label.value}</p></template>
```

`MEEK057: La plantilla no puede usar label: se declara en la línea 3, después del primer await de navegador, y sólo existe en el navegador una vez montado el componente. Declara ese nombre antes de ese await`.

```html good
<script lang="ts">
const label = signal("Hola");
const input = await useElementRef("input");
</script>
<template><input ref:input><p>{label.value}</p></template>
```

### Macros after `await`

```html bad
<script lang="ts">
const input = await useElementRef("input");
const props = defineProps<{ label: string }>();
</script>
```

`MEEK058: defineProps debe ir antes del primer await de navegador (await useElementRef o await useSocket), tras el cual el código sólo continúa en el navegador`.

```html good
<script lang="ts">
const props = defineProps<{ label: string }>();
const input = await useElementRef("input");
</script>
```

### Await a list or a component without `defineExpose`

```html bad
<script lang="ts">
const rows = await useElementRef("row");
</script>
<template><li each:of="items" each:as="item" ref:row>{item}</li></template>
```

`MEEK056: ref:row está dentro de each:of y nombra una lista; lee useElementRef("row").value en lugar de esperarla con await`. On a component without `defineExpose`, the error is `MEEK080`.

```html good
<script lang="ts">
const items = ["Té", "Café"];
const rows = useElementRef("row");
</script>
<template><li each:of="items" each:as="item" ref:row>{item}</li></template>
```

### Destructure the signal

```html bad
<script lang="ts">
const { value } = useElementRef("input");
</script>
```

`MEEK015: useElementRef no admite desestructuración: asigna la ref a un nombre simple, como const input = useElementRef("input"), y lee input.value cuando la necesites`.

```html good
<script lang="ts">
const input = useElementRef("input");
</script>
```

## Notes

- **SSR.** There are no elements on the server: the signal is `null` and code after `await useElementRef` does not run. Nothing you do with the element reaches server HTML.
- **Hydration.** The signal receives the element during hydration or mounting; `onMounted` already sees it. If `if:when` hides the element, the signal returns to `null`.
- **Continuation.** Code after `await useElementRef` belongs to the component: its `effect`, `onCleanup` and composables are disposed of on unmount, and if unmounted while waiting, the continuation does not resume. A failure reaches the error observer with source `"mounted"`.
- **Types.** The type is inferred from the tag: no annotation or cast is needed. In `<component is>` with multiple tags, it is the union of their elements.

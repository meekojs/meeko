---
title: <style scoped>
group: syntax
since: 1.0.0
description: Component scoped styles, limited to its template elements with a data-meeko-s attribute, and :global(…) to escape the scope.
symbols:
  - "syntax:style-scoped"
related:
  - "syntax:style"
  - "syntax:html"
  - "config:css"
  - docs/api.md#estilos-con-ámbito-y-global
  - docs/api.md#qué-elementos-reciben-el-atributo
source-hash: f71fad96880e439b03be506e1e3db2068d4d2bdb0fd4d1db9bc728d65bf8283d
---

`<style scoped>` limits styles to the component: the compiler adds the `data-meeko-s-<hash>` attribute to its template elements and requires it in every selector. This component's `.card` does not affect another's `.card`.

`:global(<selector>)` escapes the scope for part of a selector: it reaches a child component's elements, `html="…"` content or a class on `<html>`.

## Usage

```html
<!-- app/components/AppCard.meeko -->
<script lang="ts">
import type { TrustedHtml } from "@meekojs/meeko";

const props = defineProps<{ title: string; body: TrustedHtml }>();
</script>

<template>
  <section class="card">
    <h2 class="title">{props.title}</h2>
    <div class="content" html="props.body"></div>
  </section>
</template>

<style scoped>
.card { border: 1px solid; padding: 1rem; }
.card .title { font-weight: 700; }
.content :global(p) { margin: 0; }
</style>
```

## Attributes

| Attribute | Type     | Default | Description                                                       |
| --------- | -------- | ------- | ----------------------------------------------------------------- |
| `scoped`  | no value | absent  | Enables scoping. Without it, the block is global (see `<style>`). |

The `css.scopeAttribute` option in `meeko.config.ts` decides which elements receive the attribute: `"all"` (default in `1.x`) or, since `1.2`, `"matched"`.

## Result

The compiler adds `[data-meeko-s-<hash>]` to the **last compound** in each selector, before any pseudo-element. `:global(…)` emits its inner selector without the attribute:

| Source                  | Generated CSS                  |
| ----------------------- | ------------------------------ |
| `.a { … }`              | `.a[data-meeko-s-…] { … }`     |
| `.card .title`          | `.card .title[data-meeko-s-…]` |
| `.a::before`            | `.a[data-meeko-s-…]::before`   |
| `.card :global(.icon)`  | `.card[data-meeko-s-…] .icon`  |
| `:global(html.dark) .a` | `html.dark .a[data-meeko-s-…]` |
| `:global(body)`         | `body`, without an attribute   |
| `@keyframes spin { … }` | unchanged                      |

The hash comes from the file path, so it is the same on the server and in the browser, and changes if you move or rename the component. The attribute goes on the component's template elements; snippet content receives the attribute of the component that writes it.

## Examples

### States with ARIA attributes

A scoped attribute selector applies to attributes set by `bind:`:

```html
<script lang="ts">
const open = signal(false);
</script>

<template>
  <button type="button" class="toggle" bind:aria-expanded="open.value ? 'true' : 'false'" on:click="() => open.value = !open.value">Menú</button>
</template>

<style scoped>
.toggle[aria-expanded="true"] { background: CanvasText; color: Canvas; }
</style>
```

### Dark theme

`:global(…)` on an ancestor reads a class or attribute on `<html>` without losing scope for the rest:

```html
<template><div class="panel">Contenido</div></template>

<style scoped>
.panel { background: white; color: black; }
:global(html[data-theme="dark"]) .panel { background: #111; color: #eee; }
</style>
```

### A child component's elements

A child's elements do not receive the parent's attribute. To adjust one from outside, anchor the selector on your element and use `:global(…)` for the child's:

```html
<template>
  <div class="toolbar"><AppButton label="Guardar" /></div>
</template>

<style scoped>
.toolbar :global(.button) { min-width: 8rem; }
</style>
```

Better still, if you own the child: give it a prop (`variant`, `size`) and let the child decide its styles.

### Fewer attributes with `scopeAttribute: "matched"`

Since `1.2`, with `css.scopeAttribute: "matched"`, the attribute goes only on elements that a scoped selector can match, reducing HTML size:

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  css: { scopeAttribute: "matched" },
});
```

Before enabling it, review code changing classes through the DOM API (`classList`, `setAttribute`) on elements without `ref:` or `on:`: with `"matched"` they may lack the attribute. Use `bind:class` or a `ref:` on them.

## Common mistakes

### `:global` without parentheses

```html bad
<style scoped>
.card :global { color: red; }
</style>
```

`MEEK019: :global necesita un selector como argumento; usa :global(<selector>)`.

```html good
<style scoped>
.card :global(.icon) { color: red; }
</style>
```

### A selector list inside `:global(…)`

```html bad
<style scoped>
.card :global(.icon, .badge) { color: red; }
</style>
```

`MEEK019: :global(...) admite un solo selector; escribe un :global(<selector>) por cada selector de la lista`.

```html good
<style scoped>
.card :global(.icon), .card :global(.badge) { color: red; }
</style>
```

### `:global(…)` inside another pseudo-class

```html bad
<style scoped>
.card:not(:global(.dark)) { color: black; }
</style>
```

`MEEK019: :global(<selector>) debe ir en el nivel superior de un selector, no dentro de otra pseudoclase`.

```html good
<style scoped>
.card { color: black; }
:global(.dark) .card { color: white; }
</style>
```

### Styling `html` content without `:global`

HTML inserted with `html="…"` is not part of the template and does not receive the attribute: the rule does not apply, without any error.

```html bad
<style scoped>
.content p { margin: 0; }
</style>
```

```html good
<style scoped>
.content :global(p) { margin: 0; }
</style>
```

### Malformed CSS

```html bad
<style scoped>
.card { color: red;
</style>
```

`MEEK019: Unclosed block`, with the line in the `.meeko` file.

```html good
<style scoped>
.card { color: red; }
</style>
```

## Notes

- **SSR and hydration.** The server and browser share the compiled template, so the attribute matches in server HTML and HTML rendered later by `if:when`, `each:of` or navigation.
- **Specificity.** The attribute adds an attribute selector's specificity to the last compound: `.card` gains the weight of `.card[x]`. A global rule with the same class loses to it.
- **Performance.** With `"all"`, every template element carries the attribute; with `"matched"`, only those needing it. A component without `<style scoped>` never emits it.
- **Animations.** `@keyframes` rules are unchanged and their names are not isolated: use prefixed names if multiple components define animations.
- **Checking.** `meeko check`, `meeko build` and the editor analyze the block and report `MEEK019` with the error position. `css.scopeAttribute` changes neither types nor diagnostics, only HTML.

---
title: <style>
group: syntax
since: 1.0.0
description: Global styles colocated with the component that needs them, processed by the application's PostCSS and bundled with it.
symbols:
  - "syntax:style"
related:
  - "syntax:style-scoped"
  - "syntax:html"
  - "config:css"
  - docs/api.md#estilos-del-componente-style-y-style-scoped
source-hash: 27ec225e92e105c8a4bc4875ebbfc30a935ca21abe3f9761ebb84814962e21ab
---

`<style>` without `scoped` is **global** CSS in the `.meeko` file of the component that needs it. It passes through the same PostCSS as `app/styles/main.css` (`postcss.config.*`, Tailwind, Meeko utilities) and Vite bundles it with the component, but its rules apply to **the entire page**: children, `html="…"` content and any other component with the same class.

Use it for intentionally global styles, with your own prefix. For almost everything else, [`<style scoped>`](/en/docs/reference/style-scoped) is the default choice.

## Usage

```html
<!-- app/components/MarkdownView.meeko -->
<script lang="ts">
import type { TrustedHtml } from "@meekojs/meeko";

const props = defineProps<{ content: TrustedHtml }>();
</script>

<template>
  <article class="markdown-view" html="props.content"></article>
</template>

<style>
/* Global a propósito: el prefijo .markdown-view evita afectar al resto de la página. */
.markdown-view p { margin-block: 0.75em; }
.markdown-view pre { overflow-x: auto; }
</style>
```

## Attributes

| Attribute | Type     | Default | Description                                                                                             |
| --------- | -------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `scoped`  | no value | absent  | With `scoped`, styles are limited to the component (see `<style scoped>`). Without it, they are global. |

A component accepts **one** style block: two `<style>` blocks, even if one is `scoped`, produce `MEEK004: Sección <style> duplicada`.

## Result

- **CSS.** The rules as written, after PostCSS: no scope attribute is added and `:global(…)` is not transformed.
- **SSR.** The document links the page components' CSS in `<head>`, so styles are present on the first render.
- **Navigation.** Client navigation loads each route's CSS when entering it. Once loaded, it keeps applying when navigating to other routes, and its order relative to other stylesheets depends on when it was loaded.

## Examples

### Styles for third-party content

A component wrapping a widget or HTML it does not control applies global styles with a prefix:

```html
<!-- app/components/CodeBlock.meeko -->
<script lang="ts">
import type { TrustedHtml } from "@meekojs/meeko";

const props = defineProps<{ highlighted: TrustedHtml }>();
</script>

<template><div class="code-block" html="props.highlighted"></div></template>

<style>
.code-block .line { display: block; min-height: 1lh; }
.code-block .line.highlighted { background: color-mix(in oklab, currentColor 8%, transparent); }
</style>
```

### Tailwind and layers

The block passes through the application's PostCSS, so it accepts Tailwind directives if the project uses Tailwind:

```html
<template><nav class="site-nav">…</nav></template>

<style>
@layer components {
  .site-nav { display: flex; gap: 1rem; }
  .site-nav a[aria-current="page"] { font-weight: 700; }
}
</style>
```

## Common mistakes

### Use `:global(…)` in a `<style>` without `scoped`

`:global` is only transformed in `<style scoped>`. Here it reaches the browser unchanged; the browser does not understand it and discards the rule without any error.

```html bad
<style>
.card :global(.icon) { width: 1rem; }
</style>
```

```html good
<style scoped>
.card :global(.icon) { width: 1rem; }
</style>
```

### A generic selector without a prefix

A common class in a global `<style>` affects all components that use it, in the order their stylesheets were loaded: the result changes depending on the entry route.

```html bad
<style>
.card { padding: 2rem; }
</style>
```

```html good
<style scoped>
.card { padding: 2rem; }
</style>
```

### Two style blocks

```html bad
<style scoped>
.a { color: red; }
</style>
<style>
.b { color: blue; }
</style>
```

`MEEK004: Sección <style> duplicada`. Use a `<style scoped>` with `:global(…)` for the global part.

```html good
<style scoped>
.a { color: red; }
:global(.b) { color: blue; }
</style>
```

## Notes

- **Scope.** A global `<style>` is not limited to when the component is mounted: once loaded, it applies to the entire page until you reload it.
- **Where to put global styles.** Resets, tokens and typography belong in `app/styles/main.css` (or a file it imports), where their order is explicit. `<style>` in a component is for global styles that only exist if that component is in the application.
- **Performance.** Vite bundles CSS per route: a component only used in one section does not add its styles to others until you visit them.
- **CSP.** In the build, component CSS arrives as linked `.css` files, not inline `<style>` tags: a CSP with `style-src 'self'` allows them.
- **Checking.** `meeko check` does not validate CSS in a `<style>` without `scoped`; PostCSS and Vite process it in `meeko dev` and `meeko build`.

---
title: html
group: syntax
since: 1.1.0
description: Fills an element with unescaped HTML from an expression, which must be marked as trusted with trustHtml.
symbols:
  - "syntax:html"
related:
  - "@meekojs/meeko#trustHtml"
  - "syntax:interpolation"
  - "syntax:style-scoped"
  - "syntax:on"
  - docs/api.md#html-sin-escapar-con-html
  - docs/api.md#html-de-confianza-trustedhtml-y-trusthtml
  - "@meekojs/meeko/framework#documentHtml"
source-hash: a81888ec8f71b92621c3ef251b5c1bd3646c4cc66d071945bae3759b21bc1421
---

`html="expresión"` fills an element with the expression's HTML, **without escaping**: use it to render processed Markdown, code highlighter output or an SVG icon. The expression is a `string`; `null` and `undefined` leave the element empty.

Since `1.3`, that `string` must be marked as trusted with [`trustHtml`](/en/docs/reference/trusthtml) (type `TrustedHtml`), or `meeko check` warns with `MEEK107`. For text, use `{expresión}`, which escapes.

## Usage

```html
<!-- app/components/ArticleBody.meeko -->
<script lang="ts">
import type { TrustedHtml } from "@meekojs/meeko";

const props = defineProps<{ body: TrustedHtml }>();
</script>

<template>
  <article class="prose" html="props.body"></article>
</template>
```

The server module producing the HTML sanitizes it if it comes from users, then marks it with `trustHtml`; the component only receives `TrustedHtml`.

## Attributes

| Attribute | Type                               | Default  | Description                                                                                                            |
| --------- | ---------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `html`    | `TrustedHtml \| null \| undefined` | required | The element's content. An unmarked `string` compiles with warning `MEEK107`; a number or another type is a type error. |

The element must be empty in the template and be a standard HTML element that accepts content: not `<img>`, `<input>` or other void elements, nor `<textarea>`, `<title>`, `<script>`, `<style>` or `<template>`.

## Result

- **SSR.** HTML is normalized for the element before writing it so no node escapes it: unclosed tags are closed (`"<b>Hola"` gives `<b>Hola</b>`) and closing tags without a corresponding opening tag are discarded. If the browser would move part of the content outside the element (a `<div>` inside a `<p>`, a standalone `<li>`), SSR leaves the element empty and the browser fills it during hydration with `innerHTML`.
- **Hydration.** If the content matches the expression's HTML, the DOM is untouched; if it differs, `innerHTML` is replaced.
- **Changes.** Each value change replaces `innerHTML`. Inserted content is not part of the template: it has no directives or components.
- **Scripts.** Meeko never executes content's `<script>` elements when inserting it in the browser, just like `innerHTML`. Those arriving in the initial document's HTML do execute, like any page script.

## Examples

### Repository Markdown rendered on the server

For your own HTML, such as that from your Markdown files, simply declare it trusted at its source:

```ts
// server/content/articles.ts
import { trustHtml } from "@meekojs/meeko";
import type { TrustedHtml } from "@meekojs/meeko";

export function articleHtml(renderedMarkdown: string): TrustedHtml {
  return trustHtml(renderedMarkdown);
}
```

```html
<!-- app/pages/blog/[slug].meeko -->
<script server lang="ts">
import { articleHtml } from "../../../server/content/articles";

const { params } = usePage();
export const article = { title: params.slug, body: articleHtml(`<p>Post <strong>${params.slug}</strong></p>`) };
</script>

<template>
  <h1>{article.title}</h1>
  <div class="prose" html="article.body"></div>
</template>
```

`TrustedHtml` survives the payload: the export reaches the template with that type, and `html` does not warn.

### Sanitized user HTML

A user comment may contain `<img onerror>`. Sanitize it with a library such as DOMPurify, then mark it:

<!-- no-check -->

```ts
// server/content/comments.ts
import DOMPurify from "isomorphic-dompurify";
import { trustHtml } from "@meekojs/meeko";
import type { TrustedHtml } from "@meekojs/meeko";

export function commentHtml(input: string): TrustedHtml {
  return trustHtml(DOMPurify.sanitize(input));
}
```

### A constant SVG icon

A literal written in code does not warn; a `<script>` constant needs `as const` to preserve its literal type:

```html
<script lang="ts">
const check = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8l4 4 8-8"/></svg>' as const;
</script>

<template><span class="icon" html="check"></span> Saved</template>
```

### Styles and events in content

Content does not receive the `<style scoped>` attribute: select it with `:global(…)`. To react to a click inside it, listen on the element itself:

```html
<script lang="ts">
import type { TrustedHtml } from "@meekojs/meeko";

const props = defineProps<{ body: TrustedHtml }>();
function onClick(event: MouseEvent): void {
  const heading = (event.target as Element | null)?.closest("h2[id]");
  if (heading) history.replaceState(null, "", `#${heading.id}`);
}
</script>

<template><div class="content" html="props.body" on:click="onClick"></div></template>

<style scoped>
.content :global(h2) { scroll-margin-top: 4rem; }
.content :global(pre) { overflow-x: auto; }
</style>
```

## Common mistakes

### An unmarked `string`

```html bad
<article html="body.value"></article>
```

With `const body = signal("<p>Hola</p>")`, `meeko check` warns with ``MEEK107: `html` inserta HTML sin escapar; un `string` puede venir de un usuario (XSS). Sanéelo y márquelo con `trustHtml(…)`, o use `{expr}`, que escapa.`` This is a warning: it does not fail the check, but will be an error in `2.0`.

```html good
<script lang="ts">
import { trustHtml } from "@meekojs/meeko";

const body = signal(trustHtml("<p>Hello</p>"));
</script>

<template><article html="body.value"></article></template>
```

An unannotated constant also warns, because it reaches the template as `string`: write `as const` or mark it.

### Content inside the element

```html bad
<article html="body"><p>Loading…</p></article>
```

`MEEK095: Un elemento con html no admite hijos: el HTML de la expresión es todo su contenido; deja <article html="..."></article> vacío`.

```html good
<article html="body"></article>
<p if:when="!body">Loading…</p>
```

### An element that does not accept HTML content

```html bad
<img html="icon">
<textarea html="body"></textarea>
```

`MEEK095: html no se admite en <img>, que no tiene contenido` and `MEEK095: html no se admite en <textarea>, cuyo contenido no es HTML`.

```html good
<span html="icon"></span>
<textarea model="text"></textarea>
```

### A value that is not text

```html bad
<p html="count"></p>
```

With `const count = 3`, `meeko check` reports `TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.` To render a number, interpolate it.

```html good
<p>{count}</p>
```

### An empty expression

```html bad
<div html=""></div>
```

`MEEK095: html necesita una expresión que devuelva HTML: html="content"`.

```html good
<div html="content"></div>
```

## Notes

- **Security.** `html` is unsafe with untrusted content: user or third-party HTML can execute code on the page (XSS). `trustHtml` does not sanitize, it only declares trust: sanitize first. Mark HTML in the server module producing it, not immediately before the template.
- **SSR.** Choose an element that accepts the content (`<div html>` for blocks, `<ul html>` for `<li>`, `<tbody html>` for rows): if the browser would move some content outside, SSR leaves the element empty and it is invisible without JavaScript.
- **Hydration.** Identical content is untouched; different content is replaced entirely, losing any selection or focus inside it.
- **Performance.** Every change replaces the entire `innerHTML`. For frequently changing content, use the template.
- **Weight.** A value from page data arrives twice on the first load: in the HTML and in the payload. For a large one that only `html` reads, mark it with [`documentHtml`](/docs/reference/documenthtml) and it travels once.
- **Custom elements.** On a hyphenated tag (`<x-markdown html="intro">`), `html` is a literal HTML attribute and the element accepts children. On a component tag, `html` is not a prop (`MEEK032`), and `bind:html` is an attribute called `html`.
- **CSP.** Inserted content may contain `style` or `on*` attributes, blocked by a strict CSP: account for this when sanitizing.

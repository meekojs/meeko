---
title: trustHtml
group: utils
since: 1.3.0
description: Declares HTML trusted and gives it the TrustedHtml type, which the html directive accepts without a warning; does not sanitize or copy anything.
symbols:
  - "@meekojs/meeko#trustHtml"
  - "@meekojs/meeko#TrustedHtml"
related:
  - "syntax:html"
  - "syntax:interpolation"
  - "syntax:script-server"
  - docs/api.md#html-de-confianza-trustedhtml-y-trusthtml
  - docs/api.md#html-sin-escapar-con-html
source-hash: 632d460074ecf4086c788fefbb9ab04a90efe938dd67d9dad985ddfb2c3b959a
---

`trustHtml(html)` declares an HTML `string` trusted and returns it with the `TrustedHtml` type, which the `html="expresión"` directive accepts without the `MEEK107` warning. At runtime it returns the same `string`, without copying or checking it: it has no cost.

**`trustHtml` does not sanitize: it only declares.** It does not escape or filter anything. If the HTML may contain user or third-party text, sanitize it first (with [DOMPurify](https://github.com/cure53/DOMPurify), for example) and mark the result. For text, use `{expresión}`, which escapes it.

`TrustedHtml` is a `string` with a brand that only exists in types: it serializes to JSON unchanged and reaches the template with the brand intact from `<script server>` or `load`. Both are imported from `@meekojs/meeko`; they are not auto-imported, so the trust declaration is always a visible import.

## Usage

```ts
// server/content/articles.ts
import { trustHtml } from "@meekojs/meeko";
import type { TrustedHtml } from "@meekojs/meeko";

export interface Article {
  readonly title: string;
  readonly body: TrustedHtml;
}

// `html` sale de nuestro propio renderizador de Markdown.
export function article(title: string, html: string): Article {
  return { title, body: trustHtml(html) };
}
```

```html
<!-- app/pages/blog/[slug].meeko -->
<script server lang="ts">
import { article } from "../../../server/content/articles";

const { params } = usePage();
export const post = article(params.slug, `<p>Entrada <em>${params.slug}</em></p>`);
</script>

<template>
  <h1>{post.title}</h1>
  <div class="prose" html="post.body"></div>
</template>
```

## Parameters

| Parameter | Type     | Default  | Description                                                 |
| --------- | -------- | -------- | ----------------------------------------------------------- |
| `html`    | `string` | required | HTML the code already knows is safe: your own or sanitized. |

## Return value

The same `html`, with type `TrustedHtml`. A `TrustedHtml` can be used where a `string` is expected, but not vice versa: assigning a `string` to `TrustedHtml` is a type error.

## Examples

### User HTML, sanitized at its source

<!-- no-check -->

```ts
// server/content/comments.ts
import DOMPurify from "isomorphic-dompurify";
import { trustHtml } from "@meekojs/meeko";
import type { TrustedHtml } from "@meekojs/meeko";

export function commentHtml(input: string): TrustedHtml {
  return trustHtml(DOMPurify.sanitize(input, { ALLOWED_TAGS: ["p", "b", "i", "a", "ul", "li"] }));
}
```

### An icon in a constant

In `<script>`, an HTML constant reaches the template as `string` and triggers a warning. Mark it or write `as const`:

```html
<script lang="ts">
import { trustHtml } from "@meekojs/meeko";

const star = trustHtml('<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1l2 5h5l-4 3 2 6-5-4-5 4 2-6-4-3h5z"/></svg>');
</script>

<template><span class="icon" html="star"></span> Favorito</template>
```

### Type a component's prop

With `TrustedHtml` in props, the parent cannot pass an unmarked `string`:

```html
<!-- app/components/RichText.meeko -->
<script lang="ts">
import type { TrustedHtml } from "@meekojs/meeko";

const props = defineProps<{ html: TrustedHtml | null }>();
</script>

<template><div class="rich-text" html="props.html"></div></template>
```

## Common mistakes

### An unmarked `string` in `html`

```html bad
<article html="body.value"></article>
```

With `const body = signal("<p>Hola</p>")`, `meeko check` warns with ``MEEK107: `html` inserta HTML sin escapar; un `string` puede venir de un usuario (XSS). Sanéelo y márquelo con `trustHtml(…)`, o use `{expr}`, que escapa.`` This is a warning: it will be an error in `2.0`.

```html good
<script lang="ts">
import { trustHtml } from "@meekojs/meeko";

const body = signal(trustHtml("<p>Hola</p>"));
</script>

<template><article html="body.value"></article></template>
```

### Assign a `string` to `TrustedHtml`

```ts bad
const raw: string = await response.text();
const body: TrustedHtml = raw;
```

`meeko check` reports `TS2322: Type 'string' is not assignable to type 'TrustedHtml'.`

<!-- no-check -->

```ts good
const body: TrustedHtml = trustHtml(DOMPurify.sanitize(await response.text()));
```

### Mark it just before the template

`trustHtml` in the component, applied to external data, removes the warning without making the HTML safer: XSS without any error.

```html bad
<script lang="ts">
import { trustHtml } from "@meekojs/meeko";
const props = defineProps<{ comment: string }>();
const safe = computed(() => trustHtml(props.comment));
</script>
```

```html good
<script lang="ts">
import type { TrustedHtml } from "@meekojs/meeko";
const props = defineProps<{ comment: TrustedHtml }>(); // saneado en el servidor
</script>
```

## Notes

- **Security.** The brand says someone checked the HTML's origin; it does not check it. Put `trustHtml` where HTML originates (your Markdown renderer, sanitizer output) and declare `TrustedHtml` in shared types so the rest of the code cannot mark anything on its own.
- **Serialization.** The brand only exists in types: `TrustedHtml` travels in the payload as a normal `string` and retains the brand in the template.
- **Performance.** Does nothing at runtime: returns the same `string`.
- **Outside the framework.** Both are exported from the root, `@meekojs/meeko`, and work the same in a standalone component.

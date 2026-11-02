---
title: documentHtml
group: utils
since: 1.8.0
description: Makes trusted HTML travel only once on the first load, in the document's HTML and not also in the hydration payload.
symbols:
  - "@meekojs/meeko/framework#documentHtml"
related:
  - "@meekojs/meeko#trustHtml"
  - "syntax:html"
  - "syntax:script-server"
  - docs/api.md#html-que-viaja-una-vez-documenthtml
source-hash: 661503fd930c7809d5c5bad5ec97a1fa3780ed05ecbd66f45b26bbb26addf21e
---

`documentHtml(html)` declares that a `TrustedHtml` only needs to travel once. Without this mark, page data painted with `html="..."` arrives twice on the first load: in the document's HTML and in the hydration payload. In a large article, that is half the weight.

With the mark, the document's payload carries a placeholder instead of the value, and hydration adopts the element's content without reading, comparing or rewriting it. A client navigation still receives the whole value. It is imported from `@meekojs/meeko/framework` and is not an auto-import.

## Usage

```html
<!-- app/pages/guides/[slug].meeko -->
<script server lang="ts">
import { trustHtml } from "@meekojs/meeko";
import { documentHtml } from "@meekojs/meeko/framework";

const { params } = usePage();
export const guide = { body: documentHtml(trustHtml(`<h2>Guide</h2><p>${params.slug}</p>`)) };
</script>

<template>
  <article html="guide.body"></article>
</template>
```

## Parameters

| Parameter | Type          | Default  | Description                                                                                                        |
| --------- | ------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `html`    | `TrustedHtml` | required | HTML already declared trusted with [`trustHtml`](/docs/reference/trusthtml). An unmarked `string` is a type error. |

## Return value

The same `html`, not copied, with the `TrustedHtml` type. On the server, the template and `load` read the real value. Outside a page request it marks nothing.

## Examples

### A list of articles

The mark goes on each value, so it works anywhere in the data, also in a list or in what `load` returns:

```html
<!-- app/pages/news.meeko -->
<script server lang="ts">
import { trustHtml } from "@meekojs/meeko";
import { documentHtml } from "@meekojs/meeko/framework";

export const items = ["<p>First</p>", "<p>Second</p>"].map((body, id) => ({ id, body: documentHtml(trustHtml(body)) }));
</script>

<template>
  <article each:of="items" each:as="item" each:key="item.id" html="item.body"></article>
</template>
```

### An element that closes and opens

If the page paints the element again, the browser requests the value from the server with a navigation request for that URL and inserts it on arrival. Until then, the element stays empty. The first line of a `stream` route is already enough: it does not wait for its deferred values and cancels the rest of the response:

```html
<!-- app/pages/faq.meeko -->
<script server lang="ts">
import { trustHtml } from "@meekojs/meeko";
import { documentHtml } from "@meekojs/meeko/framework";

export const answer = documentHtml(trustHtml("<p>A long answer.</p>"));
</script>

<script lang="ts">
const open = signal(true);
</script>

<template>
  <button type="button" on:click="() => open.value = !open.value">Answer</button>
  <div if:when="open.value" html="answer"></div>
</template>
```

## Common mistakes

### Reading the value outside `html`

In the browser, during that first load, the value is the placeholder, an HTML comment:

```html bad
<script server lang="ts">
import { trustHtml } from "@meekojs/meeko";
import { documentHtml } from "@meekojs/meeko/framework";

export const body = documentHtml(trustHtml("<p>Hello</p>"));
</script>

<template>
  <article html="body"></article>
  <p>{body.length} characters</p>
</template>
```

The server paints the real length and the browser the placeholder's. If anything else reads the value, do not mark it:

```html good
<script server lang="ts">
import { trustHtml } from "@meekojs/meeko";

export const body = trustHtml("<p>Hello</p>");
</script>

<template>
  <article html="body"></article>
  <p>{body.length} characters</p>
</template>
```

### Marking an undeclared `string`

```ts bad
import { documentHtml } from "@meekojs/meeko/framework";

export const body = documentHtml("<p>Hello</p>");
```

`TS2345: Argument of type 'string' is not assignable to parameter of type 'TrustedHtml'.` The mark does not replace the trust declaration:

```ts good
import { trustHtml } from "@meekojs/meeko";
import { documentHtml } from "@meekojs/meeko/framework";

export const body = documentHtml(trustHtml("<p>Hello</p>"));
```

## Notes

- **When it travels whole.** If `html` did not paint it in the document, as inside a closed `if:`, or if SSR left any of its elements empty because the browser would move its content out (a `<div>` in a `<p>`), the value stays in the payload, even if another element shows it. An empty value is not replaced either.
- **By content.** The mark follows the text, because a `string` has no identity: any other page data with exactly the same text also travels as a placeholder. Do not mark a small value that may repeat in other data.
- **Security.** The DOM is never the source of HTML: the browser does not read the element's content to paint it again, it only requests it from the server. And it only inserts a value that that same response declares marked with `documentHtml`, in `markedHtml`, and whose hash matches the one the document wrote: neither an old position nor another route turns text into HTML. A value imitating the placeholder is a comment with no effect or, at most, names HTML the server declares marked.
- **If the value moves.** It is recognized by the hash of its content, so in a reordered list each element recovers its own article.
- **If the value is gone.** If other content was published, it was removed, or the URL redirects, answers another route, a `401`, `403`, `404` or `410`, or the document instead of the payload, nothing is inserted and the document loads again: the current page appears, or the server's destination, and that page's client state is lost. That reload happens at most once per minute and URL. If it is not enough, or `sessionStorage` is unavailable, the element stays empty and the error reaches `onNavigationError` or `onError`. A network failure or a `5xx` does not reload: it reports the error and the element's next render tries again.
- **A value that differs in every request.** A date or a random identifier inside the HTML means the value never matches, and painting the element again ends as in the previous case. If the page paints that element again, do not mark it. On a prerendered page, the document and the file come from two runs of the loader, so they must also give the same HTML.
- **Prerender and static hosts.** The `index.meeko.json` file stores the whole value and its declaration; the document, the placeholder.
- **Cache.** The document and its payload are a single response. An old cached document shows its content and hydrates the same, and the next navigation receives the latest published content. If that page paints the element again, the document loads again.
- **CSP.** It adds no inline code: the payload is still a data block, and `script-src` does not need `unsafe-inline`.

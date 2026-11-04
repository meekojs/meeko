---
title: useHead
group: composables
since: 1.2.0
description: Adds title, meta, link, script and style tags and html and body attributes to the document while the component is mounted.
symbols:
  - "@meekojs/meeko/framework#useHead"
types:
  - "@meekojs/meeko/framework#HeadInput"
related:
  - "@meekojs/meeko/framework#useSeoMeta"
  - "@meekojs/meeko/framework#definePage"
  - "syntax:script-server"
  - "config:document"
  - docs/framework.md#head-del-documento-document-usehead-y-useseometa
  - docs/framework.md#canónica-y-open-graph-por-página
source-hash: d09b03d2768b8231bc6f831503fbfa4bb91c4e1a0fbeca8f8f1d9f4e39f0f4e2
---

`useHead(input)` declares a component's contribution to `<head>`: the title, `<meta>`, `<link>`, `<script>` and `<style>` tags, and `<html>` and `<body>` attributes. Meeko combines entries from `document` in `meeko.config.ts`, `app/app.meeko`, layouts, the page and its components, and the route's `head` under one priority rule, and removes a component's entries when it unmounts.

On the server it writes them to HTML; in the browser, hydration adopts those same tags without duplicating them, and a getter or signal updates the document on change. It is auto-imported in applications.

## Usage

```html
<!-- app/pages/inbox.meeko -->
<script lang="ts">
const unread = signal(3);
useHead(() => ({
  title: unread.value ? `(${unread.value}) Inbox` : "Inbox",
  meta: [{ name: "robots", content: "noindex" }],
}));
</script>

<template><button on:click="() => unread.value = 0">Mark as read</button></template>
```

Clicking the button changes the document title without reloading.

## Parameters

| Parameter | Type                                                          | Default  | Description                                                                                                       |
| --------- | ------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `input`   | `HeadInput`, `ReadonlySignal<HeadInput>` or `() => HeadInput` | required | The component's contribution. With a getter or signal, the browser reapplies it when the signals it reads change. |

`HeadInput` accepts:

| Field                    | Type                                  | Description                                                                                                                                                                                                                              |
| ------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`                  | `string`                              | Document title. Highest priority wins.                                                                                                                                                                                                   |
| `titleTemplate`          | `string` or `(title) => string`       | Title template: `"%s · Mi sitio"`. Only a string in `document.head`, `meeko.addHead` and the route's `head`.                                                                                                                             |
| `meta`                   | `HeadMeta[]`                          | `{ name?, property?, httpEquiv?, content, media?, key? }`.                                                                                                                                                                               |
| `link`                   | `HeadLink[]`                          | `{ rel, href, hreflang?, type?, media?, sizes?, as?, crossorigin?, key? }`.                                                                                                                                                              |
| `script`                 | `HeadScript[]`                        | External with `src` or inline with `children`; `async`, `defer`, `module`, `type`.                                                                                                                                                       |
| `style`                  | `HeadStyle[]`                         | `{ children, media?, key? }`.                                                                                                                                                                                                            |
| `htmlAttrs`, `bodyAttrs` | `Record<string, string \| undefined>` | `<html>` and `<body>` attributes (`lang`, `dir`, `class`, `data-*`). `undefined` contributes nothing; `on*` attributes are rejected at runtime and, since `1.7`, DOM event attributes (`onclick`, `onload`…) are also rejected by types. |

## Return value

`void`. Outside a Meeko application (for example, in a unit test with `renderToString`), it does nothing.

## Examples

### A reactive title from page data

```html
<!-- app/pages/products/[id].meeko -->
<script server lang="ts">
const { params } = usePage();
export const product = await findProduct(params.id);
</script>

<script lang="ts">
const quantity = signal(1);
useHead(() => ({ title: `${product.name} (${quantity.value})` }));
</script>
```

### Structured data for search engines

An inline `application/ld+json` script; Meeko escapes every `<` so content cannot close the tag:

```html
<script lang="ts">
const props = defineProps<{ data: { title: string; author: string; publishedAt: string } }>();
useHead(() => ({
  script: [{
    type: "application/ld+json",
    children: JSON.stringify({ "@context": "https://schema.org", "@type": "Article", headline: props.data.title, author: props.data.author, datePublished: props.data.publishedAt }),
  }],
}));
</script>
```

### `<html>` and `<body>` attributes from a layout

```html
<!-- app/layouts/docs.meeko -->
<script lang="ts">
const sidebarOpen = signal(false);
useHead(() => ({
  htmlAttrs: { lang: "es", class: "docs" },
  bodyAttrs: { "data-sidebar": sidebarOpen.value ? "open" : undefined },
}));
</script>

<template><main><MeekoOutlet /></main></template>
```

### A reusable head composable

`useHead` can be called inside a composable invoked by the script:

```ts
// app/composables/useNoIndex.ts
import { useHead } from "@meekojs/meeko/framework";

export function useNoIndex(): void {
  useHead({ meta: [{ name: "robots", content: "noindex, nofollow", key: "robots" }] });
}
```

### In `<script server>`

In top-level server block code, `useHead` becomes part of the route's `head`, the highest-priority entry:

```html
<script server lang="ts">
const { params } = usePage();
const post = await posts.find(params.slug);
useHead({ title: post.title, link: [{ rel: "canonical", href: `https://example.com/blog/${post.slug}` }] });
export const body = post.html;
</script>
```

## Common mistakes

### An object that reads signals only once

```ts bad
const count = signal(0);
useHead({ title: `${count.value} elementos` });
```

`meeko check` accepts this, but the title is calculated once when the script runs: changing `count` does not update it. Pass a getter so the title tracks the signal:

<!-- no-check -->

```ts good
useHead(() => ({ title: `${count.value} elementos` }));
```

### A `meta` tag without `content`

```ts bad
useHead({ meta: [{ name: "description" }] });
```

`meeko check` reports `TS2741: Property 'content' is missing in type '{ name: string; }' but required in type 'HeadMeta'`. A description is shorter with [`useSeoMeta`](/en/docs/reference/useseometa):

<!-- no-check -->

```ts good
useHead({ meta: [{ name: "description", content: "Plans and pricing" }] });
```

### Event handlers in attributes

```ts bad
useHead({ bodyAttrs: { onload: "init()" } });
```

Since `1.7`, `meeko check` reports `TS2322: Type 'string' is not assignable to type 'never'.` for DOM event handlers (`onload`, `onclick`…). Any other `on*` attribute (`onLoad`, `onmievento`) passes types, but Meeko rejects it at runtime: `TypeError: useHead.bodyAttrs: event handler attribute onLoad is not allowed`. Put code in the component script:

<!-- no-check -->

```ts good
onMounted(() => init());
```

### A function in configuration's `titleTemplate`

`document` in `meeko.config.ts` is fixed as JSON during the build.

```ts bad
export default defineMeekoConfig({ document: { head: { titleTemplate: (title) => `${title} · Mi sitio` } } });
```

`meeko check` reports `TS2322: Type '(title: string) => string' is not assignable to type 'string'` in `meeko.config.ts`, because `DocumentHead` only accepts a string. Use `%s`, or put the function in a `useHead` in `app/app.meeko`:

<!-- no-check -->

```ts good
export default defineMeekoConfig({ document: { head: { titleTemplate: "%s · Mi sitio" } } });
```

## Notes

- **Priority.** Lowest to highest: configuration's `document`, `app/app.meeko`, each layout (innermost wins), the page with its components and the route's `head` (`export const head`, `route.head` or `useHead` in `<script server>`). Within one level, the later call wins. `<html>` and `<body>` attributes merge by name with the same priority.
- **Deduplication.** Each tag has a key: explicit `key` or its natural key (`name`, `property` or `httpEquiv` in `meta`, with its `media`; `rel` and `href` in `link`, except `canonical` and `icon`, which are unique; `src` or code in `script`; CSS in `style`). For the same key, only the highest-priority entry remains.
- **SSR.** Managed tags go in `<head>` between `<!--meeko:head-->` and `<!--/meeko:head-->`, with escaped attributes and the request's CSP nonce on `<script>` and `<style>`.
- **Navigation.** On navigation, unmounted components' entries disappear and what they replaced returns; going back restores the page's entries. A changed script becomes a new element, executed by the browser.
- **Security.** Inline `script` and `style` content is not escaped as HTML: do not put unvalidated user text there. Attribute values are escaped.
- **Dry run.** In a client navigation's preliminary render, `useHead` does nothing; the committed render applies it.

---
title: useSeoMeta
group: composables
since: 1.2.0
description: Typed useHead shortcut for SEO that converts each field (description, Open Graph, Twitter, canonical) to the correct tag.
symbols:
  - "@meekojs/meeko/framework#useSeoMeta"
types:
  - "@meekojs/meeko/framework#SeoMetaInput"
related:
  - "@meekojs/meeko/framework#useHead"
  - "@meekojs/meeko/framework#definePage"
  - "config:document"
  - "config:site"
  - docs/framework.md#head-del-documento-document-usehead-y-useseometa
  - docs/framework.md#canónica-y-open-graph-por-página
source-hash: 9f9667ff4bfe0fd2f4f74abceb218f87733cdadf3827aeb0fae8b16e9af6739f
---

SEO tags have rules that are easy to confuse: `description` and Twitter tags use `<meta name>`, Open Graph tags use `<meta property>`, and the canonical URL is a `<link rel="canonical">`. `useSeoMeta(input)` takes a plain object with one field per tag and produces the correct one for each. Underneath it is [`useHead`](/en/docs/reference/usehead): you call it in the same places, it follows the same priority and deduplication rules, and it accepts a getter or signal so tags follow the data.

It is auto-imported in applications.

## Usage

```html
<!-- app/pages/blog/[slug].meeko -->
<script server lang="ts">
const { params } = usePage();
export const post = await posts.find(params.slug);
</script>

<script lang="ts">
useSeoMeta({
  title: post.title,
  description: post.summary,
  ogImage: post.cover,
  twitterCard: "summary_large_image",
  canonical: `https://example.com/blog/${post.slug}`,
});
</script>

<template><article><h1>{post.title}</h1></article></template>
```

## Parameters

| Parameter | Type                                                                   | Default  | Description                                                  |
| --------- | ---------------------------------------------------------------------- | -------- | ------------------------------------------------------------ |
| `input`   | `SeoMetaInput`, `ReadonlySignal<SeoMetaInput>` or `() => SeoMetaInput` | required | SEO fields. An `undefined` or `null` field produces nothing. |

| Field                                                                                                                                                                                 | Tag                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `title`                                                                                                                                                                               | `<title>`                                                             |
| `description`, `robots`, `author`, `keywords`, `themeColor`, `colorScheme`, `applicationName`, `referrer`                                                                             | `<meta name="…">` (`theme-color`, `color-scheme`, `application-name`) |
| `ogTitle`, `ogDescription`, `ogImage`, `ogImageAlt`, `ogImageWidth`, `ogImageHeight`, `ogUrl`, `ogType`, `ogSiteName`, `ogLocale`                                                     | `<meta property="og:…">` (`og:image:alt`, `og:site_name`…)            |
| `twitterCard` (`"summary"`, `"summary_large_image"`, `"app"` or `"player"`), `twitterSite`, `twitterCreator`, `twitterTitle`, `twitterDescription`, `twitterImage`, `twitterImageAlt` | `<meta name="twitter:…">`                                             |
| `canonical`                                                                                                                                                                           | `<link rel="canonical">`                                              |

`ogImageWidth` and `ogImageHeight` accept numbers; all other fields accept strings.

## Return value

`void`. Outside a Meeko application, it does nothing. Inside one, a field not in the list throws `TypeError: useSeoMeta: unknown field <nombre>` when applying tags.

## Examples

### Tags for a product page

```html
<script lang="ts">
const props = defineProps<{ data: { name: string; summary: string; image: string; price: number } }>();
useSeoMeta(() => ({
  title: props.data.name,
  description: props.data.summary,
  ogTitle: props.data.name,
  ogType: "product",
  ogImage: props.data.image,
  ogImageAlt: `Foto de ${props.data.name}`,
  ogImageWidth: 1200,
  ogImageHeight: 630,
}));
</script>
```

With a getter, tags change when navigating to another product even if the component is preserved.

### A page that is not indexed

```ts
import { useSeoMeta } from "@meekojs/meeko/framework";

// En el <script> de app/pages/account/settings.meeko
useSeoMeta({ robots: "noindex, nofollow" });
```

### Automatic canonical and Open Graph tags

To avoid repeating `canonical`, `ogUrl`, `ogTitle` and `ogDescription` on every page, `document.seo` derives them from the final URL, title and description:

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  site: "https://example.com",
  document: { seo: true, head: { titleTemplate: "%s · Mi sitio" } },
});
```

A page declaring the same tag with `useSeoMeta` overrides the derived one.

## Common mistakes

### A misspelled field

```ts bad
useSeoMeta({ title: "Precios", ogimage: "/og/pricing.png" });
```

`meeko check` reports `TS2353: Object literal may only specify known properties, and 'ogimage' does not exist in type 'HeadSource<SeoMetaInput>'` and, at runtime, `TypeError: useSeoMeta: unknown field ogimage`.

<!-- no-check -->

```ts good
useSeoMeta({ title: "Precios", ogImage: "/og/pricing.png" });
```

### A `twitterCard` that does not exist

```ts bad
useSeoMeta({ twitterCard: "large" });
```

`meeko check` reports `TS2322: Type '"large"' is not assignable to type '"app" | "player" | "summary" | "summary_large_image" | null | undefined'`.

<!-- no-check -->

```ts good
useSeoMeta({ twitterCard: "summary_large_image" });
```

### An object with changing data

```ts bad
useSeoMeta({ title: props.data.name });
```

The title is fixed to the value at that moment: if the layout or page is preserved on navigation and the prop changes, the tag keeps the previous product. Pass a getter:

<!-- no-check -->

```ts good
useSeoMeta(() => ({ title: props.data.name }));
```

### A relative URL in `ogImage` or `canonical`

```ts bad
useSeoMeta({ ogImage: "/og/home.png", canonical: "/" });
```

There is no error, but search engines and social networks expect absolute URLs in `og:image` and the canonical tag. Use the site's public origin, or `document.seo` for the canonical URL:

<!-- no-check -->

```ts good
useSeoMeta({ ogImage: "https://example.com/og/home.png", canonical: "https://example.com/" });
```

## Notes

- **SSR.** Tags appear in the server HTML, which search engines and social previews read. Calculate them from data SSR already has: `<script server>`, `load`, props or an `await useApi`.
- **Priority.** The same as `useHead`: route `head` takes precedence over the page, the page over layouts, and layouts over `document`. Within a level, the later call wins.
- **Page `description`.** If route `head` (`export const head` or `route.head`) already declares `description`, it takes precedence over the component's `useSeoMeta` description.
- **Escaping.** Values go into attributes and Meeko escapes them: a title with quotes or `<` is safe.

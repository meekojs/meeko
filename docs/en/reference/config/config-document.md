---
title: document
group: config
since: 1.2.0
description: The application's shared HTML document, with html lang, head tags for all pages, per-page canonical and Open Graph tags and the useId prefix.
symbols:
  - "config:document"
types:
  - "@meekojs/meeko/framework#DocumentConfig"
  - "@meekojs/meeko/framework#DocumentSeo"
related:
  - "@meekojs/meeko/framework#useHead"
  - "@meekojs/meeko/framework#useSeoMeta"
  - "@meekojs/meeko#useId"
  - "config:site"
  - "config:theme"
  - docs/framework.md#head-del-documento-document-usehead-y-useseometa
  - docs/framework.md#canónica-y-open-graph-por-página
source-hash: b47d0409c13cddae1a3b3a4c7b1e699fea41915a1ccea8978c99ddacbd18d4a2
---

`document` declares what all application HTML documents share: `<html>`'s `lang` and a `head` with a title, title template, `meta`, `link`, `script`, `style` and `<html>` and `<body>` attributes. It renders in SSR, `"stream"`, `"prerender"`, error pages and the shell for `"client"` routes, with the lowest priority: `useHead`, `useSeoMeta` and each page's `head` override it.

In addition, `document.seo` (since `1.3`) adds each page's `<link rel="canonical">` and its `og:url`, `og:title` and `og:description`, and `document.idPrefix` (since `1.5`) changes the prefix of IDs from `useId` and `form.field`.

## Usage

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  site: "https://example.com",
  document: {
    lang: "es",
    head: {
      title: "Mi tienda",            // páginas sin título propio
      titleTemplate: "%s · Mi tienda",
      link: [{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }],
      meta: [{ name: "theme-color", content: "#0f172a" }],
    },
    seo: true,
  },
});
```

## Options

| Option     | Type                     | Default | Description                                                                                                                                    |
| ---------- | ------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `lang`     | `string`                 | none    | `<html>`'s `lang` attribute; `head.htmlAttrs.lang` takes priority.                                                                             |
| `head`     | `DocumentHead`           | none    | `title`, `titleTemplate` (a string with `%s`), `meta`, `link`, `script`, `style`, `htmlAttrs` and `bodyAttrs`. Must be serializable.           |
| `seo`      | `boolean \| DocumentSeo` | none    | Since `1.3`. `true` enables `canonical`, `ogUrl`, `ogTitle` and `ogDescription`; an object disables those set to `false` and can set `origin`. |
| `idPrefix` | `string`                 | `"m"`   | Since `1.5`. Prefix for `useId` and `form.field`: a letter followed by letters, numbers, `-` or `_`, up to 32 characters.                      |

## Result

| Source                                         | Priority                                            |
| ---------------------------------------------- | --------------------------------------------------- |
| Modules' `document.head` (`meeko.addHead`)     | Lowest                                              |
| `document.head` from `meeko.config.ts`         | Overrides modules                                   |
| `document.seo`                                 | Tags derived from each page, with the same priority |
| `useHead`, `useSeoMeta` and the route's `head` | Override everything above                           |

With `seo: true` and `site: "https://example.com"`, a `/docs/api` page titled “API” receives:

```html
<title>API · Mi tienda</title>
<link rel="canonical" href="https://example.com/docs/api">
<meta property="og:url" content="https://example.com/docs/api">
<meta property="og:title" content="API · Mi tienda">
```

`canonical` does not include the query string, and error pages receive neither `canonical` nor `og:url`.

## Examples

### A script before rendering, compatible with CSP

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  document: {
    head: { script: [{ children: "document.documentElement.dataset.js = 'on'" }] },
  },
});
```

With `server.contentSecurityPolicy` (since `1.7`), the script carries each SSR response's nonce and its hash in prerendered pages, without `'unsafe-inline'`.

### Only the canonical tag

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  site: "https://example.com",
  document: { seo: { ogUrl: false, ogTitle: false, ogDescription: false } },
});
```

### Two Meeko applications on the same page

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ document: { idPrefix: "shop" } });
```

## Common mistakes

### A function in `titleTemplate`

```ts bad
export default defineMeekoConfig({ document: { head: { titleTemplate: (title: string) => `${title} · Mi tienda` } } as never });
```

`document` is fixed at build time and ends up in HTML: `meeko check` reports a type error and `meeko dev`, `meeko build` and `meeko routes` stop with `…/meeko.config.ts: document.head: titleTemplate must be a string here, since it is serialized`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ document: { head: { titleTemplate: "%s · Mi tienda" } } });
```

### The theme inside `document`

```ts bad
export default defineMeekoConfig({ document: { theme: { themes: ["light", "dark"] } } as never });
```

`…/meeko.config.ts: document.theme no es una opción de meeko.config.ts; use theme en el nivel superior`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ theme: { themes: ["light", "dark"] } });
```

### `seo` without an origin

```ts bad
export default defineMeekoConfig({ document: { seo: true } }); // sin site ni MEEKO_PUBLIC_ORIGIN
```

`meeko build` stops before compilation with `document.seo (canonical y og:url) necesita la URL pública del sitio: declara site en meeko.config.ts (site: "https://example.com") o define MEEKO_PUBLIC_ORIGIN al construir`. In `meeko dev` without an origin, those two tags are not written.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ site: "https://example.com", document: { seo: true } });
```

## Notes

- **Public.** `document` reaches the browser bundle because it ends up in HTML: do not put secrets in it.
- **Security.** `script` and `style` are written as is in `<head>`: do not interpolate user or request data.
- **Development.** Changing `meeko.config.ts` requires restarting `meeko dev`.

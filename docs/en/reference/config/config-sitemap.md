---
title: sitemap
group: config
since: 1.3.0
description: Writes sitemap.xml during the build with prerendered pages, routes without parameters and, since 1.7, sitemapEntries URLs from dynamic routes.
symbols:
  - "config:sitemap"
types:
  - "@meekojs/meeko/framework#SitemapConfig"
  - "@meekojs/meeko/framework#SitemapEntry"
  - "@meekojs/meeko/framework#SitemapEntriesContext"
related:
  - "config:site"
  - "config:robots"
  - "@meekojs/meeko/framework#definePage"
  - docs/framework.md#sitemapxml-y-robotstxt
  - docs/framework.md#rutas-dinámicas-en-el-sitemap-sitemapentries
source-hash: 620db12310f4c4451787b0da962336c73b43c80c1bb5f00441e93f07972ab3a0
---

`sitemap` makes `meeko build` write `sitemap.xml` (sitemaps.org protocol 0.9) with the absolute URL of each prerendered page and each route without parameters, whether `"ssr"`, `"stream"` or `"client"`. Routes in `exclude` and prerendered pages with `<meta name="robots" content="noindex">` (or `none`) are omitted.

Since `1.7`, a dynamic route rendered on the server declares its URLs through `sitemapEntries` in `definePage`, with optional `lastmod`, `changefreq` and `priority`. URLs require the public origin: `site` or the build's `MEEKO_PUBLIC_ORIGIN`.

## Usage

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  site: "https://example.com",
  sitemap: { exclude: ["/admin", "/admin/*"] }, // o sitemap: true
});
```

## Options

| Value     | Type                      | Default    | Description                                                                                                                                                                          |
| --------- | ------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sitemap` | `boolean \| { exclude? }` | no sitemap | `true` or an object enables it.                                                                                                                                                      |
| `exclude` | `readonly string[]`       | `[]`       | Paths (`pathname`) not listed. Start with `/`, without spaces, `?` or `#`; `*` replaces any sequence, including `/`: `"/admin/*"` excludes everything under `/admin/`, not `/admin`. |

`definePage`'s `sitemapEntries` (since `1.7`): a list of `{ params?, lastmod?, changefreq?, priority? }`, or a synchronous or asynchronous function receiving `{ env, prerendering: true }` and returning it.

## Result

`sitemap.xml` in the build's public files, served like the others in Node, Bun, Deno and Workers, and written to the `static` adapter's folder:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/docs/instalacion</loc><lastmod>2026-10-01</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>
</urlset>
```

## Examples

### Dynamic routes with SSR (since 1.7)

```ts
// app/pages/docs/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";

const docs = [{ slug: "instalacion", updatedAt: "2026-10-01", draft: false }];

export const route = definePage({
  sitemapEntries: ({ env }) => docs
    .filter((doc) => env.DOCS_DRAFTS === "1" || !doc.draft)
    .map((doc) => ({ params: { slug: doc.slug }, lastmod: doc.updatedAt, changefreq: "weekly" as const })),
});
```

`meeko build` evaluates it once, after prerendering, in the intermediate Node server: the runtime exists with `prerendering: true`, but there is no request, session or per-request `services`.

### Complete prerendered pages

```ts
// app/pages/blog/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({
  render: "prerender",
  prerenderEntries: [{ slug: "hola-meeko" }],
  sitemapEntries: [{ params: { slug: "hola-meeko" }, lastmod: new Date("2026-09-15"), priority: 0.6 }],
});
```

With `"prerender"`, `sitemapEntries` only adds `lastmod`, `changefreq` and `priority` to URLs already being prerendered.

### Alongside `robots.txt`

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ site: "https://example.com", sitemap: true, robots: { disallow: ["/admin/"] } });
// robots.txt termina con «Sitemap: https://example.com/sitemap.xml»
```

## Common mistakes

### No public origin

```text bad
sitemap: true, sin site ni MEEKO_PUBLIC_ORIGIN al construir
```

`meeko build` stops before compilation with `sitemap necesita la URL pública del sitio: declara site en meeko.config.ts (site: "https://example.com") o define MEEKO_PUBLIC_ORIGIN al construir`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ site: "https://example.com", sitemap: true });
```

### A pattern without a leading `/`

```ts bad
export default defineMeekoConfig({ site: "https://example.com", sitemap: { exclude: ["admin"] } });
```

`meeko dev`, `meeko build`, `meeko check` and `meeko routes` stop with `…/meeko.config.ts: sitemap.exclude debe ser un array de cadenas no vacías que empiecen por /`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ site: "https://example.com", sitemap: { exclude: ["/admin", "/admin/*"] } });
```

### A `public/sitemap.xml` (or one from a module)

```text bad
public/sitemap.xml   y   sitemap: true
```

`meeko build` stops with `El archivo público sitemap.xml (de public/ o de un módulo) choca con el que genera la opción sitemap de meeko.config.ts; quita uno de los dos`.

```text good
Borre public/sitemap.xml, o quite sitemap de meeko.config.ts
```

### An entry that is not prerendered

```ts bad
export const route = definePage({
  render: "prerender",
  prerenderEntries: [{ slug: "a" }],
  sitemapEntries: [{ params: { slug: "b" } }],
});
```

`meeko build` stops with `sitemapEntries of route /blog/[slug] lists /blog/b, which is not prerendered: add it to prerenderEntries or remove it`: the sitemap never advertises a URL the `static` adapter does not have.

<!-- no-check -->

```ts good
export const route = definePage({ render: "prerender", prerenderEntries: [{ slug: "a" }, { slug: "b" }], sitemapEntries: [{ params: { slug: "b" } }] });
```

### Values outside the protocol

```ts bad
sitemapEntries: [{ params: { slug: "a" }, priority: 2, changefreq: "sometimes" as never }],
```

The build stops with the route and `priority must be a number from 0 to 1` or `changefreq must be always, hourly, daily, weekly, monthly, yearly or never`. A `lastmod` that is neither a valid `Date` nor W3C Datetime text gives `lastmod must be a Date or a W3C Datetime text, such as "2026-10-01" or "2026-10-01T12:00:00Z"`, and a repeated URL gives `duplicate sitemap URL`.

<!-- no-check -->

```ts good
sitemapEntries: [{ params: { slug: "a" }, priority: 0.8, changefreq: "monthly", lastmod: "2026-10-01" }],
```

## Notes

- **`render: "client"`.** Its options reach the browser, so it does not accept `sitemapEntries`: this is a type error and stops `meeko dev`, `meeko build` and `meeko check`.
- **Spread.** Meeko only loads options from routes naming `sitemapEntries`: write it in the `definePage` object, not through a spread.
- **Data.** The function runs at build time: if it reads a database, it must be accessible during the build. It never receives request data.
- **`exclude` and `noindex` override** `sitemapEntries`.
- **Cost.** In Node, the sitemap requires compiling the server once more, because it lists prerendered pages.

---
title: site
group: config
since: 1.3.0
description: The site's public URL, of which only the origin is used, for absolute URLs in sitemap.xml, robots.txt and document.seo.
symbols:
  - "config:site"
related:
  - "config:sitemap"
  - "config:robots"
  - "config:document"
  - docs/framework.md#sitemapxml-y-robotstxt
  - docs/framework.md#canónica-y-open-graph-por-página
source-hash: fe3ca4e7be84105e463dc92623c1868224451e93925b1aa6b10e10b4c3dffa22
---

`site` is the site's public origin (`"https://example.com"`, without a path). It is the origin for absolute URLs Meeko writes during the build: those in `sitemap.xml`, the `Sitemap:` line in `robots.txt` and, with `document.seo`, `<link rel="canonical">` and `og:url`. Without `site`, the build uses `MEEKO_PUBLIC_ORIGIN` from its environment.

`site` is set at build time and does not change HTTP and Socket `Origin` checks: those still read `MEEKO_PUBLIC_ORIGIN` or `publicOrigin` from `server/runtime.ts` at runtime.

## Usage

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  site: "https://example.com",
  sitemap: true,
  robots: true,
  document: { seo: true },
});
```

## Options

| Value  | Type     | Default                       | Description                                                                         |
| ------ | -------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| `site` | `string` | Build's `MEEKO_PUBLIC_ORIGIN` | An absolute `http:` or `https:` URL without a path, query, fragment or credentials. |

## Result

With `site: "https://example.com"`:

```xml
<!-- sitemap.xml -->
<url><loc>https://example.com/docs/api</loc></url>
```

```text
# robots.txt
User-agent: *
Allow: /
Sitemap: https://example.com/sitemap.xml
```

```html
<!-- /docs/api with document.seo -->
<link rel="canonical" href="https://example.com/docs/api">
```

## Examples

### One origin per environment

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  site: process.env.SITE_URL ?? "https://example.com",
  sitemap: true,
});
```

```sh
SITE_URL=https://staging.example.com npm run build
```

### Without `site`, using the build variable

```sh
MEEKO_PUBLIC_ORIGIN=https://example.com npx meeko build
```

The same variable later sets the origin for `Origin` checks in production.

## Common mistakes

### A URL with a path

```ts bad
export default defineMeekoConfig({ site: "https://example.com/blog" });
```

`meeko dev`, `meeko build`, `meeko check` and `meeko routes` stop with `…/meeko.config.ts: site must be an origin without path, query, fragment or credentials, such as "https://example.com"`. Hosting a site under a subpath is not supported.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ site: "https://example.com" });
```

### A domain without a scheme

```ts bad
export default defineMeekoConfig({ site: "example.com" });
```

`…/meeko.config.ts: site must be an absolute URL such as "https://example.com"`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ site: "https://example.com" });
```

### Expect `site` to fix `Origin` checks

```text bad
site: "https://example.com" and the application behind a TLS proxy, without MEEKO_PUBLIC_ORIGIN at runtime
```

Mutations (with a session and, since `1.8`, also without one) respond with `403 INVALID_ORIGIN`: `site` is only used during the build. The origin for security checks is set at runtime.

```text good
MEEKO_PUBLIC_ORIGIN=https://example.com when starting the server
```

## Notes

- **Build only.** Changing `site` requires rebuilding; it is not read in production.
- **No origin.** With `sitemap`, or with `document.seo` and `canonical` or `ogUrl`, and without `site` or `MEEKO_PUBLIC_ORIGIN`, `meeko build` stops before compiling; `robots` without `sitemap` does not need it.

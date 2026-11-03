---
title: robots
group: config
since: 1.3.0
description: Writes robots.txt during the build with User-agent wildcard rules and, with sitemap, the absolute sitemap URL.
symbols:
  - "config:robots"
types:
  - "@meekojs/meeko/framework#RobotsConfig"
related:
  - "config:sitemap"
  - "config:site"
  - docs/framework.md#sitemapxml-y-robotstxt
source-hash: 7b7a1bfcd1efef083a9e54f94b177669366f1483bb740664ad5ece7835f87e07
---

`robots` makes `meeko build` write `robots.txt` with rules for `User-agent: *`: its `allow` and `disallow` entries (`Allow: /` if none are set) and, if `sitemap` is enabled, a `Sitemap:` line with its absolute URL. It works with all adapters: on Node, Bun, Deno and Workers it is served like any other public file, with an `ETag`.

## Usage

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  site: "https://example.com",
  sitemap: true,
  robots: { disallow: ["/admin/"] }, // or robots: true
});
```

## Options

| Option     | Type                | Default                           | Description                        |
| ---------- | ------------------- | --------------------------------- | ---------------------------------- |
| `allow`    | `readonly string[]` | `["/"]` if there is no `disallow` | Allowed prefixes (`Allow:`).       |
| `disallow` | `readonly string[]` | `[]`                              | Disallowed prefixes (`Disallow:`). |

Each entry starts with `/`, with no spaces, `?` or `#`. `robots: true` is equivalent to `{}`.

## Result

```text
User-agent: *
Disallow: /admin/
Sitemap: https://example.com/sitemap.xml
```

With `robots: true` and no `sitemap`:

```text
User-agent: *
Allow: /
```

## Examples

### A test environment that is not indexed

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

const staging = process.env.DEPLOY_ENV === "staging";
export default defineMeekoConfig({
  robots: staging ? { disallow: ["/"] } : true,
});
```

### Allowing a folder inside a disallowed one

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ robots: { disallow: ["/cuenta/"], allow: ["/cuenta/ayuda/"] } });
```

## Common mistakes

### A misspelled field

```ts bad
export default defineMeekoConfig({ robots: { disalow: ["/admin/"] } as never });
```

`meeko dev`, `meeko build`, `meeko check` and `meeko routes` stop with `…/meeko.config.ts: robots: campo desconocido disalow`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ robots: { disallow: ["/admin/"] } });
```

### A path without a leading `/`

```ts bad
export default defineMeekoConfig({ robots: { disallow: ["admin"] } });
```

`…/meeko.config.ts: robots.disallow debe ser un array de cadenas no vacías que empiecen por /`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ robots: { disallow: ["/admin"] } });
```

### A `public/robots.txt`

```text bad
public/robots.txt   and   robots: true
```

`meeko build` stops with `El archivo público robots.txt (de public/ o de un módulo) choca con el que genera la opción robots de meeko.config.ts; quita uno de los dos`.

```text good
Delete public/robots.txt and declare its rules in robots
```

## Notes

- **Not security.** `Disallow` is a request to crawlers, not protection: protect `/admin` with a session and server middleware.
- **Origin.** `robots` without `sitemap` does not need `site`.
- **Specific pages.** To prevent a page from being indexed, use `<meta name="robots" content="noindex">` with `useSeoMeta`; if it is prerendered, it is also excluded from the sitemap.

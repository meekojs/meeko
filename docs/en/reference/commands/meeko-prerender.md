---
title: meeko prerender
group: commands
since: 1.0.0
description: Prerenders render "prerender" routes again using the existing Node build, without recompiling, and writes .meeko/output/node/prerender/.
symbols:
  - "cli:prerender"
related:
  - "cli:build"
  - "@meekojs/meeko/build#prerenderRoutes"
  - "@meekojs/meeko/framework#definePage"
  - docs/framework.md#modos-de-render
source-hash: 190de89050f6fac597ed5694e0f922919ffdf7b569fcf9a88c3724366b7a6fec
---

`meeko prerender` imports the server from `.meeko/output/node/index.mjs`, creates it with `prerendering: true` and renders each URL of `render: "prerender"` routes (using `prerenderEntries` for dynamic routes). It deletes and rewrites `.meeko/output/node/prerender/`: each page's HTML, its navigation payload (`index.meeko.json`) and the `manifest.json` index. It prints the path of each HTML file written.

[`meeko build`](/en/docs/reference/meeko-build) already prerenders; this command regenerates pages when the data their loaders read changes, without recompiling the client or server.

## Usage

```sh
meeko build .
meeko prerender .
```

```text
C:\proyectos\tienda\.meeko\output\node\prerender\index.html
```

## Parameters

| Parameter      | Type | Default  | Description                                                                                               |
| -------------- | ---- | -------- | --------------------------------------------------------------------------------------------------------- |
| `<directorio>` | path | required | Project root, with a Node build in `.meeko/output/node/`. Without it, `Falta el directorio de prerender`. |

Loaders run in this process: they read `process.env` as it is when you run the command (the CLI does not read the project's `.env` in `prerender`).

## Result

- `.meeko/output/node/prerender/<ruta>/index.html` and `<ruta>/index.meeko.json` per page, and `manifest.json` with each page's file, `ETag`, `<head>` offset and inline script and style hashes, which the server uses to complete the CSP for those pages (with `server.contentSecurityPolicy`, since `1.7`).
- One line per HTML file written to standard output. Exit code `0`, or `1` with the error if a page fails.

The running server reads the index at startup and caches each page in memory the first time it serves it: after `meeko prerender`, restart `meeko start` to serve the new pages.

## Examples

### Regenerate the blog every night

```sh
# cron, en el servidor
cd /srv/blog && npx meeko prerender . && systemctl restart blog
```

```ts
// app/pages/blog/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({
  render: "prerender",
  prerenderEntries: async () => [{ slug: "hola-meeko" }, { slug: "senales" }],
  load: ({ params }) => ({ slug: params.slug ?? "" }),
});
```

`prerenderEntries` is evaluated again, so a new article returned by the function appears without another build.

### See which routes are prerendered

```sh
meeko prerender . | wc -l
```

In PowerShell: `(meeko prerender .).Count`.

## Common mistakes

### Without a Node build

```sh bad
meeko clean
meeko prerender .
```

```text
No hay build de producción en C:\proyectos\tienda\.meeko\output\node\index.mjs; ejecuta meeko build
```

```sh good
meeko build .
meeko prerender .
```

### With another adapter

`meeko prerender` only works on `.meeko/output/node/`. With `adapter: "static"`, `bun`, `deno` or `cloudflare`, the build does not write that folder (it prerenders using an intermediate server in `.meeko/build/node/`) and the command fails in the same way:

```sh bad
# server: { adapter: "static" }
meeko build .
meeko prerender .
```

`No hay build de producción en …\.meeko\output\node\index.mjs; ejecuta meeko build`.

```sh good
# vuelve a construir: prerenderiza y copia las páginas a la salida del adaptador
meeko build .
```

### A dynamic route without `prerenderEntries`

```ts bad
// app/pages/blog/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({ render: "prerender" });
```

`Dynamic prerender route /blog/[slug] requires prerenderEntries`, also in `meeko build`.

```ts good
// app/pages/blog/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({ render: "prerender", prerenderEntries: [{ slug: "hola-meeko" }] });
```

## Notes

- **Only `200` HTML.** A page that responds with another status or is not HTML stops prerendering with the error; nothing is served partially.
- **Middleware.** Rendering does not run server middleware (`server/middleware`), which runs when the page is served; route middleware does run.
- **Without the sitemap or hooks.** The command only regenerates pages: it does not update `sitemap.xml` (which is in `client/`) or evaluate `sitemapEntries`. If URLs change, run `meeko build`. Modules do receive the `prerender:routes` hook.
- **Performance.** URLs are rendered with the already built application, without Vite: this is much faster than a full build.
- **Messages.** Unlike the rest of the CLI, the missing-build error is in English.

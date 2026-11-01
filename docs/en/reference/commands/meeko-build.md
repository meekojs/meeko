---
title: meeko build
group: commands
since: 1.0.0
description: Checks the project and writes production output to .meeko/output/<adaptador>/, including the client, server and prerendered pages.
symbols:
  - "cli:build"
related:
  - "cli:check"
  - "cli:start"
  - "cli:preview"
  - "cli:prerender"
  - "config:server"
  - "@meekojs/meeko/build#buildProject"
  - docs/framework.md#build-despliegue-y-verificación
  - docs/framework.md#sitio-estático
  - docs/framework.md#csp-y-cabeceras-en-los-adaptadores-con-servidor
source-hash: 1d8b29c3b97022463dbfe31636d6b04410045513fa704d079ebcb8bd7a608c54
---

`meeko build` builds the application for production. First it does everything [`meeko check`](/en/docs/reference/meeko-check) does (and stops with the same errors); then it builds the client with Vite, the adapter's server and `render: "prerender"` pages, and writes a folder that runs without the application's sources: `.meeko/output/node/`, `bun/`, `deno/`, `cloudflare/` or `static/`.

The adapter comes from `--adapter`, `server.adapter` in `meeko.config.ts` or, by default, `node`.

## Usage

```sh
meeko build
```

```text
C:\proyectos\tienda\.meeko\output\node
```

The only line on stdout is the generated folder, so a script can use it (`out=$(meeko build)`). Warnings go to stderr.

## Options

| Option                                       | Type                                                  | Default                     | Description                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------- | ----------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[directorio]`                               | path                                                  | `.`                         | Project root.                                                                                                                                                                                                                                                                                                  |
| `--adapter <nombre>` or `--adapter=<nombre>` | `node` \| `bun` \| `deno` \| `cloudflare` \| `static` | `server.adapter`, or `node` | Adapter for this run. Can appear anywhere after `build`. It does not change which `server` options are read: `host` and `port` only with `server.adapter: "node"`, `headerFiles` only with `"static"`, and `contentSecurityPolicy` and `headers` from a non-`"static"` `server` apply with any server adapter. |
| `MEEKO_PUBLIC_ORIGIN`                        | origin                                                | none                        | Origin for absolute URLs (`sitemap.xml`, `robots.txt`, `document.seo`) if `meeko.config.ts` does not declare `site`.                                                                                                                                                                                           |
| Project `.env`                               |                                                       |                             | Read before configuration, as in `meeko check`.                                                                                                                                                                                                                                                                |

## Result

| Adapter      | Folder                      | Contents                                                             | Runs with                                                                                                         |
| ------------ | --------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `node`       | `.meeko/output/node/`       | `index.mjs`, `chunks/`, `client/`, `prerender/`                      | `meeko start`, `meeko preview` or `node .meeko/output/node/index.mjs`; needs `node_modules` with `@meekojs/meeko` |
| `bun`        | `.meeko/output/bun/`        | `index.js` with all dependencies, `chunks/`, `client/`, `prerender/` | `bun .meeko/output/bun/index.js`                                                                                  |
| `deno`       | `.meeko/output/deno/`       | `main.js` with all dependencies, `chunks/`, `client/`, `prerender/`  | `deno run --allow-net --allow-env --allow-read=.meeko/output/deno …/main.js`                                      |
| `cloudflare` | `.meeko/output/cloudflare/` | `worker.js`, `wrangler.jsonc`, assets and prerendered pages          | `wrangler deploy --config .meeko/output/cloudflare/wrangler.jsonc`                                                |
| `static`     | `.meeko/output/static/`     | Each page's HTML and payload, assets, `404.html` and header files    | Any static hosting                                                                                                |

In addition:

- **The Node build** embeds `server.host` and `server.port` in the bundle (if `server.adapter` is `"node"`), the route, endpoint and asset manifest, and a new `buildId` on every run, which since `1.7` is part of the `ETag` for the [page cache](/en/docs/framework#ssr-page-caching).
- **Since `1.7`**, with `adapter: "node"`, `"bun"`, `"deno"` or `"cloudflare"`, `server.contentSecurityPolicy` and `server.headers` are stored in the application manifest and applied to every response: the policy with hashes for each prerendered page, a nonce per SSR response and `default-src 'none'` for JSON.
- **Prerendering** uses a Node server: the build's own server with `node`, or an intermediate one in `.meeko/build/node/` with other adapters (and with `node` when `sitemap` is enabled). Since `1.7`, the same server evaluates `sitemapEntries`.
- **`sitemap.xml` and `robots.txt`** are written to the client if enabled.
- **Modules** receive the `build:before`, `routes:resolved` and `build:done` hooks.

## Examples

### Node, with its CSP and headers

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  server: {
    adapter: "node",
    port: 8080,
    contentSecurityPolicy: { "default-src": ["'self'"], "object-src": ["'none'"], "base-uri": ["'none'"] },
    headers: { "X-Content-Type-Options": "nosniff", "/admin/*": { "X-Robots-Tag": "noindex" } },
  },
});
```

```sh
meeko build && meeko start
```

A prerendered page then responds with `content-security-policy: default-src 'self'; object-src 'none'; base-uri 'none'; style-src 'self' 'sha256-…'` and `x-content-type-options: nosniff`. Before `1.7`, these two options only existed with `adapter: "static"`.

### Another adapter without changing configuration

```sh
meeko build --adapter deno
meeko preview --adapter deno
```

`preview` needs the same `--adapter`: without it, it looks for the configured adapter's build.

### A static site with a sitemap

```sh
MEEKO_PUBLIC_ORIGIN=https://example.com meeko build --adapter static
```

```text
[meeko] Sin app/error.meeko, el adaptador static no genera 404.html; el hosting mostrará su propia página 404.
C:\proyectos\blog\.meeko\output\static
```

All pages must use `render: "prerender"`, and the application cannot have API, RPC, Socket or server middleware.

### In CI, with output in a variable

```sh
set -e
out=$(npx meeko build)
tar -czf app.tgz -C "$out" .
```

In PowerShell: `$out = npx meeko build`.

## Common mistakes

### An unknown adapter, or one without a name

```sh bad
meeko build --adapter vercel
meeko build --adapter
```

`Adaptador desconocido: vercel; usa node, cloudflare, deno, bun o static` and `Falta el nombre del adaptador en --adapter de build`, both with code `1`. Repeating the option gives `--adapter aparece más de una vez en build`.

```sh good
meeko build --adapter node
```

### A sitemap without a public origin

```ts bad
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ sitemap: true });
```

`meeko build` stops before compiling anything: `sitemap necesita la URL pública del sitio: declara site en meeko.config.ts (site: "https://example.com") o define MEEKO_PUBLIC_ORIGIN al construir`. `document.seo` with `canonical` or `ogUrl` gives the same error.

```ts good
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ site: "https://example.com", sitemap: true });
```

### The `static` adapter with server features

```sh bad
# la aplicación tiene server/api/health.get.ts
meeko build --adapter static
```

```text
El adaptador static genera un sitio sin servidor, pero la aplicación necesita uno:
- endpoints de API: GET /api/health (server/api/health.get.ts)
Usa render: "prerender" (con prerenderEntries en las rutas dinámicas) y quita lo que se ejecuta en el servidor, o elige otro adaptador.
```

```sh good
meeko build --adapter node
```

### A dynamic prerendered route without `prerenderEntries`

```ts bad
// app/pages/blog/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({ render: "prerender" });
```

`meeko check` does not detect it; `meeko build` fails during prerendering with `Dynamic prerender route /blog/[slug] requires prerenderEntries`.

```ts good
// app/pages/blog/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({ render: "prerender", prerenderEntries: [{ slug: "hola-meeko" }] });
```

### A `public/` file conflicting with a generated file

```text bad
public/sitemap.xml      ← y sitemap: true en meeko.config.ts
```

`El archivo público sitemap.xml (de public/ o de un módulo) choca con el que genera la opción sitemap de meeko.config.ts; quita uno de los dos`. The same applies to `robots.txt`, and with Cloudflare, `public/_meeko` is reserved.

```text good
public/favicon.svg      ← sitemap.xml lo genera el build
```

## Notes

- **Checks before building.** `meeko build` runs the complete `meeko check` validation (including TypeScript), so `meeko build` alone is enough in CI if you do not need separate phases. A type error stops the build without writing output.
- **Standalone output.** Builds do not read `app/`, `server/` or `meeko.config.ts` at runtime or load TypeScript or Vite. The Node build needs `node_modules` (with `@meekojs/meeko`); Bun and Deno builds do not.
- **Environment variables.** `MEEKO_HOST`, `MEEKO_PORT` (or `PORT`) and `MEEKO_PUBLIC_ORIGIN` are read when starting the output, not during the build; the build only fixes the defaults for `server.host` and `server.port`. Values read from `process.env` during the build are used by prerendering and `sitemapEntries`.
- **Sessions.** Building does not require persistent sessions, but starting production output does: set `MEEKO_REDIS_URL` or declare `sessions` in `server/runtime.ts` (see [`meeko start`](/en/docs/reference/meeko-start)).
- **Performance.** Client and server builds are two Vite passes; with `sitemap` and `adapter: "node"`, the server is built twice. TypeScript checking is usually the longest part.
- **Windows and POSIX.** The printed path uses the system separator. `.meeko/output/<adaptador>/` is emptied on every build: do not store anything there.

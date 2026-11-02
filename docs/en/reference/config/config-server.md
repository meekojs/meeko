---
title: server
group: config
since: 1.0.0
description: The meeko build adapter (node, bun, deno, cloudflare or static) and its options, plus, since 1.7, response CSP and headers for server adapters.
symbols:
  - "config:server"
types:
  - "@meekojs/meeko/framework#ServerResponseConfig"
  - "@meekojs/meeko/framework#ServerHeaders"
  - "@meekojs/meeko/framework#StaticHeaderFile"
related:
  - "@meekojs/meeko/server#contentSecurityPolicy"
  - "@meekojs/meeko/node#serveNode"
  - "@meekojs/meeko/bun#createBunServer"
  - "@meekojs/meeko/deno#serveDeno"
  - "@meekojs/meeko/cloudflare#createWorker"
  - "cli:build"
  - docs/framework.md#build-despliegue-y-verificación
  - docs/framework.md#csp-y-cabeceras-en-los-adaptadores-con-servidor
  - docs/framework.md#sitio-estático
  - docs/framework.md#cloudflare-workers
source-hash: f1e46fa3180e18d0f02f0d073a6dbb24541c02b22bdfc6d16e850491a4dabd31
---

`server` chooses where the built application runs: a discriminated union keyed by `adapter`. `meeko build` writes output to `.meeko/output/<adapter>/`; the CLI's `--adapter` takes precedence over configuration. Without `server`, the adapter is `node`.

Since `1.7`, server adapters (`node`, `bun`, `deno` and `cloudflare`) also accept `contentSecurityPolicy` and `headers`: they are fixed at build time, and the application applies them to every response, completing the CSP per response (hashes for prerendered pages, a nonce for SSR pages, hashes for SSR pages with `cache` and a closed policy for JSON).

## Usage

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  server: {
    adapter: "node",
    contentSecurityPolicy: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "object-src": ["'none'"],
      "base-uri": ["'none'"],
      "frame-ancestors": ["'none'"],
    },
    headers: {
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "/admin/*": { "X-Robots-Tag": "noindex" },
    },
  },
});
```

## Options

### Shared by `node`, `bun`, `deno` and `cloudflare` (since 1.7)

| Option                  | Type                                               | Default | Description                                                                                                                                                                                                                             |
| ----------------------- | -------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contentSecurityPolicy` | `Record<string, readonly string[]>`                | none    | Policy by directive. Depending on the response, Meeko adds hashes or a nonce (to `script-src-elem` and `style-src-elem` if present), and never to a directive with `'unsafe-inline'` unless it has `'strict-dynamic'`. Production only. |
| `headers`               | `Record<string, string \| Record<string, string>>` | none    | A header-name key applies to all responses; a key starting with `/` is a `pathname` pattern with its own headers, applied after global ones in the written order. `*` matches any sequence, including `/`. Also applies in `meeko dev`. |

### By adapter

| Adapter      | Option                  | Type                                | Default                       | Description                                                                                                                                                                                                                   |
| ------------ | ----------------------- | ----------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node`       | `host`                  | `string`                            | `"127.0.0.1"`                 | `meeko start` interface; `MEEKO_HOST` (or `HOST`) overrides it.                                                                                                                                                               |
| `node`       | `port`                  | `number`                            | `4173`                        | `meeko start` port, from `0` to `65535`; `MEEKO_PORT` (or `PORT`) overrides it.                                                                                                                                               |
| `cloudflare` | `name`                  | `string`                            | `package.json`'s `name`       | Worker name: lowercase letters, digits and hyphens.                                                                                                                                                                           |
| `cloudflare` | `socketClassName`       | `string`                            | `"MeekoSocketRoom"`           | Durable Object class for Socket rooms.                                                                                                                                                                                        |
| `cloudflare` | `compatibilityDate`     | `string` (`YYYY-MM-DD`)             | the date Meeko is tested with | Workers compatibility date.                                                                                                                                                                                                   |
| `cloudflare` | `wrangler`              | `Record<string, unknown>`           | `{}`                          | Additional `wrangler.jsonc` fields (`d1_databases`, `vars`, `routes`…). `compatibility_flags` and `durable_objects.bindings` merge with Meeko's; `main`, `assets`, `no_bundle` and `find_additional_modules` belong to Meeko. |
| `static`     | `contentSecurityPolicy` | `Record<string, readonly string[]>` | none                          | Since `1.3`. Policy for all pages, with hashes from every output `.html`.                                                                                                                                                     |
| `static`     | `headers`               | `Record<string, string>`            | none                          | Since `1.3`. Headers for all responses; no route patterns.                                                                                                                                                                    |
| `static`     | `headerFiles`           | `("_headers" \| "nginx")[]`         | `[]`                          | Since `1.3`. Where to write them: `/_headers` (Netlify, Cloudflare Pages) or `/_meeko/headers.conf` (nginx).                                                                                                                  |

## Result

| Adapter      | Output                                                                 | How to run it                                              |
| ------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| `node`       | `.meeko/output/node/`: `index.mjs`, `chunks/`, `client/`, `prerender/` | `meeko start` or `node index.mjs`; needs `node_modules`.   |
| `bun`        | `.meeko/output/bun/`: `index.js` with bundled dependencies             | `bun index.js`, without `node_modules`.                    |
| `deno`       | `.meeko/output/deno/`: `main.js` with bundled dependencies             | `deno run --allow-net --allow-env --allow-read=… main.js`. |
| `cloudflare` | `.meeko/output/cloudflare/`: `worker.js`, `assets/`, `wrangler.jsonc`  | `wrangler deploy --config …/wrangler.jsonc`.               |
| `static`     | `.meeko/output/static/`: HTML, payloads, `404.html`, assets            | Any file hosting; only `render: "prerender"` pages.        |

Per-response CSP for server adapters:

| Response                            | `Content-Security-Policy`                                                                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prerendered page                    | Policy with hashes for inline scripts and `<style>` elements written by Meeko (never those inside `#app` or a teleport); still served from its file, with `ETag` and `304`. |
| SSR, `"stream"`, error and 404 page | Policy with a new nonce for every response, which Meeko places on its `<script>` and `<style>` elements.                                                                    |
| SSR page with `cache`               | Policy with hashes of inline code written by Meeko, without a nonce.                                                                                                        |
| API, RPC and navigation JSON        | `default-src 'none'; frame-ancestors 'none'`.                                                                                                                               |
| Public files and everything else    | Policy as written.                                                                                                                                                          |

A header already present on the response (from Meeko, a handler or middleware) is not replaced, and a `304` never carries CSP.

## Examples

### Cloudflare Workers with D1

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  server: {
    adapter: "cloudflare",
    name: "mi-app",
    compatibilityDate: "2026-10-19",
    wrangler: {
      d1_databases: [{ binding: "DB", database_name: "mi-app", database_id: "<id>" }],
      vars: { MEEKO_PUBLIC_ORIGIN: "https://mi-app.example" },
    },
    headers: { "X-Content-Type-Options": "nosniff" },
  },
});
```

### A static site for Netlify and nginx

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  site: "https://example.com",
  server: {
    adapter: "static",
    headerFiles: ["_headers", "nginx"],
    contentSecurityPolicy: { "default-src": ["'self'"], "style-src": ["'self'", "'unsafe-inline'"], "object-src": ["'none'"] },
    headers: { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin" },
  },
});
```

### The same project on multiple targets

```sh
npx meeko build                     # server.adapter, o node
npx meeko build --adapter bun       # sin tocar la configuración
npx meeko build --adapter static    # falla si hay páginas SSR, API, RPC, Socket o middleware de servidor
```

With `--adapter`, options from another `server` adapter do not apply: `static` over a `node` configuration builds without `headerFiles`.

## Common mistakes

### An unknown adapter

```ts bad
export default defineMeekoConfig({ server: { adapter: "vercel" } as never });
```

`meeko dev`, `meeko build`, `meeko check` and `meeko routes` stop with `…/meeko.config.ts: server.adapter debe ser "node", "cloudflare", "deno", "bun" o "static"`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ server: { adapter: "node" } });
```

### CSP in `headers`

```ts bad
server: { adapter: "node", headers: { "Content-Security-Policy": "default-src 'self'" } }
```

`…/meeko.config.ts: server.headers no puede fijar Content-Security-Policy; use server.contentSecurityPolicy, que añade los hashes de los scripts`. Written manually, the policy would lack the nonce and hashes and block Meeko's scripts.

<!-- no-check -->

```ts good
server: { adapter: "node", contentSecurityPolicy: { "default-src": ["'self'"] } }
```

### Route patterns with `static`

```ts bad
server: { adapter: "static", headers: { "/admin/*": { "X-Robots-Tag": "noindex" } } }
```

`…/meeko.config.ts: server.headers "/admin/*": el adaptador static aplica sus cabeceras a todas las rutas; los patrones de ruta necesitan un adaptador con servidor`. `headerFiles` writes a single block for all routes.

<!-- no-check -->

```ts good
server: { adapter: "static", headers: { "X-Robots-Tag": "noindex" } }
```

### A pattern with text instead of headers

```ts bad
server: { adapter: "node", headers: { "/docs/*": "max-age=60" } }
```

`…/meeko.config.ts: server.headers "/docs/*" must be an object of header values`.

<!-- no-check -->

```ts good
server: { adapter: "node", headers: { "/docs/*": { "Cache-Control": "public, max-age=60" } } }
```

### Unquoted CSP sources

```ts bad
server: { adapter: "bun", contentSecurityPolicy: { "script-src": ["self ok"] } }
```

`…/meeko.config.ts: server.contentSecurityPolicy: invalid source "self ok" in script-src`.

<!-- no-check -->

```ts good
server: { adapter: "bun", contentSecurityPolicy: { "script-src": ["'self'"] } }
```

### Options from another adapter

```ts bad
server: { adapter: "static", port: 3000 } as never
```

`…/meeko.config.ts: server (static): campo desconocido port`. With `cloudflare`, an invalid name gives `server.name debe ser un nombre de Worker (minúsculas, dígitos y guiones)`, and with `node`, an out-of-range port gives `server.port debe ser un entero entre 0 y 65535`.

<!-- no-check -->

```ts good
server: { adapter: "node", port: 3000 }
```

## Notes

- **Security.** Start with `default-src 'self'`, `object-src 'none'`, `base-uri 'none'` and `frame-ancestors 'none'`. Reserve `'unsafe-inline'` for `style-src` if a highlighter writes `style="…"` attributes: Meeko does not add a nonce or hash to that directive to avoid overriding it. The JSON policy (`default-src 'none'`) covers all of `/api/` and RPC: an endpoint with `contentType: "response"` returning HTML must set its own `Content-Security-Policy`.
- **Development.** CSP only applies in production (`meeko start`, `meeko preview` and output builds); in `meeko dev`, Vite injects scripts without a nonce. `headers` does apply in `meeko dev` to responses handled by the application.
- **Cookies and caches.** A response with `Set-Cookie` and a `public` `Cache-Control` is sent as `private, no-store` without `ETag`, with or without these options.
- **Environment variables.** `MEEKO_HOST`, `MEEKO_PORT` and `MEEKO_PUBLIC_ORIGIN` are read at runtime, not at build time; `server.host` and `server.port` only apply to Node.
- **Custom host.** Options are transferred in the manifest (`AppManifest.contentSecurityPolicy` and `AppManifest.headers`); a host that creates its `AppManifest` manually passes them there. Since `1.8`, the headers of `addPublicFile` travel separately, in `AppManifest.publicFileHeaders`, by the exact `pathname` of the file: the patterns of `headers` replace only the headers they set.

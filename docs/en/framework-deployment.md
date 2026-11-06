---
source-hash: 8c2ee787dfdeef5716e212d65928b17daa2a0c3fc3812d345a3bf0d704072cf8
---

# Build and deploy

This guide expands [the framework overview](framework.md).

## Build, deployment and verification

```sh
npm run check   # manifests, types, components and separate TypeScript projects
npm run build   # client, Node server and prerendering under .meeko/output/node/
npm start       # Node 24, with a persistent store configured
```

`meeko build [directorio] [--adapter <nombre>]` takes the adapter from `--adapter` or `server.adapter` in `meeko.config.ts`, defaulting to `node`. `MeekoConfig.server` is a discriminated union; for Node it accepts `{ adapter: "node", host?, port? }`. The Node build writes `.meeko/output/node/` with `index.mjs`, `chunks/`, `client/` and `prerender/`. This folder contains the already resolved route, endpoint and asset manifest: it does not read `app/`, `server/` or `meeko.config.ts`, or load TypeScript or Vite. It only needs `node_modules` dependencies, including `@meekojs/meeko`. `meeko start` and `meeko preview` execute `index.mjs`; you can also run it with `node .meeko/output/node/index.mjs`. For Bun and Deno, `meeko build --adapter bun` or `--adapter deno` (or `server: { adapter: "bun" }` / `{ adapter: "deno" }`) produces the standalone output described under [Bun](#bun) and [Deno](#deno), and `--adapter cloudflare` produces the Worker described under [Cloudflare Workers](#cloudflare-workers). Since `1.3`, `--adapter static` (or `server: { adapter: "static" }`) generates a file-based site for static hosting; see [Static site](#static-site).

The server listens on `127.0.0.1:4173` unless `server.host`/`server.port` or the `MEEKO_HOST` and `MEEKO_PORT` (or `PORT`) variables specify another address; use `MEEKO_HOST=0.0.0.0` to accept remote traffic. `MEEKO_PUBLIC_ORIGIN` sets the public origin for HTTP and Socket Origin checks when a proxy terminates TLS. `SIGINT` and `SIGTERM` close Socket, HTTP, `waitUntil` tasks and the runtime, in that order. Open responses, such as a stream, have `shutdownTimeout` milliseconds (10 000 by default) to finish; then their connections are cut and shutdown continues. If the client disconnects before or during transmission, the response body is canceled, releasing open files and stopping stream producers. A request-target starting with `//` is always interpreted as a path on the application's own origin (or `MEEKO_PUBLIC_ORIGIN`), never as another host.

`meeko start` does not compress responses: in production you need a proxy or CDN that does. The difference is large: `/docs/framework` on this site, with all its resources, goes from 2,220 KB to 419 KB with Brotli, measured with a local proxy. Check the result with `curl -s -o /dev/null -D - -H 'accept-encoding: br, gzip' <url>`, which must return `content-encoding`. `"stream"` pages ask not to be compressed (`no-transform`), because buffered compression would hold back their chunks; see [Streaming SSR](framework-rendering.md#streaming-ssr-render-stream).

Public files are only served if listed in the asset manifest generated with the client build (including the `public/` copy); any other path goes to the application and is never read from disk. Each asset includes `ETag`, `content-length` and support for `HEAD` and `304`; only files emitted by Vite and listed in its manifest (with a content hash) use `cache-control: public, max-age=31536000, immutable`; the rest, including those in `public/assets/`, use `public, max-age=0, must-revalidate`. Each asset's key is its path serialized by the WHATWG URL, the same one requested by the browser: `public/logo@2x.png` is served at `/logo@2x.png`, `a b.txt` at `/a%20b.txt` and a non-ASCII name in its UTF-8-encoded form. HTML links the client entry point, its CSS and its `modulepreload` entries from Vite's manifest; the client route list is imported as a module rather than inserted into the document.

For a public service, place it behind an HTTPS proxy, configure `MEEKO_PUBLIC_ORIGIN`, persistent sessions and graceful shutdown. OpenAPI export is optional through `generateOpenApi`; a schema that cannot be represented produces an explicit error.

The standalone starter created by `meeko init` coordinates HTTP and Vite shutdown on `SIGINT` and `SIGTERM`. Shutdown is idempotent; if both resources fail it preserves both causes and sets a failing exit code, without leaving unobserved promise rejections. The framework host likewise preserves the original startup error and reports each additional failure when closing Socket, sessions or Vite through the central observer.

The Node adapter delivers multiple `Set-Cookie` headers separately and stops transmitting the body if the client closes the connection. A response already started cannot be replaced with error JSON; the adapter closes that connection and reports the failure to the host's observer.

### Static site

```sh
npx meeko build --adapter static     # .meeko/output/static/
npx meeko preview --adapter static   # serves it as static hosting would
```

Since `1.3`, the `static` adapter writes a site without a server to `.meeko/output/static/`, ready to upload as is to nginx, Netlify, Cloudflare Pages, GitHub Pages or a bucket:

- client assets and `public/`;
- each prerendered page as `<ruta>/index.html` (`/docs/api` → `docs/api/index.html`, with segments decoded as the hosting expects) and its navigation payload `<ruta>/index.meeko.json`;
- `404.html`, the `app/error.meeko` page with status `404` within its layouts (without `app/error.meeko` it is not generated and the build warns);
- `sitemap.xml` and `robots.txt` if enabled, and the `headerFiles` header files.

Static hosting does not negotiate `Accept`, so this build's client does not request pages with `Accept: application/meeko+json`: it reads the `index.meeko.json` file from the page's folder (`/docs/api/index.meeko.json`, without the query string). Client navigation therefore works with any hosting that serves files; other adapters still negotiate `Accept`. `404.html` hydrates at any URL, including one matching a dynamic route whose page was not prerendered (`/docs/[slug]` with an unknown `slug`), and supports client navigation from it; a route whose payload does not exist displays the error page without reloading. Hosting services serve `404.html` for nonexistent URLs (in nginx, `error_page 404 /404.html;`).

All pages must use `render: "prerender"`, with `prerenderEntries` on dynamic routes. Before compiling anything, the build fails with a list of everything needing a server: `"ssr"`, `"stream"` or `"client"` pages, API endpoints, RPC procedures, Socket channels, `server/middleware` middleware and modules' server handlers. Route middleware (`app/middleware`) runs during prerendering and client navigation, but not on a page's first load; the build warns about this. `server/runtime.ts` only runs during prerendering. A `public/` file conflicting with a generated file (`404.html`, `sitemap.xml`, `robots.txt`, `_headers`, `_meeko/headers.conf` or a page's `index.html`) is an error.

With `adapter: "static"`, `server` accepts:

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	site: 'https://example.com',
	sitemap: true,
	robots: true,
	document: { seo: true },
	server: {
		adapter: 'static',
		headerFiles: ['_headers', 'nginx'],
		contentSecurityPolicy: {
			'default-src': ["'self'"],
			// data: for the <link rel="icon" href="data:,"> Meeko adds when the application has no icon.
			'img-src': ["'self'", 'data:'],
			'script-src': ["'self'"],
			'style-src': ["'self'", "'unsafe-inline'"],
			'object-src': ["'none'"],
			'base-uri': ["'none'"],
		},
		headers: { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' },
	},
})
```

- `contentSecurityPolicy`: the `Content-Security-Policy` of all pages, by directive. The build adds inline script hashes; see [CSP with hashes](#csp-with-hashes).
- `headers`: other headers for all responses. `Content-Security-Policy` is not accepted here, because it would lose the hashes.
- `headerFiles`: where these headers are written. By default, nowhere: static hosting does not read them from Meeko configuration, so each format is optional and explicit.
- `img-src` with `data:`: a document without a custom icon has `<link rel="icon" href="data:,">`, so the browser does not request `/favicon.ico`. With `default-src 'self'` and without `data:` in `img-src`, the browser blocks that icon and logs a CSP violation in each page's console; nothing else breaks. Simply add `data:` to `img-src`, as in the example, or declare a custom icon (`document.head.link: [{ rel: 'icon', href: '/favicon.svg' }]`), which replaces Meeko's.
  - `"_headers"` writes `/_headers`, the Netlify and Cloudflare Pages format, with a `/*` block for all routes. Those hosts read it without publishing it.
  - `"nginx"` writes `/_meeko/headers.conf`, one `add_header … always;` line per header, to include in each `location` (an `add_header` inside a `location` overrides those in `server`). The file is within the web root, so the configuration must hide `/_meeko/`:

```nginx
server {
  root /usr/share/nginx/html;   # the contents of .meeko/output/static
  location / {
    include /usr/share/nginx/html/_meeko/headers.conf;
    try_files $uri $uri/index.html =404;
  }
  location ^~ /_meeko/ { internal; }
  error_page 404 /404.html;
}
```

These options are only read when `server.adapter` is `"static"`; using `meeko build --adapter static` with another configuration builds without them. `meeko preview` serves the folder as a host would (the file, the folder's `index.html` or `404.html` with status `404`, without publishing `_headers` or `_meeko/`) and applies CSP and `headers`, at `127.0.0.1:4173` unless `MEEKO_HOST` and `MEEKO_PORT` say otherwise. `meeko start` only serves the Node build. The build still uses Node and Vite, and prerendering uses an intermediate Node server in `.meeko/build/node/`, as in Bun.

### `sitemap.xml` and `robots.txt`

```ts
export default defineMeekoConfig({
	site: 'https://example.com',
	sitemap: { exclude: ['/admin', '/admin/*'] }, // or sitemap: true
	robots: { disallow: ['/admin/'] }, // or robots: true
})
```

Since `1.3`, `sitemap` writes `sitemap.xml` (sitemaps.org 0.9 protocol) with the absolute URL of each prerendered page and each route without parameters, whether `"ssr"`, `"stream"` or `"client"`; dynamic routes without prerendering are unknown at build time unless they declare [`sitemapEntries`](#dynamic-routes-in-the-sitemap-sitemapentries) (since `1.7`). Prerendered pages requesting `<meta name="robots" content="noindex">` (or `none`) and routes in `exclude`, where `*` matches any sequence of characters including `/`, are omitted. `robots` writes `robots.txt` with `User-agent: *`, its `allow` and `disallow` entries (`Allow: /` with neither) and, with `sitemap`, the `Sitemap:` line containing its absolute URL.

URLs need the public origin: `site` or, without it, the build's `MEEKO_PUBLIC_ORIGIN`. With `sitemap` and no origin, the build fails before compilation; `robots` without `sitemap` does not need one. These work with all adapters. In Node, Bun, Deno and Workers they are served like other public files, from the build's asset manifest: because the sitemap lists prerendered pages, the Node adapter renders them with an intermediate server and builds its own afterwards, with the sitemap in its manifest (one additional server compilation, only with `sitemap`). A `public/sitemap.xml` or `public/robots.txt` conflicts with the corresponding option and fails the build.

#### Dynamic routes in the sitemap: `sitemapEntries`

Since `1.7`, a server-rendered page declares its sitemap URLs with `sitemapEntries` in `definePage`: a list of `{ params, lastmod?, changefreq?, priority? }` (type `SitemapEntry`) or a synchronous or asynchronous function returning it. This is the way to handle dynamic routes with `"ssr"` or `"stream"`, whose URLs the build cannot guess:

```ts
// app/pages/docs/[slug].route.ts (or the page's <script server>)
import { definePage } from '@meekojs/meeko/framework'
import { docs } from '../../../server/content/bundle.js'

export const route = definePage({
	sitemapEntries: ({ env }) => docs.filter((doc) => env.DOCS_DRAFTS === '1' || !doc.draft).map((doc) => ({ params: { slug: doc.slug }, lastmod: doc.updatedAt, changefreq: 'weekly' })),
})
```

- **When and with what.** `meeko build` evaluates it once, after prerendering, in the intermediate Node server used for prerendering: the `server/runtime.ts` runtime already exists with `prerendering: true`, but there is no request, session or per-request `services`. The function receives `SitemapEntriesContext`: `env` (the build's `process.env`) and `prerendering` (always `true`). Read data available to the build, such as a content bundle; if you query a database, it must be accessible during the build. It only runs with `sitemap` in `meeko.config.ts`, and Meeko only loads options from routes that name it: write it in the options, not through a spread.
- **What each entry returns.** `params` builds the URL like `href`; a route without parameters omits them and the entry only adds fields to its URL. `lastmod` is a `Date` (written with `toISOString()`) or W3C Datetime text (`"2026-10-01"`, `"2026-10-01T12:00:00Z"`); `changefreq` is `always`, `hourly`, `daily`, `weekly`, `monthly`, `yearly` or `never`, and `priority` is a number from `0` to `1`. Any other value, a duplicate URL, `params` that cannot form the URL or a URL resolving to another route stops the build with the route.
- **With `render: "prerender"`.** Prerendered pages are already in the sitemap; `sitemapEntries` only adds `lastmod`, `changefreq` and `priority` to them. An entry without a prerendered page stops the build: add it to `prerenderEntries` or remove it. This ensures the sitemap never advertises a URL the `static` adapter does not have.
- **`exclude` and `noindex` take precedence.** A declared URL matching `sitemap.exclude`, or a prerendered page with `noindex`, is not listed.
- **`render: "client"`.** Its options reach the browser, so it does not accept `sitemapEntries`: this is a type error and stops `meeko dev`, `meeko build` and `meeko check`. A parameterless `"client"` page is already in the sitemap.

This works the same with all adapters: the sitemap is written into the build's public files and in Node, Bun, Deno and Workers it is served from their asset manifest. The `static` adapter does not support `"ssr"` routes, so there `sitemapEntries` only supplements prerendered pages.

#### Sitemap served from a database

Since `1.8`, `sitemapXml(origin, urls)` from `@meekojs/meeko/framework` is the function `meeko build` uses to write the file. If pages change without a deployment, turn the option off (`sitemap: false`) and serve the sitemap from a server middleware, without writing the XML by hand:

```ts
// server/middleware/sitemap.ts
import { sitemapXml } from '@meekojs/meeko/framework'
import { defineServerMiddleware } from '@meekojs/meeko/server'

export default defineServerMiddleware(async (request, next) => {
	if (new URL(request.url).pathname !== '/sitemap.xml') return next(request)
	const pages = await db.pages.list()
	const xml = sitemapXml(
		'https://example.com',
		pages.map((page) => ({
			pathname: page.path,
			lastmod: page.updatedAt,
			alternates: [
				{ hreflang: 'es', pathname: page.path },
				{ hreflang: 'en', pathname: `/en${page.path}` },
				{ hreflang: 'x-default', pathname: page.path },
			],
		})),
	)
	return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } })
})
```

Each URL is a path or a `SitemapResolvedUrl` (`{ pathname, lastmod?, changefreq?, priority?, alternates? }`). The function escapes the XML, adds the `xhtml` namespace only when a URL has `alternates`, and does not sort the list. An invalid `hreflang` or an `alternates` `pathname` that does not start with `/` throws an error. It uses no Node APIs, so it also works in Workers.

### CSP with hashes

A `Content-Security-Policy` without `'unsafe-inline'` blocks a document's inline scripts, such as one from `document.head.script` or the one added by [`theme`](framework-rendering.md#lightdark-theme-without-flashing). For pages generated at build time, Meeko allows each through its SHA-256 hash, without a per-request nonce:

- Since `1.3`, the `prerender/manifest.json` index stores in `pages[ruta].scriptHashes` the `'sha256-…'` sources of the inline `<script>` elements executed by each prerendered page: JavaScript, `module`, `importmap` and `speculationrules`. Data blocks (`application/json`, such as Meeko's payload, and `application/ld+json`) and scripts with `src` do not count. Since `1.7`, only those Meeko writes outside the page count (`<head>`, payload, entry point and `document.bodyEnd`): a `<script>` or `<style>` inside `#app` or a teleport, potentially from user content, receives no hash.
- `inlineScriptHashes(html)` from `@meekojs/meeko/build` returns `{ hashes, unhashable }` for any document: hashes and JavaScript a hash cannot allow, `on*` attributes and `javascript:` URLs. It reads HTML like the browser, so the hash matches what the browser checks. It reads the entire document, including inside `#app`: for a Meeko page, use the index's hashes.
- `contentSecurityPolicy(policy, hashes)` from `@meekojs/meeko/server` builds the header value: it adds hashes to `script-src` (since `1.7`, to `script-src-elem` if the policy has it) without repeating sources or, if the policy has no `script-src`, to a copy of the `default-src` sources (with neither, scripts are already allowed and nothing is added). With hashes, the browser ignores `script-src`'s `'unsafe-inline'`.
- Since `1.4`, the same applies to inline `<style>` elements, such as those for [`<MeekoThemeToggle>`](framework-rendering.md#meekothemetoggle) icons and components: `pages[ruta].styleHashes` in the index, `inlineStyleHashes(html)` from `@meekojs/meeko/build` (`style="…"` attributes do not count, because a hash cannot allow them) and a third argument, `contentSecurityPolicy(policy, scriptHashes, styleHashes)`, which adds them to `style-src-elem` if present in the policy, otherwise to `style-src` or a copy of `default-src`. Unlike scripts, they are not added to a directive already allowing `'unsafe-inline'`: it is unnecessary, and the hash would override `'unsafe-inline'` for `style="…"` attributes.

The `static` adapter does all this with `server.contentSecurityPolicy`: it calculates script hashes and, since `1.4`, `<style>` hashes for every `.html` in its output (including `404.html` and those in `public/`; since `1.7`, in Meeko documents only those outside `#app` and teleports, while custom `.html` files are read in full), adds them to the policy and writes the header to `headerFiles`. If a page has an `on*` attribute or a `javascript:` URL, the build fails with the file list: use a script or the component's `on:`. Changing a script changes its hash on the next build, without touching the policy.

```ts
// A custom host serving the Node build with CSP for its prerendered pages.
import { readFile } from 'node:fs/promises'
import { contentSecurityPolicy } from '@meekojs/meeko/server'
import type { PrerenderIndex } from '@meekojs/meeko/build'

const index = JSON.parse(await readFile('.meeko/output/node/prerender/manifest.json', 'utf8')) as PrerenderIndex
const hashes = [...new Set(Object.values(index.pages).flatMap((page) => page.scriptHashes ?? []))]
const header = contentSecurityPolicy({ 'default-src': ["'self'"], 'img-src': ["'self'", 'data:'], 'object-src': ["'none'"] }, hashes)
```

Since `1.7`, server adapters set the header themselves with `server.contentSecurityPolicy` (see the next section). Without this option, `meeko start` adds no CSP: a custom host uses the `DocumentOptions.nonce` nonce, which Meeko puts on its `<script>` and `<style>` elements, and then a prerendered page is not served from its file, because the nonce changes on every response.

### CSP and headers in server adapters

Since `1.7`, `server.contentSecurityPolicy` and `server.headers` also exist with `adapter: "node"`, `"bun"`, `"deno"` and `"cloudflare"`. They are set at build time (in the application manifest, `AppManifest.contentSecurityPolicy` and `AppManifest.headers`) and the application applies them to each response:

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	server: {
		adapter: 'node',
		contentSecurityPolicy: {
			'default-src': ["'self'"],
			// data: for the <link rel="icon" href="data:,"> Meeko adds when the application has no icon.
			'img-src': ["'self'", 'data:'],
			'script-src': ["'self'"],
			// Shiki and other highlighters write style="…" attributes: this directive stays unchanged.
			'style-src': ["'self'", "'unsafe-inline'"],
			'object-src': ["'none'"],
			'base-uri': ["'none'"],
			'frame-ancestors': ["'none'"],
		},
		headers: {
			'X-Content-Type-Options': 'nosniff',
			'Referrer-Policy': 'strict-origin-when-cross-origin',
			'/admin/*': { 'X-Robots-Tag': 'noindex' },
		},
	},
})
```

**CSP by response.** Meeko completes each response's policy with what its body needs:

| Response                                                             | `Content-Security-Policy`                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prerendered page                                                     | The policy with the hashes of inline scripts and `<style>` elements written by Meeko (`scriptHashes` and `styleHashes` from the prerender index, like the `static` adapter). The page is still served from its file, with its `ETag` and `304`.                 |
| SSR page, `"stream"`, error page and 404                             | The policy with a new nonce per response in `script-src` (in `script-src-elem` if the policy has it, or in a copy of `default-src`), which Meeko puts on its `<script>`, `<style>`, client entry point, theme script and scripts from `useHead` and `document`. |
| SSR page with [`cache`](framework-rendering.md#ssr-page-caching)                           | The policy with hashes of inline scripts and `<style>` elements written by Meeko, without a nonce: the document is the same for everyone and on every revalidation, and a nonce does not survive a `304`.                                                       |
| API JSON, RPC and navigation payload                                 | `default-src 'none'; frame-ancestors 'none'`: JSON executes or loads nothing. This applies to every `server/api` and RPC response, including an endpoint with `contentType: "response"`.                                                                        |
| Any other (public files, module handlers, 404 without an error page) | The policy as is.                                                                                                                                                                                                                                               |

**What hashes authorize.** Only inline code Meeko writes outside the page: `<head>` (the theme script and style, `<MeekoAwait>` fallback, `useHead`, `document.head` and component `<style>` elements), the payload if it is not a data block, the client entry point and `document.bodyEnd`. A `<script>` or `<style>` inside `#app` or a teleport (from `html="…"`, poorly sanitized user content or written in the template) never receives a hash, so the browser blocks it, as with a nonce. A `<script>` or `<style>` in the template of a cached or prerendered page must go in `useHead` or a file.

Meeko never adds a nonce or hash to a directive with `'unsafe-inline'`: with one, the browser would ignore `'unsafe-inline'` and block what that directive deliberately allowed, such as `style="…"` attributes written by Shiki and other highlighters. The exception is `'strict-dynamic'` (since `1.7`): with it, the browser already ignores `'unsafe-inline'` and host sources, which remain only for older browsers, so `script-src 'strict-dynamic' 'unsafe-inline' https:` receives the nonce or hashes. With `'strict-dynamic'`, the client entry point (`<script src>`) only loads with a nonce: on a cached or prerendered page, which uses hashes, the browser blocks it, so these pages do not hydrate; use `'strict-dynamic'` only if all your pages are SSR without `cache`. If the policy has `script-src-elem` or `style-src-elem`, the nonce and hashes go to that directive, which governs elements. With `style-src 'self' 'unsafe-inline'`, Meeko's `<style>` elements are allowed by `'unsafe-inline'`; with strict `style-src`, by the nonce or hash, like scripts. A response already containing `Content-Security-Policy` (from a handler or middleware) retains it, and a `304` never carries the policy: the browser uses it to update its cached copy's headers, and a policy without that document's hashes would replace its own. Meeko generates the nonce (128 random bits); if the host passes `DocumentOptions.nonce`, its value is used, and `document.bodyEnd` and `document.head` receive it as usual.

With an `on*` attribute or a `javascript:` URL in HTML, the browser blocks them with a nonce just as with hashes; move them to a script or the component's `on:`. Calculating hashes for a cached page reads its HTML with the same parser as the build (`parse5`), once per render; with `cache.memory`, once per page version. CSP only applies in production (`meeko start`, `meeko preview` and each adapter's outputs): in `meeko dev`, Vite injects scripts and styles without a nonce or hash.

**Headers.** Each `headers` key with a header name applies to all responses; a key starting with `/` is a route pattern (`pathname`, without a query) with its own headers, applied after global ones and in written order, so the last one wins. In a pattern, `*` matches any sequence of characters, including `/`: `"/docs/*"` matches `/docs/api` but not `/docs`. A header already on the response (from Meeko, a handler or middleware) is not replaced: a page's or file's `Cache-Control`, for example, takes precedence over `headers`. `Content-Security-Policy` is not accepted in `headers`, and with `adapter: "static"`, pattern keys are an error, because `headerFiles` writes a single block for all routes. Unlike CSP, `headers` also applies in `meeko dev` to responses handled by the application (pages, API and RPC); files served by Vite do not include them.

**Workers.** Cloudflare Workers applies CSP and headers just like Node, Bun and Deno: hashes and the nonce use Web Crypto, and the assets' prerender index includes each page's hashes.

**An endpoint returning HTML.** The JSON policy (`default-src 'none'`) applies to all `/api/` and RPC. An endpoint with `contentType: "response"` returning HTML (a preview, a payment return page) would render without styles or scripts: put its own `Content-Security-Policy` on the `Response`, which Meeko preserves.

**Workers without CSP.** The HTML parser that calculates hashes (`parse5`) only loads when `server.contentSecurityPolicy` exists; without it, the Cloudflare build excludes it from the Worker (about 240 KB less).

**Cookies and shared caches.** Regardless of these options, a response with `Set-Cookie` and a `public` or `s-maxage` `Cache-Control` (from the response or `headers`) is sent as `private, no-store` and without `ETag`, so no shared cache stores the cookie with the page.

### Bun

```sh
npx meeko build --adapter bun
npx meeko preview --adapter bun      # runs the output with `bun`
bun .meeko/output/bun/index.js       # in production
```

The Bun build writes `.meeko/output/bun/` with `index.js`, `chunks/`, `client/` and `prerender/`. Unlike the Node build, `index.js` includes `@meekojs/meeko` and the remaining server dependencies: the folder needs neither `node_modules`, application sources, TypeScript nor Vite. Copy the complete folder to the server. Build and prerendering still run with Node; Meeko builds an intermediate Node server in `.meeko/build/node/` for this purpose, which is not part of the output.

The output listens on `127.0.0.1:4173` unless `MEEKO_HOST` and `MEEKO_PORT` (or `PORT`) specify another address; `MEEKO_PUBLIC_ORIGIN` has the same role as in Node. `server.host` and `server.port` only apply to Node. `SIGINT` and `SIGTERM` stop `Bun.serve`, close active connections and then the application. Since `1.3`, unhandled rejections and uncaught exceptions follow `processErrors` (see [Failures outside a request](framework-server.md#failures-outside-a-request)); a custom host with `createBunServer` achieves this with `handleProcessErrors`. `meeko preview` launches `bun` as a child process, forwards signals to it and adopts its exit code; if `bun` is not in `PATH`, it fails with an explicit message.

To host the application on a custom server, `createBunServer(app, options)` returns `{ fetch, websocket }` for `Bun.serve({ port, ...createBunServer(app) })`, and `createBunAssetReader({ root, assets })` serves manifest files with `Bun.file`. Socket limits:

- `maxPayloadLength`: the largest incoming frame. By default, `socket.maxMessageBytes` from `server/runtime.ts` or 64 KiB. Bun closes larger frames and the hub responds with `1009` to a message exceeding the application limit.
- `backpressureLimit`: pending outgoing bytes per peer, 1 MiB by default. A send exceeding it closes that peer with `1011` without blocking the rest of the room.
- `idleTimeout` (60 s) and `sendPings` (enabled) keep healthy connections alive and close inactive ones. Binary messages close with `1003`. Per-message compression is disabled.

### Deno

```sh
npx meeko build --adapter deno
npx meeko preview --adapter deno                 # ejecuta `deno run -A` sobre la salida
deno run --allow-net --allow-env --allow-read=.meeko/output/deno .meeko/output/deno/main.js
```

The Deno build writes `.meeko/output/deno/` with `main.js`, `chunks/`, `client/` and `prerender/`. As with Bun, `main.js` includes all server dependencies and does not need `node_modules`, sources, TypeScript or Vite. `meeko preview` grants all permissions (`-A`). In production, `--allow-net`, `--allow-env` (the runtime receives `Deno.env.toObject()`) and read access to the output folder suffice. `MEEKO_HOST`, `MEEKO_PORT` (or `PORT`) and `MEEKO_PUBLIC_ORIGIN` work as in Node.

`serveDeno(app, { host, port, publicOrigin, platform, onError, maxMessageBytes, idleTimeout, handleSignals })` serves the application with `Deno.serve` and returns `{ url, finished, close() }`. `close()` closes Socket peers with `1001`, stops HTTP, waits for `waitUntil` tasks and closes the application, in that order. With `handleSignals`, it does so on `SIGINT` and `SIGTERM` (on Windows, `SIGINT` and `SIGBREAK`) and, since `1.3`, applies `processErrors` to unhandled rejections and uncaught exceptions (see [Failures outside a request](framework-server.md#failures-outside-a-request)). `createDenoAssetReader({ root, assets })` serves manifest files. Socket limits:

- `Deno.upgradeWebSocket` offers no frame limit, so the adapter measures each message with `maxMessageBytes` (by default, the application's Socket limit or 64 KiB) and closes larger ones with `1009`. Deno reassembles the frame in memory before this check; limit request size at the proxy if you need an earlier cap.
- The outgoing buffer is controlled by the hub's buffer limit through `bufferedAmount`.
- `idleTimeout` (60 s) closes a peer that does not respond to ping. Binary messages close with `1003`.

### Cloudflare Workers

```sh
npx meeko build --adapter cloudflare
npx meeko preview --adapter cloudflare   # wrangler dev sobre la salida
npx wrangler deploy --config .meeko/output/cloudflare/wrangler.jsonc
```

The Cloudflare build writes `.meeko/output/cloudflare/` with:

- `worker.js`: a single ES module including `@meekojs/meeko` and server dependencies. It only imports `cloudflare:workers` and `node:async_hooks`, provided by the runtime.
- `assets/`: the client build and `public/`, plus prerendered pages under `assets/_meeko/prerender/`. The Worker reads those pages through the assets binding and never serves them as files; `public/_meeko/` is reserved and stops the build.
- `wrangler.jsonc`: generated configuration. Do not edit it; it regenerates on every build.

Wrangler does not rebundle the output (`no_bundle: true`), so the exact code tested is deployed. Wrangler is a deployment tool rather than a runtime dependency: `meeko preview` uses the application's installation or, failing that, Meeko's, and if neither is found it fails with `Wrangler no está instalado; añádelo con pnpm add -D wrangler…` (Wrangler is not installed; add it with the indicated command). `MEEKO_PORT` (or `PORT`) and `MEEKO_HOST` are passed to `wrangler dev` as `--port` and `--ip`. Build and prerendering still run with Node; during prerendering, the `server/runtime.ts` factory runs in Node with `prerendering: true` and no bindings.

Declare the configuration in `meeko.config.ts`:

```ts
export default defineMeekoConfig({
	server: {
		adapter: 'cloudflare',
		name: 'mi-app', // defaults to the name in package.json
		socketClassName: 'MeekoSocketRoom', // Durable Object class for rooms
		compatibilityDate: '2026-10-19', // defaults to the date Meeko is tested against
		wrangler: {
			// additional wrangler.jsonc fields
			d1_databases: [{ binding: 'DB', database_name: 'mi-app', database_id: '<id>' }],
			vars: { MEEKO_PUBLIC_ORIGIN: 'https://mi-app.example' },
		},
	},
})
```

The generated `wrangler.jsonc` contains:

- `main: "./worker.js"`, `no_bundle: true` and `find_additional_modules: false`, to prevent files in `assets/` from also being uploaded as Worker modules.
- `compatibility_flags` with `nodejs_als`, enabling `AsyncLocalStorage` from `node:async_hooks`, combined with flags declared in `server.wrangler.compatibility_flags`. `nodejs_compat` is also valid, because it includes `AsyncLocalStorage`.
- `assets` with `directory: "./assets"`, binding `ASSETS`, `run_worker_first: true` and `html_handling`/`not_found_handling` set to `"none"`. All requests reach the Worker, which only serves files listed in the manifest with the same `ETag` and cache policy as other adapters.
- The `MEEKO_SOCKET` Durable Object binding to the room class, prepended to `server.wrangler.durable_objects` bindings.
- The room class declaration (`MeekoSocketRoom`, or the name in `server.socketClassName`), without ever rewriting existing history. Cloudflare accepts two forms per Worker, the `migrations` array or the declarative `exports` map:
  - Without `server.wrangler.migrations` or Durable Object entries in `exports`, Meeko generates `migrations: [{ "tag": "meeko-socket-v1", "new_sqlite_classes": ["MeekoSocketRoom"] }]`. Do not delete or rename that migration after the first deployment.
  - If you declare `migrations`, the history must create the class itself (`new_sqlite_classes`, `new_classes` or the target of `renamed_classes`/`transferred_classes`). Migrations apply in order and are recorded by `tag`, so prepending Meeko's would change an already deployed history; the build stops with “server.wrangler.migrations does not create the Socket room class …; append { "tag": "meeko-socket-v1", "new_sqlite_classes": ["MeekoSocketRoom"] } at the end of server.wrangler.migrations”. Append that entry to your history; if `meeko-socket-v1` is already another migration's tag, the message suggests `meeko-socket-v1-<n>`, where `<n>` is the number of migrations plus one.
  - If you declare Durable Objects in `exports`, Meeko adds `"MeekoSocketRoom": { "type": "durable-object", "storage": "sqlite" }` when absent and does not generate `migrations`; a custom class entry must be live (without `state` or with `"created"`). Durable Objects in `exports` together with `migrations` stop the build, because Cloudflare only accepts one form.

`main`, `assets`, `no_bundle` and `find_additional_modules` belong to Meeko and cannot be overridden, nor can the `MEEKO_SOCKET` binding. Other `server.wrangler` fields (`routes`, `vars`, `d1_databases`, `observability`…) are copied as is.

In Workers, `env` in `server/runtime.ts` is the Worker's bindings object and `platform` is `"cloudflare"`. The application is created once per isolate, on the first request, and `context.platform.waitUntil` uses `ctx.waitUntil`. The `MEEKO_PUBLIC_ORIGIN` variable sets the public origin; without it, the routed URL's origin is used. An example with D1 for sessions:

```ts
// server/runtime.ts
import { D1SessionDriver, DurableObjectSocketPubSub } from '@meekojs/meeko/cloudflare'
import type { D1DatabaseLike, DurableObjectNamespaceLike } from '@meekojs/meeko/cloudflare'
import { defineServerRuntime, MemorySessionStore, SessionManager, SqlSessionStore } from '@meekojs/meeko/server'

interface Env {
	readonly DB?: D1DatabaseLike
	readonly MEEKO_SOCKET?: DurableObjectNamespaceLike
}

export default defineServerRuntime<Env>(({ env, production, prerendering }) => {
	const store = prerendering || !env.DB ? new MemorySessionStore() : new SqlSessionStore(new D1SessionDriver(env.DB))
	const pubsub = env.MEEKO_SOCKET ? new DurableObjectSocketPubSub(env.MEEKO_SOCKET) : undefined
	return {
		sessions: new SessionManager({ production: production && !prerendering, store }),
		services: { pubsub },
		// Without pubsub, the Worker uses DurableObjectSocketPubSub(env.MEEKO_SOCKET) by default;
		// any other broker is rejected when creating the application.
		socket: { maxMessageBytes: 16 * 1024 },
	}
})
```

#### Sessions in D1

`D1SessionDriver(db, { table? })` implements `SqlSessionDriver` for `SqlSessionStore`. `replace` is a single `UPDATE … WHERE id = ? AND family_id = ? AND expires_at > ?` checking that exactly one row changed; `revokeFamily` is a `DELETE … WHERE family_id = ?`. `UNIQUE(family_id)` prevents a second active ID in the same family. `D1SessionDriver.schema(table?)` returns the reference schema (with default table `meeko_sessions`):

```sql
CREATE TABLE IF NOT EXISTS "meeko_sessions" (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "meeko_sessions_expires_at" ON "meeko_sessions" (expires_at);
```

Apply it as a D1 migration before deploying: `npx wrangler d1 migrations create <base> meeko_sessions`, copy the SQL into the created file and run `npx wrangler d1 migrations apply <base> --remote` (or `--local` for `wrangler dev`). Expired rows are deleted on read; to clean up the rest, call `driver.deleteExpired()` from a Cron Trigger. D1 does not notify other isolates of revocation: an open connection in another isolate detects revocation when rereading the session on its next event (see [Revocation during a request](framework-auth.md#revocation-during-a-request)).

Since `1.7`, `D1SessionDriver(db, { rateLimitTable: "meeko_rate_limits" })` also implements `rateLimit`, sharing [`rateLimit`](framework-auth.md#rate-limiting-ratelimit) counters across isolates instead of keeping them in each isolate's memory (see [SQL rate limiting](framework-auth.md#sql-rate-limiting)). It is optional, because it needs another table: without the option, the driver is unchanged. `D1SessionDriver.rateLimitSchema(table?)` returns its schema; apply it in a migration, as with sessions:

```sql
CREATE TABLE IF NOT EXISTS "meeko_rate_limits" (
  key TEXT PRIMARY KEY NOT NULL,
  window_ends_at INTEGER NOT NULL,
  count INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS "meeko_rate_limits_window_ends_at" ON "meeko_rate_limits" (window_ends_at);
```

The key is the SHA-256 in base64url (43 characters), and each rate-limited request is a single `INSERT … ON CONFLICT(key) DO UPDATE … RETURNING`. With `rateLimitTable`, `deleteExpired()` also deletes counters whose window ended and returns the total number of deleted rows.

#### Redis through the Upstash REST API

Workers does not open Redis TCP connections with the `redis` client. `RedisSessionStore` only needs `get`, `set` with `PX`, `del` and `eval`, so an adapter over Upstash's REST API suffices. Store the URL and token as Worker secrets:

```ts
import { RedisSessionStore } from '@meekojs/meeko/server'
import type { RedisSessionClient } from '@meekojs/meeko/server'

/** Minimal Upstash REST API client for RedisSessionStore. */
function upstashClient(url: string, token: string): RedisSessionClient {
	const command = async (...args: Array<string | number>): Promise<unknown> => {
		const response = await fetch(url, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify(args),
		})
		const body = (await response.json()) as { result?: unknown; error?: string }
		if (!response.ok || body.error) throw new Error(`Upstash ${String(args[0])} failed: ${body.error ?? response.status}`)
		return body.result
	}
	return {
		get: async (key) => (await command('GET', key)) as string | null,
		set: (key, value, { PX }) => command('SET', key, value, 'PX', PX),
		del: (key) => command('DEL', key),
		eval: (script, { keys, arguments: args }) => command('EVAL', script, keys.length, ...keys, ...args),
	}
}

// In the server/runtime.ts factory:
const store = new RedisSessionStore(upstashClient(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN), { prefix: 'mi-app:prod:' })
```

The REST API does not maintain a subscription, so do not pass `subscriber`: revocations are detected on rereading the session, as with D1.

Workers KV is unsuitable as a session store: it offers neither atomic comparison nor family deletion operations and is eventually consistent, so it cannot guarantee `replace` or `revokeFamily`. `SessionManager({ production: true })` rejects stores that do not implement both operations.

#### Socket and Durable Objects

The Worker checks the route, Origin and channel authorization before upgrading, with the same responses as other adapters: HTTP `400`, `403` `INVALID_ORIGIN` and `404`, and session or authorization rejections with close `4401` or `4403` (see [WebSocket](framework-websocket.md#websocket)), performed by the Worker itself with a `WebSocketPair` without waking the room's Durable Object. If accepted, it forwards the connection to its room's Durable Object: `env.MEEKO_SOCKET.idFromName(canal + "\0" + sala)`. Each channel/room pair is an object that:

- accepts the WebSocket with the hibernation API (`ctx.acceptWebSocket`), so idle connections do not keep the object in memory;
- stores the channel, room, URL, session cookie (only the cookie with `SessionManager`'s name, rather than the rest of the `Cookie` header) and the `origin` and `authorization` headers using `serializeAttachment`. On wakeup it rebuilds each connection from that state and the hub reauthorizes it. Channels see the same headers before and after hibernation. `keepHeaders` adds others (lowercase; `"cookie"` retains the complete header). Cloudflare limits this attachment to 16,384 serialized bytes: Meeko estimates the size before accepting the WebSocket and, if it does not fit, responds with `431` and notifies `onError` instead of opening a connection that would close with `1011`;
- responds `pong` to a `ping` text message without waking (configurable with `autoResponse`, or `false` to disable it). The runtime always responds to protocol pings;
- closes messages larger than `maxMessageBytes` (by default, the application's Socket limit or 64 KiB) with `1009`, and binary messages with `1003`.

`DurableObjectSocketPubSub(env.MEEKO_SOCKET)` is the default broker in Workers: `publish` delivers the message to the room through RPC to the Durable Object (or directly if already running inside it) and resolves when the room accepts it; the room distributes messages to its peers in publication order. Subscriptions only exist inside the room's Durable Object; that is why every upgrade must pass through `createWorker`. A broadcast from an API or another room works the same. `runtime.socket.pubsub` can only be omitted or be a `DurableObjectSocketPubSub`: `LocalSocketPubSub`, `RedisSocketPubSub` or another broker would only deliver to subscribers within one isolate, so the Worker and room reject the application on creation with “Socket channels on Cloudflare Workers require DurableObjectSocketPubSub…”.

Room delivery:

- Each publication is delivered to already subscribed peers. A newly accepted connection still undergoing authorization does not delay others; it receives publications after its authorization, as in other adapters.
- On waking from hibernation, the room rebuilds open connections and publications wait for reauthorization, up to `rebuildTimeoutMs` (5000 ms by default) from the start of each rebuild; a connection that does not finish in time receives only subsequent publications.
- A room accepts at most `maxPendingPublications` undelivered publications (1024 by default). Above that, `publish` (and therefore `broadcast`) rejects with `SOCKET_BACKLOG_EXCEEDED` (503) and the message is not delivered.
- The room name comes from `ctx.id.name`; when the runtime does not provide it (names over 1,024 bytes), the room takes it from its first connection or publication, and publications to itself still avoid RPC.
- Workers WebSockets do not report `bufferedAmount`, so `socket.maxBufferBytes` does not apply in rooms; `maxMessageBytes` and `maxPendingDeliveries` still limit each peer.
- If the application cannot be created on wakeup, the room reports the error and closes the WebSocket that woke it with `1011`.

Performance: a Durable Object runs its code on a single thread, so all messages and broadcasts in a room are processed serially in one place. This provides order and consistency but limits throughput in a very busy room; distribute traffic across multiple rooms (for example, per document or group) instead of a global room. Consult the current Durable Object limits in Cloudflare's documentation.

For a custom Worker, `@meekojs/meeko/cloudflare` exports the pieces used by the build:

- `createWorker(app, { socketBinding?, publicOrigin?, onError? })` returns the module's `{ fetch }` handler. `app` is a `ServerApp` or a `({ env, platform }) => ServerApp | Promise<ServerApp>` factory that runs once per isolate; if it fails, the next event retries it.
- `createSocketRoomClass(app, DurableObject, { maxMessageBytes?, autoResponse?, keepHeaders?, maxPendingPublications?, rebuildTimeoutMs?, onError? })` creates the room class. `DurableObject` is imported from `cloudflare:workers` and passed as an argument so the module can load outside Workers. The Worker generated by `meeko build` uses these options' defaults; changing `keepHeaders`, `maxPendingPublications` or `rebuildTimeoutMs` requires a custom Worker.
- `DurableObjectSocketPubSub`, `socketRoomName(canal, sala)`, `D1SessionDriver`, `createCloudflareAssetReader({ binding, assets })` and `createCloudflarePrerenderSource({ binding, directory? })`.
- `ServerAppOptions.defaultSocketPubSub` sets the broker when `server/runtime.ts` does not declare `socket.pubsub`, and `openSocketSession` from `@meekojs/meeko/server` connects an already accepted peer to the hub.

### Adapter conformance

`packages/meeko/tests/conformance/` builds the same test application (`tests/fixtures/conformance-app/`) with each adapter. Before starting the output in its real runtime, it removes sources; for Bun, Deno and workerd it also removes `node_modules`. The `workerd` variant builds with the `cloudflare` adapter and runs the output with the same local runtime as `wrangler dev` (workerd behind Wrangler's proxy, through `createTestHarness`), with in-memory D1 and Durable Objects. The same assertions cover:

- SSR with loader and platform, API, RPC, CSRF and Origin, including default `Origin` for anonymous mutations (since `1.8`) and `origin: "none"`;
- `404`, `405` with `Allow`, and `HEAD`, including a routeless page's `404` with `app/error.meeko` inside layouts;
- assets with `ETag`/`304` and cache policy, and traversal attempts (`..`, `%2e%2e`, `%2f`, `%5c`) and attempts to read build files;
- prerendered pages with the session's CSRF meta tag;
- middleware order;
- Socket: route, Origin, authentication, size limits, validation and binary messages, message order for a peer and broadcast between two room connections;
- process failures: an unhandled rejection reaches the runtime's `onError` and the output keeps serving, and an uncaught exception reaches `onError` and the output exits with code 1 (except in workerd).

The `workerd` variant adds D1 sessions (also read from a private channel's Durable Object), forced room hibernation (`evictDurableObject` with `webSockets: "hibernate"`) followed by messages in both directions, `ping`/`pong` auto-response and a broadcast from the API, room-to-room publication through RPC without leaking to third-party rooms, a connection with a `Cookie` header exceeding the attachment limit, a room whose name exceeds 1,024 bytes, and output as a single `worker.js` module. The streaming test requests `accept-encoding: identity`: Wrangler's local runtime (Miniflare) emulates Cloudflare compression for `text/html` without respecting `no-transform`, and its gzip encoder only writes when the body closes, so with `wrangler dev` or `meeko preview --adapter cloudflare`, a browser accepting gzip receives complete `"stream"` pages at the end. This is a local environment limitation: in production, Cloudflare compression respects `no-transform`.

```sh
pnpm run conformance          # node, bun, deno and workerd
pnpm run conformance:bun      # or :node / :deno / :workerd
```

Node always runs. Bun and Deno are looked up in `MEEKO_BUN`/`MEEKO_DENO`, then in `PATH` and finally in a version installed with `mise` (`mise where bun`). If not found, the suite is skipped with an explicit message. workerd comes with the `wrangler` devDependency; without it, its suite is also skipped. `MEEKO_CONFORMANCE_REQUIRE=bun,deno,workerd` turns that skip into a failure; CI uses it in its Bun, Deno and workerd jobs.

`pwsh -NoProfile -File packages/meeko/tests/fullstack-consumer.ps1` installs a local tarball in an independent project, generates types, builds production, removes application sources, starts the Node build and tests HTTP, assets, prerendered pages with CSRF, two sessions, RPC/CSRF, real WebSocket and Chrome. It also creates `meeko init-framework` from that package and installs, type-checks and builds the generated starter. The fixture contains `/`, `/users`, `/users/[id]`, `/dashboard`, `/chat` and `/layer-demo` pages; its TypeScript assertions check valid and invalid inputs and outputs for API, RPC, Socket, routes and `ComponentProps` imported from a `.meeko` page of the installed package.

Before preparing a release, run `pnpm install --frozen-lockfile`, `pnpm run verify`, `pnpm run e2e`, `pnpm run pilot:e2e`, `pnpm run package:smoke`, `pnpm run conformance` (with Bun and Deno installed; workerd comes with `pnpm install`), the Redis test above, `pwsh -NoProfile -File packages/meeko/tests/fullstack-consumer.ps1`, `pnpm pack` (in `packages/meeko`) and `git diff --check`. CI runs these families of checks, including Node conformance, on Windows; Redis and Bun, Deno and workerd conformance run on Ubuntu. The workflow's existence does not replace a green CI run. The release workflow repeats the gates and only responds to a version tag; the maintainer decides whether to create it.

### Troubleshoot pnpm and Redis

If pnpm 12 reports `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`, check the effective user and the file's ACL. In a restricted Windows sandbox, `codexsandboxonline` may lack write access to `all-stores.lock`; `--store-dir` and `LOCALAPPDATA` alone do not change that location. Do not delete the store or change global ACLs to work around this case. In a normal Windows terminal with profile access, `pnpm install --frozen-lockfile` works without that adjustment.

A frozen installation with pnpm 12.14.0 passed in a clean copy by isolating the profile only within the PowerShell process launching pnpm, with the exact command `pnpm install --frozen-lockfile`, without dependency links:

```powershell
$isolatedProfile = Join-Path (Get-Location).Path '.meeko/pnpm-profile'
$env:USERPROFILE = $isolatedProfile
$env:LOCALAPPDATA = Join-Path $isolatedProfile 'AppData/Local'
$env:APPDATA = Join-Path $isolatedProfile 'AppData/Roaming'
New-Item -ItemType Directory -Path $env:LOCALAPPDATA, $env:APPDATA -Force | Out-Null
pnpm install --frozen-lockfile
```

Run the block only in a new, restricted PowerShell process so the variables revert on exit. An earlier sandbox version also produced `uv_os_get_passwd returned ENOMEM` in `node:os.userInfo()` before loading `tsx`; that error belongs to the environment. Verification in normal Windows requires no preload or Meeko changes.

The Redis test requires `MEEKO_REDIS_URL` to point to an accessible test server. A connection error or `WRONGTYPE` must fail; the adapter does not grant access to a session when Redis is unavailable. Use a different prefix per project and environment; do not run `FLUSHALL` or `FLUSHDB` on shared Redis.

`pnpm run pilot:e2e` records each engine and environment and bounds its launches. Chromium, Firefox and WebKit passed in development and production on normal Windows without changing browser protections. A restricted sandbox may prevent Firefox from creating a page; diagnose that environment with `DEBUG=pw:browser*` before attributing the failure to the framework.

## Performance and baseline

`pwsh -NoProfile -File packages/meeko/tests/fullstack-consumer.ps1 -Benchmark` reproduces the external consumer, builds the minimal application and writes `packages/meeko/.meeko/benchmarks/stability-baseline.json`. The retained baseline is in `packages/meeko/benchmarks/baseline-2026-10-24.json`. Each timing uses seven samples and two warmups; the JSON contains median, 10th/90th percentiles and extremes. Cold compilation uses a new worker per sample; HMR measures a visible edit in Chrome with a new Vite server per sample. SSR and dispatchers are measured in-process with `app.fetch` on the production Node build, including server middleware; SSR uses `/?benchmark=ssr` to avoid measuring the prerendered copy of `/`. Size measurements include gzip-compressed JS and CSS. These are measurements from this machine, rather than CI thresholds.

The generated client entry point records `meeko-hydration` in the browser. The current benchmark measures navigation from clicking a link until the new route appears; the historical baseline measured a direct call to `mountClientApp.navigate`. Because of this change in method, do not compare navigation figures between the two runs as if they were a runtime regression. The historical JSON remains unchanged.

| Metric                    |          Median or size |        p10–p90 |
| ------------------------- | ----------------------: | -------------: |
| Cold compilation          |                 9.40 ms |   9.08–9.45 ms |
| Compilation after an edit |                 0.87 ms |   0.53–1.14 ms |
| Visible HMR               |                28.63 ms | 27.19–29.11 ms |
| SSR per request           |                0.040 ms | 0.032–0.060 ms |
| Hydration                 |                11.10 ms | 10.70–11.20 ms |
| Client navigation         |                 1.90 ms |   1.80–2.10 ms |
| API dispatcher            |                0.019 ms | 0.017–0.019 ms |
| RPC dispatcher            |                0.049 ms | 0.044–0.054 ms |
| Engine bundle             |  19,134 B; gzip 7,222 B |              — |
| Minimal bundle            |  21,314 B; gzip 6,438 B |              — |
| Full-stack bundle         | 36,063 B; gzip 14,897 B |              — |

After 500 SSR renders, the heap went from 87,276,056 to 87,012,304 bytes after GC; maximum observed RSS: 224,952,320 bytes. This sample does not prove the absence of leaks and should only be compared under equivalent conditions.

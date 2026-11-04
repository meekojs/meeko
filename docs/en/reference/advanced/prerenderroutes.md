---
title: prerenderRoutes
group: advanced
since: 1.0.0
description: Prerenders render "prerender" routes with a page handler and writes their HTML, navigation payloads and manifest.json index.
symbols:
  - "@meekojs/meeko/build#prerenderRoutes"
types:
  - "@meekojs/meeko/build#PrerenderOptions"
  - "@meekojs/meeko/build#PrerenderIndex"
related:
  - "cli:prerender"
  - "@meekojs/meeko/build#buildProject"
  - "@meekojs/meeko/server#createFrameworkHandler"
  - "@meekojs/meeko/framework#definePage"
  - docs/framework.md#modos-de-render
  - docs/framework.md#csp-con-hashes
source-hash: 0c839898a014a4e0771e263e448f9924686621dc0c860201634086d094fbd2e1
---

`prerenderRoutes` is the prerendering engine of `meeko build`, without the build: it iterates over `render: "prerender"` routes, generates their URLs (one per static route and one per `prerenderEntries` entry for dynamic routes), requests each from your `handler` and writes the HTML of `200` responses, their navigation payloads (`index.meeko.json`) and a `manifest.json` with each page's file, `ETag` and inline script and style hashes to `outputRoot`.

Use it to prerender with a custom host (for example, with [`createFrameworkHandler`](/en/docs/reference/createframeworkhandler)) or generate a static site from a script.

## Usage

```ts
import { prerenderRoutes } from "@meekojs/meeko/build";
import { createFrameworkHandler } from "@meekojs/meeko/server";
import type { PageModule, PageRoute } from "@meekojs/meeko/server";

const page = (title: string): PageModule => ({ renderWithState: () => ({ html: `<h1>${title}</h1>`, state: {} }) });
const routes = [
  { id: "/", file: "index.meeko", layouts: [], render: "prerender" as const },
  { id: "/blog/[slug]", file: "post.meeko", layouts: [], render: "prerender" as const, sidecar: "post.route.ts" },
];
const pages: Record<string, PageModule> = { "index.meeko": page("Home"), "post.meeko": page("Article") };
const sidecars: Record<string, PageRoute> = { "post.route.ts": { render: "prerender", prerenderEntries: [{ slug: "hola" }, { slug: "adios" }] } };
const loadRoute = async (file: string) => sidecars[file]!;

const files = await prerenderRoutes({
  routes,
  handler: createFrameworkHandler({ routes, loadPage: async (file) => pages[file]!, loadRoute }),
  loadRoute,
  outputRoot: "dist/prerender",
});
console.log(files); // [ ".../dist/prerender/index.html", ".../blog/hola/index.html", ".../blog/adios/index.html" ]
```

## Options

| Option          | Type                                  | Default              | Description                                                                                                                        |
| --------------- | ------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `routes`        | `RouteRecord[]`                       | required             | Route manifest; only `render: "prerender"` routes render.                                                                          |
| `handler`       | `(request) => Promise<Response>`      | required             | Renders a page. Must not run `server/middleware`, which runs again when serving the file.                                          |
| `outputRoot`    | path                                  | required             | Output folder for HTML, payloads and `manifest.json`.                                                                              |
| `loadRoute`     | `(file) => Promise<PageRoute>`        | none                 | Loads a route's sidecar to read `render` and `prerenderEntries`. Without it, only `RouteRecord.render` counts.                     |
| `origin`        | origin                                | `http://meeko.local` | Origin for render requests.                                                                                                        |
| `transformHtml` | `(html) => string \| Promise<string>` | none                 | Transforms HTML before saving it.                                                                                                  |
| `extendUrls`    | `(urls) => void \| Promise<void>`     | none                 | Since `1.2`. Receives URLs and can add or remove them; each added URL must have a route. This is modules' `prerender:routes` hook. |

## Return value

A promise with absolute paths of written HTML files. For each page, `outputRoot` contains `<ruta>/index.html` (the root is `index.html`) and `<ruta>/index.meeko.json`, plus a `manifest.json`:

```json
{"version":1,"pages":{"/":{"file":"index.html","headOffset":147,"etag":"\"pAsBx…\"","payload":"index.meeko.json","scriptHashes":[],"styleHashes":[]}}}
```

Rejects if a dynamic route lacks `prerenderEntries` (`Dynamic prerender route /blog/[slug] requires prerenderEntries`), a URL is duplicated or handled by another route, a page does not respond with `200` HTML, or a `render: "client"` route declares `prerenderEntries`. If `handler` rejects, the message includes the URL, route file and error stack, retained in `cause`.

## Examples

### Add a footer to HTML

<!-- no-check -->

```ts
await prerenderRoutes({
  routes, handler, loadRoute, outputRoot: "dist/prerender",
  transformHtml: (html) => html.replace("</body>", `<!-- generated on ${new Date().toISOString()} --></body>`),
});
```

`manifest.json` hashes are computed from the final HTML, so a script added by `transformHtml` is included in the CSP.

### Add URLs from a CMS

<!-- no-check -->

```ts
await prerenderRoutes({
  routes, handler, loadRoute, outputRoot: "dist/prerender",
  extendUrls: async (urls) => {
    for (const slug of await cms.listSlugs()) urls.push(`/blog/${slug}`);
  },
});
```

## Common mistakes

### A dynamic route without entries

```ts bad
const sidecars = { "post.route.ts": { render: "prerender" } };
```

`Dynamic prerender route /blog/[slug] requires prerenderEntries`: there is no way to know which URLs to generate.

<!-- no-check -->

```ts good
const sidecars = { "post.route.ts": { render: "prerender", prerenderEntries: async () => (await cms.listSlugs()).map((slug) => ({ slug })) } };
```

### A handler that runs server middleware

```ts bad
await prerenderRoutes({ routes, handler: (request) => app.fetch(request), outputRoot });
```

`createServerApp`'s `app.fetch` runs `server/middleware` and serves already prerendered pages. Middleware would run twice (during prerendering and serving), and middleware requiring a session would respond with `401`, stopping prerendering because only `200` responses are accepted.

<!-- no-check -->

```ts good
await prerenderRoutes({ routes, handler: createFrameworkHandler({ routes, loadPage, loadRoute }), loadRoute, outputRoot });
```

### Omit `loadRoute` when the option is in the sidecar

```ts bad
await prerenderRoutes({ routes: [{ id: "/about", file: "about.meeko", layouts: [], sidecar: "about.route.ts" }], handler, outputRoot });
```

Without `loadRoute`, `prerenderRoutes` only sees `RouteRecord.render`: a route declaring `render: "prerender"` only in its sidecar is not prerendered and the result is `[]`.

<!-- no-check -->

```ts good
await prerenderRoutes({ routes, handler, loadRoute, outputRoot });
```

## Notes

- **Only `200` HTML.** A response with another status or without HTML stops prerendering; nothing is partially written for that URL.
- **Output folder.** Writes into `outputRoot` without clearing it; `meeko build` and `meeko prerender` delete it first.
- **Query string.** Prerendered URLs have no query: a request with `?…` to that route is rendered with SSR when served.
- **CSP.** Each page's `scriptHashes` and `styleHashes` are used by the server (since `1.7`, with any server adapter) and the `static` adapter to complete `Content-Security-Policy`. Since `1.7` they only cover inline code Meeko writes outside `#app` and teleports, so a `<script>` or `<style>` arriving in page content is blocked.
- **Performance.** URLs render one after another with the same handler; a slow loader delays the entire prerendering process.

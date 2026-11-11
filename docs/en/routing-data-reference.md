---
source-hash: 19f196ddf561aea9274d184c4b6a104f4f2c5a007ef0f57d57d640b3426fde17
---

# Data and rendering: technical details

Full contracts for server code, rendering modes, streaming and page caching. Start with the [short guide](routing-data.md) for the usual choices.

## Application error page (`app/error.meeko`)

`app/error.meeko`, alongside `app/app.meeko`, is the application-wide error page. It receives the same props as `+error.meeko`, `{ status: number; message: string }`, and `meeko check` checks them in the same way. It is used in two cases:

- **Unmatched URL.** A page request (GET or HEAD with `accept: text/html`, or navigation with `accept: application/meeko+json`) responds `404` with `app/error.meeko` inside the root layouts: `app/app.meeko` and `app/layouts/default.meeko` (or `app/pages/+layout.meeko`). The props are `{ status: 404, message: "NOT_FOUND" }`. Like a route's error page, the document is titled `Error` (`<title>` in SSR and `document.title` when navigating to an unmatched URL). The document includes the hydration payload, so the browser hydrates it and subsequent navigation works. In the browser, a link or `navigate()` to an unmatched URL loads the document: that URL may belong to server middleware, a file or a redirect, and checking it first with `fetch` would run a `GET` with side effects twice. If nothing else handles it, the server responds with `app/error.meeko`. For the same reason, returning through history to an unmatched entry reloads the document; navigation from the `404` page to application routes is client-side.
- **Failed page.** The nearest `+error.meeko` still takes priority; if none exists, `app/error.meeko` is used. The same applies to a `render: "client"` route's browser loader.

`/api/...`, `/_meeko/...`, assets and non-page requests keep their `404` responses (JSON or text). Without `app/error.meeko`, nothing changes: an unmatched URL responds `404` in plain text and the browser reloads the document. `app/error.meeko` and `app/pages/+error.meeko` would define the same level, so having both is a discovery error. In a layer or module, `app/error.meeko` backs up its own pages; the `404` uses the project's page. A custom host passes the page through `errorPage` to `createFrameworkHandler` and `mountClientApp` (`AppManifest.errorPage` in `createServerApp`).

## Page server code

A page declares its server code in a `<script server lang="ts">` block inside the `.meeko` file itself, so `app/pages` contains only `.meeko` files. The block supports two forms. They can coexist in the same block, except `load`, which cannot be combined with top-level code:

- **Top-level code** (since `1.1`). The block is normal server code: it reads the request, queries the database, redirects or responds `404`, and each `export const` is page data that reaches `<script>` and the template with its type.
- **Route options.** `export const route = definePage({ params, search, render, prerenderEntries, load, head })`, the `1.0` form, still works unchanged; since `1.5`, also `layout` and `layoutProps` (see [Named layouts](routing-layouts.md#named-layouts)), and since `1.7`, `sitemapEntries` (see [Dynamic routes in the sitemap](framework.md#dynamic-routes-in-the-sitemap-sitemapentries)).

### Top-level code and exported data

```html
<!-- app/pages/users/[id].meeko -->
<script
	server
	lang="ts"
>
	import { definePage } from '@meekojs/meeko/framework'
	import * as v from 'valibot'

	export const route = definePage({ params: v.object({ id: v.string() }) })

	const { params, context } = usePage() // the current request, typed by route.params
	if (!context.session.current) redirect('/login')
	const row = await db.users.findById(params.id) // db: an auto-import from server/utils; row stays on the server
	if (!row) notFound()
	export const user = { id: row.id, name: row.name } // sent to the page
	export const head = { title: `Profile of ${user.name}` }
</script>

<script lang="ts">
	const name = signal(user.name) // `user` is in scope and typed
</script>

<template>
	<h1>{user.name}</h1>
	<input model="name" />
</template>
```

- **When it runs.** Block statements other than imports, types and `export const route` run on each request: in SSR and each client navigation's data request, after middleware and validation of `params` and `search` with `route`, just like `load`. They support top-level `await`. Imports, types and route options evaluate once per module.
- **Exports.** Each `export const` or `export let` (including destructuring, `export const { a, b } = ...`) except `route` and `head` is a page data field. Only exported names cross the boundary: the rest of the block, its imports and private variables do not reach the client bundle or payload. An export that is a promise is awaited before rendering.
- **In the page.** `<script>` and the template see each export as a normal, deeply read-only value, with the already-awaited export type. It is not a signal: it arrives in the payload and is replaced on each navigation when the block runs again. For editable state, create a signal from it (`signal(user.name)`). Declaring a name in `<script>` that the block already exports produces `MEEK075`. The page does not need to declare `data` in `defineProps`; if it does, `meeko check` checks compatibility with the exports.
- **`export const head`.** Sets the page's `<head>` like `route.head`: a `{ title, description }` object or a zero-argument function returning it, calculated on the server from block values. It is not part of the data. Declaring both `export const head` and `route.head` produces `MEEK072`. Since `1.2`, top-level `useHead` and `useSeoMeta` in the block are an alternative, with `export const head` taking priority (see [Document head](framework.md#document-head-document-usehead-and-useseometa)).
- **Request API.** `usePage()` returns `{ url, params, search, request, context, signal }`: `params` and `search` come from `route` schemas or, without a schema, from the route ID segments; `context` is the request context (session, services, platform) and `signal` aborts if the client disconnects, the session is revoked or the response is canceled. `redirect(url, status?)` stops the block and responds with a redirect (`302` by default; supports `301`, `302`, `303`, `307` and `308`), which client navigation follows like a loader redirect. `notFound()` stops the block and responds `404` with the nearest error page (`+error.meeko` or `app/error.meeko`). All three are imported from `@meekojs/meeko/framework` or used without an import inside the block. They work while top-level code runs: also inside a block helper called by that code (`function requireAdmin() { … redirect("/login") }`), even if it is `async`. Where no page is in progress, they produce `MEEK073`, and at runtime throw an error with that code: in route options, in a block without top-level code, in the component's `<script>` (since `1.3`, also without an import in `<script>` and the template) and, since `1.7`, in a function Meeko calls to calculate the head after top-level code has finished (`export const head = () => …` and the function passed to `useHead(() => …)` or `useSeoMeta(() => …)`); read values obtained by top-level code there. `meeko check` cannot know whether a block function is called later (from a timer, for example): in that case, the error only appears at runtime.
- **Serialization.** Exports travel in JSON, like `load` data. `meeko check` produces a type error for a non-serializable export: functions, `undefined`, `bigint`, symbols and class instances such as `Date` or `Map`. At runtime, a value rejected by `serializeJson` fails the response with `500`, like a loader.
- **State between requests.** Because the block runs on each request, a top-level variable (`const cache = new Map()`) is new each time. A value that must be shared between requests belongs in an imported module.

Meeko considers a block to have top-level code if it exports a name other than `route` (including `head`) with `export const` or `export let`, or uses `usePage`, `redirect` or `notFound` (since `1.2`, also `useHead` or `useSeoMeta`) outside any function and outside route options. A block with neither retains `1.0` behavior: it evaluates once as a module and supports `export default`, `export function` or a private constant used by `load`. With top-level code, these rules apply:

| Code      | Cause                                                                                                                                                                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MEEK070` | Top-level code and `route.load` together: exports are the page data. Choose one.                                                                                                                                                                                           |
| `MEEK071` | `export function`, `export class`, `export enum`, `export default`, `export { ... }` or `export const route` alongside other declarations in the same statement.                                                                                                           |
| `MEEK072` | Both `export const head` and `route.head`.                                                                                                                                                                                                                                 |
| `MEEK073` | `usePage`, `redirect` or `notFound` where no page is in progress: in route options, in a block without top-level code, in the component's `<script>` and template and, since `1.7`, in `export const head = () => …` or the function passed to `useHead` and `useSeoMeta`. |
| `MEEK074` | Top-level code on a `render: "client"` page, whose block runs in the browser. Use `useApi` or `useRpcQuery`, or render on the server.                                                                                                                                      |
| `MEEK075` | A name exported by the block is also declared in `<script>`.                                                                                                                                                                                                               |
| `MEEK076` | Route options read a name declared by top-level code, which runs later and on each request. Move the shared value to an imported module.                                                                                                                                   |

The editor gives exports their type in `<script>` and the template, and “Go to definition” on `user` takes you to the block's `export`.

### Route options with `definePage`

```html
<!-- app/pages/users/[id].meeko -->
<script
	server
	lang="ts"
>
	import { definePage } from '@meekojs/meeko/framework'
	import * as v from 'valibot'

	export const route = definePage({
		params: v.object({ id: v.string() }),
		load: async ({ params, signal }) => ({ id: params.id, signalAborted: signal.aborted }),
		head: ({ data }) => ({ title: data.id }),
	})
</script>

<script lang="ts">
	export interface Props {
		params: { id: string }
		search: Record<string, string | string[]>
		data: { id: string; signalAborted: boolean }
	}
	const props = defineProps<Props>()
</script>

<template><h1>{props.data.id}</h1></template>
```

### Common rules

The block is a TypeScript module independent of the component:

- **Server only.** The compiled component never includes it. It runs on the server with `server/utils` auto-imports and can import `server/` and `*.server.*` modules; relative imports resolve from the page's folder. Only a `render: "client"` route sends it to the browser (see “Rendering modes”).
- **Route options.** Just like a sidecar: `export const route = definePage({ ... })` or, without top-level code, `export default`. `render` and, since `1.5`, `layout` must be literals that `meeko build` can read without executing it.
- **Pages only.** A `<script server>` in a component, layout, `+layout.meeko` or `+error.meeko` is an error (`MEEK044`). A second block produces `MEEK004`, omitting `lang="ts"` produces `MEEK006`, and a value (`server="..."`) produces `MEEK043`.
- **Checking.** `meeko check` checks the block with TypeScript in server scope and compares its loader or exports with the page props; errors point to the `.meeko` line and column.

`head({ data })`, or `export const head`, returns the page's `title` and, since `1.1`, its `description`. In SSR, `title` goes in `<title>` and `description` in `<meta name="description">`, before the host's `<head>`; on navigation, they apply to `document.title` and that meta tag. A page without `title` or `description` leaves those provided by the host in `document.head`, or none, equally in SSR and navigation. Since `1.2`, route `head` also supports `useHead` tags and attributes (`meta`, `link`, `script`, `style`, `htmlAttrs`, `bodyAttrs` and `titleTemplate` as a string), with the highest priority over `useHead` and configuration `document`; the host's title and description remain after Meeko's managed head (see [Document head](framework.md#document-head-document-usehead-and-useseometa)).

Alternatively, route options can live in a `*.route.ts` sidecar next to the page (`app/pages/users/[id].route.ts`), the form available since `1.0`. A sidecar does not support top-level code. A page cannot declare both: Meeko stops route discovery with an error naming both files.

Route options validate params and search before the loader and top-level code. A loader can return a `Response` to redirect; top-level code uses `redirect()`. On client navigation, if the data request responds `404` (from `notFound()` or a loader `ApiError` with status `404`), the browser shows the nearest `+error.meeko`, or `app/error.meeko`, with `{ status: 404, message }`, where `message` is the public error code (`NOT_FOUND`), just like the SSR document. `meeko check .` compares each page's `ComponentProps` with the `params`, `search` and data its sidecar provides; a contract error identifies both files. It also checks that `app/app.meeko` and layouts accept the `outlet` supplied by Meeko, and that `+error.meeko` and `app/error.meeko` accept `status` and `message`. These contracts reject props declared as `any`, `never` or `unknown`. Loader data is required for the page when the sidecar declares `load`; a repeated query parameter without a schema can produce `string[]` as well as `string`. The SSR handler creates `useState` state and session context per request; it transfers only props, public state and serializable route data. The browser hydrates that payload and requests server data during navigation, so a private sidecar does not enter the client bundle; only `render: "client"` sidecars are public (see “Rendering modes”). `mountClientApp` manages history, cancellation and cleanup. If a host uses `loadRoute` directly on the client, its loader receives provisional state: Meeko applies its changes when confirming the route and discards them on cancellation or failure. That state's signals must be used during `load`, without retaining references after returning. You can use `render: "prerender"` with `prerenderEntries` for dynamic routes; without them, `meeko build` fails (`Dynamic prerender route /posts/[id] requires prerenderEntries`) and, since `1.7`, so do `meeko check` and `meeko dev` during route discovery, unless an options spread might supply them, which is left to the build. `meeko build` reads `render` from the sidecar without executing it: it must be a string literal inside `definePage({ ... })`, an exported object or a local constant in the same file; a calculated value, a computed key (`["render"]` or `[clave]`) not followed by a literal `render`, a spread without a subsequent explicit `render`, or a re-export stops the build, naming the affected file. The build writes HTML and navigation payloads under `.meeko/output/node/prerender/` (`meeko prerender .` repeats that step on an existing build). The server serves these pages through server middleware, session context and route middleware; it inserts the session CSRF meta tag in `<head>` without rewriting the document. Without a session, it responds with `ETag`, `Vary: cookie` and `cache-control: public, max-age=0, must-revalidate`, returning `304` for `If-None-Match`; with a session, it responds `private, no-store`. A CDN or shared cache in front of the server must respect `Vary: cookie` or avoid storing responses to requests with cookies; if it ignores `Vary`, configure it to bypass caching when a request has the session cookie, otherwise it could deliver the anonymous version to a user with a session, leaving them without a CSRF meta tag. `PrerenderedPage.headOffset` in the `prerender/manifest.json` index is measured in UTF-16 code units of the stored HTML read as text (JavaScript string indices), not bytes: an adapter must read the file as UTF-8 text and use the value as is, without calculating it from bytes. A URL with a query string, an ungenerated dynamic entry or a host with its own CSP nonce (without `server.contentSecurityPolicy`, which since `1.7` serves the file with its hashes) renders with SSR.
Loader checking covers both `definePage({ load() { /* ... */ } })` and `definePage(options)` when the type of `options` retains a required `load`.

### Where each API is used

A component's `<script>` and template run in SSR and in the browser; `<script server>` and `*.route.ts` sidecars run on the server, outside the component. Since `1.3`, `meeko check`, `meeko build` and the editor flag each API where it does not exist, with a message explaining where to use it, and `<script>` and template autocomplete no longer offer server APIs:

| API                                                                                                                                    | `<script server>`                        | `<script>` and template                                              | `*.route.ts` sidecar | `server/`               |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------- | -------------------- | ----------------------- |
| `definePage`                                                                                                                           | Yes: `export const route`                | No effect: `MEEK109` warning, error in `2.0`                         | Yes                  | No effect               |
| `usePage`, `redirect`, `notFound`                                                                                                      | Yes, at top level; outside it, `MEEK073` | No: `MEEK073`                                                        | No: throw `MEEK073`  | No: throw `MEEK073`     |
| `defineApiRoute`, `defineRpc`, `defineServerMiddleware`, `defineSocketChannel`, `defineServerRuntime`, `ApiError`                      | Yes, without an import                   | No: `MEEK108`. In the browser, an API error arrives as `ClientError` | Yes                  | Yes, each in its folder |
| Auto-imports from `server/utils`, `imports.serverDirs` and `*.server.ts` files in any auto-import folder (including `imports.appDirs`) | Yes                                      | No: `MEEK108`. Request data with `useApi` or `useRpcQuery`           | Yes                  | Yes                     |
| Imports from `server/` and `*.server.*` modules                                                                                        | Yes                                      | No: `MEEK108`; `import type` is allowed                              | Yes                  | Yes                     |
| Value imports from `@meekojs/meeko/server` and `/cloudflare`                                                                           | Yes                                      | No: `MEEK108`; `import type` is allowed                              | Yes                  | Yes                     |
| Value imports from `@meekojs/meeko/node`, `/bun`, `/deno`, `/password` and `/build`                                                    | Yes                                      | `MEEK109` warning, error in `2.0`; `import type` is allowed          | Yes                  | Yes                     |
| `defineProps`, `defineEmits`, `defineExpose`, `defineModel`, `defineSnippets`, `useElementRef`, `onMounted`                            | No: `MEEK108`                            | Yes                                                                  | No                   | No                      |

Since `1.6`, [server route middleware](routing-middleware.md#server-route-middleware) (`app/middleware/*.server.ts`) is server code like `server/`: it uses `redirect()` and `notFound()` while running, like top-level `<script server>` code, and `defineServerRouteMiddleware` is auto-imported there; in a component's `<script>` or template it produces `MEEK108`.

With `render: "client"`, the block or sidecar runs in the browser (see [Rendering modes](#rendering-modes)) and cannot use the table's server APIs: a server auto-import, an import from `server/` or a `*.server.*` import stops the build, and the editor flags the auto-import with `MEEK_AUTOIMPORT`. A component inside `server/` (an email template, for example) only renders on the server, so it can use server APIs. The build and `meeko dev` only apply `MEEK108` to the browser bundle: a component outside `server/` imported only by server code (a template in `app/emails/` rendered by an API route) still compiles, as in `1.2`. `meeko check` and the editor, which do not know the import graph, check every component outside `server/` as browser code, just as in `1.2`; put those components in `server/` for them to be accepted.

`MEEK108` flags code that already failed before `1.3`: the server auto-import did not resolve in the browser bundle, `@meekojs/meeko/server` and `/cloudflare` cannot load there, a `server/` import stopped `meeko build`, and macros and `onMounted` do not exist outside `<script>`. `MEEK109` is a warning because that code compiles and loads: `definePage` in a component does not configure the route, and `/node`, `/bun`, `/deno`, `/password` and `/build` functions only fail when called in the browser (see [Stability policy](stability.md#deprecated-apis)).

## Rendering modes

The sidecar's `render` selects how each page reaches the browser:

| Mode              | Server HTML                                                          | Loader and `head`    | Usage                                                     |
| ----------------- | -------------------------------------------------------------------- | -------------------- | --------------------------------------------------------- |
| `"ssr"` (default) | Complete page on each request                                        | Server               | Indexable or personalized content                         |
| `"stream"`        | Page without `defer` values, which arrive later in the same response | Server               | Pages with slow, secondary data                           |
| `"prerender"`     | Complete page generated by `meeko build`                             | Server, during build | Static content                                            |
| `"client"`        | Layouts only, with an empty outlet                                   | Browser              | Dashboards and interactive views without SEO requirements |

Top-level `<script server>` code follows the mode like a loader: with `"ssr"` and `"stream"` it runs on each request, and with `"prerender"` once per entry during `meeko build`. In `"stream"`, an export created with `defer(...)` arrives after the page, like a deferred loader value (see [Streaming SSR](#streaming-ssr-render-stream)). It is not supported with `"client"` (`MEEK074`), because the block runs in the browser.

```html
<!-- app/pages/notes/index.meeko: the block runs in the browser -->
<script
	server
	lang="ts"
>
	import { definePage } from '@meekojs/meeko/framework'

	export const route = definePage({
		render: 'client',
		load: async ({ url, params, search, signal, state }) => api.notes.list({ signal }),
		head: ({ data }) => ({ title: `${data.length} notas` }),
	})
</script>
```

With `render: "client"`, the `<script server>` block (or sidecar) is public: it enters the browser bundle with client auto-imports, even though its tag says `server`.

With `render: "client"`, the server runs server and route middleware, creates session context and validates `params` and `search` against the sidecar schemas (invalid input responds `400`). It then renders `app/app.meeko` and layouts with an empty outlet, without calling `load` or `head`, and sends a payload with `render: "client"` and only `params` and `search`. Without layouts, `#app` is empty. In the browser, Meeko hydrates the layouts, runs `load` with `ClientPageLoadContext` (`url`, `params`, `search`, `signal` and `state`, without `request` or `context`) and confirms the page through the same transactional path as navigation; `head` runs after `load` and its `title` applies to `document.title`. A loader failure shows the nearest `+error.meeko` inside the layouts, with the same public message as the server (`500` reports to the navigation error observer; a 4xx `ClientError` retains its status and code).

Navigation works in both directions between SSR and client pages, preserving common layouts: each route selects its data source. `"client"` pages use their sidecar in the browser and others request their payload from the server. Only `"client"` sidecars enter the client bundle, through the `virtual:meeko-client-routes` virtual module; the generated entry point loads them with `mountClientApp({ loadClientRoute })`. This is why the build applies the same boundary as for other client code: importing `server/` or a `*.server.*` module from that sidecar stops `meeko build`, and only client auto-imports exist in the browser, so using a `server/utils` utility fails with an error naming the auto-import.

Tradeoffs of `"client"`:

- **SEO.** The initial HTML contains neither page data nor its `<title>`. Search engines that do not run JavaScript only see the layouts. Use `"ssr"` or `"prerender"` for indexable content.
- **Data security.** The sidecar is public: it cannot contain secrets or check permissions. Data arrives through API or RPC, and each endpoint must apply its own guards (session, CSRF, authorization and validation). Route middleware protects navigation, but not data.
- **Prerendering.** A `"client"` page cannot be prerendered: declaring `prerenderEntries` alongside `render: "client"` stops `meeko check`/`meeko build` with an explicit error.
- **Consistent build.** The server compares the sidecar's `render` with the build manifest's and responds with an error if they differ; rerun `meeko build` (or restart `meeko dev`) when changing a route's mode.

## Streaming SSR (`render: "stream"`)

A loader uses `defer` to mark data that can arrive after the page. `defer(promise, { timeoutMs })` or `defer((signal) => promise, { timeoutMs })` returns a `Deferred<T>` with `status` (`"pending"`, `"resolved"` or `"rejected"`), `value` and `error` (`{ code, status }`). Reading these fields in a template or `effect` subscribes to the result, because they are backed by signals.

With a factory, Meeko invokes it when the loader returns and passes an `AbortSignal` that aborts when the value is no longer awaited: on `timeoutMs`, if the client disconnects, the session is revoked, the stream is canceled, on a `HEAD` request or, in the browser, when leaving the route. Pass it to `fetch` or your database client to actually cancel the work. An already-started promise cannot be canceled: Meeko only stops awaiting it, unless the work itself uses the loader's `context.signal`, which also aborts in those cases (except the timeout, which is specific to each value).

```ts
// app/pages/posts/[id].route.ts
import { defer, definePage } from '@meekojs/meeko/framework'

export const route = definePage({
	render: 'stream',
	load: async ({ params }) => ({
		post: await api.posts.get({ params }), // critical: included in the initial HTML
		comments: defer((signal) => api.comments.list({ params, signal }), { timeoutMs: 5_000 }),
	}),
	head: ({ data }) => ({ title: data.post.title }),
})
```

```html
<p if:when="props.data.comments.status === 'pending'">Loading comments…</p>
<ul if:when="props.data.comments.status === 'resolved'">
	…
</ul>
<p if:when="props.data.comments.status === 'rejected'">Could not load ({props.data.comments.error?.code}).</p>
```

**Phase 0, before the first byte.** The server resolves the route, creates context and session, runs middleware, validates `params` and `search`, awaits the critical loader (everything outside `defer`), synchronously renders the page and all its layouts with deferred values in `pending`, and calculates `head`, which sees state written during rendering. It then seals state (`StateStore.seal()`: a later write throws `STATE_SEALED` and the deferred value causing it is rejected with `500`), awaits ongoing session changes (`create`, `rotate` or `revoke` started by the loader), and calls `context.session.verify()`; a session revoked while the loader ran responds `401` instead of a partial `200`. State, headers, cookies, CSRF token and `<title>` are fixed at that point: deferred work cannot redirect or change the session. From then on, `create`, `rotate` and `revoke` fail with `SESSION_LOCKED`/`500` before touching the store, so the browser session remains valid: only the deferred value attempting it is rejected, the failure reaches `onError`, and other values keep arriving.

Sealing applies to every rendering mode, not just `"stream"`. A state write from a promise nobody awaits (neither the loader with `await` nor a `defer`) throws `STATE_SEALED` inside that promise; without a catch, it is an unhandled rejection and Node terminates the process with its default configuration. Await that work in the loader or return it with `defer`.

**Phase 1, the stream.** The response has `cache-control: no-store, no-transform` and `x-accel-buffering: no`. First it sends the document through `#app`, the `#meeko-payload` payload (with `deferred: [{ id, path, status: "pending" }]` and `null` at each `path`) and the client entry point with `<script type="module" async>`, respecting the host's CSP nonce. For each value that resolves, in resolution order, a `<script type="application/json" data-meeko-deferred="N">{"deferred":N,"value":…}</script>` follows (or `"error":{"code","status"}`), and finally `</body></html>`. These are data blocks, not executable scripts, so a strict CSP without `'unsafe-inline'` needs no exceptions.

**Errors and cancellation.** A rejection serializes only as `{ code, status }`, with the same rules as the API: an `ApiError` retains its code and status; any other error becomes `INTERNAL_ERROR`/`500`, and its private cause goes to `onError` with the response's `requestId`. A value that does not finish within `timeoutMs` (10 s by default) is rejected with `DEFERRED_TIMEOUT`/`504`. Deferred values follow `RequestContext.signal`: if the client disconnects or an adapter write fails, the stream is canceled, Meeko stops awaiting pending deferred values and aborts their factory signals and the loader's `signal`, without reporting to `onError`; if the session is revoked, remaining values are sent as `SESSION_REVOKED`/`401`. A `HEAD` request receives final headers without a body and also aborts those signals. A promise passed directly to `defer` continues running until it finishes on its own.

**Browser.** The client hydrates with all deferred values in `pending`, as the server rendered them, and applies already-arrived values only when hydration finishes. It finds blocks already in the document and those subsequently added by the parser through a `MutationObserver` on `<body>`. It only accepts direct children of `<body>` after `#meeko-payload`, where the server writes them; a similar-looking block inside `#app` (user HTML, for example) is ignored. If the document ends without a value's block (for example, because a write failed), that value is rejected with `DEFERRED_INCOMPLETE`/`502`. On client navigation to a `"stream"` route, Meeko requests `accept: application/meeko+json` and the server responds `application/meeko+ndjson`: the first line is the payload, with which the route is confirmed, and each following line is `{ "deferred": id, "value" | "error" }`. A malformed line is reported to `onError` without stopping reading; if the connection fails halfway through, the failure is reported and values that did not arrive are rejected with `DEFERRED_INCOMPLETE`/`502`. Navigating to another route cancels the pending read. Other routes still respond `application/meeko+json`.

**`stream` versus `ssr`.** With `render: "ssr"` or `"prerender"`, a `defer` is awaited inside the server before rendering: HTML always contains the resolved value (or its error) and is safe for SEO, so a page can switch modes without changing its template. With `"prerender"`, a rejected value is not saved: the request responds `500` and `meeko build` stops, naming the route and the value's `path`. Prerendered HTML and its `index.meeko.json` come from the same loader execution. Use `"stream"` when a secondary part of the page (comments, recommendations, metrics) is slow and must not delay the first paint or interactivity. Tradeoffs:

- **SEO.** Deferred content is absent from the initial SSR HTML; it is in subsequent data blocks shown only when JavaScript runs. Content that must be indexed must go in the critical loader or an `"ssr"` page.
- **Proxies and CDNs.** A proxy, load balancer or CDN that stores the entire response before forwarding it defeats streaming: the user waits as with `"ssr"`. Meeko sends `x-accel-buffering: no` (respected by nginx) and `cache-control: no-store, no-transform`: `no-transform` asks intermediaries not to compress or rewrite the body, since buffered compression or rewriting would hold back blocks. On Cloudflare, `no-transform` disables compression to the visitor and features that modify HTML, but not read-only inspection: if a zone enables it, create a Configuration Rule with “Response Body Buffering” set to “None” for those routes. Locally, `wrangler dev` and `meeko preview --adapter cloudflare` (Miniflare) gzip `text/html` responses even with `no-transform` and write the compressed body only when finished, so a `"stream"` page appears to arrive all at once at the end unless the client sends `accept-encoding: identity`. In production, Cloudflare compression does respect `no-transform`. Other intermediaries or serverless functions without streaming responses require separate configuration. Node, Bun and Deno adapters write each block as soon as it is produced; the conformance suite checks that the first byte arrives before the deferred value.
- **Final headers.** Redirects, cookies, CSRF and `<title>` depend only on critical data. Moving something into `defer` removes it from those decisions.
- **Browser loaders.** A `"client"` sidecar (or a host using `loadRoute`) can also return `defer`: the browser applies the same `timeoutMs`, updates the value when its promise finishes, and aborts a factory's signal on timeout or when leaving the route.
- **Keys.** A deferred value can be under any own key, including `constructor` and `prototype`, except `__proto__`: the server responds `500` when rendering.

## SSR page caching

Since `1.7`, `definePage`'s `cache` lets you revalidate and cache an `"ssr"` or `"stream"` page without running its loader or render on each request:

```html
<!-- app/pages/docs/[...slug].meeko -->
<script
	server
	lang="ts"
>
	import { definePage } from '@meekojs/meeko/framework'

	export const route = definePage({
		cache: {
			// Cheap: query the modification date, rather than the document.
			etag: async ({ params }) => (await docs.updatedAt(params.slug))?.toISOString(),
			maxAge: 60,
			staleWhileRevalidate: 600,
			memory: { maxEntries: 500 },
		},
		load: ({ params }) => docs.get(params.slug),
	})
</script>
```

- **`etag(ctx)`** returns the content version (a string or number) and runs before the loader and render, with validated `url`, `params` and `search`, plus `request`, `signal` and `context`. Meeko combines it with the request theme (cookie and client hint), build and response type (document or navigation payload) into a weak `ETag`, `W/"…"`. If it matches `If-None-Match`, it responds `304` without a loader, plugins or render. It must change with everything that changes the HTML except the theme: if the page reads a header or search parameter outside `params`, include it. `undefined` leaves that response without an `ETag`.
- **`maxAge`** and **`staleWhileRevalidate`** (seconds) write `Cache-Control: public, max-age=N, stale-while-revalidate=M`. Without `maxAge`, `public, max-age=0, must-revalidate`: the browser revalidates each time and the `ETag` saves the body transfer.
- **`memory`** (`true` or `{ maxEntries, maxBytes }`, defaulting to 1000 entries and 32 MiB per route and process) stores rendered HTML and payload in an LRU, keyed by URL, theme and response type, with the `ETag` used to render them. Since `1.7`, on a route with a `search` schema, the URL part after `?` is the validated `search`: an undeclared parameter (`?utm_source=…`, a random number to bypass the cache) shares the copy instead of filling the LRU; without a schema, the query counts as received, because the page receives it all. While `etag` returns the same value, Meeko serves the copy without a loader or render; when it changes, the copy is discarded and the page renders again. Requires `etag`. Two simultaneous requests finding no copy both render.

The response has `Vary: Accept, Cookie` (and `Sec-CH-Prefers-Color-Scheme` with the theme in `"system"`), because document and payload share a URL and HTML depends on theme and session. With `server.contentSecurityPolicy`, a cached page's document has no nonce and its CSP contains hashes of inline code Meeko writes, never of a `<script>` or `<style>` arriving inside the page (see [CSP and headers in server adapters](framework.md#csp-and-headers-in-server-adapters)); the `304` has no CSP, so the browser keeps its copy's policy.

**What is never cached.** Caching only applies in production (in `meeko dev`, each request renders what was just compiled) and to sessionless `GET` and `HEAD` requests:

- a request with the session cookie, even expired, or with `session.current`, goes out as usual with `no-store` and no `ETag`: its HTML contains that session's CSRF token;
- a response setting a cookie (a loader creating a session, for example) goes out with `no-store`, no `ETag` and no memory copy; in development, Meeko warns once per route in the console;
- since `1.7`, a request with the `Authorization` header goes out with `no-store` and no `ETag`, without reading or writing the copy: the response is for those credentials;
- a host with its own nonce (`DocumentOptions.nonce` without `server.contentSecurityPolicy`) does not cache: the copy would contain another response's nonce;
- a request with the single-use cookie containing a JavaScript-free form's result (`__Host-meeko-form`, or `meeko-form` without HTTPS) receives neither `304` nor the memory copy, is not stored, and on a prerendered page renders instead of serving the file;
- and, in any application response, `Set-Cookie` with a `public` `Cache-Control` or, since `1.7`, with `s-maxage` (including when added by `server.headers`) becomes `private, no-store` without an `ETag`.

**Personalizing with your own cookies.** Meeko only recognizes its session cookie. A page with `cache` that personalizes HTML using another cookie (language, currency, anonymous cart, A/B test) shares it: `etag` does not see it unless it reads it, and `memory` serves the same copy to everyone. `Vary: Cookie` only prevents a shared cache mixing responses with different cookies. If HTML depends on your own cookie, include its value in what `etag` returns and do not use `memory`, or do not use `cache` on that page.

**Middleware.** Route middleware (isomorphic and server) always runs, before the `304` and the memory copy: caching never bypasses a guard. With `memory`, application plugins do not run on a request served from the copy.

**`render: "stream"`.** Only uses `ETag` and `304`: its body goes out as `defer` values resolve, so storing it would require waiting for all of them (the opposite of a stream) and fix values that can change on each request. Its `Cache-Control` adds `no-transform`, as always, and its CSP contains the document hashes without deferred values, which are JSON data blocks. With `"prerender"`, `cache` only affects SSR for URLs that were not prerendered; a `"client"` page does not support `cache` (type error and `TypeError` when defining it).

`cache` is read when the route executes, like `load`: `meeko build` does not read it from the file. `definePage` validates it when loading the module (an unknown field, a negative number or `memory` without `etag` throws `TypeError`).

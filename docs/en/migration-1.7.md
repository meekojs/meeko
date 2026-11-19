---
source-hash: f8b7414013448db2bbfe89b4d001e5e81c03592f10c0edb88eebe24aada373bb
---

# Upgrade from 1.6 to 1.7

**From:** 1.6.x. **To:** 1.7.0. **Status:** published on npm; the latest version checked on November 5, 2026 is 1.9.0. **Who acts:** maintainers upgrading an application from 1.6.x to 1.7.0.

`1.7` is a minor release: new features (CSP and headers in server adapters, SSR page caching with `cache`, forms without JavaScript with `form` and `useForm({ action })`, SQL `rateLimit`, `clientAddress`, `sitemapEntries`, typed `services` and `debounceMs`/`enabled` in `useApi` and `useRpcQuery`) are optional. Three changes ship as [approved exceptions](stability.md#approved-exceptions) to stability policy: directly casting `context.services` to an incompatible type is a type error, assigning `computed(...).value` throws and `PageInputError.name` is `"PageInputError"`. Other noticeable upgrade changes include CSP hashes covering only Meeko-written code, new checks in `meeko check` and the editor, new auto-imported names, new warnings and Spanish messages. This guide collects them, what to review and how to adopt each feature. The complete list of additions and fixes is in the [CHANGELOG](../../packages/meeko/CHANGELOG.md); compatibility commitments are in the [stability policy](stability.md).

## Recommended order

1. Update `@meekojs/meeko` to exact version `1.7.0` and recompile or rebuild, including prerendered pages: generated code and runtime must have the same version, and `1.7`'s prerender index has CSP hashes computed only from Meeko-written code (see [CSP hashes only for Meeko code](#csp-hashes-only-for-meeko-code)). If you use the VS Code extension, update to `1.7.0`; Meeko DevTools is unchanged (still `1.0.0`).
2. Run `meeko check`. Review [new type and checking errors](#new-type-and-checking-errors): `context.services` casts, prop assignments, `useHead`'s `on*` handlers and `MEEK073` in head functions.
3. Look for assignments to a `computed`'s `.value`, especially in untyped JavaScript (see [Assigning `computed().value` throws](#assigning-computedvalue-throws)), and `error.name === "Error"` comparisons identifying a `PageInputError`.
4. If using `contentSecurityPolicy` with the `static` adapter or the prerender index's `scriptHashes`, check that no page depends on a `<script>` or `<style>` written inside the template (see [CSP hashes only for Meeko code](#csp-hashes-only-for-meeko-code)).
5. Read [new warnings](#new-warnings) from `meeko dev`, `meeko build` and `meeko check`: unread `meeko.config.ts` keys and `MEEK119`.

## Approved exceptions

### Typed `context.services` and casts

With TypeScript `server/runtime.ts`, `meeko check`, `meeko dev` and the editor generate `.meeko/types/services.d.ts`, and `RequestContext.services` without an explicit type becomes `AppServices`, the type returned by its `services`, instead of `unknown`. A direct cast to an incompatible type is now error `TS2352` in `meeko check`, `meeko build` and the editor:

```ts
// server/api/report.get.ts
export default defineApiRoute({
  contentType: "response",
  // TS2352: Conversion of type '{ db: Database; … }' to type 'ReportServices' may be a mistake…
  handler: ({ context }) => Response.json(buildReport(context.services as ReportServices)),
});
```

This affects only types: the `services` object is the same as in `1.6`. What to change:

- **Usually**: remove the cast, because the type already comes from `server/runtime.ts` (`context.services.db` compiles without `as unknown as MisServicios`).
- **If the cast type was wrong**, correct it; the error identifies exactly that.
- **If the cast is intentional**, write `as unknown as Otro` or type the context with `RequestContext<Otro>`, which still takes priority, like `any`.

A context with other services, such as in a test (`createRequestContext(request, { db: falso }, session)`), is still accepted where `RequestContext` without an argument is expected, such as an untyped route handler: `RequestContext` compares by its services type. To receive a route context in a function, write `RequestContext` without an argument (its `services` are already `AppServices`); `RequestContext<AppServices>` does not accept it. Without `server/runtime.ts`, with a JavaScript runtime file or without `services`, the type remains `unknown`, like `1.6`. See [Service types](framework.md#service-types).

### Assigning `computed().value` throws

`computed(...)` returns a `ReadonlySignal`, so TypeScript already rejected `total.value = 0` (`TS2540`). In untyped JavaScript, or after a cast, writing replaced the computed value until the next recalculation. Since `1.7` it always throws, like writing to props:

```text
TypeError: Meeko computed values are read-only: change the signals it reads, or use a signal
```

Change the signals the `computed` depends on or, if the value is manually written, use a `signal`.

### `PageInputError.name`

`PageInputError.name` is `"PageInputError"`, like `ClientError` and `ApiError`; previously it was `"Error"`. This only affects code comparing `error.name === "Error"` to identify it: use `instanceof PageInputError` or `error.code`, which are unchanged, as is the message.

## Noticeable upgrade changes

### CSP hashes only for Meeko code

Since `1.3`, the prerender index's `scriptHashes` and `styleHashes` and the `static` adapter's CSP were computed over the whole document, so a `<script>` or `<style>` arriving inside the page (CMS content read at build time, unsanitized `html="…"`) was authorized. Since `1.7`, only those Meeko writes outside the page count: `<head>` (theme, `<MeekoAwait>` reservation, `useHead`, `document.head` and component `<style>` blocks), the payload if not a data block, the client entry point and `document.bodyEnd`. A `<script>` or `<style>` inside `#app` or a teleport is blocked, as already happened with the nonce.

If a prerendered or `static` adapter page had a `<script>` or `<style>` written in the template and a CSP without `'unsafe-inline'`, move it to `useHead` (or `document.head` in `meeko.config.ts`) or a file. A custom `.html` in `public/` is still read in full, and `inlineScriptHashes` and `inlineStyleHashes` from `@meekojs/meeko/build` still read the entire document they receive. Rebuild so the index includes new hashes.

### `contentSecurityPolicy()` and `script-src-elem`

With `script-src-elem` in the policy, script hashes go to that directive, consulted by the browser for `<script>` elements, as style hashes go to `style-src-elem` since `1.4`. Through `1.6`, they always went to `script-src`, where they authorized nothing.

### Cookies and shared caches

Every `createServerApp` response with `Set-Cookie` and a `public` or `s-maxage` `Cache-Control` (from the response or added by `server.headers`) becomes `private, no-store` without `ETag`, so no shared cache stores the cookie with the page. If a public response intentionally set a cookie, remove the cookie or serve that response privately.

### `useSocketClient` in SSR

`useSocketClient` (and `useSocket`, `useSocketChannel`) no longer throws during server rendering: without `await`, it returns an inert client remaining `"connecting"`, whose `on` registers nothing and whose `emit` rejects. The browser opens the connection on mount, as before. A surrounding `window` check still works and is no longer needed.

### Prerendered pages with a host nonce

With `server.contentSecurityPolicy`, a prerendered page is served from its file even when the host passes `DocumentOptions.nonce`, using its index's hashes. Without it, as before, a host nonce renders it with SSR.

### `handleProcessErrors` once per application

Alongside `serveNode` or `serveDeno` with `handleSignals`, a second `handleProcessErrors` call added more listeners: each failure was reported twice and two shutdowns competed. Since `1.7`, it adds nothing and returns its own removal function; options differing from the first call are ignored with a warning. Use only one of the two.

### RPC with an unsupported method

`GET` (or any non-`POST` method) to `/_meeko/rpc/...` responds with `405` and `Allow: POST`, as promised by its JSDoc.

### The CLI

- `meeko <comando> --help` (and `meeko help <comando>`) prints help for that command.
- `meeko routes` prepares `.meeko/` like `meeko check`, so `tsc -p .meeko/tsconfig.server.json` works afterward; `buildProject` does the same in a clean project instead of failing with `Tsconfig not found`.
- `meeko check-app ./no-existe` fails with `No existe el directorio …` instead of printing `OK`; a missing component produces `No existe el archivo …`. A script relying on exit code `0` for a nonexistent path must correct the path.
- `meeko init` and `init-framework` accept a folder containing only `.git`, and `init-framework` accepts `bun.lock` and `bun.lockb`.
- `meeko types`, `compile` and `check <componente>` use on-disk filename casing: on Windows and macOS, `meeko types src/app.meeko` with file `App.meeko` writes `App.d.meeko.ts`.
- A second `meeko dev` for the same project warns at startup that the first is still running, without replacing or deleting its record (`.meeko/dev/server.json`).

### New auto-imported names

`useNavigation` (from `@meekojs/meeko/framework`) and `createRoot` (from `@meekojs/meeko`) are auto-imported like `useRoute` and `effect`; `defer` is auto-imported in server code (`<script server>`, `*.route.ts` sidecars, `server/` and `*.server.ts`). Your own export with one of those names, or a file-local import or declaration, takes priority. With auto-imported `defer`, an `export const x = defer(...)` reaches the template as `Deferred<T>` with its exact type: `x.value.value` stops compiling and list items in `x.value` are no longer `unknown`.

### New type and checking errors

All flag code that already failed at runtime or did not do what it appeared to:

| What                                                                                                                                                                                                                         | Where                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `props.x = …` is `TS2540`: the script sees `defineProps<T>()` as `Readonly<T>`. It already threw `TypeError` at runtime.                                                                                                     | `meeko check`, `meeko build` and the editor |
| A DOM event `on*` handler in `useHead`'s `htmlAttrs` or `bodyAttrs` is a type error. It already threw `TypeError` at runtime.                                                                                                | `meeko check`, `meeko build` and the editor |
| `usePage()`, `redirect()` or `notFound()` inside `export const head = () => …` or the function of `useHead(() => …)` and `useSeoMeta(() => …)` in `<script server>` produce `MEEK073`. They failed every request with `500`. | `meeko check`, `meeko build` and the editor |
| A dynamic `render: "prerender"` route without `prerenderEntries` stops discovery (`Dynamic prerender route /posts/[id] requires prerenderEntries`). Previously only `meeko build` failed.                                    | `meeko check` and `meeko dev`               |
| `meeko check componente.meeko` checks the same as the project command: `MEEK044`, `MEEK100` and type errors in its `<script server>`.                                                                                        | `meeko check <componente>` and the editor   |

`meeko check` also accepts `export default definePage(...)` in `<script server>` and a `*.route.ts` sidecar, previously failing with `has no exported member 'route'`, and `signal(props.x ?? 0)` no longer produces `MEEK101`.

### New warnings

- **Unknown configuration keys.** A `meeko.config.ts` key read by neither Meeko nor a module (`meta.configKey`) warns once per configuration with the most similar key (`¿Quisiste decir "sitemap"?`); previously silently ignored. It is not an error because that configuration loaded in `1.6`.
- **`LocalSocketPubSub` in production.** An application with Socket channels and no `socket.pubsub` warns once that the broker is each instance's in-memory broker. An explicit `new LocalSocketPubSub()` in `server/runtime.ts` removes it; with multiple instances, use `RedisSocketPubSub`.
- **`MEEK119`.** An `each:*` or `if:*` attribute unread by any node directive (`each:by` alongside `each:of`, `if:else` alongside `if:when`) was silently written as a literal HTML attribute; `meeko check`, `meeko build` and the editor now warn. Generated HTML is unchanged: remove the attribute or write the intended directive.

### Spanish messages

Validation of `meeko.config.ts` and theme (`server.port debe ser un entero entre 0 y 65535`, `campo desconocido …`), `meeko init` and `meeko init-framework` (`El destino no está vacío`), empty or oversized piped passwords in `meeko auth hash`, missing builds in `meeko prerender` and configuration loading (`No se puede cargar <archivo>: …`) produce Spanish messages. Update scripts or tests searching for their English text. API errors (`contentSecurityPolicy: invalid source …`, `ApiError` codes) are unchanged.

## Adopt new features

### CSP and headers in server adapters

`server.contentSecurityPolicy` and `server.headers`, available only in the `static` adapter through `1.6`, are also available with `adapter: "node"`, `"bun"`, `"deno"` and `"cloudflare"`:

```ts
// meeko.config.ts
export default defineMeekoConfig({
  server: {
    adapter: "node",
    contentSecurityPolicy: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"], // style="…" attributes from a highlighter
      "object-src": ["'none'"],
      "base-uri": ["'none'"],
      "frame-ancestors": ["'none'"],
    },
    headers: {
      "X-Content-Type-Options": "nosniff",
      "/admin/*": { "X-Robots-Tag": "noindex" },
    },
  },
});
```

In production, Meeko completes each response's policy: index hashes for a prerendered page (still served from its file), a fresh nonce per response for other SSR, Meeko code hashes for a page with `cache`, and `default-src 'none'; frame-ancestors 'none'` for API, RPC and navigation JSON. It never adds a nonce or hash to a directive containing `'unsafe-inline'`, unless it has `'strict-dynamic'`. When adopting it:

- Start with the example policy and check for blocked resources in the browser. CSP is not applied in `meeko dev` (Vite injects scripts without a nonce): test with `meeko build` and `meeko preview`.
- An `on*` attribute or `javascript:` URL in HTML is blocked with both nonces and hashes: move it to a script or the component's `on:`.
- An endpoint with `contentType: "response"` returning HTML needs its own `Content-Security-Policy`, because all of `/api/` receives the JSON policy.
- With `'strict-dynamic'`, the client entry point only loads with a nonce, so cached or prerendered pages using hashes do not hydrate.
- Without `contentSecurityPolicy`, the Cloudflare Worker omits the HTML hash parser (about 240 KB less).

See [CSP and headers in server adapters](framework.md#csp-and-headers-in-server-adapters).

### SSR page caching: `cache`

`definePage({ cache })` revalidates and caches an `"ssr"` or `"stream"` page without running its loader or render on every request:

```ts
export const route = definePage({
  cache: {
    etag: async ({ params }) => (await docs.updatedAt(params.slug))?.toISOString(),
    maxAge: 60,
    staleWhileRevalidate: 600,
    memory: { maxEntries: 500 },
  },
  load: ({ params }) => docs.get(params.slug),
});
```

`etag` must be cheap (modification date, not the document) and change with everything changing HTML except the theme. Caching applies only in production and never to a request with a session or `Authorization`, or a response setting a cookie. If a page personalizes HTML with its own cookie (language, currency, A/B test), include that value in `etag` and do not use `memory`, or omit `cache` for that page. See [SSR page caching](framework.md#ssr-page-caching).

### Forms without JavaScript: `form` and `useForm({ action })`

An API endpoint with `form` also handles a native `<form method="post">`, validated against the same `body` schema:

```ts
// server/api/feedback.post.ts
export default defineApiRoute({
  body: feedbackInput,
  response: feedbackSaved,
  form: { redirect: (saved) => `/gracias?id=${saved.id}`, echo: ["comment"] },
  handler: ({ body }) => saveFeedback(body),
});
```

In the component, `useForm({ action: "/api/feedback", … })` renders native submission results during SSR (`errors`, `error`, `failure` or `submitted`), and the form has `method="post"`, `action`, a hidden `return` field with `useRoute().url.value` and `_csrf` with `form.csrfToken`. With JavaScript, `on:submit="form.submit"` still sends JSON with the same definition. When adopting it:

- Each control needs its field's `name`. An unchecked checkbox sends nothing: declare it with `v.optional(v.boolean(), false)`.
- After an error, no submitted values return by default, only code and messages. List in `form.echo` fields the user should not need to retype, never passwords, card numbers or other sensitive data: they travel in a cookie and HTML.
- An asynchronous schema runs once: convert numeric or boolean field strings in the schema itself.
- A form for signed-in users belongs on an `"ssr"` page: prerendered HTML has no CSRF token, so submission without JavaScript would receive `403 INVALID_CSRF`.
- Every native submission requires an allowed `Origin`; a page served with `Referrer-Policy: no-referrer` cannot use native forms.

See [Forms without JavaScript](framework.md#forms-without-javascript-form).

### SQL `rateLimit`

Without Redis, `rateLimit` counters are shared across instances through the database: implement optional `rateLimit(key, windowMs, now)` in your `SqlSessionDriver`, with one atomic statement returning `{ count, windowEndsAt }` (type `SqlRateLimitRow`); `SqlSessionStore` delegates to it. The guide documents a reference PostgreSQL `UNLOGGED` table and its `INSERT … ON CONFLICT DO UPDATE … RETURNING`. On Cloudflare, `D1SessionDriver` implements it with `rateLimitTable`, whose schema comes from `D1SessionDriver.rateLimitSchema()`; optional because it needs a migration. Without driver `rateLimit`, everything remains as in `1.6`. See [SQL rate limiting](framework.md#sql-rate-limiting).

### `clientAddress`

`clientAddress(request, env?)` from `@meekojs/meeko/server` gives the client IP where there is no `RequestContext`, such as `defineServerMiddleware` or an `addServerHandler` handler, using the same policy as `context.clientAddress` and `rateLimit`: connection IP or, with `MEEKO_TRUST_PROXY`, the `X-Forwarded-For` entry added by the outermost trusted proxy. If middleware manually read `X-Forwarded-For`, forgeable by any client, replace it with `clientAddress(request)`. See [Client IP behind a proxy](framework.md#client-ip-behind-a-proxy).

### Dynamic routes in the sitemap: `sitemapEntries`

A dynamic SSR route (`/docs/[slug]`) did not appear in `sitemap.xml`. `definePage({ sitemapEntries })` declares its URLs: a list of `{ params, lastmod?, changefreq?, priority? }` or a synchronous or asynchronous function evaluated once by `meeko build` after prerendering. In a `render: "prerender"` route, it only completes prerendered pages with those fields. See [Dynamic routes in the sitemap](framework.md#dynamic-routes-in-the-sitemap-sitemapentries).

### Typed `services`

With TypeScript `server/runtime.ts`, nothing is needed: after `meeko check` or `meeko dev`, `context.services` has the type returned by its `services`. Remove `as unknown as MisServicios` casts; for a function receiving services, use `AppServices`. A custom host without generated declarations augments `GeneratedServices` manually. See [Service types](framework.md#service-types).

### Search as you type: `debounceMs` and `enabled`

`useApi` and `useRpcQuery` accept `debounceMs` (one request per burst, canceling the in-flight one) and `enabled` (a boolean, signal or function; while `false`, requests nothing and retains `data`):

```ts
const results = useRpcQuery("docs.search", () => ({ q: query.value.trim() }), {
  debounceMs: 200,
  enabled: () => query.value.trim().length >= 2,
});
```

If you had a custom `setTimeout` or an `if` around the query, you can remove it. See [Search as you type](framework.md#search-as-you-type-debouncems-and-enabled).

## The API reference

The site has a new reference at [`/docs/reference`](https://meekojs.com/docs/reference): one page per symbol (components, macros, composables, reactivity, utilities, syntax, server, adapters, commands and configuration), with its exact type from code, examples and common mistakes with actual messages, plus the list of all exports per module at [`/docs/reference/exports`](https://meekojs.com/docs/reference/exports). Sources are in [`docs/reference`](reference/README.md).

## Editor

The VS Code `1.7.0` extension includes Meeko's `1.7` language server: `context.services` typed from `server/runtime.ts`, new auto-imports, `MEEK119`, standalone component checking with project rules and new type errors. With `meeko.languageServer.preferWorkspace` (enabled by default), it uses the project's `@meekojs/meeko` server, so new features arrive when upgrading the package to `1.7`. See [Editors](editors.md).

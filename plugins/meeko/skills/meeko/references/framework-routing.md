# Meeko Framework: routing, data, layouts, middleware

Meeko 1.9 application mode (`@meekojs/meeko/framework`). Pages are `.meeko` files under `app/pages`; the
server renders them (SSR by default), the browser hydrates, and later navigations are client-side using
the same route manifest. Component syntax (`signal`, `bind:`, `on:`, `if:when`, `each:of`, `model`) is
covered elsewhere; this file covers the app layer.

## Project layout

`meeko init-framework my-app` (Node 24+) creates exactly:

```text
my-app/
├─ package.json            # scripts: dev/check/build/start = meeko <cmd> .
├─ meeko.config.ts         # export default defineMeekoConfig({ layers: [], modules: [], imports: { serverDirs: [] } })
├─ tsconfig.json           # only references .meeko/tsconfig.{app,server,shared,config}.json
├─ .env.example  .gitignore  README.md
├─ public/.gitkeep
└─ app/
   ├─ app.meeko            # root shell: <div class="site-root"><MeekoOutlet /></div>
   ├─ layouts/default.meeko# default layout: header + <main><MeekoOutlet /></main>
   ├─ pages/index.meeko    # "/" with definePage({ render: "prerender" })
   └─ styles/main.css      # global CSS, loaded automatically
```

Full conventional tree (create folders as needed; all are discovered automatically):

```text
app/pages/          routes (+layout.meeko, +error.meeko, +group.ts, *.route.ts live here too)
app/layouts/        named layouts: <name>.meeko  (default.meeko = default layout)
app/middleware/     route middleware: *.ts (isomorphic) and *.server.ts (server only)
app/components/     auto-imported components      app/error.meeko  app-wide error page
app/composables/ app/utils/ app/stores/ app/types/  auto-imported (browser-safe code only)
server/api/ server/rpc/ server/socket/ server/middleware/ server/utils/  (server/utils auto-imported server-side)
server/runtime.ts   optional: defineServerRuntime (services, sessions, socket policy)
shared/{types,schemas,utils,constants,enums}/       auto-imported on both sides
.meeko/             GENERATED (types, manifests, entries, output). Never edit, gitignored.
```

Commands: `meeko dev .`, `meeko check .` (types + page contracts; regenerates `.meeko/types/routes.d.ts`),
`meeko build .`, `meeko start .`, `meeko preview .`, `meeko routes .` (prints the manifest).

## File routing

| File under `app/pages`       | Route ID / URL                                                     | `params`                    |
| ---------------------------- | ------------------------------------------------------------------ | --------------------------- |
| `index.meeko`                | `/`                                                                | none                        |
| `about.meeko`                | `/about`                                                           | none                        |
| `users/index.meeko`          | `/users`                                                           | none                        |
| `users/new.meeko`            | `/users/new` (beats `[id]`)                                        | none                        |
| `users/[id].meeko`           | `/users/[id]` → `/users/42`                                        | `{ id: '42' }`              |
| `docs/[...slug].meeko`       | `/docs/[...slug]`                                                  | `{ slug: 'guide/install' }` |
| `(admin)/reports.meeko`      | `/reports` (group, no URL)                                         | none                        |
| `users/[id].route.ts`        | sidecar with route options for `users/[id].meeko`                  |                             |
| `+layout.meeko` (any folder) | nested layout for that folder and below                            |                             |
| `+error.meeko` (any folder)  | error page for that folder and below (props `{ status, message }`) |                             |
| `+group.ts` (any folder)     | `export default defineGroup({ layout, layoutProps, middleware })`  |                             |

- `[x]` = one segment; `[...x]` = one or more segments, must be last. No optional catch-all.
- Static beats dynamic. `users/[id]` + `users/[name]` = collision error.
- Every `.meeko` in `app/pages` whose name does not start with `+` is a page. Put reusable
  components in `app/components`, never in `app/pages`.
- The route ID (used by `href`, `MeekoLink to`, `useRoute().id`) is the file path without groups:
  `"/users/[id]"`, not `"/users/42"`.

## Page anatomy

A page has up to three blocks. `<script server lang="ts">` is **server-only** (unless `render: "client"`),
runs per request, and only its `export const`/`export let` values reach the component.

```html
<!-- app/pages/users/[id].meeko -->
<script server lang="ts">
  import * as v from 'valibot'                                   // any Standard Schema lib
  export const route = definePage({                               // options: evaluated once per module
    params: v.object({ id: v.pipe(v.string(), v.regex(/^\d+$/)) }), // invalid -> 400 before the block runs
    layout: 'default',
  })
  const { params, context, signal } = usePage()                  // no import needed here
  if (!context.session.current) redirect('/login')               // throws; code below never runs
  const row = await db.users.findById(params.id, { signal })     // db: auto-import from server/utils
  if (!row) notFound()                                           // 404 with nearest error page
  export const user = { id: row.id, name: row.name }            // page data (JSON-serializable)
  export const head = { title: `Profile of ${row.name}` }       // page <head>, not data
</script>

<script lang="ts">
  const name = signal(user.name)   // exports are in scope, typed, deeply read-only, NOT signals
</script>

<template>
  <h1>{user.name}</h1>
  <input model="name" />
</template>
```

**Two mutually exclusive data styles** (pick one per page; mixing = `MEEK070`):

1. **Top-level code** (above): statements run per request (SSR and each client navigation's data
   request), after middleware and params/search validation. Supports top-level `await`. Each export
   except `route`/`head`/`layoutProps` is page data. Exported promises are awaited.
2. **`load` option**: data arrives as `props.data`; declare props.

```html
<script server lang="ts">
  import * as v from 'valibot'
  export const route = definePage({
    params: v.object({ slug: v.string() }),
    load: async ({ params, search, signal, context, request, url }) => {
      const p = await catalog.find(params.slug, { signal })
      if (!p) throw new ApiError('NOT_FOUND', 404)                 // NOT notFound() here
      if (p.moved) return Response.redirect(new URL(`/p/${p.moved}`, url), 301) // NOT redirect() here
      return { name: p.name, price: p.price }
    },
    head: ({ data }) => ({ title: data.name, description: `Price ${data.price}` }),
  })
</script>
<script lang="ts">
  export interface Props {
    params: { slug: string }
    search: Record<string, string | string[]>
    data: { name: string; price: number }
  }
  const props = defineProps<Props>()
</script>
<template><h1>{props.data.name}</h1></template>
```

`usePage()` returns `{ url: URL, params, search, request: Request, context: RequestContext, signal }`.
`context` has `session`, `services`, `platform`, `state`, `requestId`, `clientAddress`. Without schemas
`params` is `Readonly<Record<string,string>>` and `search` values are `string | string[]`.

Alternative: put `export const route = definePage({...})` in `users/[id].route.ts` (sidecar). A sidecar
cannot hold top-level code; a page with both a `<script server>` route and a sidecar is an error.

### `definePage` options

| Option             | Value                                                           | Notes                                                                       |
| ------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `params`, `search` | Standard Schema                                                 | Validated per request; failure → `400` (`INVALID_PARAMS`/`INVALID_SEARCH`). |
| `render`           | `'ssr'` (default) \| `'stream'` \| `'prerender'` \| `'client'`  | **String literal** (read without executing the file).                       |
| `prerenderEntries` | `Record<string,string>[]` or `async () => [...]`                | Required for dynamic routes with `'prerender'`; error with `'client'`.      |
| `load`             | `(ctx) => data \| Response \| Promise<…>`                       | Not with top-level code.                                                    |
| `head`             | `(ctx & { data }) => { title?, description?, meta?, link?, … }` | Not together with `export const head` (`MEEK072`).                          |
| `layout`           | layout name literal or `false`                                  | Must exist in `app/layouts`.                                                |
| `layoutProps`      | object, or `({ data, params, … }) => object`                    | Typed against the layout's props; JSON-serializable.                        |
| `middleware`       | `['auth', …]` literal array, or `false`                         | Named middleware; `false` drops inherited ones (not globals).               |
| `cache`            | `{ etag, maxAge?, staleWhileRevalidate?, memory? }`             | `'ssr'`/`'stream'` only; `memory` requires `etag`; prod + sessionless only. |
| `sitemapEntries`   | `[{ params, lastmod?, changefreq?, priority? }]` or fn          | Not with `'client'`.                                                        |

Route options are evaluated once per module and **cannot read variables declared by top-level code**
(`MEEK076`); move shared constants to an imported module.

## Render modes

| `render`    | Initial HTML                     | Data code runs                       | Use for                          |
| ----------- | -------------------------------- | ------------------------------------ | -------------------------------- |
| `ssr`       | full page, per request           | server, per request + per navigation | default, personalized/indexable  |
| `stream`    | page with `defer` values pending | server; deferred values stream later | slow secondary data              |
| `prerender` | full page at `meeko build`       | server, once per entry at build      | static content, `static` adapter |
| `client`    | layouts only, empty outlet       | **browser**                          | dashboards without SEO           |

```html
<!-- render: 'stream' with defer (top-level form). defer is auto-imported only in server code. -->
<script server lang="ts">
  export const route = definePage({ render: 'stream' })
  const { params } = usePage()
  export const post = await posts.get(params.id)                               // critical
  export const comments = defer((signal) => comments.list(params.id, { signal }), { timeoutMs: 5_000 })
</script>
<template>
  <h1>{post.title}</h1>
  <p if:when="comments.status === 'pending'">Loading…</p>
  <ul if:when="comments.status === 'resolved'">
    <li each:of="comments.value ?? []" each:as="c" each:key="c.id">{c.text}</li>
  </ul>
  <p if:when="comments.status === 'rejected'">Failed ({comments.error?.code})</p>
</template>
```

- `Deferred<T>` is not a signal: read `x.status`, `x.value` (maybe `undefined`), `x.error` (`{ code, status }`)
  directly. Default timeout 10 s → `DEFERRED_TIMEOUT`/504. With `ssr`/`prerender`, `defer` is awaited
  server-side (no speedup). Redirects, cookies, `<title>` must depend only on critical data.

```html
<!-- render: 'client' - the "server" block is PUBLIC and bundled for the browser -->
<script server lang="ts">
  export const route = definePage({
    render: 'client',
    load: async ({ signal }) => api.notes.list({ signal }),   // only url/params/search/signal/state
    head: ({ data }) => ({ title: `${data.length} notes` }),
  })
</script>
```

`client` pages: no top-level code (`MEEK074`), no server auto-imports or `server/` imports, no `cache`,
`sitemapEntries`, `prerenderEntries` or named server middleware. Fetch via `api.*`/`rpc.*`/`useApi`/
`useRpcQuery`; each endpoint must enforce its own auth. Changing a route's `render` requires restarting
`meeko dev` / rebuilding.

## Errors

| Situation                                  | Do this                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| Missing resource in top-level code         | `if (!row) notFound()` → 404, nearest `+error.meeko` else `app/error.meeko` |
| Redirect in top-level code                 | `redirect(url, status?)` — status `301\|302\|303\|307\|308`, default 302    |
| Missing resource / other error in `load`   | `throw new ApiError('NOT_FOUND', 404)` (any code/status)                    |
| Redirect in `load` / isomorphic middleware | `return Response.redirect(new URL('/x', url), 302)`                         |
| Bad URL params/search                      | Declare schemas; Meeko answers 400 automatically                            |
| Unmatched URL                              | `app/error.meeko` rendered with `{ status: 404, message: 'NOT_FOUND' }`     |

```html
<!-- app/error.meeko  or  app/pages/<folder>/+error.meeko -->
<script lang="ts">
  const props = defineProps<{ status: number; message: string }>()
</script>
<template>
  <h1>{props.status === 404 ? 'Not found' : 'Something failed'}</h1>
  <p>{props.message}</p>
  <MeekoLink to="/">Home</MeekoLink>
</template>
```

`app/error.meeko` and `app/pages/+error.meeko` together = discovery error. `redirect`/`notFound` work by
throwing: never wrap them in a `try` that swallows. Thrown non-`ApiError` errors become
`INTERNAL_ERROR`/500 publicly. Validate open redirects (`?next=`): must start with `/` and not `//`.

## Layouts

Nesting order: `app/app.meeko` → named layout (`app/layouts/<name>.meeko`) → folder `+layout.meeko`
files (outer → inner) → page. Shared layouts stay mounted across navigations (state, focus, scroll).

```html
<!-- app/layouts/dashboard.meeko -->
<script lang="ts">
  export interface Props { title?: string; showAlert?: boolean }   // must be optional or defaulted
  const props = defineProps<Props>({ showAlert: false })            // do NOT declare `outlet`
</script>
<template>
  <header>{props.title}</header>
  <p if:when="props.showAlert" role="alert">Connection problem</p>
  <main><MeekoOutlet /></main>
</template>
```

- Select: `definePage({ layout: 'dashboard' })`, inherited from `+group.ts`, else `default`.
  `layout: false` removes the named layout but keeps `app/app.meeko` and `+layout.meeko` files.
- Subfolder names: `app/layouts/admin/panel.meeko` → `'admin/panel'`. Files like `_parts.meeko` are not layouts.
- `app/layouts/default.meeko` and `app/pages/+layout.meeko` together = error.
- `<MeekoOutlet />` only in `app/app.meeko` and layouts, no attributes/children (`MEEK104`).
- `<script server>` is pages-only: in a layout, `+layout.meeko`, `+error.meeko` or component = `MEEK044`.

Layout props from the page:

```ts
// static or computed (server-side, reach SSR HTML)
export const route = definePage({ layout: 'dashboard', layoutProps: { title: 'Connections' } })
export const route = definePage({ layout: 'dashboard', load: …, layoutProps: ({ data }) => ({ title: data.user.name }) })
// with top-level code (1.8+): a dedicated export, not page data
export const layoutProps = { title: snapshot.title }
```

```html
<!-- runtime updates from the page's <script>; useLayout() is auto-imported, typed by the page's layout -->
<script lang="ts">
  const layout = useLayout()
  const failing = signal(false)
  effect(() => layout.set({ showAlert: failing.value }))  // patch; layout.props / layout.name readable
</script>
```

Props reset to the new page's values on each navigation. For markup (toolbar buttons), use
`<MeekoTeleport to="#toolbar">…</MeekoTeleport>` instead of props.

## Groups (`+group.ts`)

```ts
// app/pages/(dashboard)/+group.ts   (defineGroup is auto-imported)
export default defineGroup({ layout: 'dashboard', layoutProps: { showAlert: false }, middleware: ['auth'] })
```

- Only `layout`, `layoutProps`, `middleware`; all **literals** (no variables, spreads, env reads).
  Unknown option = error. `render`/`load`/`head` belong in `definePage`.
- Applied outer → inner, then the page wins. `layoutProps` merge by key; switching layout drops
  inherited props. `middleware` accumulates without duplicates; `middleware: false` clears inherited.
- A page leaving the group: `definePage({ layout: false, middleware: false })`.
- `+group.ts` outside `app/pages` does nothing (`MEEK115`).

## Route middleware (`app/middleware`)

| File                         | Define with                              | Runs                                              | Can read session        |
| ---------------------------- | ---------------------------------------- | ------------------------------------------------- | ----------------------- |
| `app/middleware/x.ts`        | `defineRouteMiddleware(fn, opts?)`       | server (SSR) + browser (navigation)               | no (bundled to browser) |
| `app/middleware/x.server.ts` | `defineServerRouteMiddleware(fn, opts?)` | server only (also during navigation data request) | yes                     |

```ts
// app/middleware/auth.server.ts  - named, protects pages with the session
import { redirect } from '@meekojs/meeko/framework'     // redirect/notFound ARE NOT auto-imported here

export default defineServerRouteMiddleware(
  ({ session, url }) => {
    if (!session.current) redirect(`/login?next=${encodeURIComponent(url.pathname)}`)
  },
  { global: false },
)
```

```ts
// app/middleware/00-maintenance.ts - global, isomorphic
export default defineRouteMiddleware(({ url, match, phase, request, signal }) => {
  // phase: 'server' | 'client'; request only exists on the server
  if (isMaintenance() && match.route.id !== '/maintenance') return Response.redirect(new URL('/maintenance', url))
})
```

- Without options = **global** (every route, ordered by filename). `{ global: false }` (object literal)
  = named; select with `middleware: ['auth']` in `definePage`/`defineGroup`. Requesting a global by name
  or a nonexistent name stops dev/build/check.
- Name = path without `.ts`/`.server.ts` and numeric prefix: `10-auth.ts` → `'auth'`, `admin/20-role.ts` → `'admin/role'`.
  `auth.ts` + `auth.server.ts` both existing = duplicate name error.
- Order: isomorphic globals → isomorphic named (declared order) → server globals → server named. First
  that stops (returns a `Response`, throws, `redirect()`/`notFound()` in server middleware) ends the route.
  Returning `undefined` continues.
- Server middleware context: `url`, `params`, `search` (NOT yet schema-validated), `request`, `signal`,
  `context`, `session`, `match`.
- Named server middleware on a `render: 'client'` or `'prerender'` page = discovery error.
- Wrong definer for the file kind (`defineRouteMiddleware` in `*.server.ts` or vice versa) = error.
- Route middleware never protects `server/api` or RPC: those need their own `auth`/checks.
  HTTP middleware wrapping everything is `server/middleware/*` with `defineServerMiddleware`.

## Navigation and links

```html
<MeekoLink to="/">Home</MeekoLink>
<MeekoLink to="/users/[id]" bind:params="{ id: user.id }" bind:search="{ tab: 'activity' }">Profile</MeekoLink>
<MeekoLink to="/users" match="prefix">Users</MeekoLink>   <!-- aria-current="true" under /users/* -->
<MeekoLink to="/projects" data-meeko-view-transition="false">No animation</MeekoLink>
<a href="/about">About</a>                                 <!-- plain internal <a> also navigates client-side -->
<a bind:href="href('/users/[id]', { params: { id: props.id } })">{props.name}</a>
```

- `MeekoLink`/`MeekoOutlet` are built-in tags: no import. `to` is a typed `RouteId`; dynamic routes
  require `bind:params` with exact keys (string values). No `href`/`bind:href` on `MeekoLink` (`MEEK105`).
  Active link gets `aria-current="page"`; `match="prefix"` adds `"true"` on descendants (`/` is exact only).
- `href(id, { params?, search? })` builds an encoded same-origin path; works in components, server code,
  middleware. `search` omits `null`/`undefined`. `[id]` values cannot contain `/` (use `[...slug]`).
- There is **no `navigate()` for components**. Navigate with links; after an action use
  `location.assign(href(...))`, or redirect server-side. (`app.navigate()` exists only on the
  `mountClientApp` instance of a custom host.)
- `useRoute()` → signals `url`, `path`, `id`, `params`, `search` (+ `isActive(to, { params?, prefix? })`
  returning `'page' | 'true' | false`). Reflects the **committed** route. Call it in setup, not inside
  event handlers/timers (throws there). Params are `unknown`-ish: prefer page exports/props for typed data.
- `useNavigation()` → `{ pending }` signal (always `false` in SSR). Only state, no methods.
- Fragment-only changes do not refetch data; back/forward restore window scroll.
- View transitions: `defineMeekoConfig({ viewTransitions: true })`; style with native
  `::view-transition-*` CSS in `app/styles/main.css`.

```html
<!-- app/layouts/default.meeko -->
<script lang="ts">
  const route = useRoute()
  const nav = useNavigation()
</script>
<template>
  <nav><MeekoLink to="/">Home</MeekoLink><MeekoLink to="/users" match="prefix">Users</MeekoLink></nav>
  <p if:when="nav.pending.value" role="status">Loading…</p>
  <main bind:aria-busy="nav.pending.value ? 'true' : null"><MeekoOutlet /></main>
  <small>{route.path.value}</small>
</template>
```

## Head

Page head precedence: `export const head` / `route.head` > `useHead`/`useSeoMeta` > `document` in
`meeko.config.ts`. In components/layouts, `useHead({ title, meta: [...] })` is auto-imported (object,
getter or signal). In `<script server>` top level, `useHead`/`useSeoMeta` work; in 1.9 they **must be imported** (auto-import fixed after 1.9):
`import { useHead } from '@meekojs/meeko/framework'`. `titleTemplate` must be a string there.

## Where identifiers are available

"auto" = usable without import. Anything can also be imported explicitly from the listed module.

| Identifier                                                                                                                 | `<script>` + template                             | `<script server>` / `*.route.ts`                                         | `app/middleware/*.ts`                  | `app/middleware/*.server.ts`, `server/`                                 |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------- |
| `signal computed effect batch untrack onCleanup provide inject createContext useId createId createRoot` (`@meekojs/meeko`) | auto                                              | auto                                                                     | auto                                   | auto                                                                    |
| `onMounted`                                                                                                                | auto                                              | no (`MEEK108`)                                                           | —                                      | —                                                                       |
| `definePage` (`/framework`)                                                                                                | `MEEK109` (no effect)                             | auto                                                                     | —                                      | —                                                                       |
| `usePage redirect notFound` (`/framework`)                                                                                 | **no** (`MEEK073`)                                | auto, top level of `<script server>` only (not in `load`/`head`/sidecar) | no                                     | import `redirect`/`notFound` explicitly; `usePage` not needed (ctx arg) |
| `href useRoute useNavigation useState defineGroup defineRouteMiddleware definePlugin`                                      | auto                                              | auto (`href` is the useful one)                                          | auto (`href`, `defineRouteMiddleware`) | auto (`href`)                                                           |
| `useHead useSeoMeta useLayout useForm useStorage useTheme ClientError isClientError`                                       | auto                                              | **import** (`useHead`/`useSeoMeta` only; others don't belong)            | no                                     | no                                                                      |
| `defer`                                                                                                                    | **import** (`import type { Deferred }` for props) | auto (in `client` sidecar: import)                                       | —                                      | auto                                                                    |
| `ApiError defineApiRoute defineRpc defineServerMiddleware defineServerRuntime defineSocketChannel` (`/server`)             | no (`MEEK108`)                                    | auto                                                                     | no                                     | auto                                                                    |
| `defineServerRouteMiddleware`                                                                                              | no                                                | —                                                                        | no (wrong file kind)                   | auto                                                                    |
| `server/utils/*`, `*.server.ts` exports, `server/` imports                                                                 | no (`MEEK108`; `import type` ok)                  | auto/allowed (not with `render:'client'`)                                | no                                     | auto                                                                    |
| `app/components`, `app/composables`, `app/utils`, `app/stores`                                                             | auto                                              | —                                                                        | auto                                   | —                                                                       |
| `shared/*` exports                                                                                                         | auto                                              | auto                                                                     | auto                                   | auto                                                                    |
| `api rpc useApi useRpcQuery useRpcMutation useApiMutation socket useSocket` (generated)                                    | auto (browser clients)                            | auto (server clients, dispatched locally)                                | auto                                   | auto                                                                    |
| `defineProps defineEmits defineModel defineExpose defineSnippets useElementRef`                                            | auto (macros)                                     | no (`MEEK108`)                                                           | —                                      | —                                                                       |
| `MeekoLink MeekoOutlet MeekoTeleport MeekoAwait` tags; `RouteId LayoutProps MeekoLinkProps` types                          | auto                                              | types auto                                                               | types auto                             | types auto                                                              |

`useRequestState(context, key, factory)` (per-request cache) is server-only: `import { useRequestState } from '@meekojs/meeko/server'`.

## Common mistakes

```html
<!-- 1. Request APIs in the component script: MEEK073 -->
<script lang="ts">const { params } = usePage()</script>           <!-- bad -->
<script server lang="ts">export const id = usePage().params.id</script> <!-- good -->

<!-- 2. definePage / export const route in <script>: MEEK109 / MEEK018 -->
<script lang="ts">export const route = definePage({ render: 'prerender' })</script> <!-- bad -->
```

```ts
// 3. load + top-level exports in one block: MEEK070
export const route = definePage({ load: () => ({ a: 1 }) }); export const b = 2      // bad

// 4. redirect()/notFound()/usePage() inside load or head: MEEK073
definePage({ load: ({ params }) => { if (!params.id) notFound() } })                // bad
definePage({ load: ({ params }) => { if (!params.id) throw new ApiError('NOT_FOUND', 404) } }) // good

// 5. Computed literals (read without executing the file)
definePage({ render: process.env.STATIC ? 'prerender' : 'ssr' })                      // bad
defineGroup({ layout: name }) / defineRouteMiddleware(fn, opts)                       // bad

// 6. Dynamic prerender without entries -> build error
definePage({ render: 'prerender', prerenderEntries: async () => (await list()).map((p) => ({ slug: p.slug })) })

// 7. Swallowing redirect in try/catch
try { if (!s) redirect('/login'); data = await load() } catch { data = null }        // bad: redirect lost

// 8. redirect with a non-redirect status
redirect('/x', 404)                                                                   // bad: use notFound()

// 9. Route options reading top-level variables: MEEK076
const title = 'Hi'; export const route = definePage({ head: () => ({ title }) }); export const t = title // bad
```

10. Non-serializable exports/`load` data (`Date`, `Map`, class instances, functions, `undefined`,
    `bigint`) → type error / 500. Convert: `createdAt: row.createdAt.toISOString()`.
11. Treating exports as signals (`user.value.name`) — they are plain read-only values; wrap with
    `signal(user.name)` for editable state. Declaring the same name in `<script>` = `MEEK075`.
12. Returning `null` + "not found" markup with status 200 instead of `notFound()`.
13. Using only isomorphic `app/middleware/*.ts` for auth (it is in the browser bundle and cannot read the
    HttpOnly session cookie). Use `*.server.ts` + `defineServerRouteMiddleware`, and still guard APIs/RPC.
14. Secrets, DB access or `server/` imports in a `render: 'client'` page block — it ships to the browser.
15. Expecting `defer` to speed up an `ssr` page — only `render: 'stream'` streams.
16. Components or helpers placed in `app/pages` become routes; non-optional layout props break
    `meeko check` (`MEEK_LAYOUT_PROPS`); declaring `outlet` in layout props is unnecessary.
17. Linking with filled URLs in `to` (`to="/users/42"`) or query in the ID — use
    `to="/users/[id]" bind:params="{ id: '42' }"` and `bind:search`.
18. Calling `useRoute()` inside an event handler — get it in setup and read `route.path.value` later.
19. Unvalidated `params` used in queries — declare `params`/`search` schemas in `definePage`.
20. Mutable module state in the server block (`const cache = new Map()` at top level is recreated per
    request; a module-level map in `server/utils` is shared across users) — use `useRequestState` for
    per-request caches.

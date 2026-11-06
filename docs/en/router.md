---
source-hash: 9951a806622a7486beef1759534aad4ed82a903b7b53ee0fa030ae0b8350e90a
---

# Router: pages and navigation

The router connects a URL to a page in `app/pages`, loads its data and displays it inside its layouts. The server and browser use the same route manifest. This walkthrough starts from [your first application](primeros-pasos.md) and requires neither a database nor a custom host.

## 1. Create the pages

Files define the URLs:

| File under `app/pages`  | URL                   | Parameters                  |
| ----------------------- | --------------------- | --------------------------- |
| `index.meeko`           | `/`                   | none                        |
| `users/index.meeko`     | `/users`              | none                        |
| `users/new.meeko`       | `/users/new`          | none                        |
| `users/[id].meeko`      | `/users/42`           | `{ id: '42' }`              |
| `docs/[...slug].meeko`  | `/docs/guide/install` | `{ slug: 'guide/install' }` |
| `(admin)/reports.meeko` | `/reports`            | none                        |

`[id]` captures one segment; `[...slug]` captures one or more and must come last. Groups such as `(admin)` organize pages without adding URL segments. Static routes take priority over dynamic routes: `/users/new` is not interpreted as user `new`. Two pages with the same URL shape, such as `users/[id]` and `users/[name]`, produce a collision.

For this example, create this entry page:

```html
<!-- app/pages/users/index.meeko -->
<template>
	<h1>Usuarios</h1>
	<MeekoLink to="/users/[id]" bind:params="{ id: '42' }" bind:search="{ tab: 'activity' }">
		Ver usuario 42
	</MeekoLink>
</template>
```

`<MeekoLink>` generates a real `<a href="/users/42?tab=activity">`. `to` is the file's route ID, without a query or fragment; `params` fills the segments and `search` adds the query string. The editor and `meeko check` check routes and their parameters. A regular `<a href="/users/42">` also participates in client navigation.

## 2. Validate and load data

This page uses sample data inside the block, without external services:

```html
<!-- app/pages/users/[id].meeko -->
<script server lang="ts">
	export const route = definePage({ layout: 'default' })
	const { params, search } = usePage()
	if (params.id !== '42') notFound()

	export const user = { id: params.id, name: 'Ada' }
	export const tab = search.tab === 'activity' ? 'activity' : 'profile'
	export const head = { title: `Usuario ${user.name}` }
</script>

<template>
	<h1>{user.name}</h1>
	<p>ID: {user.id}. Pestaña: {tab}.</p>
	<a href="/users">Back to users</a>
</template>
```

`usePage()` reads the current request. With the default SSR mode, top-level code runs on the server per request, including requests for client navigation data. Exported data reaches the page; private variables stay on the server. The data must be JSON-serializable.

This example checks the ID manually. For real inputs, `definePage({ params, search })` accepts Standard Schema schemas that validate and transform before the data code runs; invalid input returns `400`. You can also load data through `definePage({ load })`, whose result reaches the page as `props.data`. Choose either `load` or top-level code, without combining them in one page. A `*.route.ts` sidecar lets you separate route options from the component. See [definePage](reference/macros/definepage.md) and [the server block](reference/syntax/script-server.md).

## 3. Share the layout and display loading

Replace the starter layout's contents with:

```html
<!-- app/layouts/default.meeko -->
<script lang="ts">
	const route = useRoute()
	const navigation = useNavigation()
</script>

<template>
	<nav>
		<MeekoLink to="/">Inicio</MeekoLink>
		<MeekoLink to="/users" match="prefix">Usuarios</MeekoLink>
	</nav>
	<p>Ruta actual: {route.path.value}</p>
	<p if:when="navigation.pending.value" role="status">Cargando página…</p>
	<main bind:aria-busy="navigation.pending.value ? 'true' : null">
		<MeekoOutlet />
	</main>
</template>
```

`<MeekoOutlet />` displays the page or next layout. Moving from `/users` to `/users/42` retains shared layouts and their state and disposes the outgoing page. The indicator only appears if navigation is still pending when the browser paints; a fast transition may finish without displaying it.

`useRoute()` offers the `url`, `path`, `id`, `params` and `search` signals and the `isActive()` method. It describes the committed page; while the next one loads it still shows the previous one. `useNavigation()` only offers the `pending` signal, which is `false` during SSR: it has no `navigate` method. Obtain both composables in the script and use their results in events. For precise page data, use its exports or props; `useRoute()` parameters are general and their values are `unknown`.

`match="prefix"` marks “Usuarios” in `/users/42` with `aria-current="true"`; in `/users` it uses `"page"`. The query and fragment do not affect this comparison. See [MeekoLink](reference/components/meekolink.md), [useRoute](reference/composables/useroute.md) and [useNavigation](reference/composables/usenavigation.md).

## 4. Choose layouts and protect groups

Any `app/layouts/<name>.meeko` is a named layout. Select it through `definePage({ layout: 'dashboard' })` or share it through `+group.ts`:

```ts
// app/pages/(dashboard)/+group.ts
export default defineGroup({ layout: 'dashboard', middleware: ['auth'] })
```

To use this group, create `app/layouts/dashboard.meeko` with a `<MeekoOutlet />` and place its pages inside `(dashboard)`. The following middleware requires the application to already have a login flow at `/login`:

```ts
// app/middleware/auth.server.ts
import { redirect } from '@meekojs/meeko/framework'

export default defineServerRouteMiddleware(
	({ session }) => {
		if (!session.current) redirect('/login')
	},
	{ global: false },
)
```

`*.server.ts` stays on the server and has session access. Without `{ global: false }`, middleware is global; with that option it only applies to pages that select it. Middleware defined with `defineRouteMiddleware` also runs in the browser. Additionally protect the data of every API and RPC: a navigation guard does not replace their authorization.

`+group.ts` options are inherited from outside in, with the page taking precedence. `middleware: false` removes inherited named middleware, not globals. `layout: false` removes the named layout while keeping `app/app.meeko` and folder `+layout.meeko` files. Pass layout props through `layoutProps` and update them through `useLayout().set(...)`. See [defineGroup](reference/macros/definegroup.md) and [route middleware](routing-middleware.md).

## 5. Handle errors and check the walkthrough

Add an application error page:

```html
<!-- app/error.meeko -->
<script lang="ts">
	const props = defineProps<{ status: number; message: string }>()
</script>

<template>
	<h1>Error {props.status}</h1>
	<p>{props.message}</p>
	<a href="/users">Back to users</a>
</template>
```

Open `/users`, visit the profile and return with the back button. `/users/99` calls `notFound()` and displays the `404` error; an unmatched URL also uses `app/error.meeko`. A closer `+error.meeko` takes precedence for its pages' errors. `redirect('/login')` stops server code and responds with a redirect (`302` by default).

Run `npm run check` to generate types and check the starter project. `pnpm exec meeko routes .` lets you inspect `.meeko/manifests/routes.json`. See [errors](routing-data.md#application-error-page-apperrormeeko) and [meeko routes](reference/commands/meeko-routes.md).

## What happens during navigation

The first SSR load delivers HTML and data that the browser hydrates. On subsequent navigations, Meeko resolves the route, runs applicable checks, loads modules and data, and commits the new page together with route state and history. Starting another navigation aborts the previous one so an old response cannot replace the new page.

| `definePage({ render })` mode | Content source                                             |
| ----------------------------- | ---------------------------------------------------------- |
| `ssr` (default)               | Server, per request                                        |
| `stream`                      | Server, with deferred values arriving later                |
| `prerender`                   | Build, with explicit entries for dynamic parameters        |
| `client`                      | Browser; initial HTML contains layouts and an empty outlet |

With `client`, the loader and its options are sent to the browser and cannot import secrets or server services; the data example's top-level code is not allowed. Other modes request server data during navigation; static hosting uses payloads generated alongside the HTML. See [rendering modes](routing-data.md#rendering-modes).

Modified clicks, external links, downloads and targets in another tab keep the browser's behavior. An unmatched URL loads as a document. Changing only `#section` does not rerun data code. Back and forward restore window scroll; View Transitions are optional. See [links and scroll](routing-navigation.md#links-anchors-and-scrolling) and [View Transitions](routing-navigation.md#native-view-transitions).

## APIs for code and integrations

| API                               | Responsibility                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| `href(id, options)`               | Build a typed URL without navigating                                                          |
| `app.navigate(url, { replace? })` | Navigate from the instance returned by `mountClientApp`; `replace` replaces the history entry |
| `createRouteManifest(records)`    | Validate, sort and freeze routes                                                              |
| `matchRoute(routes, pathname)`    | Find the route and its parameters, without query or fragment                                  |
| `createNavigator(routes, render)` | Manage history and cancellation with a custom render callback                                 |
| `mountClientApp(options)`         | Hydrate and connect links, data, layouts and navigation                                       |

In a starter application, startup is already generated; you do not need to mount another client. Inside components, use links to navigate. `useNavigation()` reads loading state. For custom integrations, `app.navigate` allows programmatic navigation; call `app.dispose()` when unmounting the host to release resources. `createNavigator` alone does not hydrate or load data. See [href](reference/utils/href.md), [createNavigator](reference/advanced/createnavigator.md), [matchRoute](reference/advanced/matchroute.md) and [mountClientApp](reference/advanced/mountclientapp.md).

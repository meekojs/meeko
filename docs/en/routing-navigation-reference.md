---
source-hash: cd143f62b5c3b696f866ced3a9e1589cacf149a0ea1935499fd468bd3fc35019
---

# Navigation: technical details

Full contracts and edge cases. For common usage, start with the [short guide](routing-navigation.md).

## `<MeekoOutlet />` and `<MeekoLink>`

Since `1.2`, Meeko includes these tags without an import. `<MeekoLink>` does not replace `<a>`: the router intercepts both by their `href` when they point to an internal route. The tag adds route construction and checking, plus automatic `aria-current`.

- **`<MeekoOutlet />`** renders the inner layout or page in `app/app.meeko` and layouts (`app/layouts/*.meeko` or `+layout.meeko`). It reads the `outlet` Meeko passes, so the layout does not need to declare `defineProps<{ outlet }>()`. Up to `1.4`, if it declared props, `outlet` had to be among them; since `1.5`, a layout with `<MeekoOutlet />` declares only its own (`defineProps<{ title?: string }>()`) and Meeko adds `outlet` to its `ComponentProps`. It is equivalent to `<component is="props.outlet">`: the browser preserves the layout between routes and only changes its contents. In another component, or with attributes or content, it produces `MEEK104`.
- **`<MeekoLink to="/users/[id]" bind:params="{ id: user.id }" bind:search="{ tab: 'perfil' }">`** renders an `<a>` whose `href` is built by `href()`: `to` only accepts existing routes, dynamic routes require `bind:params` with their keys, and `bind:search` adds the query string. `meeko check` and the editor flag the error on the attribute (`Argument of type '"/nowhere"' is not assignable…`). On the active route (the same path without query or fragment), it adds `aria-current="page"`, which navigation updates; with `match="prefix"`, it also marks its section (see below). Other attributes and children pass through to the `<a>` unchanged: `class`, `target`, `rel`, `aria-*`, `data-*` and `on:click`. `href` and `bind:href` are not supported, because `to` builds the link (`MEEK105`).
- **`match`: page or section.** Since `1.5`, `match="exact"` (the default) marks the link only on its own route, and `match="prefix"` also on routes below it. On its own route, the link has `aria-current="page"`; on a route below it, `aria-current="true"`, meaning “the current item in a set”: the section containing the page. Comparison uses complete segments, on paths encoded as by `href()`, without query or fragment: `/dashboard` covers `/dashboard/stats` and `/dashboard/r%201`, but not `/dashboards`; `/dash` does not cover `/dashboard`. `to="/"` only matches exactly, even with `match="prefix"`, since otherwise it would mark every page. On a dynamic route, the section follows its `params`: `<MeekoLink to="/users/[id]" bind:params="{ id: '7' }" match="prefix">` covers `/users/7/posts`, not `/users/8/posts`. `match` supports `bind:match` with an expression of type `"exact" | "prefix"`; another static value produces `MEEK105`. The value appears in the server HTML, hydration leaves it unchanged, and navigation updates it, including in a layout the browser preserves.
- **Link resolvers: language and other prefixes.** Since `1.8`, the `href` passes through the resolvers that plugins and modules register with [`app.resolveLink`](framework.md#application-plugins). With `@meekojs/i18n`, `<MeekoLink to="/guide">` points to `/en/guide` on an `/en/…` page and to `/guide` in the default language, without writing the prefix; `hreflang="es"` (or `bind:hreflang`, or the `hreflang` key of `bind`) forces another language and is also kept on the `<a>`. `bind:resolve="false"` leaves the `href` from `href()` as is, for a link that must not change; a static `resolve="false"` is `MEEK105`. The typing of `to`, `params` and `search`, `aria-current` (with the resolved `href`, so `/guide` is active on `/en/guide`) and client navigation do not change. Without resolvers, the `href` is the one from `href()`.

```html
<!-- /en/guide on an /en/… page, /guide in the default language -->
<MeekoLink to="/guide">Guide</MeekoLink>
<!-- /guide in any language -->
<MeekoLink
	to="/guide"
	hreflang="es"
>
	Spanish version
</MeekoLink>
<MeekoLink
	to="/admin"
	bind:resolve="false"
>
	Administration
</MeekoLink>
```

- **Prop types.** Since `1.4`, `@meekojs/meeko/framework` exports `MeekoLinkProps<K>` (`to`, `params` and `search` for route `K`; since `1.5`, also `match`, and since `1.8`, `resolve`), `MeekoOutletProps` (no props) and `MeekoThemeToggleProps` (the props of [`<MeekoThemeToggle>`](framework.md#meekothemetoggle)), plus `RouteId`, the ID of any application route (the type of `to`). All are auto-imported: prop types where the components are used, like [component types](framework.md#component-types), and `RouteId` throughout the project, like `href`. The editor shows props on tag hover and opens their type with “Go to definition”. You can use them to type a component that receives a route, without an import:

```html
<!-- app/components/NavLink.meeko -->
<script lang="ts">
	const props = defineProps<{ href: MeekoLinkProps['to']; label: string }>()
</script>
<template><a bind:href="href(props.href)">{props.label}</a></template>
```

`MeekoLinkProps["to"]` and `RouteId` are the same type: the union of routes declared by `.meeko/types/routes.d.ts` (`meeko check`, `meeko dev`), or `string` without those declarations. `<NavLink href="/nowhere">` is a type error in the parent. A project type with one of those names (for example, in `app/types`) takes priority.

```html
<!-- app/layouts/default.meeko -->
<template>
	<header>
		<MeekoLink
			to="/"
			class="brand"
		>
			Home
		</MeekoLink>
		<MeekoLink
			to="/users/[id]"
			bind:params="{ id: session.userId }"
		>
			My profile
		</MeekoLink>
	</header>
	<main><MeekoOutlet /></main>
</template>

<style scoped>
	a[aria-current='page'] {
		font-weight: 700;
	}
</style>
```

A section menu marks the section on all its pages and marks the exact page differently. CSS distinguishes the two `aria-current` values, the same ones screen readers read:

```html
<!-- app/layouts/default.meeko -->
<template>
	<nav aria-label="Secciones">
		<MeekoLink
			to="/"
			match="prefix"
		>
			Home
		</MeekoLink>
		<MeekoLink
			to="/dashboard"
			match="prefix"
		>
			Dashboard
		</MeekoLink>
		<MeekoLink
			to="/users"
			match="prefix"
		>
			Users
		</MeekoLink>
		<MeekoLink
			to="/settings"
			match="prefix"
		>
			Settings
		</MeekoLink>
	</nav>
	<main><MeekoOutlet /></main>
</template>

<style scoped>
	/* The current page section: /dashboard/stats marks “Dashboard”. */
	nav a[aria-current='true'] {
		border-bottom: 2px solid currentColor;
	}
	/* The exact page: /dashboard marks “Dashboard” with a heavier weight. */
	nav a[aria-current='page'] {
		border-bottom: 2px solid currentColor;
		font-weight: 700;
	}
</style>
```

On `/dashboard/stats`, “Panel” has `aria-current="true"`; on `/dashboard`, `aria-current="page"`; on `/dashboards`, neither, and “Inicio” is only marked on `/`. For your own link or component, `useRoute().isActive()` applies the same rule (see [Current route](#current-route)).

In the editor, `to="` suggests project routes and takes you to their page with Ctrl+click. `meeko init-framework` generates the shell and layout with these tags.

A project from before `1.2` with its own component named `MeekoLink` or `MeekoOutlet` (in `app/components`, from a module, or imported or declared in `<script>`) keeps it: the tag is that component, with its props, rather than Meeko's tag. `meeko check`, `meeko build` and the editor warn with `MEEK106`; rename the component to use the built-in tag.

## Links, anchors and scrolling

`mountClientApp` turns clicks on same-origin links to application routes into client navigation, including links in HTML inserted with `html`. A link to a current-page fragment (`#seccion`, or `/docs#seccion` while on `/docs`) is not intercepted: the browser scrolls the page and adds the history entry without requesting or rendering the page again, and going back or forward between those fragments does not render it either. `app.navigate("#seccion")` does the same.

A new navigation starts at the top of the page or, if its URL has a fragment naming an element (`id` or `name`), at that element, immediately even if the page uses `scroll-behavior: smooth`. Navigation with `replace` only scrolls to the fragment, if any. If a navigation data request receives HTML instead of a payload (static hosting serving the prerendered `index.html`, a proxy or CDN), Meeko loads that document instead of failing.

Back and forward return the reader to the position they had in each history entry, even one with a fragment; an entry with no saved position goes to its fragment, if any. The position is applied together with the DOM of the page, before the first frame and inside the View Transition. If it does not fit yet because content is missing, such as a `defer` value, Meeko waits up to 10 s for it, and gives up if the reader or other code moves the page or if another navigation happens. On a reload or a return from another document, the browser restores it.

To do this Meeko sets `history.scrollRestoration` to `manual`, adds `meekoEntry` to `history.state` and stores the positions in `sessionStorage`, and it keeps whatever else is in `history.state`. If you write to it, keep what is there: `history.replaceState({ ...history.state, own: 1 }, '')`. Only the scroll of the window is remembered, not that of your own container. There is no option to control this scrolling: if you need another position, scroll after `app.navigate()` finishes.

## Native View Transitions

Enable client navigation transitions in `meeko.config.ts`:

```ts
export default defineMeekoConfig({
	viewTransitions: true,
})
```

The option is boolean and disabled by default. Meeko loads the page, its modules and data before starting `document.startViewTransition()`, placing the DOM and head change inside the callback. It does not animate SSR, initial hydration or current-page fragment changes. It works with internal links and back/forward navigation. Without the API, with a hidden tab or with `prefers-reduced-motion: reduce`, it navigates normally.

It does not animate a page that is too large either: above 4,000 elements, on the source or the destination page, it navigates without a transition. In a document that size, on a high-density screen or a phone, each frame of the transition blocks the page for seconds. If the destination is the large one, Meeko captures the source page and skips the animation when it applies the change. If you call `document.startViewTransition()` yourself, check the same with [`isTooLargeToAnimate`](reference/utils/istoolargetoanimate.md).

The browser provides a basic transition; customize the animation from `app/styles/main.css` with native CSS:

```css
.project-surface {
	view-transition-name: project-surface;
}

::view-transition-group(project-surface) {
	animation-duration: 280ms;
	animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
}
```

Use the same `view-transition-name` on the source and destination elements. Each name must be unique among visible elements on a page; duplicates can prevent animation, though navigation still completes. No directive or wrapper component is needed. See the [native API](https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition).

Since `1.8`, a navigation's transition has the type `meeko-route`, so CSS can tell it from one that a component starts. Name an element only during navigations:

```css
html:active-view-transition-type(meeko-route) .tabs-indicator {
	view-transition-name: tabs-indicator;
}
```

A browser without transition types (Chrome before 125, Safari before 18.2, Firefox before 147) still animates the navigation and ignores those rules.

To disable or enable a particular navigation, use `app.navigate('/projects', { viewTransition: false })` in a host with the `ClientApp` returned by `mountClientApp`. Links support a standard HTML attribute, on both `<MeekoLink>` and `<a>`:

```html
<MeekoLink
	to="/projects"
	data-meeko-view-transition="false"
>
	Open without a transition
</MeekoLink>
```

`data-meeko-view-transition="true"` enables that link even when the global option is disabled; reduced motion still takes priority. The navigation promise waits for the DOM change, without waiting for the animation to finish. A subsequent navigation or application unmount skips the previous animation; an aborted update cannot replace the new page. Animation failures do not become navigation failures; render errors continue propagating as before.

This option controls changes within the same document. Navigation to new documents can use `@view-transition { navigation: auto; }` in both same-origin pages' stylesheets, subject to browser support and that API's rules. UI modals keep their local animations and do not need whole-page snapshots. The `/transitions` example on the `apps/ui` public site includes a shared surface between list and detail, plus links without a transition.

### Elements present on only one of the two pages

When an element with a `view-transition-name` exists only on the source page or only on the destination page, its group has a single snapshot: `::view-transition-old(name)` or `::view-transition-new(name)`. That snapshot's fade inherits the duration and fill mode of its `::view-transition-group`. So if you turn off the group's animation, which is common for a fixed header that must not move:

```css
::view-transition-group(header) {
	animation: none;
}
```

the snapshot does not animate: when going to a layout without the header, the old one stays painted over the new page until the whole transition ends, and when coming back the new one pops in. Meeko adds no styles of its own to the transition, so give those lone snapshots a short fade in `app/styles/main.css`:

```css
@keyframes app-fade-out {
	to {
		opacity: 0;
	}
}

@keyframes app-fade-in {
	from {
		opacity: 0;
	}
}

html:active-view-transition-type(meeko-route)::view-transition-old(*):only-child {
	animation: 150ms ease-out both app-fade-out;
}

html:active-view-transition-type(meeko-route)::view-transition-new(*):only-child {
	animation: 150ms ease-in both app-fade-in;
}
```

`:only-child` only affects groups with a single snapshot; elements present on both pages keep their animation. Set the duration and `both` in the rule itself, because they cannot be inherited from a group with `animation: none`. If an element needs a different effect, write its rule with the same prefix and its name instead of `*`, such as `html:active-view-transition-type(meeko-route)::view-transition-old(header):only-child`: the name makes it more specific. With `prefers-reduced-motion: reduce`, Meeko navigates without a transition and these rules do not apply; if you start your own transitions, check that preference yourself. In a browser without transition types the rule does not match and the previous behavior remains; remove `html:active-view-transition-type(meeko-route)` from the selector if you also want it for your components' transitions.

## Navigation state

`useNavigation()` returns `{ pending }`, a read-only signal that is `true` from the start of navigation until its page is confirmed, fails or is canceled, including the first load of a `"client"` page and loading the new page's `await useApi`/`await useRpcQuery` calls (see [Navigation and `render: "client"`](framework.md#navigation-and-render-client)). In SSR and outside `mountClientApp`, it is always `false`. Since `1.7`, it is auto-imported, like `useRoute` (your own export with that name takes priority).

```ts
import { useNavigation } from '@meekojs/meeko/framework'

const nav = useNavigation()
// <p if:when="nav.pending.value">Loading…</p>
```

### `data-navigating` and `data-pending` attributes

Since `1.10`, while `pending` is `true`, Meeko also sets two attributes on the document, so navigation can be styled with CSS alone:

- **`data-navigating` on `<html>`** (`document.documentElement`), empty, on any client navigation: a link click, `app.navigate()`, a redirect, back and forward, and the first load of a `"client"` page.
- **`data-pending` on the clicked `<a>`**, empty, when the navigation started with a click on a `<MeekoLink>` or an internal `<a href>` that Meeko intercepts. Back, forward and navigations from code mark no link. If another navigation starts first, the previous link loses the attribute and the new one receives it, if there is one.

Both are removed when the navigation is confirmed, fails or is cancelled, and when the application is disposed of (`dispose()`). They are never in the server HTML, so they do not affect hydration. A fragment-only navigation does not set them.

```css
/* Atenúa el enlace pulsado mientras carga su página. */
a[data-pending] {
	opacity: 0.6;
	cursor: progress;
}

html[data-navigating] main {
	transition: opacity 0.2s 0.15s;
	opacity: 0.7;
}
```

[`useNavigation`](reference/composables/usenavigation.md#attributes-for-css) has a progress bar with a delay.

## Programmatic navigation

Since `1.10`, `navigate(target, options)` navigates from the code of a component or a browser composable through the same router as `<MeekoLink>`: route middleware, page data, `useNavigation().pending`, history, scroll and View Transitions. It is auto-imported in `app/` code that reaches the browser and, since it does not read the component context, it also works in an event handler, a timer or after an `await`. It replaces `window.location.assign`, which reloads the document.

```html
<script lang="ts">
	const props = defineProps<{ userId: string }>()
	async function save() {
		await api.users.update.post({ body: { id: props.userId } })
		await navigate({ to: '/users/[id]', params: { id: props.userId }, search: { saved: 1 }, hash: 'perfil' })
	}
</script>
```

- **Typed destination.** It receives the same as `<MeekoLink>`: `to` (only routes that exist), `params` (required on a dynamic route and forbidden on the others), `search`, `hash` (without `#`), `hreflang` and `resolve`, which go through the link resolvers as in the tag. `meeko check` flags a nonexistent route or missing `params` (`TS2769`).
- **URL as text.** `navigate("/users/42?tab=a")` accepts any relative or absolute URL, without checking it against the routes. A URL from another origin or without a page loads as a document (`location.assign`, or `location.replace` with `replace: true`), like a link. Only `http:` and `https:` are followed: another scheme rejects with `TypeError`, the same rule as middleware redirects.
- **Options.** `replace: true` replaces the history entry; `viewTransition` enables or disables the View Transition for that navigation.
- **Result.** A `Promise<boolean>`, that of `app.navigate()`: `true` when the new page is confirmed and `false` if it is cancelled (another navigation, `beforeNavigate`, a middleware that blocks) or the URL loads as a document. It rejects with the error if it fails; the previous page stays visible.
- **Server.** In SSR, in a loader, in top-level code or in a server middleware, it throws an error that points to `redirect()`. Outside an application mounted with `mountClientApp` it throws the same error. A call during hydration waits for the router to be ready.

See [navigate](reference/utils/navigate.md).

## Search parameters as state

Since `1.10`, `useSearchParam(name, initial, { schema, history })` returns an editable signal bound to a query string parameter of the confirmed route. It is auto-imported in `app/` code that reaches the browser.

```html
<script lang="ts">
	import * as v from 'valibot'

	const tab = useSearchParam('tab', 'perfil')
	const page = useSearchParam('page', 1, { schema: v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(1)) })
</script>

<template>
	<button on:click="() => (tab.value = 'actividad')">Actividad</button>
	<button on:click="() => page.value++">Página siguiente</button>
</template>
```

- **Reading.** It comes from the query of `useRoute().url`, with the same timing as `useRoute()`: it changes when a navigation is confirmed, also through history. The `schema` (a synchronous Standard Schema) receives the parameter's text, or a list if the key is repeated, and its output gives the type. Without the parameter or with a value the schema rejects, the signal is `initial`; it never throws because of the URL. Without a `schema`, the value is the text (the first one, if repeated) and `initial` must be a text.
- **Writing.** It navigates to the same URL with the parameter changed, keeping the other parameters and the fragment, through the router: the route middleware and the page's data run, as when following a link to that URL. By default it replaces the history entry; `history: "push"` adds another. A value equal to `initial`, `null` and `undefined` remove the parameter; a list repeats the key and a date is written with `toISOString()`. The signal returns the written value while the navigation is pending and returns to the URL's if it fails or is cancelled. Two consecutive writes accumulate in one URL.
- **SSR and hydration.** In SSR it reads the request's query and is read-only: writing throws an error. Hydration reads the same as the server, without mismatches.
- **What is mounted again.** Like any navigation, the page is mounted again with the new URL and the layouts are kept. A text field on the page that writes on every keystroke loses focus: write on submit or in `on:change`.

`useRoute().search` is still the `search` the page validated; `useSearchParam` reads the URL, so it also works for a parameter that the `definePage({ search })` schema does not declare. See [useSearchParam](reference/composables/usesearchparam.md).

## Current route

Since `1.2`, `useRoute()` returns the confirmed route rendered by the component, with a read-only signal for each value (`RouteState` type):

| Field                                | Value                                                                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `url`                                | Origin-relative URL as a string: `pathname`, `search` and, in the browser, the fragment (`/users/42?tab=a#bio`). It excludes the origin, so it matches HTML prerendered on another domain.                               |
| `path`                               | `pathname`, encoded as in `location.pathname` (`/users/42`).                                                                                                                                                             |
| `id`                                 | Route ID in the manifest (`"/users/[id]"`), or `null` on the `app/error.meeko` `404` page for an unmatched URL.                                                                                                          |
| `params`                             | Route parameters, in the same shape the page receives (validated by its schema).                                                                                                                                         |
| `search`                             | Search parameters, in the same shape the page receives; on the `404` page, the query string with repeated keys in arrays.                                                                                                |
| `isActive(to, { params?, prefix? })` | Since `1.5`, a function, not a signal: whether route `to` is active, using the `<MeekoLink match>` rule. Returns `"page"` on the exact route and, with `prefix: true`, `"true"` on a route below it; otherwise, `false`. |

It is auto-imported in applications (your own export named `useRoute` in `app/composables` or another auto-import folder takes priority over the framework's), and, like `useNavigation`, can also be called from nested code running with the component (a composable, `computed`, `effect` or `onMounted`), but not from an event handler, timer or promise callback, where no root is active: there it throws (`useNavigation` returns a fixed state with `pending` set to `false`); get it in the script and use it in the handler. It works in pages, layouts, `app/app.meeko`, `app/error.meeko` and their components:

- **SSR.** Values are those of the request, including on `"prerender"` and `"stream"` routes and in layouts of a `"client"` route. The server does not receive the fragment, so SSR `url` never includes it.
- **Hydration.** The browser hydrates with the same values as SSR, without mismatches, even when the HTML was rendered for another URL: the `static` adapter's `404.html`, served by hosting for any nonexistent URL, or a prerendered page served by static hosting with any query string. The payload includes the render URL (optional `url` field, since `1.6`). Just after hydration, `url` and `path` become those of the browser address, including its `#fragmento`; on the `404` page, so does `search`, while on a page, `params` and `search` remain those validated by the server.
- **Navigation.** Values change only when navigation is confirmed, together with the outlet, never while `useNavigation().pending` is `true`; the previous page is disposed of before effects reading the route update. Values also change when going back or forward in history and on fragment-only navigation, where `path` stays the same and `url` changes. The preliminary render loading the new page's data `await` calls already sees the destination route.
- **Outside an application.** Outside framework rendering or `mountClientApp` (for example, in a unit test with `renderToString`), `useRoute()` throws an explanatory error instead of inventing a route; pass the route to the component as a prop in those tests.

**`isActive`.** Since `1.5`, `route.isActive(to, { params, prefix })` tells you whether a route is active with the same rule as [`<MeekoLink match>`](#meekooutlet--and-meekolink), for your own links and components. `to` is a `RouteId` and `params` are that route's parameters, with the type used by `href()`: required on a dynamic route, unsupported on others, and a nonexistent route is a type error. It returns `"page"` when the confirmed route is `to`, `"true"` with `prefix: true` when it is below it by complete segments, and `false` otherwise; `"/"` only matches exactly. It ignores query strings and fragments and compares encoded paths. The result works directly for `bind:aria-current`, because `bind:` removes the attribute when its value is `false`, and as a condition, because `"page"` and `"true"` are truthy. It reads `path`, so a template, `computed` or `effect` using it updates on navigation; in SSR and hydration it returns the same result, without mismatches.

A layout with a sidebar marks the active section this way, both in server HTML and after each navigation:

```html
<!-- app/layouts/default.meeko -->
<script lang="ts">
	const route = useRoute()
	const links = [
		{ to: '/', label: 'Home' },
		{ to: '/users', label: 'Users' },
		{ to: '/settings', label: 'Settings' },
	] as const
	const inSettings = computed(() => route.isActive('/settings', { prefix: true }) !== false)
</script>

<template>
	<aside>
		<nav>
			<a
				each:of="links"
				each:as="link"
				each:key="link.to"
				bind:href="href(link.to)"
				bind:aria-current="route.isActive(link.to, { prefix: true })"
			>
				{link.label}
			</a>
		</nav>
		<p if:when="inSettings.value">Changes are saved when you leave.</p>
	</aside>
	<main><MeekoOutlet /></main>
</template>
```

Components received as props retain the contract's direction: a component requiring `label` does not satisfy an outlet that can render it without `label`. `meeko check` diagnoses the expression passing the component. When you save a TypeScript module imported by an open `.meeko`, the VS Code extension rechecks its diagnostics and semantic tokens.

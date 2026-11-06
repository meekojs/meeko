---
source-hash: ab7cc28e8640a033d9470e894c277da7d32920bdfa2323df57ca045719d97eba
---

# Render pages and layouts

This guide expands [the framework overview](framework.md).

## Routing, layouts and SSR

See the [Routing index](routing.md) for pages, data, layouts, navigation and middleware.

### `<MeekoOutlet />` and `<MeekoLink>`

The explanation is in [Navigation](routing-navigation.md#meekooutlet--and-meekolink).

### `<MeekoTeleport>`

Since `1.5`, `<MeekoTeleport to="â€¦">` renders its content elsewhere in the document while keeping it within the component that declares it. You do not import it either. A typical case is a page putting its actions in its layout's toolbar:

```html
<!-- app/layouts/default.meeko -->
<template>
	<header class="bar">
		<MeekoLink to="/">Home</MeekoLink>
		<div id="toolbar"></div>
	</header>
	<main><MeekoOutlet /></main>
</template>

<!-- app/pages/notes/[id].meeko -->
<script lang="ts">
	const isMobile = signal(false)
	async function save(): Promise<void> {
		/* â€¦ */
	}
</script>
<template>
	<MeekoTeleport
		to="#toolbar"
		bind:disabled="isMobile.value"
	>
		<AppButton on:click="save">Save</AppButton>
	</MeekoTeleport>
	<article>â€¦</article>
</template>
```

- **Target.** `to="body"` appends the content to `<body>` and `to="#id"` inserts it inside the element with that `id`, after its existing content. Only these two forms are supported: `body`, or `#` followed by a letter and ASCII letters, digits, `-` or `_`. Meeko looks up the `id` with `getElementById` and never interprets `to` as a CSS selector or HTML. A static `to` that does not match this form produces `MEEK114`; `bind:to` accepts an expression of type ``"body" | `#${string}` `` (`MeekoTeleportTarget`), validated at render time. `<MeekoTeleport>` supports `to`, `bind:to`, `disabled`, `bind:disabled`, `if:when` and `each:of`; any other attribute produces `MEEK114`.
- **Author scope.** The content compiles in the declaring component's template, like the content of an `if:when`: it reads its signals, its events call its functions, it receives its `provide`/`inject` and error handlers, can use its snippets, and retains its `<style scoped>` attribute. It is disposed of with the component: on unmount, on page changes, or when its `if:when` or `each:of` row disappears, its nodes leave the target too.
- **Initial HTML.** In SSR, `"stream"` and `"prerender"` (including the `static` adapter), the HTML already contains the content at its target, without shifts during hydration: `to="body"` content goes after the application and before Meeko's scripts; `to="#id"` content goes inside that element, whether it renders before or after the teleport. Multiple teleports to the same target retain their order on the page. Hydration finds the content by its markers (`<!--meeko:portal:â€¦-->`) and leaves the DOM unchanged.
- **Missing target.** If the page does not render the `#id` element (or it is a void element such as `<input>`), rendering fails with a clear error in development. In production, the content renders in place, where it hydrates, and the server warns once with `console.warn`. In the browser, a missing target leaves content in place with a warning; the next change to `to` or `disabled` looks it up again.
- **`disabled`.** With `disabled` (or while `bind:disabled` is true), content renders in place. Changing it moves the same nodes between the target and their original position without rerendering, so they retain their state; the focused element loses focus, as with any DOM move.
- **Browser.** Content rendered by the browser (navigation, an appearing `if:when`, a new row or a deferred child) first renders in place and moves to its target at the end of that mount, before the next paint, appending to the target. The target must live at least as long as the teleport: a layout or `app/app.meeko` element for a page, or an element of the component itself.

Modals, menus and tooltips do not need a teleport: `<dialog>` with `showModal()` and the `popover` attribute already show them in the browser's _top layer_, above everything and without `z-index` or `overflow` issues, handling focus and `Escape`. Use `<MeekoTeleport>` when content must live elsewhere in the layout, such as an action bar, breadcrumbs or a notice at the end of `<body>`.

Pages, layouts, `app/app.meeko` and `app/error.meeko` cannot be [generic components](api.md#generic-components-generic): Meeko passes their props and cannot choose their type parameters, so `generic` on their `<script>` produces `MEEK100`. Move generic content into an `app/components` component and use it from the page.

If a page fails and `+error.meeko` exists, Meeko loads and renders it with the same request context and SSR state. The server observer receives the original failure with its `requestId`; the HTML shows a public message without private details. If the error page also fails, the server logs that second failure and returns a safe response.

### Named layouts

The explanation is in [Layouts](routing-layouts.md#named-layouts).

#### Per-folder options: `+group.ts`

See [Per-folder options](routing-layouts.md#per-folder-options-groupts).

#### Layouts from layers and modules

See [Layouts from layers and modules](routing-layouts.md#layouts-from-layers-and-modules).

### Layout props from the page

The explanation is in [Layouts](routing-layouts.md#layout-props-from-the-page).

### Application error page (`app/error.meeko`)

The explanation is in [Data and rendering](routing-data.md#application-error-page-apperrormeeko).

### Page server code

The explanation is in [Data and rendering](routing-data.md#page-server-code).

#### Top-level code and exported data

See [Top-level code and exported data](routing-data.md#top-level-code-and-exported-data).

#### Route options with `definePage`

See [Route options](routing-data.md#route-options-with-definepage).

#### Common rules

See [Common rules](routing-data.md#common-rules).

#### Where each API can be used

See [Where each API can be used](routing-data.md#where-each-api-is-used).

### Rendering modes

The explanation is in [Data and rendering](routing-data.md#rendering-modes).

### Streaming SSR (`render: "stream"`)

The explanation is in [Data and rendering](routing-data.md#streaming-ssr-render-stream).

### SSR page caching

The explanation is in [Data and rendering](routing-data.md#ssr-page-caching).

### Links, anchors and scrolling

The explanation is in [Navigation](routing-navigation.md#links-anchors-and-scrolling).

### Native View Transitions

The explanation is in [Navigation](routing-navigation.md#native-view-transitions).

### Navigation state

The explanation is in [Navigation](routing-navigation.md#navigation-state).

### Current route

The explanation is in [Navigation](routing-navigation.md#current-route).

### Document head: `document`, `useHead` and `useSeoMeta`

Since `1.2`, Meeko manages each document's `<head>` and the attributes of `<html>` and `<body>` from three sources, combined using one priority rule:

- **`document` in `meeko.config.ts`.** The application's common document: `lang` and a `head` with tags and attributes. It renders in all HTML documents: SSR, `"stream"`, `"prerender"`, the `app/error.meeko` `404` page, a failed route's error document, and a `"client"` route's shell. It is fixed at build time (and also reaches the browser bundle, because it ends up in HTML), so it must be serializable: `titleTemplate` can only be a string (its type, `DocumentHead`, does not accept a function, so the editor and `meeko check` flag it as a type error in `meeko.config.ts`) and `meeko build` rejects a function. Its `title` is the site title: pages without their own title show it unchanged, without a template (see **Title** below). Meeko modules add their head before the application's, which wins.
- **`useHead(input)`.** In pages, layouts, `app/app.meeko`, `app/error.meeko`, components and composables, at script top level or in a composable it calls. Also in top-level `<script server>` code, as an alternative to `export const head` (see below). `input` can be an object, getter or signal; with a getter or signal, the browser updates the document when the values it reads change.
- **`useSeoMeta(input)`.** Typed shorthand for `useHead`: `description`, `robots`, `themeColor`, `colorScheme`, `author`, `keywords`, `applicationName`, `referrer` and `twitter*` fields produce `<meta name>`; `og*` fields (`ogTitle`, `ogDescription`, `ogImage`, `ogImageAlt`, `ogImageWidth`, `ogImageHeight`, `ogUrl`, `ogType`, `ogSiteName`, `ogLocale`) produce `<meta property>`; `title` is the title and `canonical` is `<link rel="canonical">`. An `undefined` or `null` field produces nothing.

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	document: {
		lang: 'es',
		head: {
			// â€œShoes Â· My storeâ€ on a titled page; â€œMy storeâ€ on an untitled one.
			title: 'My store',
			titleTemplate: '%s Â· My store',
			link: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
			// Runs while the browser reads <head>, before painting; hydration does not repeat it.
			// (For a light/dark theme, use theme: Meeko provides the script, cookie and useTheme().)
			script: [{ children: 'document.documentElement.dataset.theme = localStorage.getItem("theme") ?? "light"' }],
		},
	},
})
```

```html
<!-- app/pages/products/[id].meeko -->
<script
	server
	lang="ts"
>
	const { params } = usePage()
	export const product = await findProduct(params.id)
</script>

<script lang="ts">
	const quantity = signal(1)
	useSeoMeta({
		title: product.name,
		description: product.summary,
		ogImage: product.image,
		twitterCard: 'summary_large_image',
		canonical: `https://tienda.example/products/${product.id}`,
	})
	useHead(() => ({ title: `${product.name} (${quantity.value})` }))
</script>
```

`HeadInput` supports `title`, `titleTemplate` (`"%s Â· Sitio"` or `(title) => string`; in `document.head`, `meeko.addHead` and route `head`, only the string), `meta`, `link`, `script` (external with `src` or inline with `children`; `async`, `defer`, `module` and `type`), `style` (with `children` and `media`), `htmlAttrs` and `bodyAttrs` (`lang`, `dir`, `class`, `data-*`; an `undefined` value contributes nothing and `on*` attributes are rejected).

**Priority.** Lowest to highest: configuration `document`, `app/app.meeko`, each layout (innermost wins), the page with its components and, finally, route `head` (`export const head`, `route.head` or `useHead` in `<script server>`). Within a level, the later call wins, so a page component mounting later (after an `if:`, for example) replaces what the page set. `<html>` and `<body>` attributes merge by name with the same priority.

**Title.** `titleTemplate` comes from the highest-priority entry declaring it, and applies to the highest-priority title from `app/app.meeko`, layouts, page and route `head`, including error pages: `"Error"` or, above it, the title the error page itself (`app/error.meeko` or `+error.meeko`) declares with `useHead`, which its layouts' titles do not override. The `title` in `document.head` (or added by a module with `meeko.addHead`) is different: it is the site title and never passes through the template. A page without its own title shows that title unchanged, as does one whose winning title is an empty string, instead of a template around nothing. Without a site title, a page without a title has no managed `<title>` (the host's remains, if any), and an empty title is written empty. The rule is the same in SSR, hydration and client navigation. With the example configuration:

| Page title | `<title>`          |
| ---------- | ------------------ |
| `"Shoes"`  | `Shoes Â· My store` |
| none       | `My store`         |
| `""`       | `My store`         |

**Deduplication.** Each tag has a key: `key` if declared, otherwise its natural key. For `meta`, `name` (case-insensitive), `property` or `httpEquiv`, together with its `media` if present (two `theme-color` tags for light and dark coexist); for `link`, `rel` and `href`, except `rel: "canonical"` and `rel: "icon"`, which are unique even if `href` changes; for `script`, `src` or the code; for `style`, the CSS. With the same key, only the highest-priority tag remains, in the position where the first appeared. Thus a `document` `icon` replaces the `<link rel="icon" href="data:,">` Meeko writes by default, and a `meta name="viewport"` replaces the default viewport.

**SSR and CSP.** The server writes `<html lang="â€¦">` and attributes as real, escaped attributes. Inside `<head>`, after the CSRF meta tag and component styles, the title and managed tags go between `<!--meeko:head-->` and `<!--/meeko:head-->` comments, before trusted host HTML (`DocumentOptions.head`, which keeps its own `<title>` as the default title). Attribute values are escaped; inline `script` and `style` content is not escaped but cannot close its tag: `</` is written `<\/` (and `<!--` as `<\!--` in a script), and in JSON scripts (`application/ld+json`, `application/json`, `importmap`, `speculationrules`) each `<` is written `\u003c`. The request's CSP nonce (`DocumentOptions.nonce`) is added to managed `<script>` and `<style>` tags. A prerendered page keeps the head and receives the CSRF meta tag just after `<meta charset>` and default tags the application did not replace.

**Browser.** On hydration, Meeko adopts SSR tags without duplicating them or rerunning scripts. When a `useHead` getter or signal changes, it updates title, attributes and tags. On navigation, unmounted components' entries disappear and what they replaced returns (for example, the layout's `canonical` or `app/app.meeko`'s `description`); going back restores the page's entries. New tags are inserted before `<!--/meeko:head-->` with the document's CSP nonce; a changed script is a new element, which the browser executes. Route `head` travels in the navigation payload, just like `title` and `description` in `1.1`. Outside a Meeko application (for example, in a unit test with `renderToString`), `useHead` does nothing. A custom host passing `DocumentOptions.config` to `createFrameworkHandler` must pass the same value to `mountClientApp({ document })`; Meeko's generated entry point already does this.

**`<script server>`.** Top-level `useHead` and `useSeoMeta` make the block have top-level code, like `usePage`. Their entries form the route `head` together with `export const head` (or `route.head`), which takes priority over them. Because they travel in the payload, their `titleTemplate` must be a string.

#### Per-page canonical URL and Open Graph

Since `1.3`, `document.seo` adds tags depending on the page to each document, which each page would otherwise need to repeat with `useSeoMeta`:

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	site: 'https://example.com',
	document: { seo: true, head: { titleTemplate: '%s Â· Mi sitio' } },
})
```

| Option          | Tag                                | Value                                                                                 |
| --------------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| `canonical`     | `<link rel="canonical">`           | The page's origin and path, without the query string: `https://example.com/docs/api`. |
| `ogUrl`         | `<meta property="og:url">`         | The same URL.                                                                         |
| `ogTitle`       | `<meta property="og:title">`       | The final title, with `titleTemplate` applied.                                        |
| `ogDescription` | `<meta property="og:description">` | The page's `description` (from route `head`, `useSeoMeta` or `document.head`).        |

`seo: true` enables all of them; an object disables those set to `false` (`seo: { ogDescription: false }`). The origin is `site` or, without it, `MEEKO_PUBLIC_ORIGIN` from the build environment; with `canonical` or `ogUrl` enabled and neither supplied, `meeko build` fails with a message requesting it. It is fixed at build time (`seo.origin` in the manifest), so an SSR-rendered page uses the same origin as a prerendered one. In `meeko dev` without an origin, these two tags are not written.

These are the lowest-priority tags: a page or layout declaring the same tag (with `useSeoMeta`, `useHead` or route `head`, with any `key`) replaces it, just like `document.head` tags. Error pages (`app/error.meeko`, `+error.meeko` and the `static` adapter's `404.html`) receive neither `canonical` nor `og:url`, because they are served at any URL. On client navigation, tags follow the confirmed page. A custom host passing `DocumentOptions.config` with `seo` must include `seo.origin`.

### Light/dark theme without flashing

Since `1.4`, Meeko includes light/dark themes (and custom themes): the choice is saved in a cookie, the server writes the theme on `<html>` from the first byte, and components render the correct icons in server HTML without waiting for JavaScript. When the server cannot know it (a prerendered page, the `static` adapter or `"system"` mode without a client hint), a minimal blocking `<head>` script applies it before the first paint.

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	theme: true, // light and dark, "system" by default, data-theme and the meeko-theme cookie
})
```

```css
/* app/styles/main.css: each theme's colors, with color-scheme even without JavaScript. */
:root {
	color-scheme: light;
	--bg: #fff;
	--ink: #111;
}
:root[data-theme='dark'] {
	color-scheme: dark;
	--bg: #111;
	--ink: #eee;
}
/* Without the attribute (unresolved "system" mode and no JavaScript), the system takes precedence. */
@media (prefers-color-scheme: dark) {
	:root:not([data-theme]) {
		color-scheme: dark;
		--bg: #111;
		--ink: #eee;
	}
}
```

Without `theme`, nothing changes: no script or style in `<head>`, cookie, headers or `POST /_meeko/theme`. `theme` accepts `true` or an object:

| Option        | Default                                  | What it does                                                                                                                                                    |
| ------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `themes`      | `["light", "dark"]`                      | The themes. Each name uses letters, digits, `-` or `_` and cannot be `"system"`.                                                                                |
| `default`     | `"system"`                               | The choice for someone who has not chosen: `"system"` or a theme (the first if `system: false`).                                                                |
| `system`      | `true`                                   | `"system"` mode, following `prefers-color-scheme`. `true` uses `light` and `dark`; `{ light: "day", dark: "night" }` selects other themes; `false` disables it. |
| `darkThemes`  | the dark theme from `system` (or `dark`) | Themes receiving `color-scheme: dark`.                                                                                                                          |
| `attribute`   | `"data-theme"`                           | Where the theme goes on `<html>`: a `data-*` attribute or `"class"` (adds the theme name to classes and removes the other theme's).                             |
| `colorScheme` | `true`                                   | Applies `color-scheme` to `<html>` via CSSOM (`style.colorScheme`).                                                                                             |
| `cookie`      | `"meeko-theme"`                          | The choice cookie.                                                                                                                                              |
| `storageKey`  | the value of `cookie`                    | The `localStorage` key, notifying other tabs: by default, the cookie name (`"meeko-theme"` if `cookie` is unchanged); `false` uses only the cookie.             |
| `clientHints` | `true`                                   | Requests and reads `Sec-CH-Prefers-Color-Scheme` to resolve `"system"` on the server.                                                                           |

Cookies are per host, not per port: in development, all Meeko applications on `localhost` (or `127.0.0.1`), on any port, share the `meeko-theme` cookie, so choosing a theme in one changes the others on reload (`localStorage` is per port). To separate them, give each application its own name with `cookie`, for example `theme: { cookie: "mi-app-theme" }`.

#### `useTheme()`

`useTheme()` is auto-imported in `.meeko` files (your own export with that name takes priority) and called while a component's script runs. It returns:

- `theme`: the choice, including `"system"`. It is a writable signal: assigning it is equivalent to `set`, and works for `model="theme"`.
- `resolved`: the effective theme, read-only; in `"system"`, the one from `prefers-color-scheme`.
- `themes`: the list of themes, without `"system"`.
- `set(theme)`: changes the choice. Updates the `<html>` attribute (or class), `color-scheme`, cookie and `localStorage`. A name other than a theme or `"system"` throws `TypeError`.

In `"system"`, `resolved` follows `prefers-color-scheme` changes while the page is open, and a change in another tab arrives through the `localStorage` `storage` event. Client navigation preserves the theme, because it does not reload `<html>`. On the server, `theme` and `resolved` are those of the request and cannot be changed (`set` throws an error). Without `theme` in the configuration, `useTheme()` throws an error requesting it.

`meeko check` types themes from the configuration: with `themes: ["light", "dark", "sepia"]`, `resolved` is `"light" | "dark" | "sepia"` and `set("purple")` is a type error. Declarations are generated in `.meeko/types/routes.d.ts` (`GeneratedTheme`); without them, themes are `string`. The editor does not need them: it declares `GeneratedTheme` from `theme` read without executing `meeko.config.ts`, even before the first `meeko check`, when its value is a literal (`true` or an object with literal values).

#### Icons that do not shift

The shortest approach is [`<MeekoThemeToggle>`](#meekothemetoggle), which already does the following. Manually, there are two ways to render icons, and both are correct in server HTML when the server knows the theme (cookie, or client hint in `"system"`):

- **With CSS (recommended).** The component renders both icons and CSS shows one according to the `<html>` attribute. It never shifts, even when the server does not know the theme (a prerendered page, the `static` adapter or `"system"` without a client hint), because the `<head>` script sets the attribute before painting and CSS reads it from the first frame.
- **From `resolved`.** `{resolved.value === "dark" ? "luna" : "sol"}` or an `if:` on `resolved`. It is correct whenever the server knows the theme; when it does not, server HTML and hydration render the light theme from `system`, and the icon changes when hydration finishes.

```html
<!-- app/components/ThemeToggle.meeko -->
<script lang="ts">
	const { resolved, set } = useTheme()
	const toggle = (): void => set(resolved.value === 'dark' ? 'light' : 'dark')
</script>

<template>
	<button
		type="button"
		class="theme-toggle"
		aria-label="Theme oscuro"
		bind:aria-pressed="String(resolved.value === 'dark')"
		on:click="toggle"
	>
		<svg
			class="sun"
			viewBox="0 0 24 24"
			aria-hidden="true"
		>
			<circle
				cx="12"
				cy="12"
				r="5"
			/>
		</svg>
		<svg
			class="moon"
			viewBox="0 0 24 24"
			aria-hidden="true"
		>
			<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
		</svg>
	</button>
</template>

<style>
	.theme-toggle .moon {
		display: none;
	}
	:root[data-theme='dark'] .theme-toggle .sun {
		display: none;
	}
	:root[data-theme='dark'] .theme-toggle .moon {
		display: inline;
	}
</style>
```

`aria-pressed` depends on `resolved`, so in the unknown case it changes on hydration; this is invisible, and a screen reader announces it once the page is interactive. A three-option selector (system, light, dark) uses `theme` with `model`:

```html
<script lang="ts">
	const { theme } = useTheme()
</script>
<template>
	<select
		aria-label="Theme"
		model="theme"
	>
		<option value="system">System</option>
		<option value="light">Light</option>
		<option value="dark">Dark</option>
	</select>
</template>
```

<a id="data-theme-choice"></a>**`data-theme-choice`.** Since `1.4`, `<html>` also carries the choice, including `"system"`: `data-theme-choice="system"` while `data-theme` gives the effective theme (`dark`). The `<head>` script always writes it before the first paint, as does the server when it knows it from the cookie; the runtime updates it on each change. It is useful for your own CSS, whether or not you use `<MeekoThemeToggle>`: a â€œsystemâ€ icon that does not shift, or a selector's checked radio.

```css
.theme-toggle .icon {
	display: none;
}
:root[data-theme-choice='light'] .theme-toggle .sun,
:root[data-theme-choice='dark'] .theme-toggle .moon,
:root[data-theme-choice='system'] .theme-toggle .monitor {
	display: inline;
}
```

Without a cookie, server HTML does not include it (it does not know whether `localStorage` stores another choice, and a prerendered page is the same for everyone); the script writes it before painting. Without JavaScript, a `:root:not([data-theme-choice])` selector corresponds to `default`.

#### Custom theme selector

Since `1.8`, `useThemeToggle()` from `@meekojs/meeko/framework` is the public API for building a selector. Call it in a component script with `theme` enabled in `meeko.config.ts`; without that configuration or outside an application, it throws `MEEK111`. It takes no parameters and returns a `ThemeToggleState`, shared by the entire application:

| Member        | Description                                                                                                                                                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `theme`       | The same `ThemeState` as `useTheme()`: `theme`, `resolved`, `themes` and `set(choice)`.                                                                                                                                                               |
| `choices`     | List of configured choices, in order, including `"system"` if enabled. Read-only.                                                                                                                                                                     |
| `system`      | `ThemeToggleSystem`: `{ light, dark }`, the theme names for `"system"`; `undefined` without system mode.                                                                                                                                              |
| `known`       | `ReadonlySignal<boolean>`: the server knows the choice if it received the cookie; in the browser, becomes `true` when hydration finishes. While `false`, use a neutral accessible name, such as â€œChange themeâ€, without announcing an unknown choice. |
| `interactive` | `ReadonlySignal<boolean>`: `false` during SSR and hydration; `true` when browser handlers are ready. Use the native form while it is `false`.                                                                                                         |

The form sends `POST /_meeko/theme` with `theme` (the valid choice) and `return` (the current URL). The endpoint validates the theme and `Origin`, saves the cookie and returns `303` to a same-origin path. The `static` adapter has no endpoint: changing the theme requires JavaScript. This example uses native submit buttons, each with its own accessible name, without implementing a radio group:

```html
<script lang="ts">
	import { useRoute, useThemeToggle } from '@meekojs/meeko/framework'

	const toggle = useThemeToggle()
	const route = useRoute()
</script>

<template>
	<form
		method="post"
		action="/_meeko/theme"
	>
		<input
			type="hidden"
			name="return"
			bind:value="route.url.value"
		/>
		<button
			each:of="toggle.choices"
			each:as="choice"
			each:key="choice"
			type="submit"
			name="theme"
			bind:value="choice"
			on:click="(event) => { if (toggle.interactive.value) { event.preventDefault(); toggle.theme.set(choice); } }"
		>
			Usar {choice}
		</button>
	</form>
</template>
```

For a cycling button with icons, render all icons and mark each with `data-meeko-theme-icon="light"`, `"dark"`, `"system"` or a custom theme name. The rule `theme` adds to `<head>` shows the icon for the choice on `<html>` from the first frame: do not select a single icon with a conditional on `resolved`. If the selector omits `"system"`, add the `system-light` or `system-dark` token to the corresponding theme's icon (for example, `data-meeko-theme-icon="light system-light"`); `toggle.system` identifies those themes. These decorative icons have `aria-hidden="true"`; the button needs text or an `aria-label`.

The `theme` configuration, cookie, `<head>` script, this icon rule and `POST /_meeko/theme` remain in core. For a complete control with keyboard support and accessibility, use `UIThemeToggle` from `@meekojs/ui` 0.2. See the [useThemeToggle reference](reference/composables/usethemetoggle.md).

#### `<MeekoThemeToggle>`

> **Deprecated since 1.8; removal in 2.0.** Use `<UIThemeToggle>` from the `@meekojs/ui` 0.2 module, with the same props, snippets and markup. In 1.x it still works and emits `MEEK121`. See [Migration to 1.8](migration-1.8.md).

Since `1.4`, with `theme` in `meeko.config.ts`, Meeko includes its own theme selector: a built-in tag, like `<MeekoLink>`, without an import.

```html
<MeekoThemeToggle>
	<snippet name="light"><IconSun /></snippet>
	<snippet name="dark"><IconMoon /></snippet>
	<snippet name="system"><IconMonitor /></snippet>
</MeekoThemeToggle>
<MeekoThemeToggle mode="select" />
<MeekoThemeToggle
	bind:themes="['light', 'dark']"
	bind:labels="{ light: 'Light', dark: 'Dark', system: 'System' }"
	class="toggle"
/>
```

| Prop          | Default                      | What it does                                                                                                                                                        |
| ------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`        | `"cycle"`                    | `"cycle"`: a button advancing to the next choice in the list. `"select"`: a radio group.                                                                            |
| `themes`      | the themes and `"system"`    | Choices and their order (`bind:themes="['light', 'dark']"`).                                                                                                        |
| `labels`      | â€œClaroâ€, â€œOscuroâ€, â€œSistemaâ€ | Each choice's name; an unlabeled custom theme uses its theme name.                                                                                                  |
| `messages`    | in Spanish                   | Accessible text: `cycle(current, next)` (the button's `aria-label`), `unknown` (â€œCambiar temaâ€) and `group` (â€œTemaâ€), for localization. Type `ThemeToggleMessages`. |
| `class`, `id` | â€”                            | On the root `<form>`. Other attributes do not pass through: wrap the tag if you need them.                                                                          |

Each snippet (`light`, `dark`, `system` or a custom theme name) is that choice's icon; without a snippet, its label renders. `meeko check` and the editor type snippets, `themes` and `labels` with the themes from `meeko.config.ts` (`system` only if enabled) and `mode` as `"cycle" | "select"`; the editor completes the tag, its props and snippets, and hovering shows the tag's reference entry. Its prop type is `MeekoThemeToggleProps`, auto-imported like `MeekoLinkProps`. It has no visual styles of its own: the button and radios are native elements styled by the application (`.toggle button`, `[role="radio"][aria-checked="true"]`, `[data-meeko-theme-option="dark"]`). To mark the selected radio before hydration too, when the choice is unknown and there is no `aria-checked`, use `data-theme-choice`, like the icons: `[data-theme-choice="dark"] [data-meeko-theme-option="dark"]`.

**Icons that never shift.** The component renders all icons, each in `<span data-meeko-theme-icon="light|dark|system|â€¦">`, without selecting any: with `theme` enabled, Meeko adds a minimal CSS rule to `<head>`, only `display: none`, hiding all except the one for `data-theme-choice`. Since the `<head>` script writes that attribute before the first paint, the icon is correct from the first frame in every case (with a cookie, in `"system"` without a cookie or client hint, on a prerendered page or in `static`), without JavaScript in the component, and hydration changes no component nodes. A list without `system` (`bind:themes="['light', 'dark']"`) shows the effective theme's icon in system mode, according to `prefers-color-scheme`, like the script. In `mode="select"`, each radio has its icon and all are visible.

**Accessibility.** In `mode="cycle"`, it is a `<button>` whose `aria-label` announces the choice and the next one, â€œTema: oscuro. Cambiar a sistemaâ€, updating on each change. When HTML is generated without knowing the choice (without the cookie, a prerendered page), the `aria-label` is neutral, â€œCambiar temaâ€, until hydration finishes: this avoids announcing something false or causing a hydration mismatch, because hydration renders the same thing as the server. In `mode="select"`, it is a `role="radiogroup"` with an `aria-label` (â€œTemaâ€) and a `role="radio"` button per choice, with `aria-checked` and the choice's name. When HTML does not know the choice, no radio has `aria-checked`, neither `"true"` nor `"false"`: a group with all set to `"false"` would say nothing is checked, and checking `default` would tell someone who chose another theme something false, since the prerendered page is the same for everyone. When hydration finishes, each radio receives its `aria-checked` once, with visual state already supplied by CSS using `data-theme-choice`; with JavaScript, arrow keys, `Inicio` (Home) and `Fin` (End) move focus and selection, with roving `tabindex`, like a native radio group. Without JavaScript, each radio is a button reachable with Tab.

**Without JavaScript (progressive enhancement).** The component is a `<form method="post" action="/_meeko/theme">`: the `"cycle"` button submits the next choice and each radio submits its own, together with the page URL (`return`). With JavaScript, submission is intercepted and the change is immediate, using `useTheme().set()`, without navigation. Without it, the server handles the form:

- `POST /_meeko/theme` exists only with `theme` enabled (other methods respond `405`).
- It only accepts `application/x-www-form-urlencoded` up to 2 KB; `theme` must be a theme from `themes` or `"system"` (with system mode enabled); otherwise, `400 INVALID_THEME`, without writing anything.
- It writes the cookie like the browser runtime (`Path=/`, one year, `SameSite=Lax`, `Secure` on HTTPS) and responds `303` to `return`, which must be a path on this origin (`/docs?tab=a`). An absolute URL, `//otro.sitio`, a backslash or control characters fall back to `/`: there is never an open redirect. The next SSR document already has the new theme.
- **CSRF.** It does not use the session or CSRF token (`x-meeko-csrf`, which only exists with JavaScript): it only changes the theme cookie. Like an API mutation, it requires an `Origin` matching the request's, which after `createServerApp` is the configured `publicOrigin`; a missing, `null` or other-site `Origin` responds `403 INVALID_ORIGIN` before reading the body. Browsers send `Origin` on every `POST`; a page with `Referrer-Policy: no-referrer` sends it as `null`, so the JavaScript-free form does not work there (it does with JavaScript). Behind a proxy, configure the public origin, as for mutations with a session.
- **Prerendering with Node.** The endpoint also exists on the server of an application with prerendered pages and writes the cookie; but prerendered HTML is the same for everyone and, without JavaScript, does not apply the cookie (the `<head>` script does), so the page still shows the default theme. Without JavaScript, the change is only visible on SSR pages.
- **`static` adapter.** There is no server: the form renders the same way (the HTML comes from prerendering, common to all adapters) and works with JavaScript, but without it, the `POST` reaches hosting, which rejects it. This is a documented limitation; on a static site, the selector needs JavaScript.

Using `<MeekoThemeToggle>` without `theme` produces `MEEK111`. `meeko dev` and `meeko build` know from the configuration, which they execute; `meeko check` and the editor read `theme` from `meeko.config.*` without executing it. When this cannot determine it (`theme: variable`, a nonliteral configuration, or a folder without `meeko.config.*`, such as a layer with its own `package.json`), they do not warn, and the component produces the same error at render time. A project component named `MeekoThemeToggle` takes priority over Meeko's tag, with the `MEEK106` warning, as with `MeekoLink`.

#### How flashing is prevented in each case

| Case                                                        | Who sets the theme on `<html>`                                                                                                        | `useTheme()` in server HTML                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| SSR with the cookie (`light`, `dark`, a custom theme)       | The server, from the first byte.                                                                                                      | The cookie's theme. Hydration changes nothing.                                              |
| SSR in `"system"` with `Sec-CH-Prefers-Color-Scheme`        | The server, with the client hint.                                                                                                     | The system theme. Hydration changes nothing.                                                |
| SSR in `"system"` without the client hint (Firefox, Safari) | The `<head>` script, before the first paint; HTML has no attribute, so `prefers-color-scheme` CSS is also correct without JavaScript. | `resolved` is the light theme from `system`; it changes on hydration if the system is dark. |
| Prerendered page or `static` adapter                        | The `<head>` script, with the cookie or `localStorage`.                                                                               | The build's default value; it changes on hydration if the user chose another.               |

The script reads the cookie, then `localStorage` (so a choice saved only there, as on a site previously using `localStorage`, still applies and returns to the cookie), and finally `default`; in `"system"`, it queries `prefers-color-scheme`. It writes the theme and [`data-theme-choice`](#data-theme-choice). A cookie written by the server (the JavaScript-free `<MeekoThemeToggle>` form) transfers to `localStorage` and other tabs on the next load with JavaScript. It always runs and is idempotent: where the server already wrote the theme, it writes the same one. It goes among managed `<head>` tags, just after `meta` tags (so a CSP in `<meta http-equiv>` also applies to it) and before all linked stylesheets, those from `document.head` and `useHead` and from the build, so it waits for none.

**Client Hints.** An SSR response includes `Accept-CH: Sec-CH-Prefers-Color-Scheme` and, when the choice is `"system"`, `Critical-CH: Sec-CH-Prefers-Color-Scheme`. Chromium remembers `Accept-CH` for the origin and, on the first visit, responds to `Critical-CH` by repeating the request with the hint before showing anything: once per origin, with one extra round trip on that first visit. Firefox and Safari do not send the hint and use the script. With `clientHints: false`, Meeko neither requests nor reads the hint.

**Hydration.** The browser hydrates with the values rendered by the server (they travel in page state, `sharedState["meeko:theme"]`) and receives its own when hydration finishes, before `onMounted`, like `useStorage`. This prevents hydration mismatches, changing only what depended on a theme the server did not know.

**Security.** The server only accepts a theme from `themes` (or `"system"`) in the cookie; any other value is ignored and never written into HTML. The browser writes the cookie with `Path=/`, `SameSite=Lax`, a one-year lifetime and `Secure` on HTTPS; it is not `HttpOnly`, because the client writes it, and contains nothing private.

#### CSP

- **SSR.** The script and `<style>` for `<MeekoThemeToggle>` icons carry the nonce from `DocumentOptions.nonce` or, since `1.7`, the one Meeko generates with `server.contentSecurityPolicy`, like any `useHead` script or style. A page with [`cache`](#ssr-page-caching) has no nonce: its hashes enter that response's CSP ([CSP and headers in server adapters](framework-deployment.md#csp-and-headers-in-server-adapters)).
- **Prerendering and `static`.** The script and style are in each page's HTML, so their hashes enter `scriptHashes` and `styleHashes` in the prerender index and the CSP written by the `static` adapter ([CSP with hashes](framework-deployment.md#csp-with-hashes)). Their text depends only on `theme`: it is the same across pages and its hash only changes if the configuration changes.
- **Why a hashed `<style>`.** The icon rule must precede the first paint and work without JavaScript (the `<MeekoThemeToggle>` form), so the script cannot apply it through CSSOM. An inline `<style>` with a nonce (SSR) or hash (prerendering and `static`) is allowed by a CSP without `'unsafe-inline'`, without another file to request. The hash is only added to a directive without `'unsafe-inline'`: with a hash, the browser would ignore `'unsafe-inline'` and block `style="â€¦"` attributes the policy allowed.
- **`color-scheme`.** This is not an HTML `style` attribute, which a CSP without `'unsafe-inline'` in `style-src` would block: the script and runtime apply it through CSSOM (`style.colorScheme`), which CSP allows. For the page to have the right scheme without JavaScript too, declare it per theme in your CSS, as in the example above.

#### Caching

An SSR document depends on the cookie and client hint, so it has `Vary: Cookie, Sec-CH-Prefers-Color-Scheme` (without `clientHints`, `Vary: Cookie`). SSR responses are `cache-control: no-store` except those of a page with [`cache`](#ssr-page-caching), whose `ETag` already includes the theme; if a proxy or CDN caches your pages, it must include the theme cookie in its key or avoid caching them, or it will serve one user's theme to another. Many CDNs do not vary by `Cookie` and do not cache a response with `Vary: Cookie`. Prerendered pages and the `static` adapter do not vary by theme: the same file serves everyone and the script applies each visitor's theme, so caching works as before. A prerendered page served by `meeko start` does vary by session, as without themes: without a session, it responds with `Vary: cookie` and `cache-control: public, max-age=0, must-revalidate`, and with a session, `private, no-store`, because it inserts the session's CSRF meta tag (see [Common rules](#common-rules)).

A custom host passing `DocumentOptions.config` to `createFrameworkHandler` puts the theme in `config.theme` (as does `mountClientApp({ document })`); the build copies it there from `theme` in `meeko.config.ts`, where `document.theme` is unsupported.

## Route and server middleware

Route middleware has its own [guide](routing-middleware.md). General HTTP middleware remains here.

### Named middleware

The explanation is in [Route middleware](routing-middleware.md#named-middleware).

### Server route middleware

The explanation is in [Route middleware](routing-middleware.md#server-route-middleware).

### Server middleware

To intercept HTTP on the server before the page or API/RPC handler, put middleware in `server/middleware/*.ts` and use `defineServerMiddleware` from `@meekojs/meeko/server`. It receives `Request` and `next(request)`; it must return a `Response`. It can continue, modify a response or short-circuit. Meeko executes files by name, from outside inward; `next()` can only be called once. Middleware runs before creating the request's session context, including for prerendered pages; public build files are served before middleware. Built-in API/RPC authentication, authorization, contract and CSRF checks still run inside the handler.

```ts
// server/middleware/10-request-header.ts
import { defineServerMiddleware } from '@meekojs/meeko/server'

export default defineServerMiddleware(async (request, next) => {
	const response = await next()
	const headers = new Headers(response.headers)
	headers.set('x-content-type-options', 'nosniff')
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	})
})
```

Server middleware has no `RequestContext`: for the client IP, use `clientAddress(request)` (since `1.7`), which applies `MEEKO_TRUST_PROXY` like `context.clientAddress` and `rateLimit`; never read `X-Forwarded-For` manually (see [Client IP behind a proxy](framework-auth.md#client-ip-behind-a-proxy)).

This pipeline wraps SSR pages, `/api` and `/_meeko/rpc`; static assets, the Vite development server and WebSocket upgrades have their own handlers. `*.test.ts`, `*.spec.ts`, `*.d.ts` and `*.client.ts` files are excluded. Automatic middleware discovery is currently limited to the root project: layers contribute routes, auto-imports and plugins, but their `app/middleware` and `server/middleware` folders do not participate. A module adds server middleware with `meeko.addServerMiddleware`, which runs before the project's middleware (see [Modules](framework-configuration.md#modules)). Editing an existing middleware file invalidates modules and reloads the browser during development; when you add or remove one, `meeko dev` recreates the application without restarting (see [Configuration](framework-configuration.md#configuration)). `npm run check` checks types in their respective scopes.

`onNavigationError` callbacks can return a promise: if the observer fails, Meeko logs both the observer failure and the original navigation error without generating an unhandled rejection. Server `onError` observers also do not change the response when they throw or reject; fallback logging includes the available `requestId` and error categories, without private messages.

Component events can be observed per root with `provideErrorHandler` in the `<script>` of `app/app.meeko` or a layout; it is automatically imported, and the callback receives `unknown` and its `ErrorSource`. Children inherit the closest observer, including after an HMR replacement. `mountClientApp({ onError })` defines the application-wide observer: it receives navigation, Socket channels, events, effects and cleanups without a closer `provideErrorHandler` and, since `1.3`, the page's uncaught exceptions and unhandled promise rejections ([Global browser failures](framework-server.md#global-browser-failures)). Without `onError`, navigation, Socket and those global failures consult the application's first active provider when there is no explicit `onNavigationError` or channel `onError`. That provider is unregistered when its root is disposed; an observer failure is logged with the original error. Direct calls to `app.navigate()` and `socket.emit()` keep their rejections for the code awaiting them. SSR has no browser events or Socket connections.

If server middleware calls `next()`, Meeko also awaits that work even if the middleware forgets to await the promise. A downstream failure propagates to the HTTP handler; if both fail, each error is preserved in an `AggregateError`. Middleware must return a pipeline response or its own response.

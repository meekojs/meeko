---
source-hash: d335ed08e076d535b1cf790f8b3a200fd9051c58cb1ad0c4b5ad1a820881bdbb
---

# Layouts: technical details

Full contracts and edge cases. For common usage, start with the [short guide](routing-layouts.md).

## Named layouts

Since `1.5`, each `app/layouts/<nombre>.meeko` is a named layout: `default`, `dashboard`, `auth`, `blank`… A subfolder forms part of the name: `app/layouts/admin/panel.meeko` is `"admin/panel"`. The name contains letters, digits, `-` and `_` (and `/` between folders), starting with a letter or digit; a file with another name (`_partes.meeko`) is not a layout and can hold other components. A named layout is a normal layout: it renders the page with `<MeekoOutlet />` and declares its props with `defineProps`.

The page selects its layout in its route options, in `<script server>` or the `*.route.ts` sidecar:

```html
<!-- app/pages/connections.meeko -->
<script
	server
	lang="ts"
>
	export const route = definePage({ layout: 'dashboard' })
</script>
<template><h1>Connections</h1></template>
```

- **Without `layout`**, the page uses the layout inherited from its folders' [`+group.ts`](#per-folder-options-groupts) files or, if none, `default`, as up to `1.4`.
- **`layout: false`** removes the named layout: `app/app.meeko` and its folders' `+layout.meeko` files remain.
- **A literal.** Like `render`, `meeko build` reads `layout` without executing the file: it must be a string literal or `false` inside `definePage({ ... })`. A computed value produces `layout debe ser un literal de texto…` with the file. A nonexistent name stops `meeko dev`, `meeko build` and `meeko check`: `el layout "nowhere" no existe; crea app/layouts/nowhere.meeko (layouts disponibles: …)`. In types, `layout` is the union of application layouts, with editor completion; hovering the name shows its file and pages, and Ctrl+click opens it.
- **Nesting order.** `app/app.meeko` → named layout → folder and group `+layout.meeko` files, from outermost to innermost → page. `(group)` groups and `+layout.meeko` files work as before, inside the named layout. Having both `app/pages/+layout.meeko` and `app/layouts/default.meeko` remains an error; an `app/pages/+layout.meeko` without `default` nests inside the named layout the page selects.

```text
app/app.meeko
└─ app/layouts/dashboard.meeko        (layout: "dashboard")
   └─ app/pages/(dashboard)/+layout.meeko
      └─ app/pages/(dashboard)/connections.meeko
```

**Navigation.** The browser preserves layouts shared by the outgoing and incoming pages, as always: if both use the same named layout, it stays mounted with its state (DOM, focus, sidebar scroll, text entered in a field) and only its contents change; if they use different layouts, the old one is disposed of and the new one mounts. This works equally for SSR, `render: "stream"`, `render: "client"`, prerendered pages and the `static` adapter.

**Error page.** A page that fails in the browser (its loader, `notFound()` or data) shows its `+error.meeko` or `app/error.meeko` inside its own layouts, including the named layout, with its `+group.ts` props and without the page's props. The `404` for an unmatched URL uses the `default` layout (if present), with its default values. Since `1.8`, a page that responds `404` on the server (`notFound()` or an `ApiError` with that status) gives the same document, which hydrates; with a nearer `+error.meeko`, that page goes inside the page's layouts, without hydration. If a layout fails while painting it, or the error is another one, the error document has no layouts, because a layout may be what failed.

### Per-folder options: `+group.ts`

To avoid repeating `layout` on each page, a `+group.ts` in any `app/pages` folder (a `(dashboard)` group or a normal folder) declares options for that folder and its subfolders. `defineGroup` is auto-imported:

```ts
// app/pages/(dashboard)/+group.ts
export default defineGroup({ layout: 'dashboard', layoutProps: { showAlert: false } })
```

- **Cascading inheritance.** `+group.ts` files apply from outermost to innermost, then the page. The page's `layout`, or that of the innermost group declaring it, wins.
- **`layoutProps` merge by key** between groups and the page, with the page winning. A group or page selecting a different layout from the inherited one starts without inherited props, which belonged to another layout.
- **`layout: false`** on a page (or group) inside a group removes the named layout and keeps its `+layout.meeko` files.
- **Literals.** Meeko reads the file without executing it, like `render`: `layout` is a literal or `false`, `layoutProps` is an object literal of strings, numbers, booleans, `null`, arrays and objects, and `middleware` is an array literal of strings or `false`. A computed value, spread or unknown option stops discovery, naming the file. This is why it works equally in prerendering and a static site.
- **`middleware`** (since `1.6`). Named middleware for the group's pages, added to outer groups' middleware; `middleware: false` removes inherited middleware. See [Named middleware](routing-middleware.md#named-middleware).
- **Types.** `defineGroup({ layout: "dashboard", layoutProps: { … } })` checks `layoutProps` against that layout in the file itself. A group inheriting its layout, and a page not selecting one in `definePage`, are checked by `meeko check` against the inherited layout (`MEEK_PAGE_LAYOUT_PROPS`: `Las layoutProps de app/pages/(dashboard)/reports/+group.ts no coinciden con las props del layout dashboard`). A `+group.ts` outside `app/pages` configures nothing: `meeko check` warns with `MEEK115`.

To migrate a group with its own layout, such as `app/pages/(dashboard)/+layout.meeko`, move the file to `app/layouts/dashboard.meeko` and add `app/pages/(dashboard)/+group.ts` with `export default defineGroup({ layout: "dashboard" })`. The layout now replaces `default` rather than nesting inside it, and any page in another folder can select it; remaining subfolder `+layout.meeko` files still nest inside.

### Layouts from layers and modules

A layer contributes its `app/layouts/*.meeko` to the entire application, and a module contributes its layouts with `meeko.addLayout(name, file)` (see [The `meeko` object](framework.md#the-meeko-object)). When two layouts have the same name, the project wins, then the page's own layer, then other layers in order, and finally modules; two modules with the same name are an error. `default` keeps the `1.4` rule: the project's layout also wraps layer pages; a layer's `default` only wraps its own pages when the project has none (nor `app/pages/+layout.meeko`), and a module's is used when neither project nor layer has one.

## Layout props from the page

The layout declares normal props. The page passes them, checked against the selected layout's `Props`, excluding `outlet`:

```html
<!-- app/layouts/dashboard.meeko -->
<script lang="ts">
	export interface Props {
		title?: string
		showAlert?: boolean
	}
	const props = defineProps<Props>({ showAlert: false })
</script>
<template>
	<header>{props.title}</header>
	<AppAlert if:when="props.showAlert" />
	<main><MeekoOutlet /></main>
</template>
```

Because Meeko renders the layout without props a page does not pass, named layout props must be optional or have default values; `meeko check` verifies this (`MEEK_LAYOUT_PROPS`).

**1. With route options (`layoutProps`).** Static or calculated from server data, like `head`: they reach the SSR HTML from the first byte.

```ts
// app/pages/connections.route.ts (or export const route in <script server>)
export const route = definePage({ layout: 'dashboard', layoutProps: { title: 'Connections', showAlert: true } })
```

```ts
export const route = definePage({
	layout: 'dashboard',
	load: async ({ context }) => ({ user: await users.current(context) }),
	layoutProps: ({ data }) => ({ title: data.user.name }),
})
```

With top-level code in `<script server>`, write the props as one more export. Since `1.8`, `export const layoutProps` is typed by its own values and checked against the layout; like `head`, it does not reach the page, so data that only the layout reads travels once, unless you also export it separately:

```html
<script server lang="ts">
	export const route = definePage({ layout: 'docs' })

	const { params } = usePage()
	const snapshot = await readPage(params.slug)
	export const doc = { html: snapshot.html }
	export const layoutProps = { nav: snapshot.nav, title: snapshot.title }
</script>
```

Exporting it and also declaring `route.layoutProps` is `MEEK072`.

The function receives the same context as `head` (`params`, `search`, `request`, `context`, `signal`, `state` and `data`); with top-level code in `<script server>`, `data` contains its exports, typed since `1.8` when the options are an object literal without a spread. They merge with `+group.ts` props and take priority. They travel in the payload (`layoutProps`), so they must be JSON-serializable: an `undefined` prop (`{ title: data.user?.name }` without a user, or `layout.set({ title: undefined })`) leaves the prop unset, so the layout uses its default value on both server and browser; a value JSON cannot represent (a date, a `Map`, an instance) fails the page with an error naming the page, layout and prop. On a `render: "client"` page, the object already reaches the server HTML and the function runs in the browser after `load`. `export const layoutProps` in `<script server>` is not an option: it would be another page data field.

**2. From the page's `<script>`: `useLayout()`.** It is auto-imported and, in a page, its type follows the layout selected by its `definePage` or `+group.ts` files (in another component, `useLayout<"dashboard">()`):

```html
<!-- app/pages/connections.meeko -->
<script lang="ts">
	const layout = useLayout() // LayoutHandle for "dashboard"
	const failing = signal(false)
	effect(() => layout.set({ showAlert: failing.value }))
</script>
<template>
	<p>Current title: {layout.props.title}</p>
	<button on:click="() => failing.value = !failing.value">Test connection</button>
</template>
```

- `layout.set(patch)` changes the named props and preserves the others; `layout.props` reads the props the layout receives (reactive); `layout.name` is the layout's name. A prop the layout does not declare, or with another type, is a type error.
- The layout does not remount: with `1.2` reactive props, only what reads those props changes.
- **Nothing carries over.** On navigation to another page, the layout receives the new page's props (its `layoutProps`, those of its `+group.ts` files and, for the rest, the layout's default values), even if the layout is preserved. A page that has already left cannot write.
- **SSR without mismatches.** The layout renders before the page, so what the page setup writes with `set` during rendering reaches the HTML through a second server render of the page (with the same request state and data, like an `await` pass), and the payload contains those props: the browser hydrates exactly that HTML. A render writing different values each time stops on the third pass. In the browser, what the page writes while rendering and hydrating applies when mounting finishes; afterwards, each `set` applies immediately.
- A page without a named layout (`layout: false`) receives a `useLayout()` that does nothing. Outside a page rendered by Meeko (a unit test), `useLayout()` throws an error.

**Markup in layout areas.** Props are for data. To put page content in a layout area (header buttons, breadcrumbs), use `<MeekoTeleport>`, which moves page markup to a layout target.

**Types.** `.meeko/types/routes.d.ts` declares `GeneratedLayouts` (each layout's props) and `GeneratedPageLayouts` (each route's layout). `LayoutProps<"dashboard">` (auto-imported) is the type of props a page can pass to `dashboard`; `LayoutName` is the union of names, and `PageLayout<"/connections">` is a route's layout.

**Comparison with Nuxt.** In Nuxt, `definePageMeta({ layout: "dashboard" })` selects the layout, but there is no typed way to pass it props: you resort to `useState`, `provide`/`inject` or `route.meta` (such as a `showAlert` in `meta`), without checking against the layout's types and with state that can carry over from the previous page. In Meeko, `layout` and `layoutProps` are checked against the layout's `Props`, reach the server HTML, `useLayout()` changes them reactively, and each navigation resets to the new page's props.

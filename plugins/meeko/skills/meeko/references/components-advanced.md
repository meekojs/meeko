# Advanced components: styles, dynamic components, refs, built-ins

Meeko 1.9. Built-in tags (`<MeekoAwait>`, `<MeekoTeleport>`, `<MeekoLink>`, `<MeekoOutlet>`) are recognized by the compiler: **never import them**. A project component with the same name shadows the built-in (`MEEK106` warning) — don't name your components `Meeko*`.

## Styles

One style block per `.meeko`, processed by the project's CSS pipeline (its `postcss.config`, plus any Vite plugin it
registers, such as Tailwind) and bundled per component/route. Meeko ships no CSS engine of
its own: the project picks plain CSS, Tailwind, UnoCSS… (`@meekojs/ui` already sets up Tailwind).

|                               | `<style scoped>` (default choice)                          | `<style>` (global)                              |
| ----------------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| Applies to                    | This template's elements only (`data-meeko-s-<hash>` attr) | Whole page, stays applied after navigating away |
| Child components / `html="…"` | No — reach them with `:global(...)`                        | Yes                                             |
| `:global(...)`                | Unwraps the selector                                       | Not transformed — don't use                     |

```html
<template>
	<article class="prose" html="props.content"></article>
	<ChildCard class="card" />
</template>
<style scoped>
	.prose :global(p) { margin-block: 0.75em; }   /* -> .prose[data-meeko-s-…] p */
	:global(html.dark) .prose { color: white; }    /* -> html.dark .prose[data-meeko-s-…] */
	.prose::before { content: ''; }                /* attr goes before the pseudo-element */
</style>
```

- Attribute goes on the last local compound. `:global` without parens, empty, with a selector list inside, or nested in `:not(...)` → `MEEK019`. `@keyframes` untouched.
- Snippet content gets the scope of the component that **writes** it; a child component's own elements do not get the parent's attribute.
- App-wide CSS (reset, tokens) belongs in `app/styles/main.css`, not in a non-scoped component `<style>`.
- `css: { scopeAttribute: 'matched' }` in `meeko.config.ts` (default `'all'` in 1.x, becomes default in 2.0) puts the attribute only on elements a scoped selector can match. With it, classes added via `classList`/`setAttribute` on elements without `ref:`/`on:`/`bind:class` won't get scoped styles — use `bind:class`, `ref:`, or `:global`. Restart `meeko dev` after changing it.

## Component tags and `<component is>`

PascalCase tags are components: `<AppButton bind:label="'Save'" />` ≡ `<component is="AppButton" bind:label="'Save'" />`. The name is an import (`import * as AppButton from './AppButton.meeko'`) or an auto-import from `app/components`. `<Table>`, `<Input>`, `<Title>` are components, not HTML.

Use `<component is="expr">` when the choice is an expression. `is` accepts:

```html
<!-- 1. a component module (typed prop or lookup table) -->
<script lang="ts">
	import type { Component } from '@meekojs/meeko'
	import * as GridView from './GridView.meeko'
	import * as ListView from './ListView.meeko'
	const props = defineProps<{ content: Component<{ label: string }>; items: Item[] }>()
	const mode = signal<'grid' | 'list'>('grid')
	const views = { grid: GridView, list: ListView }  // plain const, NOT a signal
</script>
<template>
	<component is="props.content" bind:label="'Hi'" />
	<component is="views[mode.value]" bind:items="props.items" />  <!-- swap disposes old instance -->
</template>

<!-- 2. an HTML tag (since 1.5): literal, union-typed expression or TagName -->
<component is="props.href ? 'a' : 'button'" class="btn" bind:href="props.href" bind:type="props.type ?? 'button'">
	<render snippet="snippets.default" />
</component>

<!-- 3. a PascalCase literal naming a known component (since 1.8), incl. 'MeekoLink' -->
<component is="to !== undefined ? 'MeekoLink' : href !== undefined ? 'a' : 'button'"
	bind:to="to" bind:params="params" bind:href="href" bind:type="type">Open</component>
```

Rules:

- Attributes are only written where the current tag accepts them: `href` only on `<a>`, `type`/`disabled` only on `<button>`. With `'MeekoLink'`, `to/params/search/match` go to that branch only. An attribute no branch accepts → `MEEK112`.
- Tag must be in Meeko's HTML allow-list; `script`, `style`, `iframe`, `object`, `embed`, `template`, `slot`, `textarea`, `title`, `base`, `link`, `meta`, `head`, `html`, `body`, `noscript`, `param`, `fencedframe`, custom elements and SVG tags are rejected (`MEEK112`; runtime `TypeError` before writing HTML). A plain `string` type is `MEEK112` — type it as a literal union or `TagName` (exported from `@meekojs/meeko`).
- A text string from data never becomes a component (`is="option.component"` where it is `"AppSelect"` → `MEEK112`). Use a literal in `is`, an imported module in the data, or `resolveComponent`.
- `is="x ? MeekoLink : 'a'"` → `TS2304` (MeekoLink is not a value). Write `'MeekoLink'`. `'MeekoOutlet'`/`'MeekoTeleport'` are not allowed; unknown PascalCase literal → `MEEK132`; mixing names with a non-literal (`x ? 'MeekoLink' : props.as`) → `MEEK132`.
- `ref:` with several named-component branches → `MEEK052`. `model` on a tag-only `is` → `MEEK112`. Void tag (`img`, `input`) with content → `MEEK031`.
- Content between tags: for a component, its snippets (loose = `default`, `<snippet name="x" params="a, b">`); for an HTML tag, its children. A prop typed `Component<Props>` declares no snippets — type it `typeof Card` to pass content.
- Modules are not serializable: never put them in a `signal`/`useState` (`MEEK136`). Keep modules in a const map, keep the _keys_ in a signal, derive with `computed`.
- Changing the tag between HTML tags moves children (state/focus kept); tag↔component remounts.

### `bind="obj"` (bulk props/attributes)

```html
<component each:of="options.value" each:as="o" each:key="o.id" is="o.component" bind="o.props" />
<BaseButton bind="rest" on:click="(e) => emit('click', e)">{label}</BaseButton>
```

- Explicit attributes win over `bind` keys. `bind` rejects `on*` keys (`MEEK113`) — forward events with `on:`.
- When `is` and `bind` read the same object path, each entry is checked against its own component.
- For bind objects use `XProps` (no callbacks), not `ComponentProps<"X">` (includes `onX`).

## Wrapping another component (since 1.8)

Auto-imported component `<BaseButton>` gives `BaseButtonProps` (no event callbacks), `BaseButtonEmits`, `BaseButtonSnippets`, `BaseButtonModels`, `BaseButtonExposed`, and `ComponentProps<"BaseButton">` (everything incl. `onClick`).

```html
<script lang="ts">
	type Props = BaseButtonProps & { label: string }   // `type`, not `interface extends` (TS2312 on unions)
	const { label, ...rest } = defineProps<Props>()
	const emit = defineEmits<BaseButtonEmits>()
</script>
<template>
	<BaseButton bind="rest" on:click="(event) => emit('click', event)">{label}</BaseButton>
</template>
```

`aria-*`/`data-*` passed to a component are props: declare them (e.g. `& Omit<ElementAttributes<'a'>, 'href'>` from `@meekojs/meeko`) or get `TS2353`. Optional props accept `undefined` = not passed (default applies).

## Refs and `defineExpose`

```html
<!-- SearchBox.meeko -->
<script lang="ts">
	const query = signal('')
	const clear = (): void => { query.value = '' }
	defineExpose({ query, clear })        // top level, once (MEEK050)
</script>

<!-- Parent.meeko -->
<script lang="ts">
	const title = useElementRef('title')  // ReadonlySignal<HTMLHeadingElement | null>
	const box = useElementRef('box')      // ReadonlySignal<{ query; clear } | null>
	const rows = useElementRef('row')     // in each:of → readonly array, document order
	onMounted(() => title.value?.scrollIntoView())
</script>
<template>
	<h2 ref:title>Search</h2>
	<SearchBox ref:box />
	<li each:of="items.value" each:as="i" each:key="i.id" ref:row>{i.name}</li>
	<button on:click="() => box.value?.clear()">Clear</button>
</template>
```

- `useElementRef` value is `null` in SSR, before hydration, while hidden by `if:` and after disposal; set when `onMounted` runs.
- `const el = await useElementRef('title')` → never null, waits (also under a false `if:`); the rest of setup is browser-only. Awaiting a list ref → `MEEK056`; awaiting a component without `defineExpose` → `MEEK080`.
- Argument must be a string literal naming an existing `ref:` (`MEEK056`). `ref:` with a value/duplicated → `MEEK052`/`MEEK053`. `ref="x"` is a plain attribute, not a ref.
- Top level of `<script>` only (`MEEK054` inside functions/effects/`onMounted`), same for `useApi`, `useRpcQuery`, `useRpcMutation`.

## Generic components

```html
<script lang="ts" generic="T extends { id: string }">
	const props = defineProps<{ rows: T[] }>()
	const emit = defineEmits<{ select: [row: T] }>()
	const snippets = defineSnippets<{ row: [row: T] }>()
	const current = defineModel<T | null>('current', { default: null })
</script>
<template>
	<ul><li each:of="props.rows" each:as="row" each:key="row.id" on:click="() => emit('select', row)">
		<render snippet="snippets.row" args="row" />
	</li></ul>
</template>
```

Parent never writes type args: `T` is inferred **from props only**. Script-level `interface`/`type` using `T` → `MEEK100` (inline it in the macro or make the alias generic). Pages, layouts, `app.meeko`, `error.meeko` and `<script server>` cannot be generic.

## `<MeekoAwait>` — states for non-awaited data

```html
<script lang="ts">
	const items = useApi('/api/items')                 // no await: fetched in browser after mount
</script>
<template>
	<MeekoAwait for="items" reserve>                  <!-- for="[users, stats]" for several -->
		<snippet name="pending"><ItemsSkeleton /></snippet>
		<snippet name="error" params="error, retry"><p role="alert">Failed. <button on:click="retry">Retry</button></p></snippet>
		<ItemsList bind:items="items.data.value" />   <!-- typed as loaded, no ! needed -->
	</MeekoAwait>
</template>
```

- `for` takes the **resource** (not `items.data`) — missing → `MEEK116`. Default snippet params: `[refreshing: boolean]`. `reserve` remembers last height; `reserve="320px"` sets a minimum (must be a CSS length). `bind:messages="{ error, retry }"` for default texts. Renders one unstyled `<div data-meeko-await="pending|error|ready" aria-busy>`.
- Data read outside the tag is still `T | null` (`TS18047`).
- Above-the-fold data: prefer `const items = await useApi(...)` (rendered in SSR). Use `<MeekoAwait>` for secondary/off-screen data. `MEEK117` flags unguarded non-awaited lists in pages/layouts.

## `<MeekoTeleport>` — render elsewhere, stay owned

```html
<!-- layout renders <div id="toolbar"></div> -->
<MeekoTeleport to="#toolbar" bind:disabled="narrow.value">
	<button type="button" on:click="save">Save</button>
</MeekoTeleport>
<MeekoTeleport to="body"><div if:when="saved.value" role="status">Saved.</div></MeekoTeleport>
```

- `to` is only `"body"` or `"#id"` (id looked up with `getElementById`, never a CSS selector). Computed: `bind:to` typed `MeekoTeleportTarget` (from `@meekojs/meeko/framework`); a `string` signal is `TS2322`.
- Only `to`, `bind:to`, `disabled`, `bind:disabled`, `if:when`, `each:of` — anything else (e.g. `class`) → `MEEK114`. Put classes on the content.
- Content keeps the declaring component's signals, events, context, error handler and scoped styles; disposed with it. SSR already places it at the target; `disabled` moves the same nodes in place.
- Missing target: dev throws, prod renders in place + `console.warn`. Target must outlive the teleport (layout/app element).
- Not needed for modals/menus: `<dialog>.showModal()` and `popover` use the top layer.

## `<MeekoLink>` — typed route link

```html
<MeekoLink to="/" match="prefix">Home</MeekoLink>
<MeekoLink to="/users/[id]" bind:params="{ id: String(user.id) }" bind:search="{ tab: 'activity', page: 2 }">{user.name}</MeekoLink>
<MeekoLink each:of="links" each:as="l" each:key="l.to" bind:to="l.to">{l.label}</MeekoLink>  <!-- links `as const` -->
```

- `to` is a **route ID** from `app/pages` (`RouteId`), not a URL: no query/fragment (use `bind:search`). Dynamic routes require `bind:params` (string values); static routes forbid it.
- Never `href`/`bind:href`, and `params`/`search` must use `bind:` → `MEEK105`. `match` is `"exact"` (default) or `"prefix"`.
- Adds `aria-current="page"` (exact) / `"true"` (prefix section); kept in sync across navigations. Explicit `aria-current` wins (since 1.8; `false` removes it).
- Renders a plain `<a>` (works without JS); scoped styles apply to it. External links: use `<a href>`.
- `RouteId` comes from generated `.meeko/types/routes.d.ts` (run `meeko check`/`meeko dev` after adding a page). To accept any route + its params in a prop, build a per-route union (`{ [K in RouteId]: { to: K } & … }[RouteId]`) using `MeekoLinkProps<K>['params']`.

## `<MeekoOutlet />` — layouts only

```html
<!-- app/app.meeko or app/layouts/default.meeko or +layout.meeko -->
<template>
	<header><MeekoLink to="/">Home</MeekoLink><div id="toolbar"></div></header>
	<main><MeekoOutlet /></main>
</template>
```

- Only in `app/app.meeko` and layouts; no attributes or content (`MEEK104`). It adds no wrapper element — wrap it yourself (one `<main>` per page).
- Equivalent to `<component is="props.outlet">`; layouts need not declare `outlet` (since 1.5). Named-layout props must be optional or defaulted.
- Shared layouts persist across client navigations (DOM, state, focus). Pass page markup into layout zones with `<MeekoTeleport>`, data with `layoutProps`/`useLayout`. In a regular component, use `defineSnippets` + `<render snippet>` instead.

## Deprecated built-ins (since 1.8, removed in 2.0, emit `MEEK121`)

| Deprecated           | Use (from `@meekojs/ui` ≥ 0.2, module enabled)                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `<MeekoPopover>`     | `<UIPopover>` (same props, snippets, `data-meeko-*` markup)                                            |
| `<MeekoSelect>`      | `<UICombobox>` for `multiple`/`searchable`/`filter`/`max` parity; `<UISelect>` for single-choice lists |
| `<MeekoThemeToggle>` | `<UIThemeToggle>`; custom: `useThemeToggle()` / `useTheme()`                                           |

Don't write new code with the `Meeko*` versions. For simple cases a native `<select model="x">` is lightest.

## Component registry and runtime names

```ts
// meeko.config.ts
export default defineMeekoConfig({
	components: { dirs: [{ path: 'app/components/Form', prefix: 'Form' }, { path: 'app/widgets', prefix: 'Widget' }] },
})
```

- `app/components` always included. Name = prefix + PascalCase path segments: `app/components/user-menu.meeko` → `UserMenu`; `app/components/Form/UserCreate.meeko` with prefix `Form` → `FormUserCreate`; `Button/Index.meeko` → `Button`. Duplicate names in one source error out.
- Types (from `@meekojs/meeko`, auto-available): `ComponentName`, `ComponentOf<Name>`, `ComponentProps<Name>`, `ComponentArgs`, `ResolvedComponent<Name>`.
- `resolveComponent(name, props?)` (auto-import) returns a **Promise** with the module (lazy chunk). Await it, then pass to `is`; not in SSR HTML.

```html
<script lang="ts">
	const selected = signal<ResolvedComponent<'FormUserCreate'> | undefined>(undefined)
	async function show(): Promise<void> {
		selected.value = await resolveComponent('FormUserCreate', { name: 'Ada', role: 'admin' })
	}
</script>
<template>
	<button type="button" on:click="show">Create</button>
	<component if:when="selected.value" is="selected.value!" />
</template>
```

Name known while writing the template → literal in `is` (static, SSR-rendered). Name known only at runtime (URL, DB) or lazy load → `resolveComponent`; validate external strings (unknown name rejects).

## Standalone generated module (outside the framework)

Each `.meeko` exports `renderWithState(props)`, `renderToString(props)`, `hydrate(root, props, state?)`, `hydrateScope`, `css` and types `ComponentProps`, `ComponentEmits`, `ComponentExposed`, `ComponentModels`, `ComponentSnippets`.

```ts
import { hydrate, renderWithState } from './Counter.meeko'
import { serializeJson } from '@meekojs/meeko'
const { html, state } = renderWithState(props)          // server
const payload = serializeJson({ props, state })          // safe for <script type="application/json">
const release = hydrate(document.querySelector('#counter')!, props, state) // client; call release() to dispose
```

Both renders are synchronous: a component with `await useApi(...)` throws `MEEKO_SUSPENDED` outside the framework. Server and browser must get identical props and list order.

## Common mistakes

- Importing `MeekoLink`/`MeekoAwait`/`MeekoTeleport`/`MeekoOutlet`, or naming a project component `MeekoLink` (shadows the built-in, `MEEK106`).
- `<MeekoLink href="/about">` or `to="/about?tab=1"` or `params="{…}"` without `bind:` → `MEEK105`/`TS2345`. Use `to` + `bind:params` + `bind:search`.
- `is="cond ? MeekoLink : 'a'"` → `TS2304`; write `'MeekoLink'`.
- Component name as a runtime string in `is` → `MEEK112`; use an imported module or `resolveComponent` (and `await` it).
- Storing component modules in `signal`/`useState` → `MEEK136`.
- `bind="props"` carrying `onClick` → `MEEK113`; forward events with `on:`.
- `<style>` without `scoped` for component styles → leaks globally and persists after navigation.
- Styling child components or `html` content from `<style scoped>` without `:global(...)`.
- `<MeekoOutlet>` in a regular component, or `<MeekoOutlet class="x" />` → `MEEK104`.
- `<MeekoTeleport to=".bar">` or with `class` → `MEEK114`.
- `<MeekoAwait for="items.data">` → `TS2322`; pass the resource. Reading `items.data.value` outside the tag is nullable.
- `useElementRef` inside `onMounted`/functions (`MEEK054`), or expecting non-null refs in SSR/setup.
- `interface X extends BaseButtonProps` when the props are a union → `TS2312`; use `type X = BaseButtonProps & {…}`.
- Script-level `type Rows = T[]` in a generic component → `MEEK100`.
- New code using `<MeekoPopover>`/`<MeekoSelect>`/`<MeekoThemeToggle>` (deprecated, `MEEK121`).

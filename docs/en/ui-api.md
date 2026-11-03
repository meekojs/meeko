---
source-hash: aa0d0305f4335ac4c50099f666c35d63e73ec5a0d3c43c19d1ba62dfd9b293c4
---

# Meeko UI API

Complete reference for `@meekojs/ui`. The [Meeko UI guide](ui.md) summarizes it, and the [Meeko UI site](https://ui.meekojs.com) has a demo of each component.

Visual components and styles for Meeko. It is a package of the same ecosystem, with its own version, enabled as a framework module.

## Installation

In an application of this monorepo, add the workspace dependency to its `package.json`:

```json
{
	"dependencies": {
		"@meekojs/meeko": "workspace:*",
		"@meekojs/ui": "workspace:*"
	}
}
```

Then run `pnpm install` from the root. To install a published version of the package in an external consumer:

```sh
pnpm add @meekojs/ui
```

The application needs `@meekojs/meeko` and Node.js 24 or later. UI requires Meeko `>=1.8 <2` because `UIThemeToggle` uses `useThemeToggle()`.

## Configuration

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	modules: ['@meekojs/ui'],
	theme: true,
})
```

The module registers the components with the `UI` prefix and its stylesheet through `meeko.addStylesheet`. Vite processes it with the project's PostCSS, resolves its imports and generates the build assets. In development, CSS changes use HMR. You do not need to import the CSS manually or link a fixed URL. `theme: true` enables the framework's themes; the UI module can also be used without that option.

### Typed options and an existing brand

Register the module by its name and write its options under the `ui` key, typed without importing anything: Meeko loads its types in `.meeko/types/config.d.ts`. You do not need to copy the UI palette: its tokens can point to the variables your site already has.

```ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	modules: ['@meekojs/ui'],
	ui: {
		tokens: {
			primary: 'var(--pill)',
			primaryHover: 'var(--pill-hover)',
			onPrimary: 'var(--on-pill)',
			accent: 'var(--accent)',
			focus: 'var(--accent)',
			surface: 'var(--surface)',
			surfaceHover: 'var(--surface-2)',
			text: 'var(--ink)',
			muted: 'var(--muted)',
			border: 'var(--line)',
			font: 'var(--font-ui)',
		},
		defaults: {
			button: { shape: 'pill' },
			link: { shape: 'pill', variant: 'outline' },
			card: { variant: 'soft' },
		},
	},
})
```

`UIOptions`, `UITokens` and `UIDefaults` are exported as types from `@meekojs/ui`. Defaults are per application and per SSR request; there is no global mutable state. Explicit props win over `ui.defaults`, and those over the base values. The available defaults are `button` and `link` (`variant`, `size`, `shape`), and `card` (`variant`). Without options, the original configuration is kept and the defaults plugin is not installed.

`tokens` accepts `primary`, `primaryHover`, `onPrimary`, `accentSoft`, `accentText`, `surface`, `surfaceHover`, `text`, `textSoft`, `muted`, `border`, `borderStrong`, `danger`, `focus`, `radius`, `font`, `controlHeight`, `controlPadding`, `controlWeight` and `controlFontSize`. Each key assigns `--ui-*` tokens: `primary` is `--ui-color-primary`, `text` is `--ui-color-text`, and `surface` covers both surfaces and controls. `var(...)` references follow the application's themes without duplicating their colors.

`base: false` omits the global UI base (see [Customization](#customization)).

Options are validated when the module loads. Tokens are added to the UI stylesheet before it goes through PostCSS; no inline styles or files in `node_modules` are generated. The application's stylesheets load afterwards and can override them.

### Texts and languages

`UIModal`, `UITable`, `UISelect` and `UIThemeToggle` render a few texts of their own. The package ships them in Spanish and English and chooses as follows:

1. **With `@meekojs/i18n`**, the language of the document (`useI18n().locale`), with nothing to configure. UI does not depend on that package: it reads its context if it exists.
2. **Without it**, `ui.locale`.
3. **Without either**, Spanish, as before.

```ts
export default defineMeekoConfig({
	modules: ['@meekojs/ui'],
	ui: {
		// Sin @meekojs/i18n, el idioma de los textos; con él, el respaldo de un idioma sin textos.
		locale: 'en',
		messages: {
			en: { table: { empty: 'Nothing here yet.' } },
			fr: {
				modal: { close: 'Fermer' },
				table: { empty: 'Aucune donnée.' },
				select: { empty: 'Aucun résultat', clear: 'Effacer la sélection' },
				themeToggle: {
					labels: { light: 'Clair', dark: 'Sombre', system: 'Système' },
					unknown: 'Changer de thème',
					group: 'Thème',
					cycle: 'Thème : {current}. Passer à {next}',
				},
			},
		},
	},
})
```

| Text                  | Spanish                             | English                              | Overridden in a component by |
| --------------------- | ----------------------------------- | ------------------------------------ | ---------------------------- |
| `modal.close`         | `Cerrar modal`                      | `Close modal`                        | `closeLabel`                 |
| `table.empty`         | `No hay datos.`                     | `No data.`                           | `emptyText`, snippet `empty` |
| `select.empty`        | `Sin resultados`                    | `No results`                         | snippet `empty`              |
| `select.clear`        | `Quitar selección`                  | `Clear selection`                    | `clearLabel`                 |
| `themeToggle.labels`  | `Claro`, `Oscuro`, `Sistema`        | `Light`, `Dark`, `System`            | `labels`                     |
| `themeToggle.unknown` | `Cambiar tema`                      | `Change theme`                       | `messages.unknown`           |
| `themeToggle.group`   | `Tema`                              | `Theme`                              | `messages.group`             |
| `themeToggle.cycle`   | `Tema: {current}. Cambiar a {next}` | `Theme: {current}. Switch to {next}` | `messages.cycle`             |

- **Priority.** A prop or a snippet of the component wins over everything else. After that, `ui.messages` wins over the package's texts in that language.
- **Languages.** `ui.locale` and the keys of `ui.messages` are validated on load and read in their canonical form: `EN` is `en` and `pt-br` is `pt-BR`. An invalid tag, such as `en-u`, is a configuration error.
- **What is missing** is taken from the base language (`pt` for `pt-BR`), from `ui.locale` and, finally, from Spanish. A language of `@meekojs/i18n` without UI texts, such as `ar`, is shown in the language of `ui.locale`, or in Spanish without it.
- **`themeToggle.cycle`** is a text template, because the options are serialized to the client: `{current}` and `{next}` are the labels in lowercase. For another form, use the component's `messages.cycle` function. `themeToggle.labels` also accepts the name of a custom theme.
- **Hydration.** The language comes from the URL or the configuration and does not change without a new document, so SSR, prerendering and hydration choose the same text. `document.lang` and `Accept-Language` play no part.

The types `UIMessages` and `UIMessageOverrides` are exported from `@meekojs/ui`. An unknown language, section or text, or an empty value, stops startup with a `ui:` error.

## Usage

```html
<script lang="ts">
	const name = signal('')
	const error = signal<string | undefined>(undefined)

	function save() {
		error.value = name.value.trim() ? undefined : 'Escribe tu nombre.'
	}
</script>

<template>
	<UIField
		id="user-name"
		label="Nombre"
		description="Como aparecerá en tu perfil."
		bind:error="error.value"
		required
	>
		<snippet
			name="default"
			params="id, describedBy"
		>
			<UIInput
				bind:id="id"
				bind:describedBy="describedBy"
				bind:invalid="Boolean(error.value)"
				model="name"
				required
			/>
		</snippet>
	</UIField>

	<UIButton on:click="save">Guardar</UIButton>
</template>
```

`UIField` passes the control's ID and the ID of its description or error to the snippet. Pass those values to the control, along with `invalid` and `required` when applicable: the field does not propagate them automatically.

## Components

### Container

`UIContainer` centers content with a maximum width and fluid gutters, from mobile to 4K. It is registered automatically with the module.

```html
<UIContainer
	as="section"
	size="4k"
	gutter="md"
	ariaLabel="Proyectos"
>
	<h2>Proyectos del equipo</h2>
</UIContainer>
```

- `size`: `sm` (40rem), `md` (48rem), `lg` (64rem), `xl` (80rem, the default), `2xl` (96rem), `3xl` (120rem), `4k` (240rem) or `full` (no maximum).
- `gutter`: `none`, `sm`, `md` (the default) or `lg`. The side padding is included in the outer width and uses logical properties for RTL. `md` equals `clamp(1rem, 2vw, 4rem)`; `sm`, `clamp(0.75rem, 1vw, 1.5rem)`; `lg`, `clamp(1.5rem, 3vw, 6rem)`.
- `as`: `div` by default; also `section`, `main`, `article`, `header`, `footer`, `nav` and `aside`.
- `id`, `ariaLabel` and `class`: identity, accessible name and customization. Requires the `default` snippet.

With a 16px root, `4k` allows up to 3840 CSS pixels. It always respects the parent's width and centers on larger screens; `full` lets it take all the available space. For reading or forms use a smaller limit, or nest a container with `gutter="none"`. The component neither clips the content nor prevents its children from scrolling.

You can override `--ui-container-max-width` and `--ui-container-gutter` from a class of the container itself. The types `UIContainerSize`, `UIContainerGutter` and `UIContainerTag` are exported from `@meekojs/ui`. The public site uses Container in its structure and documents its API at `/container`.

### Basic controls

| Component  | API                                                                                                                                                                                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UIButton` | Route (`to`, `params`, `search`), link (`href`, `target`, `rel`, `download`) or button (`type`, `disabled`); see [UIButton](#uibutton-route-link-or-button). Always `variant`, `size`, `shape`, `class`, `click` event and `default` snippet. By default `button`, `primary`, `md`, `rounded`. |
| `UIInput`  | Text model with `model`. Props: `id`, `name`, `type`, `placeholder`, `required`, `disabled`, `invalid`, `describedBy` and `class`. Accepted types: `text`, `email`, `password`, `search`, `url`, `tel`. By default it uses `text` and an empty value.                                          |
| `UIField`  | Requires `id`, `label` and the `default(id, describedBy)` snippet. Optional props: `description`, `error`, `required`, `class`. The error takes priority over the description and is announced with `role="alert"`.                                                                            |

It also includes `UIApp` and `UIModal` for [modals](#modals), `UITable` for [tables](#tables), `UICard` for [cards](#cards), and the navigation and label components below.

### UIButton: route, link or button

`UIButton` renders the element that matches what it does, with the same appearance (`.meeko-ui-button` with `data-variant`, `data-size` and `data-shape`), also on hover, on focus and with the application's link styles:

- **With `to`**, a `<MeekoLink>`: a link to a route of the application that navigates without reloading. `to` only accepts routes that exist; `params` is required on a dynamic route, with its keys, and not accepted on a static one; `search` is the query string.
- **With `href`**, an `<a>` to any URL, with `target`, `rel` and `download`. With `target="_blank"` and no `rel`, it adds `rel="noopener noreferrer"`.
- **With neither**, a `<button>` with `type` (`button` by default, so it never submits a form without being asked to) and `disabled`.

```html
<UIButton
	to="/users/[id]"
	bind:params="{ id: user.id }"
	bind:search="{ tab: 'actividad' }"
>
	Perfil
</UIButton>
<UIButton
	href="https://github.com/meekojs/meeko"
	target="_blank"
	variant="outline"
>
	GitHub
</UIButton>
<UIButton
	type="submit"
	bind:disabled="saving.value"
	on:click="save"
>
	Guardar
</UIButton>
```

- **Invalid combinations.** `to` with `href`, `type` or `disabled` on a link, `target`, `rel`, `download` or `hreflang` on a button, `resolve` without `to`, a route that does not exist and `params` that are not the route's are type errors in `meeko check` and in the editor.
- **A link cannot be disabled.** `<a>` has no native `disabled`, and emulating it with `aria-disabled` leaves the `href` navigable with the keyboard, the middle click or without JavaScript; removing the `href` takes it out of the tab order. That is why `disabled` only exists without `to` or `href`: if the action is unavailable, do not render the link, or use a disabled button.
- **Attributes.** `id`, `title`, `lang`, `tabindex`, `aria-*` and `data-*` reach the element in all three forms (`UIForwardedAttributes`: those common to `<a>` and `<button>`). A link, with `to` or with `href`, also accepts `target`, `rel`, `download` and the attributes of `<a>` itself (`UIAnchorAttributes`: `hreflang`, `ping`, `referrerpolicy`…). `on:click` receives the `MouseEvent` in all three; on a link, `event.preventDefault()` cancels the navigation.
- **Localized links.** With `to`, the `href` goes through the application's link resolvers, like `<MeekoLink>`: with `@meekojs/i18n`, `<UIButton to="/guide">` points to `/en/guide` on a page in English, `hreflang="es"` chooses another language and `bind:resolve="false"` leaves the route as it is.
- **Types.** `UIButtonProps`, `UILinkProps`, `UIRouteTarget`, `UIForwardedAttributes`, `UIAnchorAttributes` and `UIActionAppearance` are imported from `@meekojs/ui/runtime`.

### Navigation and labels

- `UILink` gives a real `<a>` the appearance of an action, with the defaults of `ui.defaults.link`. It receives `href` (any URL) or `to` (a route of the application with typed `params` and `search`, as in `UIButton`, with client navigation and the `href` localized with `@meekojs/i18n`); one of the two, not both. With either it accepts `target`, `rel`, `download`, `hreflang` and `lang`. It shares `variant`, `size` and `shape` with `UIButton`, and accepts `ariaLabel`, `class`, `id`, `title`, `aria-*`, `data-*` and the `click` event. It does not simulate buttons or use artificial roles. For `target="_blank"` it adds `noopener noreferrer` if `rel` is not specified.
- `UILinkCard` is a linked surface: it requires `title` and a destination, `href` (any URL) or `to` (a route of the application with `params`, `search` and `resolve`, as in `UILink`, with client navigation and the `href` localized with `@meekojs/i18n`), with optional `description`, `class` and `default` snippet. It accepts `target`, `rel`, `download`, `hreflang`, `lang`, `id`, `aria-*`, `data-*` and the `click` event; `title` is the card's text, not the HTML attribute. The content must not include other links or buttons, because the whole card is a single link.
- `UIBadge` shows metadata, with `tone="neutral|accent|danger"` (`neutral` by default), `class` and a required `default` snippet. It keeps text semantics; it adds no announcements or interaction.

```html
<UILink
	to="/docs"
	variant="primary"
>
	Empezar
</UILink>
<UILinkCard
	to="/docs/framework"
	title="Framework"
	description="Rutas, SSR y datos."
/>
<UIBadge tone="accent">Función</UIBadge>
```

The public site `apps/meeko` uses these actions in its home page, header and errors; `UILinkCard` makes up the documentation index and `UIBadge` the reference metadata. Its `meeko.config.ts` links the tokens to the current palette, including the neutral actions and the blue focus.

Since UI 1.8, `UIPopover`, `UISelect` and `UIThemeToggle` are components of the UI module. They replace `MeekoPopover`, `MeekoSelect` and `MeekoThemeToggle`, deprecated since core 1.8 and due for removal in 2.0. They keep the contract and the `data-meeko-*` markup; see [Migration to 1.8](migration-1.8.md).

## Customization

[`DESIGN.md`](../../packages/ui/DESIGN.md) is the visual contract: which token to use for each thing, sizes, typography and states. The module's stylesheets load before `app/styles/main.css`. Override the CSS variables from that stylesheet of the application:

```css
:root {
	--ui-color-primary-9: #6750a4;
	--ui-color-primary-10: #503d85;
	--ui-radius-md: 0.75rem;
}

:root[data-theme='dark'] {
	--ui-color-primary-9: #7c5cff;
	--ui-color-primary-10: #8a6eff;
}
```

The dark theme uses `data-theme="dark"` on the root element.

The module also loads the global base in the `ui-base` layer: the root's [fluid scale](../../packages/ui/DESIGN.md#escala-fluida), reset, `body` with background, text and font, `color-scheme`, `::selection`, scrollbars and focus. It also serves Inter at `/_meeko-ui/fonts/`, with its `preload`, so the application does not need to copy the font. Any rule of the application wins over that layer; `ui: { base: false }` omits it entirely.

## Modals

The module installs an independent manager per application (and per SSR request). Mount a single `UIApp`, preferably in `app/app.meeko`, to keep the host during navigations. It can also go in each root layout: when navigating from one to another, the new `UIApp` takes over from the previous one and the open modals move to it, but the content of the layouts is created again. Two `UIApp` at once are an error in SSR or when nested, and a `console.error` in the browser:

```html
<template>
	<UIApp><MeekoOutlet /></UIApp>
</template>
```

Components opened by name must start with `Modal`; for example, `app/components/Modal/UserCreate.meeko` is registered as `ModalUserCreate`.

```ts
const modal = useModal()

async function createUser() {
	const user = await modal.open<User>('ModalUserCreate', { organizationId: 1 })
	if (user !== undefined) users.value = [...users.value, user]
}
```

Inside the modal component, use `UIModal` and the context of its instance:

```html
<script lang="ts">
	const props = defineProps<{ organizationId: number }>()
	const modal = useModalInstance<boolean>()
</script>

<template>
	<UIModal
		title="Crear usuario"
		description="Confirma la creación en esta organización."
	>
		<p>Organización {props.organizationId}</p>
		<snippet name="footer">
			<UIButton
				variant="secondary"
				on:click="() => modal.dismiss()"
			>
				Cancelar
			</UIButton>
			<UIButton on:click="() => modal.close(true)">Confirmar</UIButton>
		</snippet>
	</UIModal>
</template>
```

This last example returns `boolean`; whoever opens it must use `open<boolean>`. Names and props are inferred from the generated registry. The result `R` is a contract declared by the consumer and is not inferred from the component: it must match `useModalInstance<R>()`.

`open<R>()` returns `Promise<R | undefined>`. Cancel, Escape, a click on the backdrop or unmounting the host resolve with `undefined`; load errors reject the promise. `undefined` is reserved for cancellation. `useModal()` exposes `instances` as a signal of a read-only map, `dismiss(id)` and `dismissAll()`. Concurrent loads keep the opening order; a cancelled load mounts no content when it finishes. The resolvers are private.

When stacking modals, only the top one paints the dark backdrop: the intensity does not build up as more instances open. When the top one closes, the previous one gets the backdrop back; focus, Escape and interaction blocking remain native. This behavior also works when combining declarative and programmatic modals.

Opening takes 220 ms and closing 160 ms, with opacity, translation and scale. Dialogs in the back keep their DOM and state, shrink slightly and receive no interaction; on returning to the front they recover their size and focus. The component unmounts and `open()` resolves when the exit ends. The manager keeps the first result if closing is repeated. Unmounting the host or disposing of the provider immediately cancels those pending. Declarative modals can be reopened during the exit without unmounting. With reduced motion these animations do not run. The example at `/modals` opens an `lg → md → sm` stack so you can watch each layer.

Only `useModal` and `useModalInstance` are auto-imported in components and application code. For explicit imports use `@meekojs/ui/runtime`, which does not load the module's configuration tools. The public types `ModalContext`, `ModalInstanceContext` and `ModalDismissReason` require an explicit `import type`; they are not added to the globals. Call the composables during setup, before any `await`. Opening modals during SSR or without a mounted `UIApp` produces an explicit rejection.

`UIModal` also works without the manager with `model="opened"`, where `opened` is a boolean signal. It accepts:

| Prop                               | Behavior                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `title`                            | Required; provides the dialog's accessible name.                                                         |
| `description`                      | Optional accessible description.                                                                         |
| `size`                             | `sm`, `md` (the default) or `lg`.                                                                        |
| `closeOnEscape`, `closeOnBackdrop` | Allow cancelling with the keyboard or the backdrop; both `true` by default.                              |
| `closeButton`, `closeLabel`        | Close button visible by default, with `modal.close` from [the texts](#texts-and-languages) as its label. |
| `class`                            | Additional classes of the dialog.                                                                        |

The `default` snippet is required and `footer` is optional. The `dismiss` event receives `escape`, `backdrop`, `button` or `native`; changing the model to `false` closes without emitting that event. If you disable the ways to cancel, provide an explicit close action. The base uses `<dialog>` and `showModal()`, with native accessible name, focus and modal layer. `components/internal/ModalInstance.meeko` is host infrastructure and is only imported explicitly: it is not part of the registry and generates no global component or prop names.

`provideModal`, the manager, the resolvers and the auxiliary types belong to the internal implementation and have no public package entry. The static plugin `app/plugins/modal.ts` imports them directly. The auxiliary types that describe public return values are still distributed in the TypeScript declarations, without becoming named exports of `runtime` or auto-imports.

## Tables

`UITable` generates the header, rows and footer from `columns` and `rows`. The row type is inferred from the props; `TableColumn<T>` checks the keys and the type of the value each formatter receives. Its types are imported explicitly from `@meekojs/ui/runtime`.

```html
<script lang="ts">
	import type { TableColumn } from '@meekojs/ui/runtime'

	interface User {
		id: number
		name: string
		age: number
	}

	const users = signal<User[]>([{ id: 1, name: 'Ana', age: 28 }])
	const columns = [
		{ key: 'name', label: 'Nombre', footer: 'Total' },
		{
			key: 'age',
			label: 'Edad',
			format: (value) => value.toFixed(0), // value: number
			footer: (rows) => rows.length + ' usuarios',
		},
	] satisfies TableColumn<User>[]
</script>

<template>
	<UITable
		caption="Usuarios"
		bind:columns="columns"
		bind:rows="users.value"
		rowKey="id"
		layout="grid"
		gridColumns="minmax(180px, 2fr) 120px"
	/>
</template>
```

| Prop          | Behavior                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `rows`        | Array of rows; accepts read-only arrays. Required.                                                                                             |
| `columns`     | Array of `TableColumn<T>`, required. Each column defines `key`, `label`, and optionally `format(value, row)` and `footer`.                     |
| `rowKey`      | Row property whose value is `string` or `number`, or a function `(row) => string \| number`. Required and unique per row to keep its identity. |
| `layout`      | `native` by default; `grid` uses CSS subgrid and keeps the native mode if it is not available.                                                 |
| `gridColumns` | CSS column definition for grid; by default it generates one `minmax(var(--ui-table-column-min), 1fr)` column for each entry of `columns`.      |
| `caption`     | Visible title and name of the scrollable region, optional.                                                                                     |
| `hideHeader`  | Hides the header; `false` by default.                                                                                                          |
| `emptyText`   | Message when `rows` is empty; by default, `table.empty` from [the texts](#texts-and-languages).                                                |
| `class`       | Additional classes on `<table>`.                                                                                                               |

`format` returns text, a number, a boolean or an empty value (`null`/`undefined`). Without a formatter, values are converted to text and empty ones are shown as an empty string. The content is escaped like any Meeko interpolation. For objects or dates, provide a formatter. `footer` accepts the same values or a function that receives all the rows; the footer appears when some column defines it.

The snippets are optional and customize the **content** of each cell; the table keeps the tags and their accessible roles:

| Snippet          | Parameters                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `cell-<clave>`   | `row: T`, `value: T[clave]`: the value with the exact type of that column. Since Meeko `1.8`. |
| `header-<clave>` | `column: TableColumn<T>`: the header of that column. Since Meeko `1.8`.                       |
| `header`         | `column: TableColumn<T>`                                                                      |
| `cell`           | `row: T`, `column: TableColumn<T>`, `value: T[keyof T]`, `index: number`                      |
| `footer`         | `column: TableColumn<T>`, `rows: readonly T[]`; forces the footer to appear.                  |
| `empty`          | No parameters; replaces `emptyText`.                                                          |
| `caption`        | No parameters; replaces `caption` and also gives the name of the scrollable region.           |

Each key of the row has its own snippets, `cell-<clave>` and `header-<clave>`. A key the row does not have (`name="cell-email"` with rows without `email`) is a type error, as are extra `params`. In each cell `cell-<clave>` wins, then `cell` and finally the column's `format`; in the header, `header-<clave>`, then `header` and finally `label`.

```html
<UITable
	bind:columns="columns"
	bind:rows="projects.value"
	rowKey="id"
>
	<!-- value es string: el tipo de Project['status']. -->
	<snippet
		name="cell-status"
		params="row, value"
	>
		<UIBadge bind:tone="value === 'Publicado' ? 'accent' : 'neutral'">{value}</UIBadge>
	</snippet>
	<snippet
		name="header-name"
		params="column"
	>
		<abbr title="Nombre del proyecto">{column.label}</abbr>
	</snippet>
</UITable>
```

The generic `cell` snippet still works for all the columns at once:

```html
<UITable
	bind:columns="columns"
	bind:rows="users.value"
	rowKey="id"
>
	<snippet
		name="cell"
		params="row, column, value"
	>
		<strong if:when="column.key === 'name'">{row.name}</strong>
		<span if:when="column.key !== 'name'">{String(value)}</span>
	</snippet>
</UITable>
```

The `cell` snippet replaces the formatter and receives the original value. Its value is the union of the row's field types; for a value with the type of its column use `cell-<clave>`, `row.age` or that column's `format`. Per-column snippets require `@meekojs/meeko` `1.8` or later. Do not write `<tr>` or `<td>` in these snippets.

The styles are processed with Meeko's PostCSS. The container supports focus and horizontal scrolling with the keyboard. You can customize `--table-border`, `--table-background` and `--table-hover` through a class; define the columns with `gridColumns`. The `/tables` guide shows both layouts, formatters, calculated footers, custom cells and the empty state.

## Cards

`UICard` composes a header, a body and a footer with four typed variants. The body is the `default` snippet, required; `header` and `footer` are optional.

```html
<UICard
	title="Datos del proyecto"
	description="Información compartida con tu equipo."
	variant="outline"
>
	<p>Contenido de la card.</p>
	<snippet name="footer">
		<UIButton on:click="save">Guardar</UIButton>
	</snippet>
</UICard>
```

| Prop          | Behavior                                                                        |
| ------------- | ------------------------------------------------------------------------------- |
| `variant`     | `outline` by default, `soft`, `solid` or `elevated`.                            |
| `title`       | Optional title, rendered as `<h2>` and accessible name of the section.          |
| `description` | Optional text under the title.                                                  |
| `headingId`   | `id` of the title, which receives `tabindex="-1"` so code can move focus to it. |
| `class`       | Additional classes on the section.                                              |

Other attributes, such as `id` or `aria-label`, reach the `<section>`. The `actions` snippet goes next to the title, and a `UITable` alone in the body reaches the edge of the card, which frames it.

`outline` uses a surface and a border; `soft`, a faint background with no visible border; `solid`, the accent color and its contrast text; `elevated`, a surface with a shadow and no visible border. All respond to the tokens and the UI theme. `--card-padding` lets you adjust the inner spacing through a class; `--ui-card-shadow` customizes the shadow.

The `header` snippet entirely replaces `title` and `description`; provide a heading at the right level for your page if you use it. The footer only appears when you supply `footer`. Without a title, description or header snippet, the `<header>` is not generated. The container keeps its section semantics and adds no button behavior: use links and buttons in its content for actions. The `/cards` guide shows the variants and the composition.

## Markdown editor

`<UIMarkdownEditor>` edits Markdown with [Crepe](https://milkdown.dev) and a code mode. It lives in its own module, `@meekojs/ui/editor`, because Crepe weighs 347 KB of gzipped JS: Meeko's component registry generates an `import()` for each component, and inside the main module it would be a chunk of every site.

```sh
pnpm add @milkdown/crepe @milkdown/kit @codemirror/language @codemirror/view @codemirror/lang-javascript @codemirror/lang-html @codemirror/lang-css @codemirror/lang-json @lezer/highlight
```

```ts
// meeko.config.ts
export default defineMeekoConfig({
	modules: ['@meekojs/ui', '@meekojs/ui/editor'],
})
```

```html
<UIMarkdownEditor
	label="Contenido"
	model="markdown"
	model:mode="mode"
/>
```

They are optional dependencies of `@meekojs/ui`: an application without the module does not install them. Crepe's JavaScript loads with `import()` in the browser, when the component mounts, and never enters the server bundle. Until then, the server's HTML renders a placeholder with the final height.

| Prop          | Type      | Purpose                                                                    |
| ------------- | --------- | -------------------------------------------------------------------------- |
| `label`       | `string`  | Visible label and accessible name. Required.                               |
| `id`          | `string`  | `id` of the text area of the code mode.                                    |
| `readonly`    | `boolean` | It can be read and selected, but not changed.                              |
| `disabled`    | `boolean` | Like `readonly`, and it also looks disabled.                               |
| `describedBy` | `string`  | `id` of the text that describes it.                                        |
| `placeholder` | `string`  | Text of the empty document, if you do not want the one from `ui.messages`. |
| `class`       | `string`  | Class of the root.                                                         |

- **Models:** `model` is the text and `model:mode`, `'visual'` or `'code'`. If the parent writes another text, the editor starts over with it.
- **Snippet:** `tools` goes in the bar, between the label and the switcher.
- **Height:** `--ui-markdown-editor-height`. The content scrolls inside.
- **Texts:** `ui.messages.<idioma>.markdownEditor`, including those of Crepe's menus.

### Block-based saving

Crepe serializes a document in its own format, so saving its output would rewrite tables and blank lines nobody touched. That is why the model only changes with a real edit, and then keeps the bytes of the original outside the edited blocks:

- Without editing, `model` remains the received text, byte for byte. Typing and undoing, or pressing Enter without typing, also leaves it so.
- An edited block comes out of Crepe. A list is a single block: changing a word in a long list rewrites all of it.
- CRLF line breaks become LF only if the document is edited.
- The frontmatter never reaches Crepe: it is kept as it is.
- The event waits for a pause in typing, and fires earlier on leaving the editor, before a click on "save" reads the model.
- If a document does not match its serialization block by block, it opens in code mode with a notice. No document in `docs/` needs it.

Code blocks keep their `meta` (` ```ts bad `), also when copied. Pasted images are ignored: with no destination, they would be saved as a `blob:` address of the tab. There is no LaTeX or image block.

`splitMarkdownSource` and `createMarkdownSplicer` are exported from `@meekojs/ui/editor`, without Crepe, for anyone who needs them separately.

## Development

From the root of the monorepo:

```sh
pnpm build
pnpm -F @meekojs/ui run check
pnpm -F meeko-ui-site run dev
```

The sources of the module's application are organized like this:

```text
src/
  app/
    components/
      internal/
        ModalInstance.meeko
    composables/
      useModal.ts
    plugins/
      modal.ts
    types/
      modal.ts
    utils/
      modal-dialog.ts
    styles/
      main.css
      tokens.css
  index.ts
  module.ts
  runtime.ts
```

The UI build generates ESM, TypeScript declarations and the components with their adjacent declarations in `dist/app/components`. The module registers the static plugin `dist/app/plugins/modal.js` and links its private alias `virtual:meeko-ui-components` to the component registry Meeko generates for the consumer; UI writes no plugin in `.meeko/generated`. The stylesheets are distributed directly from `src/app/styles/`: `main.css` imports `tokens.css`, and the consumer processes them with Vite/PostCSS. In the workspace, editing these CSS files updates the UI site through HMR without rebuilding the package. Consumers do not need to generate files inside `node_modules`.

More information in the [UI guide](ui.md) and on the [public Meeko UI site](https://ui.meekojs.com), with installation, customization, API and interactive examples. In the monorepo it starts with `pnpm ui:dev`.

## UIPopover

Content in the browser's top layer (the `popover` API), anchored to its trigger with _CSS anchor positioning_:

```html
<script lang="ts">
	const open = signal(false)
</script>
<template>
	<UIPopover
		placement="bottom-start"
		bind:offset="8"
		model="open"
		role="menu"
		on:toggle="(event) => console.log(event.open)"
	>
		<snippet name="trigger">Opciones ▾</snippet>
		<button
			role="menuitem"
			on:click="rename"
		>
			Renombrar
		</button>
		<button
			role="menuitem"
			on:click="duplicate"
		>
			Duplicar
		</button>
		<button
			role="menuitem"
			on:click="remove"
		>
			Eliminar
		</button>
	</UIPopover>
</template>
```

Meeko renders a `<button>` with `popovertarget`, `aria-expanded`, `aria-controls` and `aria-haspopup` (depending on `role`), whose content is the `trigger` snippet, and the loose content inside an element with `popover` and `data-meeko-popover`. The button looks like a control and elements with `role="menuitem"`, like a menu option: `triggerClass`, `class` or any rule of your CSS replace them. With `popovertarget`, the button opens and closes the content even before hydration.

| Prop                    | Default          | What it does                                                                                                                            |
| ----------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`                  | `"auto"`         | `"auto"` closes on a press outside and with `Esc`; `"manual"` only from the trigger, `Esc` or the model; `"hint"` is a tooltip (below). |
| `placement`             | `"bottom-start"` | `top`, `bottom`, `left` or `right`, with `-start` or `-end` to align it with an edge of the trigger.                                    |
| `offset`                | `0`              | Distance in pixels from the trigger.                                                                                                    |
| `role`                  | —                | `"menu"`, `"dialog"` or `"tooltip"` (the default with `mode="hint"`): the ARIA pattern of the content.                                  |
| `label`                 | —                | `aria-label` of the content; without it, a menu or a dialog is named by the trigger (`aria-labelledby`).                                |
| `class`, `triggerClass` | —                | Classes of the content and of the button.                                                                                               |
| `triggerId`             | `useId`          | `id` of the trigger; with a custom trigger, the `id` it carries.                                                                        |
| `matchWidth`            | `false`          | The content measures at least as much as the trigger (`anchor-size(width)`).                                                            |
| `delay`, `closeDelay`   | `300`, `150`     | With `mode="hint"`, milliseconds before opening and closing with the pointer.                                                           |

`model` (the default model) is the opening signal: assigning it opens or closes the content, and the user changes it on opening or closing. `on:toggle` emits `{ open }` (type `PopoverToggleEvent`) on each change. A `ref:` receives `show()`, `hide()` and `toggle()`.

**Keyboard and focus.**

- `Esc` closes and returns focus to the trigger. A press outside closes a `mode="auto"` without moving focus.
- With `role="menu"`, the content follows the menu pattern: `Enter`, `Space` or `↓` on the trigger open the menu with focus on the first `menuitem` (`↑`, on the last); the arrows move it (wrapping around), `Home` and `End` go to the ends and the first letters search for an element. Elements with `disabled` or `aria-disabled="true"` are skipped. Choosing a `role="menuitem"` closes the menu and returns focus; a `menuitemcheckbox` or `menuitemradio` leaves it open. `Tab` closes the menu. Mark the elements with `role="menuitem"`: Meeko does not change the role of its content.
- With `role="dialog"`, focus enters the first control (or the element with `autofocus`) on opening.

**Tooltip.** `mode="hint"` uses `popover="hint"`: it opens when the pointer hovers (after `delay`) or when the trigger gets focus, stays open while the pointer is over it or over the content, closes with `Esc` or on losing focus, and never takes focus. The trigger carries `aria-describedby` with the content, which is `role="tooltip"`.

```html
<UIPopover mode="hint">
	<snippet name="trigger">?</snippet>
	El código está en el reverso de la tarjeta.
</UIPopover>
```

**Position.** The content uses `position-anchor: auto`, `position-area` and `position-try-fallbacks: flip-block, flip-inline`, so it moves to the other side if it does not fit, without JavaScript. The rules are in the `meeko` layer of `popover.css`, so any rule of your CSS wins. A browser without anchor positioning opens it unanchored. Open content carries `data-open`.

**Custom trigger.** The `anchor` snippet replaces the button: it receives in `trigger` (type `PopoverTrigger`) the attributes the trigger must carry, with each attribute's name as the key, so [`bind="trigger"`](api.md) is enough. `<UIPopover>` finds the element by its `id` on mounting and adds the keyboard handling and anchoring:

```html
<UIPopover role="menu">
	<snippet
		name="anchor"
		params="trigger"
	>
		<button
			type="button"
			class="avatar"
			bind="trigger"
		>
			<img
				src="/me.png"
				alt="Mi cuenta"
			/>
		</button>
	</snippet>
	<a
		role="menuitem"
		href="/perfil"
	>
		Perfil
	</a>
</UIPopover>
```

With a component of your own, `<AppButton bind="trigger">` passes it those keys as props: the component must declare them (for example, `defineProps<Partial<PopoverTrigger> & { variant?: "ghost" }>()`) and put them on its `<button>`, which is the element that carries the `id`.

A trigger that is not a `<button>` (without `popovertarget`) opens the content with the model: `on:click="() => open.value = !open.value"`.

### UIPopover props

Public types from `@meekojs/ui/runtime`.

| Prop           | Type               | Description                                                                                           |
| -------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| `mode`         | `PopoverMode`      | `"auto"` (the default), `"manual"` or `"hint"`; see `PopoverMode`.                                    |
| `placement`    | `PopoverPlacement` | Where it opens relative to the trigger; `"bottom-start"` by default.                                  |
| `offset`       | `number`           | Distance in pixels between the trigger and the content; `0` by default.                               |
| `role`         | `PopoverRole`      | ARIA pattern of the content; with `mode="hint"`, `"tooltip"` by default.                              |
| `label`        | `string`           | `aria-label` of the content. Without it, a menu or a dialog is named by the trigger.                  |
| `class`        | `string`           | Classes of the content, the element with `popover`.                                                   |
| `triggerClass` | `string`           | Classes of the trigger `<button>` Meeko renders.                                                      |
| `triggerId`    | `string`           | `id` of the trigger; by default, one from `useId`. With a custom trigger, the `id` it carries.        |
| `matchWidth`   | `boolean`          | With `true`, the content measures at least as much as the trigger (`anchor-size(width)`).             |
| `delay`        | `number`           | With `mode="hint"`, milliseconds the pointer waits over the trigger before opening; `300` by default. |
| `closeDelay`   | `number`           | With `mode="hint"`, milliseconds before closing when the pointer leaves; `150` by default.            |

## UISelect

A native `<select>` with `appearance: base-select`: the browser brings the list, the keyboard and the form value. To search, filter on a server or choose several options, use [`UICombobox`](#uicombobox); `multiple`, `searchable`, `filter` and `max` on `UISelect` are a type error that says so.

```html
<UISelect
	id="owner"
	name="owner"
	by="id"
	labelBy="name"
	groupBy="team"
	placeholder="Asigna una persona"
	clearable
	model="owner"
	bind:options="members"
>
	<snippet
		name="option"
		params="member, state"
	>
		{member.name}
		<em if:when="state.selected">(elegida)</em>
	</snippet>
</UISelect>
```

It accepts `options`, `by`, `labelBy`, `disabledBy`, `groupBy`, `placeholder`, `name`, `required`, `disabled`, `clearable`, `clearLabel`, `field`, `id`, `label`, `describedBy`, `invalid`, `class`, `listClass`, `placement` and `offset`; it emits `change`. The snippets are `option` (`[option, state]`, with `selected` and `disabled`), `value` and `group`.

- **Browsers.** Chrome, Edge and Safari 27 paint the list with the UI tokens, with an animated entrance. Firefox and older browsers show their own list, and in them `value`, `group` and the rich content of `option` remain as their text.
- **Trigger.** It uses `<selectedcontent>`. With the `option` snippet, it shows `value` or the label, because `<selectedcontent>` would copy the whole option. Do not put an `id` inside `option`, because the copy would duplicate it.
- **Keyboard.** It is the browser's. `Enter` or `Space` open the list, and the arrows and letters move through it. With the list closed it varies by engine: in WebKit, the arrows do not open it.
- **Nothing chosen.** A hidden option at the start represents the `placeholder`, or a value no longer in `options`: the model keeps it and the form still sends it.
- **`required`.** A form without a value is not submitted: the `<select>` receives focus and `aria-invalid="true"`, without the browser's notice.
- **`listClass`.** It goes on the `<select>`: style it with `.mi-clase::picker(select)`.

## UICombobox

What the native `<select>` of `UISelect` does not cover: searching, filtering on a server and choosing several options. It is a custom list on top of `<UIPopover>`, with more JavaScript: use it only if you need `searchable`, `filter`, `multiple` or `max`. `model` is the value and its type comes from `options`:

```html
<script lang="ts">
	interface User {
		id: number
		name: string
		team: string
	}
	const colors = ['Rojo', 'Verde', 'Azul']
	const color = signal<string | null>(null)
	const users = signal<User[]>([])
	const user = signal<User | null>(null)
	const tags = signal<string[]>([])
</script>
<template>
	<label for="color">Color</label>
	<UICombobox
		id="color"
		model="color"
		bind:options="colors"
		placeholder="Elige un color"
		name="color"
	/>

	<UICombobox
		model="user"
		bind:options="users.value"
		by="id"
		label="Responsable"
	>
		<snippet
			name="option"
			params="user, state"
		>
			{user.name}
			<span if:when="state.selected">✓</span>
		</snippet>
		<snippet
			name="value"
			params="user"
		>
			{user.name}
		</snippet>
	</UICombobox>

	<UICombobox
		model="tags"
		multiple
		searchable
		bind:options="colors"
		bind:max="2"
		name="tags"
	/>
</template>
```

| Prop                                        | What it does                                                                                                                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `options`                                   | The options, primitives or objects. It is reactive.                                                                                                                                            |
| `multiple`                                  | The model is an array and each option toggles.                                                                                                                                                 |
| `by`                                        | How an option is compared with the value: a key (`by="id"`) or a function `(a, b) => boolean`. By default, `Object.is`.                                                                        |
| `labelBy`, `disabledBy`, `groupBy`          | The label (by default, the primitive's text or the object's `label`/`name`), whether it is disabled (by default, `disabled: true`) and the group of each option: a key or a function.          |
| `placeholder`                               | Text with no value chosen.                                                                                                                                                                     |
| `name`                                      | `name` of the `<input type="hidden">` sent with the `<form>`.                                                                                                                                  |
| `required`, `disabled`                      | As in a native control.                                                                                                                                                                        |
| `searchable`                                | The trigger is an `<input>` that filters the options.                                                                                                                                          |
| `clearable`, `clearLabel`                   | Button next to the trigger that removes the selection (`null`, or `[]` with `multiple`); `clearLabel` is its `aria-label` (by default, `select.clear` from [the texts](#texts-and-languages)). |
| `filter`                                    | Custom search, synchronous or asynchronous.                                                                                                                                                    |
| `max`                                       | With `multiple`, how many options can be chosen at most.                                                                                                                                       |
| `field`                                     | The field from `useForm`: `bind:field="form.field('color')"`.                                                                                                                                  |
| `id`, `label`, `describedBy`, `invalid`     | `id` of the trigger (for `<label for>`), its `aria-label`, `aria-describedby` and `aria-invalid`.                                                                                              |
| `class`, `listClass`, `placement`, `offset` | Classes of the root and of the list, and the position of the list.                                                                                                                             |

`on:change` emits the new value with each user choice. The snippets are `option` (`[option, state]`, with `state.selected`, `state.active` and `state.disabled`), `value` (how each chosen value looks in the trigger; without it, the labels separated by commas), `group` (the heading of a group), `empty` (no options; by default, `select.empty` from [the texts](#texts-and-languages)) and `loading` (while an asynchronous search loads).

**Types.** `meeko check` and the editor infer from the tag the type of the options (`T`) and whether it is multiple: the model of a single select is a `Signal<T | null>` and that of a multiple one, `Signal<T[]>`; `by`, `labelBy` and `groupBy` only accept keys of `T`, and the snippets' parameters have type `T`. The type `ComboboxModel<T, Multiple>` describes the value.

**ARIA and keyboard.** The trigger is a `role="combobox"` (a `<button>` or, with `searchable`, an `<input>` with `aria-autocomplete="list"`) with `aria-expanded`, `aria-controls`, `aria-haspopup="listbox"` and `aria-activedescendant`: focus never leaves it. The list is a `role="listbox"` (with `aria-multiselectable` in a multiple select) of `role="option"` with `aria-selected` and `aria-disabled`, grouped in `role="group"` with `groupBy`. An external `<label for>` names the trigger by its `id`. The ARIA combobox pattern does not define how to empty the selection, so `clearable` adds, outside the combobox, a `<button type="button">` with `aria-label` ("Quitar selección"): it enters the tab order right after the trigger, only exists while something is chosen, and activating it closes the list, emits `change` with `null` (or `[]`) and returns focus to the trigger.

- `↓`, `↑`, `Enter` or `Space` open the list on the chosen option (or the first); `Home` and `End` open at an end; letters open and search.
- With the list open, the arrows, `Home`, `End`, `PageUp` and `PageDown` move the active option (without wrapping around, skipping disabled ones) and scroll it into view; letters search by the start of the label, ignoring accents.
- `Enter` chooses the active option; `Space` does too, except with `searchable`, where it types a space. In a single select, choosing closes the list; in a multiple one, it toggles the option and the list stays open. `Alt+↑` chooses and closes.
- `Esc` closes without changing the value and `Tab` closes. A press outside or moving focus outside also close it.
- With the mouse, a click on an option chooses it; hovering makes it active. Pressing in the list does not take focus away from the trigger.

With `max`, as soon as `max` options are chosen the rest become `aria-disabled="true"` and `data-disabled` until one is removed.

**State attributes.** The options carry `data-active`, `data-selected` and `data-disabled`, and the root (`data-meeko-select`) carries `data-open`, `data-multiple`, `data-disabled` and `data-loading`. The list measures at least as much as the trigger (`anchor-size(width)`), has a maximum height and scrolls; your CSS replaces them:

```css
[data-meeko-select] [role='option'][data-active] {
	background: var(--hover);
}
[data-meeko-select] [role='option'][data-selected]::after {
	content: ' ✓';
}
[data-meeko-select] [data-meeko-popover] {
	max-height: 16rem;
}
```

**Search.** With `searchable`, typing filters the options whose label contains the text, ignoring case and accents ("amb" finds "Ámbar"). `filter(query, { options, signal })` replaces that filter: it returns the options to show or a promise of them to search on the server. While the promise is unresolved, the root carries `data-loading`, the list `aria-busy="true"` and the `loading` snippet is shown; a new search aborts the previous one (`signal`) and discards its response. With an empty search, `options` are shown without calling `filter`, so the search never runs on the server.

```html
<script lang="ts">
	interface City {
		code: string
		name: string
	}
	const city = signal<City | null>(null)
	const search = (query: string, { signal }: { signal: AbortSignal }): Promise<City[]> => fetch(`/api/cities?q=${encodeURIComponent(query)}`, { signal }).then((response) => response.json())
</script>
<template>
	<UICombobox
		model="city"
		bind:options="[]"
		by="code"
		searchable
		bind:filter="search"
		placeholder="Busca una ciudad"
	>
		<snippet name="loading">Buscando…</snippet>
		<snippet name="empty">Ninguna ciudad con ese nombre</snippet>
	</UICombobox>
</template>
```

**Forms.** With `name`, the native `<select>` sends its value (empty with nothing chosen) and the custom list, one `<input type="hidden">` per value (none in an empty multiple one); with `disabled` it sends nothing. The value of each option is its `by` key, the primitive itself or its label. `required` prevents submitting the `<form>` without a value: the trigger receives focus and `aria-invalid="true"` until an option is chosen. With `useForm`, `model="form.fields.color"` works as in any control, and `bind:field="form.field('color')"` also gives the value, the field's `id` (for its `<label for>`), the `name`, `aria-invalid` and `aria-describedby` with the error message; `focusInvalid` moves focus to the select when validation fails. The initial value `""` of a field counts as "no value" (unless an option is `""`).

```html
<form
	on:submit="form.submit"
	novalidate
>
	<label bind:for="form.field('country').id">País</label>
	<UICombobox
		bind:field="form.field('country')"
		bind:options="countries"
		placeholder="Elige un país"
	/>
	<p
		if:when="form.errors.value.country"
		bind:id="form.field('country').errorId"
	>
		{form.errors.value.country}
	</p>
	<button>Guardar</button>
</form>
```

**Long lists.** `<UICombobox>` renders all the options (in the server's HTML too). For thousands of options, use `searchable` with a `filter` that returns only the first matches; a virtual list that only renders the visible ones (`virtual`) is not available in UI `1.8`.

**Native alternative.** For a simple case, with no search or options with custom content, a native `<select>` with `model` remains the lightest option. In browsers that support it, `appearance: base-select` lets you style it completely and keeps the browser's keyboard, accessibility and form submission:

```css
select,
::picker(select) {
	appearance: base-select;
}
```

### UICombobox props

Public types from `@meekojs/ui/runtime`.

| Prop          | Type                                                   | Description                                                                                                           |
| ------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `options`     | `readonly T[]`                                         | The options, primitives or objects. It is reactive: a new list updates the open list.                                 |
| `multiple`    | `Multiple`                                             | With `true`, the model is an array and each option toggles.                                                           |
| `by`          | `SelectKey<T> \| ((a: T, b: T) => boolean)`            | How options are compared with the value: a key (`by="id"`) or a function; by default, `Object.is`.                    |
| `labelBy`     | `SelectKey<T> \| ((option: T) => string)`              | Label of each option: a key or a function; by default, the primitive's text or the object's `label`/`name`.           |
| `disabledBy`  | `SelectKey<T> \| ((option: T) => boolean)`             | Which options are disabled: a key or a function; by default, those with `disabled: true`.                             |
| `groupBy`     | `SelectKey<T> \| ((option: T) => string \| undefined)` | Group of each option, with a heading per group: a key (`groupBy="category"`) or a function.                           |
| `placeholder` | `string`                                               | Text of the trigger with no value chosen.                                                                             |
| `name`        | `string`                                               | `name` of the `<input type="hidden">` sent with the `<form>`, one per value.                                          |
| `required`    | `boolean`                                              | Requires a value when submitting the `<form>`.                                                                        |
| `disabled`    | `boolean`                                              | Disables the trigger; the `<input type="hidden">` are not sent.                                                       |
| `searchable`  | `boolean`                                              | Turns the trigger into a combobox with an `<input>` that filters the options.                                         |
| `filter`      | `ComboboxFilter<T>`                                    | Custom search, synchronous or asynchronous; by default, the label contains the text, ignoring accents and case.       |
| `max`         | `number`                                               | With `multiple`, how many options can be chosen at most.                                                              |
| `field`       | `SelectField<ComboboxModel<T, Multiple>>`              | The field from `useForm` (`form.field('x')`): its `id`, its `name`, its value, `aria-invalid` and `aria-describedby`. |
| `id`          | `string`                                               | `id` of the trigger, for a `<label for>`; by default, the field's or one from `useId`.                                |
| `label`       | `string`                                               | `aria-label` of the trigger and of the list, without a `<label>`.                                                     |
| `describedBy` | `string`                                               | `aria-describedby` of the trigger.                                                                                    |
| `invalid`     | `boolean`                                              | Marks the trigger with `aria-invalid="true"`.                                                                         |
| `class`       | `string`                                               | Classes of the root element.                                                                                          |
| `listClass`   | `string`                                               | Classes of the list, the element with `popover`.                                                                      |
| `placement`   | `PopoverPlacement`                                     | Where the list opens; `"bottom-start"` by default.                                                                    |
| `offset`      | `number`                                               | Distance in pixels between the trigger and the list.                                                                  |

## UIThemeToggle

Since UI `1.8`, with the UI module active and `theme` in `meeko.config.ts`, `UIThemeToggle` lets you change the theme. It requires core `1.8` and uses its public API `useThemeToggle()`.

With `icons`, the button renders an icon for `light`, `dark` and `system` instead of its name, which stays in the `aria-label`: `<UIThemeToggle icons />`. A snippet with the name of the choice wins over the icon, and another theme shows its name. It is what the headers of the Meeko sites use.

```html
<UIThemeToggle>
	<snippet name="light"><IconSun /></snippet>
	<snippet name="dark"><IconMoon /></snippet>
	<snippet name="system"><IconMonitor /></snippet>
</UIThemeToggle>
<UIThemeToggle mode="select" />
<UIThemeToggle
	bind:themes="['light', 'dark']"
	bind:labels="{ light: 'Claro', dark: 'Oscuro', system: 'Sistema' }"
	class="toggle"
/>
```

| Prop          | Default                   | What it does                                                                                                                                                         |
| ------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`        | `"cycle"`                 | `"cycle"`: a button that moves to the next choice in the list. `"select"`: a group of radios.                                                                        |
| `themes`      | the themes and `"system"` | The choices and their order (`bind:themes="['light', 'dark']"`).                                                                                                     |
| `labels`      | those of `ui.messages`    | The name of each choice; a custom theme, with no label, is named like the theme.                                                                                     |
| `messages`    | those of `ui.messages`    | The accessible texts: `cycle(current, next)` (the button's `aria-label`), `unknown` and `group`, over [the texts](#texts-and-languages). Type `ThemeToggleMessages`. |
| `class`, `id` | —                         | Of the root `<form>`. Other attributes do not pass: wrap the tag if you need them.                                                                                   |

Each snippet (`light`, `dark`, `system` or the name of a custom theme) is the icon of that choice; without a snippet its label is rendered. `meeko check` and the editor type the snippets, `themes` and `labels` with the themes of `meeko.config.ts` (`system` only if active) and `mode` as `"cycle" | "select"`; the editor completes the tag, its props and its snippets, and its hover shows the tag's card. The type of its props is `UIThemeToggleProps`, exported from `@meekojs/ui/runtime`. It has no visual styles of its own: the button and the radios are native elements the application styles (`.toggle button`, `[role="radio"][aria-checked="true"]`, `[data-meeko-theme-option="dark"]`). To mark the chosen radio also before hydration, when the choice is unknown and there is no `aria-checked`, use `data-theme-choice`, as the icons do: `[data-theme-choice="dark"] [data-meeko-theme-option="dark"]`.

**Icons that never jump.** The component renders all the icons, each one in `<span data-meeko-theme-icon="light|dark|system|…">`, and chooses none: with `theme` active, Meeko adds to `<head>` a minimal CSS rule, only `display: none`, that hides all except the one of `data-theme-choice`. Since the `<head>` script writes that attribute before the first paint, the icon is right from the first frame in every case (with a cookie, in `"system"` without a cookie or client hint, on a prerendered page or in `static`), with no JavaScript in the component, and hydrating changes no node of the component. A list without `system` (`bind:themes="['light', 'dark']"`) shows in system mode the icon of the effective theme, according to `prefers-color-scheme`, as the script does. In `mode="select"` each radio carries its icon and all are visible.

**Accessibility.** In `mode="cycle"` it is a `<button>` whose `aria-label` states the choice and the next one, "Tema: oscuro. Cambiar a sistema", and updates with each change. When the HTML is generated without knowing the choice (without the cookie, a prerendered page), the `aria-label` is neutral, "Cambiar tema", until hydration ends: this way it neither announces something false nor causes a hydration mismatch, because hydration renders the same as the server. In `mode="select"` it is a `role="radiogroup"` with an `aria-label` ("Tema") and one `role="radio"` button per choice with `aria-checked` and the choice's name. When the HTML does not know the choice, no radio carries `aria-checked`, neither `"true"` nor `"false"`: a group with all at `"false"` would say none is checked, and checking the one of `default` would say something false to whoever chose another theme, because the prerendered page is the same for everyone. When hydration ends each radio receives its `aria-checked` only once, and the CSS with `data-theme-choice` gives the visual state earlier; with JavaScript, the arrows, `Home` and `End` move focus and the choice, with a roving `tabindex`, like a native radio group. Without JavaScript each radio is a button reached with the Tab key.

**Without JavaScript (progressive enhancement).** The component is a `<form method="post" action="/_meeko/theme">`: the `"cycle"` button sends the next choice and each radio, its own, along with the page's URL (`return`). With JavaScript, the submission is intercepted and the change is immediate, with `useTheme().set()`, without navigating. Without it, the server handles the form:

- `POST /_meeko/theme` only exists with `theme` active (other methods respond `405`).
- It only accepts `application/x-www-form-urlencoded` of up to 2 KB; `theme` must be a theme from `themes` or `"system"` (with system mode active); otherwise, `400 INVALID_THEME`, writing nothing.
- It writes the cookie as the browser runtime does (`Path=/`, one year, `SameSite=Lax`, `Secure` on HTTPS) and responds `303` to `return`, which must be a path of this origin (`/docs?tab=a`). An absolute URL, `//otro.sitio`, a backslash or control characters go back to `/`: there is never an open redirect. The next SSR document already has the new theme.
- **CSRF.** It uses neither the session nor the CSRF token (`x-meeko-csrf`, which only exists with JavaScript): it only changes the theme cookie. Like `origin: "required"` on an API route, it requires an `Origin` equal to that of the request, which after `createServerApp` is the configured `publicOrigin`; an absent or `null` `Origin`, or one from another site, responds `403 INVALID_ORIGIN` before reading the body. Browsers send `Origin` on every `POST`; a page with `Referrer-Policy: no-referrer` sends it as `null`, so there the form without JavaScript does not work (with JavaScript it does). Behind a proxy, configure the public origin, as for mutations with a session.
- **Prerender with Node.** The endpoint also exists on the server of an application whose pages are prerendered, and it writes the cookie; but the prerendered HTML is the same for everyone and, without JavaScript, does not apply the cookie (the `<head>` script does), so the page keeps showing the default theme. Without JavaScript, the change is only visible on SSR pages.
- **`static` adapter.** There is no server: the form is rendered the same (the HTML is what the prerender generated, common to all adapters) and works with JavaScript, but without it the `POST` reaches the hosting, which rejects it. It is a documented limitation; on a static site, the selector needs JavaScript.

Using `<UIThemeToggle>` without `theme` produces `MEEK111` on rendering, through `useThemeToggle()`. Conflicts with your own components named `UIThemeToggle` are resolved like those of the other components registered by modules.

**Events.** It declares no component events; the change updates the shared state of `useTheme()`. The snippets are named by choice (`light`, `dark`, `system` or a custom theme). `ThemeToggleMessages` and `ThemeToggleSnippets` remain in `@meekojs/meeko/framework`.

## Structure and navigation

Components for the frame of a site and its navigation, with native HTML and CSS: the links, the menus, the side panel and the index work without hydrating. Their default texts are in `ui.messages`, in Spanish and English. The types are imported from `@meekojs/ui/runtime`.

Every link in a list accepts `href` (any URL) or `to` (a route with typed `params` and `search`), as well as `target`, `rel`, `download`, `hreflang`, `lang` and `title`. With `to` it navigates with `<MeekoLink>`, goes through the link resolvers (with `@meekojs/i18n` it points to the language of the document or that of `hreflang`) and the active route decides `aria-current`; `match: 'prefix'` also marks its child routes and `resolve: false` leaves the `href` as it is. With `href`, the link is the current one if it matches the component's `current` prop. In both cases the link's own `current` rules: `true` marks it and `false` unmarks it.

```html
<UIPage layout="docs">
	<snippet name="header">
		<UIHeader
			bind:brand="brand"
			bind:items="items"
		>
			<snippet name="actions"><UILocaleSwitcher bind:items="locales" /></snippet>
		</UIHeader>
	</snippet>
	<snippet name="bar">
		<UIDrawer
			title="Contenidos"
			triggerLabel="Contenidos"
		>
			<UINavigationTree bind:groups="groups" />
		</UIDrawer>
	</snippet>
	<snippet name="sidebar"><UINavigationTree bind:groups="groups" /></snippet>
	<snippet name="aside"><UITableOfContents bind:entries="toc" /></snippet>
	<UITableOfContents
		bind:entries="toc"
		variant="collapsible"
	/>
	<UIPageHeader
		title="Instalación"
		description="Añade el paquete a tu aplicación."
	/>
	<UIProse
		as="article"
		bind:html="doc.html"
	/>
	<UIPageNavigation bind:next="{ label: 'Rutas', to: '/routes' }" />
	<snippet name="footer"><UIFooter bind:brand="brand" /></snippet>
</UIPage>
```

| Component            | Props                                                                                                                                                                                                                  | Snippets and events                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `UIPage`             | `layout` (`docs`, `dashboard`, `landing`), `mainId` (`contenido`), `mainLang`, `skipLabel`, `class` and attributes such as `lang` or `dir`                                                                             | `default`, `header`, `notices`, `bar`, `sidebar`, `aside`, `footer` |
| `UIPageHeader`       | `title`, `description`, `layout`, `class`                                                                                                                                                                              | `breadcrumb`, `actions`, `default`                                  |
| `UIHeader`           | `brand`, `items`, `current`, `label`, `menuLabel`, `sticky` (`true`), `size` (`2xl`), `class`                                                                                                                          | `brand`, `nav`, `actions`, `menu`                                   |
| `UIFooter`           | `brand`, `description`, `groups`, `items`, `label`, `size` (`2xl`), `class`                                                                                                                                            | `brand`, `about`, `actions`, `legal`                                |
| `UINavigationTree`   | `groups` (`title`, `icon`, `open`, `items` with `icon`, `code`, `featured`, `aliases`), `current`, `label`, `collapsible` (`true`), `featuredLabel`, `emptyText`, `class`                                              | `item(item, current)`, `icon(entry)`, `empty`                       |
| `UIDrawer`           | `title`, `id`, `side` (`start`, `end`), `triggerLabel`, `closeLabel`, `closedBy` (`any`, `closerequest`, `none`), `closeOnNavigate` (`true`), `class`; `open` model with `model`                                       | `default`, `footer`, `trigger(id)`; `close` event                   |
| `UINavigationTabs`   | `items` (with `badge`, `badgeTone`, `badgeDot`), `current`, `label`, `variant` (`underline`, `segmented`), `class`                                                                                                     | `select(event, item)` event                                         |
| `UIBreadcrumb`       | `items` (the last one is the current page; without a destination it is text), `label`, `class`                                                                                                                         |                                                                     |
| `UIPageNavigation`   | `previous`, `next`, `label`, `previousLabel`, `nextLabel`, `class`                                                                                                                                                     |                                                                     |
| `UIPagination`       | `shown`, `total`, `countText`, `hasMore`, `busy`, `moreLink`, `loadMoreLabel`, `loadingLabel`, `label`, `class`                                                                                                        | `default`; `loadMore` event                                         |
| `UITableOfContents`  | `entries` (`id`, `text`, `level`), `active`, `variant` (`aside`, `collapsible`), `label`, `class`                                                                                                                      |                                                                     |
| `UILocaleSwitcher`   | `items` (`code`, `label`, `href` or `to`, `current`), `label`, `class`                                                                                                                                                 |                                                                     |
| `UILocaleSuggestion` | `items`, `suggested`, `label`, `message`, `goLabel`, `stayLabel`, `class`                                                                                                                                              | `stay` event                                                        |
| `UICodeBlock`        | `code`, `html`, `label`, `lang`, `verdict` (`good`, `bad`), `verdictLabel`, `mode` (`code`, `log`), `copy`, `copyLabel`, `copyAriaLabel`, `copiedLabel`, `copyFailedLabel`, `uiLang`, `labelLang`, `textLang`, `class` | `default`                                                           |
| `UIProse`            | `as` (`div`, `article`, `section`), `html`, `class` and attributes                                                                                                                                                     | `default`                                                           |
| `UIDiff`             | `diff`, `label`, `emptyText`, `lineLabels`, `class`                                                                                                                                                                    |                                                                     |

- **`UIPage`** renders a single focusable `<main>` and the link to skip to it, and places `sidebar` and `aside` in columns fixed while scrolling. At 75rem it hides `aside` and at 54rem it hides `sidebar` and shows `bar`, where the `UIDrawer` goes. With a fixed `UIHeader`, anchors leave its height free.
- **`notices`** of `UIPage` goes under the header, with the page's width, and takes no space if its content renders nothing.
- **`UIHeader`** has a fixed height, `--ui-header-height`. On narrow screens its links move to a menu with `popover`, which floats and does not move the page. A `brand` image declares `width` and `height` to reserve its space.
- **`UIDrawer`** is a modal `<dialog>` with `command`, `commandfor` and `closedby`: it opens, closes and returns focus without JavaScript in browsers that support them; elsewhere, it does so on hydrating. Once hydrated, it leaves with the same View Transition as `UIModal`, on its own side; when following a link it closes instantly, because the navigation already is the transition.
- **`UINavigationTabs`** are links, not a `tablist`. The indicator follows the current one with anchor positioning; without it, the link marks itself. This component does not serve for panels on the same page. `variant="segmented"` gives the row the shape of a segmented `UIRadioGroup`, for filters in the URL and without an indicator, so several rows can coexist on a page. `badge` adds a counter next to the text, and the `select` event receives the click and the tab: with `event.preventDefault()`, the page filters without navigating.
- **`UITableOfContents`** paints the active entry with `scroll-target-group`, with no script, where it exists. A minimal `IntersectionObserver` keeps `aria-current="location"` in all browsers, and that is what is painted where that property does not exist. `active` hands control to the application. Use `variant="aside"` in the column and `variant="collapsible"` in the content: `UIPage` shows each one only when appropriate.
- **`UILocaleSwitcher` and `UILocaleSuggestion`** are presentation: they receive the destinations already calculated and read no routes or cookies. With fewer than two languages, the switcher renders nothing. The suggestion is written in the language it offers and the `stay` button, in the current one; the application decides when to show it, after mounting, and what it saves.
- **`UICodeBlock`** receives in `html` an already highlighted `<pre>` (Shiki with `--shiki-light` and `--shiki-dark`) and in `code` what gets copied. The copy button is the only script and stays hidden until hydration. `mode="log"` uses `role="log"`, wraps the lines and does not show the button except with `copy`.
- **`UIProse`** dresses rendered Markdown. The `meeko-ui-prose` class also works on any element, and inside it `.heading-anchor`, `.table-wrap`, `.callout`, `.code-block` and `.shiki`, the classes of a snapshot, are styled. The component handles the `button[data-copy]` buttons of that HTML. A UI component inside the text keeps its appearance: the reading styles end at it (`@scope`).
- **Standalone stylesheets.** `@meekojs/ui/styles/prose.css` and `@meekojs/ui/styles/code.css` are those same rules as files, for a document that does not receive the page's, such as an `<iframe sandbox srcdoc>`. They read `var(--ui-*)`: that document has to declare their values.
- **`UIDiff`** receives a unified diff and marks each line with `data-kind` (`add`, `remove`, `hunk`, `file`, `context`) and a text for screen readers.

## Platform and View Transitions

`UIModal`, `UIDrawer`, `UIPopover`, `UITabs`, `UIThemeToggle` and `UISelect` use `<dialog>`, `popover`, CSS anchoring, `appearance: base-select`, `@starting-style` and View Transitions. Older browsers work without animation and with the most basic `<select>`, as does Firefox, which still shows its native list. What the platform does not cover is in `UICombobox`, on top of `UIPopover`.

For your own transitions, use `withViewTransition()`:

```ts
import { withViewTransition } from '@meekojs/ui/runtime'

withViewTransition(() => (section.value = 'team'), { types: ['app-section'] })
```

The rules and reserved names are in [`DESIGN.md`](../../packages/ui/DESIGN.md#movimiento).

## Tabs, tooltips and palette

```html
<UITabs
	model="tab"
	label="Ajustes"
	bind:items="[{ value: 'account', label: 'Cuenta' }, { value: 'team', label: 'Equipo' }]"
>
	<snippet name="panel-account">Tu cuenta</snippet>
	<snippet name="panel-team">Tu equipo</snippet>
</UITabs>

<UITooltip text="Se publica al guardar"><snippet name="trigger">?</snippet></UITooltip>

<UICommandPalette
	model:query="query"
	bind:results="results.value"
	bind:status="status.value"
	hrefBy="url"
	labelBy="title"
	childrenBy="sections"
	on:open="preload"
/>
```

`UICommandPalette` does not search: read `query` in your code, search wherever you want (Pagefind, a server or a local list) and pass it `results` and `status`.

To open or close it from the parent, assign its `model` or call `show()` and `hide()` with a reference: `<UICommandPalette ref:palette … />` and `palette.value?.show()`.

## Forms and states

The new controls keep native HTML, the keyboard and form submission. All models bind to a signal (`model="field"`), not with `bind:model`.

| Component           | Contract                                                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UITextarea`        | String model; native attributes `rows`, `name`, `maxlength`, `required`, `disabled`; `invalid`, `describedBy`.                                                                                              |
| `UICheckbox`        | Boolean model; `label`, `description`, `name`, `value`, `required`, `disabled`, `invalid`, `describedBy`.                                                                                                   |
| `UIRadioGroup`      | String model; `legend`, `options` (`value`, `label`, `disabled`), `name`, `required`, `disabled`; `variant="default"` or `"segmented"`. Native arrows and selection.                                        |
| `UISwitch`          | Boolean model and the Checkbox contract, with `role="switch"`.                                                                                                                                              |
| `UISlider`          | Numeric model; `label`, `name`, `min`, `max`, `step`, `disabled` and native attributes.                                                                                                                     |
| `UIAlert`           | `tone`, `title`, `description`, `icon` (snippet), `dismiss`, `closeLabel`, `role`; snippets `default`, `icon`, `actions`; `dismiss` event. Danger uses `alert`; the others, `note`; `status` can be chosen. |
| `UIDisclosure`      | `summary`, `open`, `class`; `default` snippet. Native `<details>`: opens with the keyboard and without JavaScript.                                                                                          |
| `UIEmpty`           | `title`, `description`, `variant="inline"` or `"panel"`; snippets `default` and `actions`.                                                                                                                  |
| `UISkeleton`        | `lines`, `widths` (`full`, `long`, `short`), `label`; announces loading once and respects reduced motion.                                                                                                   |
| `UIStat`            | `label`, `value`, `detail`, with `dl/dt/dd`; the `value` and `detail` snippets accept markup, such as a link.                                                                                               |
| `UIDescriptionList` | `items` (`label`, `labelLang`, `value`, `detail`, `code`, `title`), `columns` (1, 2 or 3), one column on mobile. `code` renders the value in `<code>`.                                                      |
| `UIToast`           | `text`, `tone`, `duration`, `closeLabel`, `actions` (snippet or prop); `dismiss` event. Manual native popover, without taking focus.                                                                        |

The prop types, `UIDensity`, `UITone` and `UIToastContext` are exported from `@meekojs/ui/runtime`. The default texts are configured in `ui.messages.<locale>.feedback` (`close`, `empty`, `loading`); there is Spanish and English.

`UIButton` adds `tone="danger"`, `loading`, `iconOnly` and `ariaLabel`. When using only an icon, always provide `ariaLabel` or `aria-label`. `loading` keeps the text and adds the spinner; it announces `aria-busy` and `aria-disabled`, and prevents activating the action without taking its focus away. With `iconOnly`, the icon measures `--ui-icon-size`. The submit button keeps `name`, `value` and `form`.

`UIBadge` adds the tones `info`, `success`, `warning` and `dot`. `UIInput` accepts `date`, `datetime-local` and native attributes such as `autocomplete`, `autocapitalize`, `spellcheck`, `min`, `max` and `step`. `UIField` adds `hint` and `counter` (string or number); the IDs of both are included in the `describedBy` its snippet receives.

`UICard` and `UITable` accept `density="compact" | "normal" | "comfortable"`. Card adds `padding="none" | "sm" | "md" | "lg"`, which wins over density. Table columns accept `numeric` (end alignment) and `rowHeader` (`th scope="row"`), also in the grid layout. `hideCaption` hides a table's title from view, when a heading already says it, and it still names the table.

### Notifications from a page

The module installs one provider per application; `<UIApp>` hosts the notifications. Call it during setup and add notices from a client action. They cannot be added during SSR. There is no state shared between requests.

```html
<script lang="ts">
	import { useToast } from '@meekojs/ui/runtime'
	const toast = useToast()
</script>
<template>
	<UIButton on:click="() => toast.add({ text: 'Cambios guardados', tone: 'success', duration: 5000 })">Guardar</UIButton>
</template>
```

`useToast` is auto-imported like `useModal`. `add` returns an ID for `remove(id)`; `clear()` closes all. `duration: 0` keeps the notice until it is closed. The countdown pauses with the cursor or focus inside the notice; the timers are released on unmounting. The host stacks notices without overlapping and they disappear on unmounting UIApp. `UIToast` can also be used declaratively with the `actions` snippet.

It enters with `@starting-style` and leaves with a View Transition of type `ui-toast-close`. If added with a `UIModal` or a `UIDrawer` open, the host returns to the top of the top layer so that it is visible, but stays inert like the rest of the page: it receives no clicks until the modal closes, and a notice with `duration` closes by itself.

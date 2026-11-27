---
source-hash: 2511bdc2afc1737b5f22bb8d62e7670c8e6db0f5cb3b9ac4d825e122fc4ca442
---

# Meeko UI

## Start in an application

Install the published packages in a Meeko application running Node.js 24 or later:

```sh
pnpm add @meekojs/meeko @meekojs/ui tailwindcss
```

Enable the module in `meeko.config.ts`:

```ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	modules: ['@meekojs/ui'],
	theme: true,
})
```

Import Tailwind and the CSS entry of UI at the top of **`app/styles/main.css`**, the global stylesheet that Meeko loads by itself:

```css
@import 'tailwindcss';
@import '@meekojs/ui';
```

The application compiles the styles of UI with Tailwind 4 together with its own classes, in a single pass. The module registers `@tailwindcss/vite`, unless the application already registers it, and the entry brings the tokens, the theme and the `@source` of the UI components. That theme adds to Tailwind's default one: the semantic colors come with their twelve steps (`bg-surface`, `text-text-soft`, `bg-primary-9`, `text-danger-11`…), the breakpoints `phone`, `compact`, `tablet`, `sidebar` and `desktop` join those of Tailwind, and the application keeps its colors (`bg-red-500`…), its breakpoints (`md:`…) and the rest of its names. But UI redefines some values of Tailwind's theme so that they read the `--ui-*` tokens, and with them the classes of the application that use them change too: `--spacing` (the grid of `p-4`, `gap-2`…, on `--ui-space-1`), `--font-sans` and `--font-mono`, the sizes `--text-xs` to `--text-6xl` (with `--text-base` equal to `--text-md`), the line heights `--leading-none`, `-tight`, `-snug`, `-normal` and `-relaxed`, the weights `--font-weight-thin` to `--font-weight-black` (`normal` is `regular`), `--tracking-normal` and `--tracking-tight`, the radii `--radius-xs` to `--radius-3xl`, the shadows `--shadow-xs` to `--shadow-2xl`, `--blur-md`, the easings `--ease-in`, `--ease-out` and `--ease-in-out`, the containers `--container-sm` to `--container-3xl` (`max-w-xl`…) and `--animate-spin`. It also leaves without a value (`initial`) the line height of each size (`--text-*--line-height`: `text-sm` sets only the size, and the line height goes with `leading-*`), the default duration and easing of `transition-*` (UI gives them with `duration-*` and `ease-*`) and the default fonts of the preflight (`--default-font-family`, `--default-mono-font-family` and their settings; the UI base sets the font of the page). Add your own with a `@theme` after both imports. `@import '@meekojs/ui/hues';`, optional and after them, also brings the Radix Colors scales (`bg-crimson-9`…) and generates the classes of the raw hue combinations. Without this stylesheet, `meeko dev` warns that the components will have no styles; the warning also follows the local imports of the stylesheet (`@import './ui.css'`, if that one imports UI).

**Mind Tailwind's preflight.** `@import 'tailwindcss'` includes the preflight, Tailwind's reset: it removes the margins of every element, the bullets of lists and the size and weight of headings (`h1`…`h6`), and makes images blocks. The UI components do not depend on it, but an application that did not use Tailwind before changes its look with it. To keep the previous one, import only Tailwind's theme and utilities, in the layers of its own entry, as [Tailwind's documentation](https://tailwindcss.com/docs/preflight#disabling-preflight) shows:

```css
@layer theme, base, components, utilities;
@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/utilities.css' layer(utilities);
@import '@meekojs/ui';
```

The UI base stays in place (`ui: { base: false }` removes it), and `ui.tokens`, the warning of `meeko dev` and `@meekojs/ui/hues` work the same with both forms. The sites of this repository use the second one.

Then, **file `app/pages/index.meeko`** in a new application:

```meeko
<script server lang="ts">
export const route = definePage({ render: "prerender" });
</script>

<template>
  <h1>Contact</h1>
  <UIBadge color="success">Available</UIBadge>
  <UIButton type="button">Save</UIButton>
</template>
```

You will see the heading, a badge and a button styled by UI. `UIButton` uses `<MeekoLink>` with `to`, an `<a>` with `href`, and a `<button>` without a destination. `UILink` also accepts `to` or `href`, always as a link. `UISelect` chooses one option from a list of its own; use `UICombobox` for search or multiple selection. The [UI reference](ui-api.md) details the props.

The `@meekojs/ui` module belongs to the Meeko ecosystem and has its own version.

## Container

`UIContainer` centers content with sizes from `sm` to `4k` (240rem, 3840 CSS pixels with a 16px root), plus `full`. Its fluid gutters support RTL, and `as` lets you choose the semantic tag. The default width is `xl`; you can combine wide surfaces with smaller containers for reading. See the [Container API](ui-api.md#container) and the interactive `/container` guide on the UI site.

## Components by category

- **Structure:** `UIContainer`, `UIPage`, `UIPageHeader`, `UIHeader` and `UIFooter`.
- **Actions:** `UIButton`, `UILink`, `UILinkCard`, `UIBadge` and `UIThemeToggle`.
- **Forms:** `UIField`, `UIInput`, `UITextarea`, `UICheckbox`, `UIRadioGroup`, `UISwitch`, `UISlider`, `UISelect` and `UICombobox`. `UIMarkdownEditor`, in its own `@meekojs/ui/editor` module.
- **Navigation:** `UINavigationTree`, `UINavigationTabs`, `UITabs`, `UIBreadcrumb`, `UIPageNavigation`, `UIPagination`, `UITableOfContents`, `UILocaleSwitcher` and `UILocaleSuggestion`.
- **Data and content:** `UICard`, `UITable`, `UIStat`, `UIDescriptionList`, `UIDisclosure`, `UIDiff`, `UICodeBlock` and `UIProse`.
- **Feedback:** `UIAlert`, `UIToast`, `UIEmpty` and `UISkeleton`.
- **Overlays:** `UIModal`, `UIDrawer`, `UIPopover`, `UITooltip`, `UICommandPalette` and the `UIApp` host.

`UILink` shares with `UIButton` the treatment (`variant`: `solid`, `soft`, `surface`, `outline`, `subtle`, `ghost` or `link`), the semantic color (`color`: `primary`, `secondary`, `neutral`, `success`, `info`, `warning` or `danger`), the `xs` to `xl` sizes and the radius (`radius`, from `none` to `full`). It requires `to` or `href`; it does not simulate a button. `UILinkCard` requires `to` or `href`, and `title`, with optional description and content. `UIBadge` combines `variant` (`soft` by default, `solid`, `surface` or `outline`), `color` (the seven semantic colors; `neutral` by default) and `radius`, with `dot`, without adding interaction or announcements. `UIAvatar` paints a person's photo or initials, in three sizes (`size`), with `variant`, `color` and `radius` (a circle by default; see [UIAvatar](ui-api.md#uiavatar)).

It registers all these components, except `UIMarkdownEditor`, the global base (`ui: { base: false }` leaves it out) and the Inter font. The rest of its CSS is the `@import '@meekojs/ui'` entry, which `app/styles/main.css` compiles with Tailwind 4 through Vite and the project's PostCSS configuration, with HMR in development and hashed asset names in production. The layers follow Tailwind's order: the preflight (`base`), if the stylesheet imports it, stays below the UI base and the components, so it does not wipe their borders or backgrounds; the hand-written rules of UI go in `components`, and its utilities, together with the application's, in `utilities`. `ui.tokens` is inserted after the imports of that stylesheet, before its rules, also when it reaches UI through a local stylesheet of its own (`@import './ui.css'`, up to eight levels). The application can override the styles in that same stylesheet: any unlayered rule wins over a component's, and `class` and the `ui` prop give each part classes of your own, which are merged with Tailwind Merge and replace the conflicting ones of the recipe (see [Classes per slot](ui-api.md#classes-per-slot)). Since core 1.8, `MeekoSelect`, `MeekoPopover` and `MeekoThemeToggle` are deprecated (`MEEK121`, removal in 2.0): UI 1.9 registers `UISelect`, `UICombobox`, `UIPopover` and `UIThemeToggle`. `UISelect` is a native `<select>`; to search or choose several options, `UICombobox`. `useTheme`, `useThemeToggle`, the theme configuration and `POST /_meeko/theme` remain in the framework. UI 1.9 needs Meeko `>=1.8 <2`. See [Migration to 1.8](migration-1.8.md).

```html
<script lang="ts">
	const name = signal('')
</script>

<template>
	<UIField
		id="name"
		label="Name"
		description="How it will appear in your profile."
	>
		<snippet
			name="default"
			params="id, describedBy"
		>
			<UIInput
				bind:id="id"
				bind:describedBy="describedBy"
				model="name"
			/>
		</snippet>
	</UIField>
	<UIButton on:click="() => console.log(name.value)">Save</UIButton>
</template>
```

`UIButton` supports `type`, `disabled`, `class`, `variant` (`solid`, `soft`, `surface`, `outline`, `subtle`, `ghost` or `link`), `color` (`primary`, `secondary`, `neutral`, `success`, `info`, `warning` or `danger`), `size`, `radius` and the `click` event; its default type is `button` and its look, `solid` and `primary`. `UIInput` shares a text model and supports `id`, `name`, `type`, `placeholder`, `required`, `disabled`, `invalid`, `describedBy`, `class` and its look: `variant` (`outline`, `surface`, `soft` or `ghost`), `color`, `size` and `radius`, which by default are the field of always. `UIField` requires `id` and `label`, supports `description`, `error`, `required` and `class`, and passes the control ID and its description to the snippet. The control must also receive `invalid` when it has an error and `required` when it is mandatory.

Customize the `--ui-*` tokens from the application's CSS: `--ui-color-primary-9`, `--ui-radius-md`, `--ui-font-sans`… The [visual contract](../../packages/ui/DESIGN.md) says which token to use for each thing. The dark theme uses `data-theme="dark"` and the tokens change by themselves. The global base (`ui: { base: false }` omits it) brings the reset, the `body`, the fluid scale and the focus; the application defines its layout.

## Texts and languages

With `@meekojs/i18n` active there is nothing to configure: `UIModal`, `UITable`, `UISelect` and `UIThemeToggle` follow `useI18n().locale`. UI does not depend on that package: it reads its context if there is one. The `ui.locale` and `ui.messages` options are optional:

```ts
// meeko.config.ts
ui: {
	// Without i18n: the language of the texts ('es' by default). With i18n: the fallback for a language without texts.
	locale: 'en',
	// Overrides package texts or adds languages; everything is optional inside each language.
	messages: {
		en: { table: { empty: 'Nothing here yet.' } },
		fr: { modal: { close: 'Fermer' }, themeToggle: { group: 'Thème', cycle: 'Thème : {current}. Passer à {next}' } },
	},
}
```

- **Chosen language:** `useI18n().locale`, then `ui.locale`, then `es`. What a language lacks is completed from its base language (`pt` for `pt-BR`), `ui.locale` and Spanish.
- **Priority:** the component's prop or snippet, then `ui.messages`, then the package texts.
- **Available texts:** `modal.close`, `table.empty`, `select.empty`, `select.clear` and `themeToggle` (`labels`, `unknown`, `group` and `cycle`, with `{current}` and `{next}`). An unknown language, section or text, an empty value or a function stops loading with a `ui:` error.
- **Types:** `UIMessages` and `UIMessageOverrides`, exported from `@meekojs/ui`. Without `locale` or `messages` no plugin is installed.

`UILinkCard` accepts `to` like `UILink`, with automatic localization, `hreflang`, `resolve`, client navigation and typed routes:

```html
<UILinkCard
	to="/theming"
	title="Themes"
	description="Variables and dark mode"
/>
<UILinkCard
	to="/users/[id]"
	bind:params="{ id }"
	title="Profile"
/>
<UILinkCard
	href="https://example.com"
	target="_blank"
	title="External"
/>
```

## Adapt UI to an existing brand

The module declares `configKey: 'ui'` and exports `UIOptions`, `UITokens` and `UIDefaults` from `@meekojs/ui`. Register it by name, and the `ui` key is typed without importing anything (Meeko loads its types into `.meeko/types/config.d.ts`; see [Modules](framework.md#modules)):

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
			text: 'var(--ink)',
			font: 'var(--font-ui)',
		},
		defaults: { link: { radius: 'full' }, button: { radius: 'full' } },
	},
})
```

Define those variables in your application's styles. CSS references follow its light/dark themes without copying the palette. `primary` lets actions have a different color from `accent`; if not configured, it still uses the accent. Precedence is explicit props, module defaults and base values. Defaults are provided per application and SSR request. Tokens are processed in the UI stylesheet through Vite/PostCSS, without generating inline styles or writing to `node_modules`. See the [full list of options](ui-api.md#typed-options-and-an-existing-brand).

The `apps/meeko`, `apps/ui`, `apps/i18n` and `apps/dashboard` sites use these components and tokens, with no design of their own: the same colors, sizes and fonts. They may only differ in images and effects.

For modals, mount `<UIApp><MeekoOutlet /></UIApp>` in `app/app.meeko`. `useModal().open<R>(nombre, props)` loads a `Modal…` component and returns its result or `undefined` on cancellation. The component uses `UIModal` and `useModalInstance<R>().close(resultado)` or `.dismiss()`. Names and props are checked against the generated registry; `R` is the contract declared by the consumer. You can also control `UIModal` directly with a boolean model. See the [modal API](ui-api.md#modals).

`UITable` generates rows from the required `rows`, `columns` and `rowKey`. The generic is inferred from the rows; `TableColumn<T>`, imported from `@meekojs/ui/runtime`, checks each column's keys and formatters. It supports per-column footers, an empty state, optional snippets for cell content and `layout="native|grid"` (native by default), with horizontal scrolling. See the [table API](ui-api.md#tables).

`UICard` combines a treatment (`surface`, `outline`, `soft`, `subtle`, `solid`, `glass` or `plain`) with a semantic color, a radius and a shadow, the `cardTheme` recipe of `@meekojs/ui/theme`, with title and description props, and header, body and footer snippets. See the [card API](ui-api.md#cards).

The public Meeko UI site is published at <https://ui.meekojs.com> and lives in `apps/ui`. It includes installation, themes, a catalog by category and, in Spanish and English, a guide with a demo, API and copyable code for each component: `/forms`, `/controls`, `/select` (also `UICombobox`), `/editor`, `/cards`, `/tables`, `/content`, `/feedback`, `/page`, `/navigation`, `/modals`, `/popover`, `/overlays`, `/container`, `/buttons`, `/links`, `/badges`, `/icons`, `/theme-toggle`, `/app` and `/transitions`. From the root, run `pnpm dev:ui`; to generate the production site use `pnpm build --filter=meeko-ui-site`. It does not require a database.

UI sources are in `src/app/components` and `src/app/styles`. Components and declarations are included in `dist/app/components` when building `@meekojs/ui`. `src/app/styles/main.css` is the CSS entry that the package exports (the `style` condition of `exports`): its `@source` point to the components, variants and recipes of `src/` and of `dist/`, so it works in the workspace and published, and the package compiles no stylesheet. The integration plugin lives in `src/app/plugins/modal.ts`: the module registers its compiled file and connects a private alias to the consumer's component registry. UI does not generate plugin code in the project or write inside the Meeko installation.

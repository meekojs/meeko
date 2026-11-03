---
source-hash: 7df211864da764f67ef983840a05a37487fc67a9c131383514856724b563feb8
---

# Meeko UI

The `@meekojs/ui` module belongs to the Meeko ecosystem and is distributed as a package with its own version. Its installation and API are described in the [Meeko UI API](ui-api.md). Enable it in the configuration:

```ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	modules: ['@meekojs/ui'],
	theme: true,
})
```

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

`UILink` shares the `primary`, `secondary`, `outline` and `ghost` variants, `sm`, `md`, `lg` sizes and `rounded`, `pill` shapes with `UIButton`. It requires `href`; it does not simulate a button. `UILinkCard` requires `to` or `href`, and `title`, with optional description and content. `UIBadge` has `neutral`, `accent`, `info`, `success`, `warning` and `danger` tones, and `dot`, without adding interaction or announcements.

It registers all these components, except `UIMarkdownEditor`, and adds its CSS through `meeko.addStylesheet`, plus the global base and the Inter font. The stylesheet goes through Vite and the project's PostCSS configuration, with imports, assets, HMR in development and hashed asset names in production. It loads before `app/styles/main.css`, where the application can override the styles. Since core 1.8, `MeekoSelect`, `MeekoPopover` and `MeekoThemeToggle` are deprecated (`MEEK121`, removal in 2.0): UI 1.8 registers `UISelect`, `UICombobox`, `UIPopover` and `UIThemeToggle`. `UISelect` is a native `<select>`; to search or choose several options, `UICombobox`. `useTheme`, `useThemeToggle`, the theme configuration and `POST /_meeko/theme` remain in the framework. UI 1.8 needs Meeko `>=1.8 <2`. See [Migration to 1.8](migration-1.8.md).

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

`UIButton` supports `type`, `disabled`, `class`, `variant="primary|secondary"` and the `click` event; its default type is `button`. `UIInput` shares a text model and supports `id`, `name`, `type`, `placeholder`, `required`, `disabled`, `invalid`, `describedBy` and `class`. `UIField` requires `id` and `label`, supports `description`, `error`, `required` and `class`, and passes the control ID and its description to the snippet. The control must also receive `invalid` when it has an error and `required` when it is mandatory.

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
		defaults: { link: { shape: 'pill' }, button: { shape: 'pill' } },
	},
})
```

Define those variables in your application's styles. CSS references follow its light/dark themes without copying the palette. `primary` lets actions have a different color from `accent`; if not configured, it still uses the accent. Precedence is explicit props, module defaults and base values. Defaults are provided per application and SSR request. Tokens are processed in the UI stylesheet through Vite/PostCSS, without generating inline styles or writing to `node_modules`. See the [full list of options](ui-api.md#typed-options-and-an-existing-brand).

The `apps/meeko`, `apps/ui`, `apps/i18n` and `apps/dashboard` sites use these components and tokens, with no design of their own: the same colors, sizes and fonts. They may only differ in images and effects.

For modals, mount `<UIApp><MeekoOutlet /></UIApp>` in `app/app.meeko`. `useModal().open<R>(nombre, props)` loads a `Modal…` component and returns its result or `undefined` on cancellation. The component uses `UIModal` and `useModalInstance<R>().close(resultado)` or `.dismiss()`. Names and props are checked against the generated registry; `R` is the contract declared by the consumer. You can also control `UIModal` directly with a boolean model. See the [modal API](ui-api.md#modals).

`UITable` generates rows from the required `rows`, `columns` and `rowKey`. The generic is inferred from the rows; `TableColumn<T>`, imported from `@meekojs/ui/runtime`, checks each column's keys and formatters. It supports per-column footers, an empty state, optional snippets for cell content and `layout="native|grid"` (native by default), with horizontal scrolling. See the [table API](ui-api.md#tables).

`UICard` offers `outline`, `soft`, `solid` and `elevated` variants, with title and description props, and header, body and footer snippets. See the [card API](ui-api.md#cards).

The public Meeko UI site is published at <https://ui.meekojs.com> and lives in `apps/ui`. It includes installation, themes, a catalog by category and, in Spanish and English, a guide with a demo, API and copyable code for each component: `/forms`, `/controls`, `/select` (also `UICombobox`), `/editor`, `/cards`, `/tables`, `/content`, `/feedback`, `/page`, `/navigation`, `/modals`, `/popover`, `/overlays`, `/container`, `/buttons`, `/links`, `/badges`, `/icons`, `/theme-toggle`, `/app` and `/transitions`. From the root, run `pnpm ui:dev`; to generate the production site use `pnpm ui:build`. It does not require a database.

UI sources are in `src/app/components` and `src/app/styles`. Components and declarations are included in `dist/app/components` when building `@meekojs/ui`, and CSS files are distributed from `src/app/styles` for processing with Vite/PostCSS. The integration plugin lives in `src/app/plugins/modal.ts`: the module registers its compiled file and connects a private alias to the consumer's component registry. UI does not generate plugin code in the project or write inside the Meeko installation.

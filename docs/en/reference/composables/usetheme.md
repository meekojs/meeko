---
title: useTheme
group: composables
since: 1.4.0
description: Returns the application's light/dark theme (choice, effective theme and theme list) and changes it in html, the cookie and other tabs.
symbols:
  - '@meekojs/meeko/framework#useTheme'
types:
  - '@meekojs/meeko/framework#ThemeState'
related:
  - 'syntax:meekothemetoggle'
  - 'config:theme'
  - '@meekojs/meeko/framework#useStorage'
  - '@meekojs/meeko/framework#useHead'
  - docs/framework.md#tema-clarooscuro-sin-parpadeo
  - docs/framework.md#iconos-que-no-saltan
source-hash: a476f6eb8d505035519e7b863f3d76e35ec6b096811427d8e2c9a884ebd79982
---

With `theme` in `meeko.config.ts`, Meeko stores the user's choice in a cookie, writes the theme to `<html>` from the first byte and, when the server cannot know it, applies it with a `<head>` script before the first render. `useTheme()` gives components that state: `theme`, the choice (including `"system"`), `resolved`, the visible theme, `themes`, the theme list, and `set`, which changes the choice in `<html>`, `color-scheme`, the cookie and `localStorage`.

For a ready-made selector, use `<UIThemeToggle>` from `@meekojs/ui` 0.2; for a custom one, use [`useThemeToggle()`](/en/docs/reference/usethemetoggle). `<MeekoThemeToggle>` is deprecated since core 1.8 and removed in 2.0. `useTheme()` is auto-imported in `.meeko` files (your own export with that name takes priority) and is called while a component script runs.

## Usage

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({ theme: true }) // light y dark, "system" por defecto
```

```html
<!-- app/components/ThemeSelect.meeko -->
<script lang="ts">
	const { theme } = useTheme()
</script>

<template>
	<select
		aria-label="Tema"
		model="theme"
	>
		<option value="system">Sistema</option>
		<option value="light">Claro</option>
		<option value="dark">Oscuro</option>
	</select>
</template>
```

`theme` is a writable signal: `model` changes it, equivalent to calling `set`.

## Parameters

`useTheme()` takes no parameters. Themes come from `theme` in `meeko.config.ts` (`themes`, `default`, `system`, `attribute`, `cookie`…).

## Return value

A `ThemeState`, shared by the entire application:

| Property     | Type                   | Description                                                                                                                                                                                                                  |
| ------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `theme`      | `Signal<Choice>`       | The choice, including `"system"`. Writable in the browser (assignment is equivalent to `set`); read-only on the server.                                                                                                      |
| `resolved`   | `ReadonlySignal<Name>` | The effective theme: the choice or, in `"system"`, that of `prefers-color-scheme`, tracking system changes.                                                                                                                  |
| `themes`     | `readonly Name[]`      | Configured themes, without `"system"`.                                                                                                                                                                                       |
| `set(theme)` | `void`                 | Changes the choice. A name that is neither a theme nor `"system"` throws `TypeError: useTheme(): unknown theme "…"`; on the server throws `Error: useTheme(): the theme changes in the browser, not during a server render`. |

`meeko check` types `Name` and `Choice` from configuration: with `themes: ["light", "dark", "sepia"]`, `resolved` is `"light" | "dark" | "sepia"`. Without `theme` in configuration, `useTheme()` throws `Error: useTheme() needs theme in meeko.config.ts (theme: true) and a running Meeko application`.

## Examples

### A light/dark toggle button without an icon jump

Render both icons and let CSS display one according to the `<html>` attribute, written by the `<head>` script before the first render:

```html
<!-- app/components/ThemeButton.meeko -->
<script lang="ts">
	const { resolved, set } = useTheme()
	const toggle = (): void => set(resolved.value === 'dark' ? 'light' : 'dark')
</script>

<template>
	<button
		type="button"
		class="theme-button"
		aria-label="Tema oscuro"
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
	.theme-button .moon {
		display: none;
	}
	:root[data-theme='dark'] .theme-button .sun {
		display: none;
	}
	:root[data-theme='dark'] .theme-button .moon {
		display: inline;
	}
</style>
```

### Custom themes

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	theme: { themes: ['light', 'dark', 'sepia'], default: 'light', darkThemes: ['dark'] },
})
```

```html
<script lang="ts">
	const { theme, themes } = useTheme()
</script>

<template>
	<fieldset>
		<legend>Tema</legend>
		<label
			each:of="themes"
			each:as="name"
			each:key="name"
		>
			<input
				type="radio"
				bind:value="name"
				model="theme"
			/>
			{name}
		</label>
	</fieldset>
</template>
```

### Read the theme for a library

A chart needing different dark-mode colors tracks `resolved` with an `effect`:

```html
<script lang="ts">
	const { resolved } = useTheme()
	const chartRef = useElementRef('chart')
	onMounted(() => {
		const chart = createChart(chartRef.value!)
		effect(() => chart.setPalette(resolved.value === 'dark' ? darkPalette : lightPalette))
		return () => chart.destroy()
	})
</script>

<template><canvas ref:chart></canvas></template>
```

## Common mistakes

### Use it without `theme` in configuration

```ts bad
// meeko.config.ts sin theme
const { resolved } = useTheme()
```

Rendering throws `Error: useTheme() needs theme in meeko.config.ts (theme: true) and a running Meeko application`. Enable the theme:

<!-- no-check -->

```ts good
export default defineMeekoConfig({ theme: true })
```

### A theme that does not exist

```ts bad
const { set } = useTheme()
const go = () => set('purple')
```

With `themes: ["light", "dark", "sepia"]`, `meeko check` reports `TS2345: Argument of type '"purple"' is not assignable to parameter of type '"dark" | "light" | "sepia" | "system"'`; in JavaScript, `set` throws `TypeError: useTheme(): unknown theme "purple"; use "system", "light", "dark", "sepia"`.

<!-- no-check -->

```ts good
const go = () => set('sepia')
```

### Choose the icon with `resolved` on a prerendered page

```html bad
<span>{resolved.value === "dark" ? "🌙" : "☀️"}</span>
```

This works when the server knows the theme (the cookie or client hint), but on a prerendered page, with the `static` adapter or in `"system"` without a client hint, HTML renders the light theme and the icon changes when hydration ends. Render both and let CSS decide using the `<html>` attribute:

```html good
<span
	class="icon-sun"
	aria-hidden="true"
>
	☀️
</span>
<span
	class="icon-moon"
	aria-hidden="true"
>
	🌙
</span>
<!-- :root[data-theme="dark"] .icon-sun { display: none } … -->
```

## Notes

- **SSR.** The server reads the request cookie and, in `"system"`, the `Sec-CH-Prefers-Color-Scheme` client hint. If it does not know the preference, `resolved` is `system`'s light theme.
- **Hydration.** The browser hydrates with the server-rendered values (transferred in page state) and receives its own when hydration ends, before `onMounted`: there is never a mismatch.
- **Other tabs.** A change in another tab arrives through `localStorage`'s `storage` event; in `"system"`, `resolved` tracks `prefers-color-scheme` while the page is open.
- **Navigation.** Client navigation preserves the theme because it does not reload `<html>`.
- **Security.** The cookie is not `HttpOnly` (the client writes it) and contains nothing private. The server only accepts a theme from `themes` or `"system"`; any other value is ignored.
- **CSS.** Declare `color-scheme` in each theme's CSS so the page has the correct scheme even without JavaScript; Meeko also applies it through CSSOM, allowed by a strict CSP.

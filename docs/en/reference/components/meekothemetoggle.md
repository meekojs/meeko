---
title: <MeekoThemeToggle>
group: components
since: 1.4.0
description: Accessible light/dark theme selector that does not jump on load and works without JavaScript, using themes from meeko.config.ts.
symbols:
  - 'syntax:meekothemetoggle'
types:
  - '@meekojs/meeko/framework#MeekoThemeToggleProps'
  - '@meekojs/meeko/framework#ThemeToggleMessages'
  - '@meekojs/meeko/framework#ThemeToggleSnippets'
related:
  - '@meekojs/meeko/framework#useTheme'
  - 'config:theme'
  - 'syntax:meekolink'
  - docs/framework.md#meekothemetoggle
  - docs/framework.md#tema-clarooscuro-sin-parpadeo
  - docs/framework.md#iconos-que-no-saltan
source-hash: 186fd11229868f6d2018c22f77239cdd83ad4d1c9dae68e19e0817b2ba1ec3dc
---

> **Deprecated since 1.8; removal in 2.0.** `<MeekoThemeToggle>` still works in 1.x and emits `MEEK121`. Use `<UIThemeToggle>` from `@meekojs/ui` 0.2 with its module enabled. It preserves props, snippets and `data-meeko-*` markup. See [Migration to 1.8](../../migration-1.8.md).

With `theme` in `meeko.config.ts`, `<MeekoThemeToggle>` is the ready-to-use theme selector: a button cycling to the next choice (`mode="cycle"`) or a radio group (`mode="select"`). Each snippet (`light`, `dark`, `system` or a custom theme) is that choice's icon.

It renders all icons and a rule Meeko adds to `<head>` shows the one for `<html>`'s `data-theme-choice`, written by the theme script before the first paint: the icon never jumps, even on a prerendered page. Without JavaScript, it is a `<form>` sending `POST /_meeko/theme`. No import is needed: the compiler recognizes it, and a project component with the same name takes priority (`MEEK106`).

## Usage

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({ theme: true })
```

```html
<!-- app/layouts/default.meeko -->
<template>
	<header>
		<MeekoThemeToggle class="toggle">
			<snippet name="light"><IconSun /></snippet>
			<snippet name="dark"><IconMoon /></snippet>
			<snippet name="system"><IconMonitor /></snippet>
		</MeekoThemeToggle>
	</header>
	<main><MeekoOutlet /></main>
</template>
```

The button says “Tema: oscuro. Cambiar a sistema” (Theme: dark. Switch to system) and each click moves to the next choice.

## Props

| Attribute             | Type                                   | Default                                            | Description                                                                                                                                |
| --------------------- | -------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `mode` or `bind:mode` | `"cycle" \| "select"`                  | `"cycle"`                                          | A button cycling to the next choice, or a radio group controlled with arrow keys.                                                          |
| `bind:themes`         | `readonly ThemeChoice[]`               | themes and `"system"` if enabled                   | Choices and their order, such as `bind:themes="['light', 'dark']"`.                                                                        |
| `bind:labels`         | `Partial<Record<ThemeChoice, string>>` | “Claro”, “Oscuro”, “Sistema” (Light, Dark, System) | Each choice's name; a custom theme without a label uses the theme name.                                                                    |
| `bind:messages`       | `ThemeToggleMessages`                  | in Spanish                                         | Accessible text: `cycle(current, next)` (the button's `aria-label`), `unknown` (“Cambiar tema”, Change theme) and `group` (“Tema”, Theme). |
| `class`, `id`         | `string`                               | none                                               | For the root `<form>`. Other attributes do not pass through: wrap the tag if you need them.                                                |

Snippets: one per choice, with its name (`light`, `dark`, `system`, `sepia`…), without parameters. Without a snippet, the choice's label renders. `meeko check` types `themes`, `labels` and snippets with configured themes.

## Result

A `<form method="post" action="/_meeko/theme">` without visual styles:

- `mode="cycle"`: a `<button>` whose `aria-label` states the current and next choice, submitting the next. While the page does not know the choice (no cookie, on a prerendered page), `aria-label` is neutral, “Cambiar tema” (Change theme), until hydration finishes.
- `mode="select"`: a `role="radiogroup"` with `aria-label` (“Tema”, Theme) and one `role="radio"` button per choice with `aria-checked` and `data-meeko-theme-option`.
- Each icon goes in `<span data-meeko-theme-icon="light|dark|system|…">`.

With JavaScript, submission is intercepted and the change is immediate with `useTheme().set()`, without navigation.

## Examples

### A radio group

```html
<MeekoThemeToggle
	mode="select"
	class="theme-radios"
/>
```

```css
.theme-radios [role='radio'][aria-checked='true'] {
	font-weight: 700;
}
/* Before hydration, without aria-checked, CSS reads the choice from <html>: */
[data-theme-choice='dark'] .theme-radios [data-meeko-theme-option='dark'] {
	font-weight: 700;
}
```

### Only light and dark, with custom labels

```html
<MeekoThemeToggle
	bind:themes="['light', 'dark']"
	bind:labels="{ light: 'Day', dark: 'Night' }"
>
	<snippet name="light">☀️</snippet>
	<snippet name="dark">🌙</snippet>
</MeekoThemeToggle>
```

Without `system` in the list, system mode shows the effective theme's icon, according to `prefers-color-scheme`.

### Translate accessible text

```html
<MeekoThemeToggle
	bind:labels="{ light: 'Light', dark: 'Dark', system: 'System' }"
	bind:messages="{ cycle: (current, next) => `Theme: ${current}. Switch to ${next}`, unknown: 'Change theme', group: 'Theme' }"
/>
```

### A custom theme

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({ theme: { themes: ['light', 'dark', 'sepia'] } })
```

```html
<MeekoThemeToggle>
	<snippet name="light"><IconSun /></snippet>
	<snippet name="dark"><IconMoon /></snippet>
	<snippet name="sepia"><IconBook /></snippet>
	<snippet name="system"><IconMonitor /></snippet>
</MeekoThemeToggle>
```

## Common mistakes

### Use it without `theme` in the configuration

```html bad
<!-- meeko.config.ts does not declare theme -->
<MeekoThemeToggle />
```

`meeko check` reports `MEEK111: <MeekoThemeToggle> sólo existe con theme en meeko.config.ts: añade theme: true (o sus opciones) para usarlo`. If `meeko check` cannot read `theme` without executing the configuration (`theme: variable`), the component reports the same error when rendering.

<!-- no-check -->

```ts good
export default defineMeekoConfig({ theme: true })
```

### A nonexistent `mode`

```html bad
<MeekoThemeToggle mode="toggle" />
```

`meeko check` reports `TS2322: Type '"toggle"' is not assignable to type '"cycle" | "select" | undefined'`.

```html good
<MeekoThemeToggle mode="cycle" />
```

### A theme missing from the configuration

```html bad
<MeekoThemeToggle bind:themes="['light', 'night']" />
```

With `themes: ["light", "dark", "sepia"]`, `meeko check` reports `TS2820: Type '"night"' is not assignable to type '"dark" | "light" | "sepia" | "system"'. Did you mean '"light"'?`.

```html good
<MeekoThemeToggle bind:themes="['light', 'dark']" />
```

## Notes

- **Without JavaScript.** `POST /_meeko/theme` only exists with `theme` enabled, accepts `application/x-www-form-urlencoded` up to 2 KB, checks the theme (`400 INVALID_THEME`) and requires an `Origin` matching the application's (`403 INVALID_ORIGIN`). It writes the cookie and responds with `303` to the page, a path on this origin: never an open redirect.
- **`static` adapter.** There is no server: it works with JavaScript, but without it, the `POST` reaches hosting, which rejects it.
- **No flash.** The server writes the theme from the cookie; on a prerendered page, in `static` or in `"system"` without a client hint, the `<head>` script does so before the first paint. The icon rule is a `<style>` with the request's nonce or its hash on a static site: CSP without `'unsafe-inline'` is sufficient.
- **Hydration.** HTML without a known choice has no `aria-checked` or specific `aria-label`; hydration renders the same and, on completion, each radio receives its `aria-checked` once. There is never a mismatch.
- **Accessibility.** In `mode="select"`, arrow keys, `Home` and `End` move focus and choice with a roving `tabindex`, like a native radio group.
- **Manual.** For a custom selector, [`useTheme()`](/en/docs/reference/usetheme) provides the same state.

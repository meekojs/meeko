---
title: useThemeToggle
group: composables
since: 1.8.0
description: Public state for a custom theme selector compatible with SSR, hydration and forms without JavaScript.
symbols:
  - '@meekojs/meeko/framework#useThemeToggle'
types:
  - '@meekojs/meeko/framework#ThemeToggleState'
  - '@meekojs/meeko/framework#ThemeToggleSystem'
related:
  - '@meekojs/meeko/framework#useTheme'
  - 'config:theme'
  - docs/framework.md#selector-de-tema-propio
source-hash: ab4c6b762ffefa11edbad1ea4e9789ff9c26a88e5ee84146077adb236d0f9de9
---

`useThemeToggle()` provides the state used by `UIThemeToggle` from `@meekojs/ui`. You can build a selector that preserves the SSR theme during hydration.

## Usage

Enable `theme: true` in `meeko.config.ts` and call the composable in a component's script:

```ts
import { useThemeToggle } from '@meekojs/meeko/framework'

const toggle = useThemeToggle()
```

## Parameters

It takes no parameters. It reads the themes from the framework configuration.

## Return value

A `ThemeToggleState<Name, Choice>`, with names inferred from the configuration:

| Property      | Type                                   | Description                                                                 |
| ------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `theme`       | `ThemeState<Name, Choice>`             | State from `useTheme()`, with `set(choice)` to change it in the browser.    |
| `choices`     | `readonly Choice[]`                    | Choices in order, including `"system"` if enabled.                          |
| `system`      | `ThemeToggleSystem<Name> \| undefined` | The `light` and `dark` names resolved by system mode.                       |
| `known`       | `ReadonlySignal<boolean>`              | The choice is known: a cookie in SSR or completed hydration in the browser. |
| `interactive` | `ReadonlySignal<boolean>`              | Handlers are responding; `false` in SSR and during hydration.               |

## Examples

```ts
import { computed } from '@meekojs/meeko'
import { useThemeToggle } from '@meekojs/meeko/framework'

const toggle = useThemeToggle()
const label = computed(() => (toggle.known.value ? `Theme: ${toggle.theme.theme.value}` : 'Cambiar tema'))
```

The [custom theme selector](../../framework.md#custom-theme-selector) includes a complete form with `POST /_meeko/theme`, `theme` and `return`, which switches through `theme.set(choice)` when `interactive.value` is `true`.

To avoid icon jumps, render all icons with `data-meeko-theme-icon` and let the `<head>` rule show the one for the choice. While `known.value` is `false`, announce a neutral action (“Change theme”).

## Common mistakes

### Call it without configuring the theme

```ts bad
// meeko.config.ts no activa theme
const toggle = useThemeToggle()
```

<!-- no-check -->

```ts good
// meeko.config.ts
export default defineMeekoConfig({ theme: true })
```

Without `theme` in `meeko.config.ts`, or outside a Meeko application, it throws `MEEK111`. Enable `theme: true` and call it while a component's script is running.

### Change the theme during SSR

```ts bad
const toggle = useThemeToggle()
toggle.theme.set('dark') // setup also runs on the server
```

```ts good
import { useThemeToggle } from '@meekojs/meeko/framework'

const toggle = useThemeToggle()
const chooseDark = (): void => {
	if (toggle.interactive.value) toggle.theme.set('dark')
}
```

`theme.set()` only changes the theme in the browser. In SSR, use the read-only state and preserve native form submission; do not call `set` during setup.

## Notes

- `known` and `interactive` are read-only signals: read `.value` in the binding that uses them.
- The form works without JavaScript with a server adapter. The `static` adapter requires JavaScript.
- The cookie, script, `<head>` icon rule and `POST /_meeko/theme` remain in core; they do not require UI.
- `<MeekoThemeToggle>` is deprecated since 1.8 and will be removed in 2.0. For a ready-made selector, enable the UI module and use `<UIThemeToggle>`.

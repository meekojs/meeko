---
source-hash: 2da1b475dc00d8b7287bde0b38eb955270a10c444359416485701e16cf18b6da
---

# Upgrade from 1.11 to 1.12

**From:** 1.11.x. **To:** 1.12.0. **Status:** unpublished; the latest published version is 1.11.0 (tag `v1.11.0`), and this guide collects what the branch accumulates for `1.12.0`. **Who acts:** maintainers upgrading an application from 1.11.x to 1.12.0.

`1.12` is a minor release with two breaking changes approved as [exceptions](stability.md#approved-exceptions): Meeko stops publishing PostCSS utilities and stops depending on Tailwind CSS, and the Prettier formatter stops sorting classes with `meekoSortClasses: "tailwind"`. They are removed without a deprecation period because Meeko stops being coupled to a CSS solution: the project chooses its own. At the same time, the editor no longer detects Tailwind on its own: a module or the project declares which tools generate classes. The new features (`meeko styles`, `dev.portless` and HMR behind an HTTPS proxy) are optional. In addition, `@meekojs/ui` 1.12 changes the look of its components and how its styles are loaded (see [Changes in `@meekojs/ui`](#changes-in-meekojsui)). Consult the [CHANGELOG](../../packages/meeko/CHANGELOG.md) and the [stability policy](stability.md) as well.

## Who is affected

| If your project…                                                                                      | What you do                                                                                         |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Imports `@meekojs/meeko/postcss`, uses `meekoUtilities()`, `defineUtilities` or the `@utilities` rule | [Remove the PostCSS utilities](#removal-of-meekojsmeekopostcss-and-tailwindcss-from-the-framework). |
| Installed `tailwindcss` only because Meeko accepted it as a peer dependency                           | Declare it in your `package.json` (same section).                                                   |
| Uses `meekoSortClasses: "tailwind"` or `meekoTailwindStylesheet`                                      | [Change the class sorting mode](#removal-of-meekosortclasses-tailwind-and-meekotailwindstylesheet). |
| Uses Tailwind without `@meekojs/ui` and works in VS Code                                              | [Declare the class provider](#editor-class-providers).                                              |
| Uses `@meekojs/ui`                                                                                    | Read [Changes in `@meekojs/ui`](#changes-in-meekojsui).                                             |
| None of the above                                                                                     | Upgrade, run `meeko check` and see [Non-breaking additions](#non-breaking-additions).               |

## Recommended order

1. Look for the removed uses: `grep -rn "meekojs/meeko/postcss\|@utilities\|meekoUtilities\|defineUtilities\|meekoTailwindStylesheet" .` and `meekoSortClasses` in your Prettier configuration.
2. Upgrade `@meekojs/meeko` to `1.12.0` and, if you use them, `@meekojs/prettier-plugin` and `@meekojs/ui` to `1.12.0`. Compiled code and the runtime must have the same version: compile or build again.
3. Remove `meekoUtilities()` from `postcss.config.*` and the `@utilities` rules from your stylesheets, and replace them with your own CSS.
4. If you used Tailwind without `@meekojs/ui`, declare `tailwindcss` and its integration (`@tailwindcss/vite` or `@tailwindcss/postcss`) in the project's `package.json`.
5. Change `meekoSortClasses: "tailwind"` to `"stylesheet"` (or `"alphabetical"`) and delete `meekoTailwindStylesheet`.
6. If you use Tailwind without `@meekojs/ui`, add `css.classProviders` to `meeko.config.ts`.
7. Run `meeko check` (which also writes `.meeko/styles/main.css`) and `prettier --check .`. In CI, run `meeko styles` before Prettier if you sort with `"stylesheet"`.

## Removal of `@meekojs/meeko/postcss` and `tailwindcss` from the framework

**What changed.** These are removed without a deprecation period:

- the `@meekojs/meeko/postcss` entry point, with `meekoUtilities()`, `defineUtilities` and their types (`UtilityDeclarations`, `UtilityAtRuleDeclarations`…);
- the `@utilities "<path>" [layer(<name>)];` at-rule;
- the optional peer dependency `tailwindcss` of `@meekojs/meeko`.

`@meekojs/meeko` no longer exports the `./postcss` subpath and does not declare `tailwindcss` in its `peerDependencies`. Meeko still passes `app/styles/main.css`, the module stylesheets and the component `<style>` blocks through Vite's CSS pipeline, with the `postcss.config.*` at the project root and the Vite plugins that the project or a module registers. PostCSS is used inside Meeko only to apply the scope of `<style scoped>`. The Tailwind configuration now lives only in `@meekojs/ui`. See [The project chooses its CSS](framework-configuration.md#postcss-and-tailwind).

**Who is affected.** A project that:

- imports `@meekojs/meeko/postcss` (typically in `postcss.config.*` or in utility modules): the import fails with `Package subpath './postcss' is not defined by "exports"`;
- writes `@utilities` in a stylesheet: the rule is no longer expanded and the classes it generated do not exist;
- used Tailwind without `@meekojs/ui`, relying on `@meekojs/meeko` accepting it as a peer dependency: nothing brings it in now.

It does not affect projects that use plain CSS, `@meekojs/ui` or Tailwind already declared in their own `package.json`.

**What to do.**

Before:

```js
// postcss.config.mjs
import tailwindcss from '@tailwindcss/postcss'
import { meekoUtilities } from '@meekojs/meeko/postcss'

export default { plugins: [meekoUtilities(), tailwindcss()] }
```

```ts
// app/styles/utilities/surface.ts
import { defineUtilities } from '@meekojs/meeko/postcss'

export default defineUtilities(({ rule }) => [rule('.surface', { position: 'relative', padding: '4px' })])
```

```css
/* app/styles/main.css */
@import 'tailwindcss';
@utilities "./utilities/surface.ts";
```

After, with your own CSS (what the module generated):

```js
// postcss.config.mjs
import tailwindcss from '@tailwindcss/postcss'

export default { plugins: [tailwindcss()] }
```

```css
/* app/styles/main.css */
@import 'tailwindcss';

.surface {
	position: relative;
	padding: 4px;
}
```

If you still need to generate utilities from code, pick the tool you prefer: Tailwind 4's `@utility`, a PostCSS plugin of your own or a build script that writes the CSS.

If you used Tailwind without `@meekojs/ui`, declare Tailwind and its integration in the project. There are two paths; use only one. With the Vite plugin, register it in a module (`addVitePlugin`); with PostCSS, in `postcss.config.*`, as above. The details and both complete examples are in [The project chooses its CSS](framework-configuration.md#postcss-and-tailwind):

```sh
pnpm add -D tailwindcss @tailwindcss/vite
```

## Removal of `meekoSortClasses: "tailwind"` and `meekoTailwindStylesheet`

**What changed.** The Prettier formatter (`@meekojs/meeko/prettier` and `@meekojs/prettier-plugin`) removes the `"tailwind"` mode of `meekoSortClasses` and the `meekoTailwindStylesheet` option. It no longer loads `tailwindcss` or `@tailwindcss/node`, and `tailwindcss` stops being an optional peer dependency of `@meekojs/prettier-plugin`. Prettier rejects `meekoSortClasses: "tailwind"` with its invalid option error. Three modes remain: `"off"`, `"stylesheet"` and `"alphabetical"`, which do not change.

**Who is affected.** Anyone with `tailwind` in `prettier.config.*`, `.prettierrc` or `--meeko-sort-classes`, or with `meekoTailwindStylesheet`. `meekoClassFunctions` keeps its behavior with the three remaining modes.

**What to do.**

Before:

```ts
// prettier.config.ts
export default {
	plugins: ['@meekojs/meeko/prettier'],
	meekoSortClasses: 'tailwind',
	meekoTailwindStylesheet: './app/styles/main.css',
}
```

After:

```ts
// prettier.config.ts
export default {
	plugins: ['@meekojs/meeko/prettier'],
	meekoSortClasses: 'stylesheet',
}
```

`"stylesheet"` sorts each class by its first appearance in the global stylesheet. Since `1.12`, the formatter reads `.meeko/styles/main.css` when it exists and names at least one class: it is the stylesheet that `meeko dev` writes through the whole Vite pipeline and its plugins, so it includes the Tailwind utilities even when Tailwind is registered as a Vite plugin (`@tailwindcss/vite`, the case of `@meekojs/ui`). It is only read. Without it, the formatter processes `app/styles/main.css` with the project's `postcss.config.*`, as before; if the stylesheet is older than `app/styles/main.css`, it is still used and a warning is shown once. See [Ordering by the global stylesheet](editors.md#ordering-by-the-global-stylesheet).

Two cases:

- **Tailwind with `@tailwindcss/vite` and no `.meeko/styles/main.css`.** The stylesheet that is processed as a fallback does not include the Tailwind utilities: run `meeko dev`, `meeko check` or `meeko styles` first, or use `"alphabetical"` or `"off"`.
- **CI and fresh clones.** `.meeko/` is outside Git, so `prettier --check` would sort differently than locally. Run [`meeko styles`](reference/commands/meeko-styles.md) before Prettier:

```sh
meeko styles . && prettier --check .
```

## Editor class providers

**What changed.** The language server no longer checks whether the project uses Tailwind: it does not read `tailwindcss` in `package.json` or in the stylesheets' `@import`s. Instead, whoever generates classes declares it:

- a module, with `meeko.addClassProvider({ name, vscode?, languages? })` in its `setup`;
- the project, in `css.classProviders` of `meeko.config.ts`.

The types are `ClassProvider` (exported by `@meekojs/meeko/framework`) and the `css.classProviders` option. With a provider active in the editor (any of the `vscode` extensions), the server leaves to that extension the classes that exist only in `.meeko/styles/main.css`. `meeko dev` and `meeko check` save the declarations in `.meeko/manifests/class-providers.json`, which the editor reads in an untrusted workspace, where it does not run the project. `.css` stylesheets register `css` and the declared `languages`, instead of always `tailwindcss`. See [Class providers](editors.md#class-providers).

**Who is affected.** Anyone using Tailwind (or another tool that generates classes) with an editor extension of its own. Nothing breaks without the declaration: Meeko also offers the generated classes, next to those of Tailwind CSS IntelliSense, so you may see the utilities duplicated in completion. `@meekojs/ui` already declares Tailwind CSS, so its projects do nothing. A server older than `1.12` does not know the `meeko/classProviders` request; the VS Code extension tolerates it and keeps sending `tailwindActive`.

**What to do.** A project with Tailwind and without `@meekojs/ui` adds the declaration to `meeko.config.ts`. Write the array as a literal: in an untrusted workspace the editor reads it without running the configuration.

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	css: { classProviders: [{ name: 'Tailwind CSS', vscode: ['bradlc.vscode-tailwindcss'], languages: ['tailwindcss'] }] },
})
```

A module of your own that registers Tailwind with `addVitePlugin` declares it in its `setup`, where it already knows the tool:

```ts
meeko.addClassProvider({ name: 'Tailwind CSS', vscode: ['bradlc.vscode-tailwindcss'], languages: ['tailwindcss'] })
```

Meeko validates the declaration when it loads the configuration: an unknown field, an empty `name`, ids that do not have the form `editor.name` or `"meeko"` among the `languages` stop `meeko dev`, `meeko build` and `meeko check` with a message that names the path (see [`css`](reference/config/config-css.md)). For other LSP clients, the `meeko/classProviders` request and the `activeExtensions` field of `meeko.classes` are described in [Editors](editors.md#class-providers).

## Changes in `@meekojs/ui`

`@meekojs/ui` `1.12.0` changes the look of its components and how its styles are loaded. It is a package with its own CHANGELOG, which lists each change with its migration; this is a summary of what requires action. See [Meeko UI](ui.md) and the [UI CHANGELOG](../../packages/ui/CHANGELOG.md).

- **The application compiles the UI styles with its own Tailwind.** The package no longer ships the precompiled `dist/styles/main.css` sheet: `app/styles/main.css` imports Tailwind and the UI CSS entry. `tailwindcss` is a peer dependency of UI (`^4.3.5`); install it in the application.

  ```css
  /* app/styles/main.css */
  @import 'tailwindcss';
  @import '@meekojs/ui';
  ```

  `@import 'tailwindcss'` brings the Tailwind preflight, which removes margins, list bullets and the size of headings. To keep the previous look of an application that did not use Tailwind, import only the theme and the utilities (see [Meeko UI](ui.md#start-in-an-application)).

- **The application's classes win over those of the components.** The recipes merge `class`, each `ui` slot and `ui.defaults` with Tailwind Merge, and `@meekojs/ui/theme` exports `mergeClasses`. The UI theme is added to Tailwind's, and `appearance-palette.css` is removed with the `ui-<color>` classes.
- **`UIButton`, `UILink`, `UIIconButton` and `UICopyButton`.** `variant` is the treatment (`solid`, `soft`, `surface`, `outline`, `subtle`, `ghost`, `link`) and the new `color` prop is the semantic color. `tone`, `shape`, the `appearance` prop and the `primary` and `secondary` values of `variant` disappear:

  | Before                | Now                                 |
  | --------------------- | ----------------------------------- |
  | `variant="primary"`   | `variant="solid" color="primary"`   |
  | `variant="secondary"` | `variant="surface" color="neutral"` |
  | `tone="danger"`       | `color="danger"`                    |
  | `shape="pill"`        | `radius="full"`                     |

- **`UICard` and `UILinkCard`.** New `color`, `radius` and `elevation` props; `variant="elevated"` (use `elevation="md"`) and the `appearance` prop disappear. The default card keeps its look.
- **The remaining components** (`UIInput`, `UIBadge`, `UIAvatar`, `UIAlert`, `UIToast`, `UISparkline`, `UIMenu`…) replace `tone`, `appearance` and `shape` with `variant`, `color`, `size` and `radius`; `UIInput` no longer passes `size` to the `<input>`. `useModal().confirm({ tone })` is `confirm({ color })`. The UI CHANGELOG has the complete table of replacements.
- **`UISelect` stops being a native `<select>`.** It is a `role="combobox"` button that opens a list of its own over `UIPopover`. The props, the model and the form value do not change; the markup does (the `select`/`option`/`::picker(select)` selectors and `selectOption()` in tests stop working), as do the list, which is created when it opens, and `listClass`, which goes on the floating box. Without JavaScript an option can no longer be chosen.
- **Widths.** `UISelect` and `UICombobox` fill the width of their container (`block w-full`); for a fixed width, use a class (`class="w-48"`).

## Non-breaking additions

- **`meeko styles [directory]`.** Writes `.meeko/styles/main.css` without starting `meeko dev`, with the same contents and atomically; it serves to sort classes in CI and for the editor after cloning. `meeko check` also writes it when it finishes successfully. See [`meeko styles`](reference/commands/meeko-styles.md).
- **`dev.portless`.** `dev: { portless: true }` (or `{ name: "ui.meeko" }`) publishes `meeko dev` at `https://<name>.localhost` through [portless](https://portless.sh), without wrapping the script. `portless` is not a Meeko dependency, and `PORTLESS=0` disables it. See [Named URL with portless](reference/config/config-dev.md#named-url-with-portless).
- **HMR behind an HTTPS proxy.** The HMR WebSocket of `meeko dev` now declares the `ws` protocol, so hot reload works when the page is served through a local HTTPS proxy (portless, Caddy or a tunnel on the same machine). There is nothing to configure.
- **Performance improvements in `meeko dev` and `meeko build`.** Auto-imports are discovered once instead of once per module, the router downloads the page code while it requests its data, and in-flight requests are answered when Vite invalidates the server graph. They do not change the API.

## Update the packages

```sh
pnpm add @meekojs/meeko@^1.12.0
pnpm add -D @meekojs/prettier-plugin@^1.12.0
pnpm add @meekojs/ui@^1.12.0 tailwindcss
```

Install only the packages you use. Follow the [stability policy](stability.md) and the [six public packages](releasing.md#publish-the-meeko-packages), which are published with the same version.

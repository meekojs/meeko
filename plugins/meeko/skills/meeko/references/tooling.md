# Meeko tooling reference (core 1.9.x)

CLI, diagnostics, Vite, ecosystem packages, testing and upgrade notes for projects that
depend on `@meekojs/meeko`. Everything here is public API; run commands from **the
application root** (the folder with `meeko.config.ts` or, for engine-only projects,
`vite.config.ts`).

Requirements: Node.js >= 24, TypeScript 7 (bundled for `meeko check`), Vite `^8.3.5`
(optional peer). All official packages share the core version line (`1.9.x`) and require
core `>=1.8 <2`.

## 1. CLI (`meeko`)

Binaries shipped by `@meekojs/meeko`: `meeko` and `meeko-language-server`. Invoke them
through the package manager (`pnpm exec meeko …`, `npx meeko …`). `meeko <cmd> --help`
(or `meeko help <cmd>`) prints per-command help. CLI messages are in **Spanish**
(`OK`, `aviso`, `AVISO`, `ERROR`, `Proyecto creado en …`); do not expect English text.
Exit code `1` on errors; warnings never fail a command.

| Command                             | Purpose                                                                                                                                                                                                                                                                      | Key flags / notes                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `meeko dev [dir]`                   | Dev server: Vite + SSR + HMR. Prepares `.meeko/` (entries, route/contract/auto-import types, `tsconfig.*.json`) before listening. Does **not** type-check.                                                                                                                   | Port/host via `MEEKO_PORT`/`MEEKO_HOST` (default `127.0.0.1:4173`). Warns if another `meeko dev` serves the same project.              |
| `meeko check [dir \| file.meeko]`   | Full validation. With a dir (default `.`): prepares `.meeko/`, checks every `.meeko`, then runs TypeScript over the app/server/shared projects and `meeko.config.ts`. With a file: only that component (syntax, directives, types).                                          | `--json` (after the component) prints `{ code, message, filename, location, severity? }[]`. **The CI gate**: must pass before `build`. |
| `meeko doctor [dir]`                | Static environment inspection: Node version, package manager, versions/resolution of Meeko, UI, i18n, plugins, TS, Vite, ESLint, Prettier; config/module/layer references; presence of `.meeko` artifacts; available LSP. Executes nothing, reads no `.env`, writes nothing. | `--json` (`schemaVersion: 1`, checks with IDs/statuses). `OK`/`AVISO`/`ERROR`; only `ERROR` exits 1.                                   |
| `meeko build [dir]`                 | Runs everything `check` does, then builds client, server and prerendered pages into `.meeko/output/<adapter>/`.                                                                                                                                                              | `--adapter <node\|cloudflare\|deno\|bun\|static>` or `--adapter=<name>`; overrides `server.adapter` (default `node`).                  |
| `meeko start [dir]`                 | Serves the Node build (`.meeko/output/node/index.mjs`) + project `.env`.                                                                                                                                                                                                     | Requires a prior `meeko build`.                                                                                                        |
| `meeko preview [dir]`               | Runs the build in its real runtime (Node in-process; Bun/Deno/`wrangler dev` as child; static file server).                                                                                                                                                                  | `--adapter …`, same values; build with the same adapter first.                                                                         |
| `meeko clean [dir]`                 | Deletes `.meeko/` and `node_modules/.vite`; never follows symlinks/junctions.                                                                                                                                                                                                | `--all` (also `node_modules`), `--dry-run` (measure only).                                                                             |
| `meeko routes <dir>`                | Discovery only: writes route/contract/component/auto-import manifests, `services.d.ts`, `tsconfig.*.json`; no TypeScript. Fast way to make a new page/endpoint exist for types.                                                                                              | Prints written files.                                                                                                                  |
| `meeko check-app <dir>`             | Checks `.meeko` components of the app and its layers only; no `.meeko/` generation, no `.env`, no TS on `.ts`.                                                                                                                                                               | Directory required. Prefer `check` in CI.                                                                                              |
| `meeko types <file.meeko>`          | Writes `.d.meeko.ts` declarations of the component and its imported `.meeko` into `.meeko/types/` (mirrored paths). Engine-only projects need it before `tsc`.                                                                                                               | Framework apps: `check` does this already.                                                                                             |
| `meeko compile <in.meeko> <out.ts>` | Checks and compiles one component to its TS module (`renderWithState`, `renderToString`, `hydrate`, `css`, types). Writes nothing on errors.                                                                                                                                 | For debugging or non-Vite builds.                                                                                                      |
| `meeko prerender <dir>`             | Re-renders `render: "prerender"` routes over the existing Node build (no recompilation).                                                                                                                                                                                     | Requires `meeko build`.                                                                                                                |
| `meeko init <dir>`                  | Scaffolds an engine-only SSR project (one component, Node server, Vite).                                                                                                                                                                                                     | Dir may be missing/empty or contain only `package.json`, lockfiles, `node_modules`, `.npmrc`, `.git`. Never installs deps.             |
| `meeko init-framework <dir>`        | Scaffolds a full-stack Meeko app (`meeko.config.ts`, `app/`, layout, prerendered page, `.env.example`, scripts).                                                                                                                                                             | Same dir rules. `npx @meekojs/meeko init-framework my-app`.                                                                            |
| `meeko auth hash`                   | Prompts (twice, no echo) or reads stdin; prints only the scrypt hash line to stdout.                                                                                                                                                                                         | `meeko auth hash >> .env`.                                                                                                             |
| `meeko lsp`                         | Starts the language server (launched by editors).                                                                                                                                                                                                                            | `--stdio`, `--node-ipc`, `--socket=<port>`, `--pipe=<name>`. Same as `meeko-language-server`.                                          |
| `meeko --help` / `--version`        | `-h` / `-v`.                                                                                                                                                                                                                                                                 |                                                                                                                                        |

Environment variables read by `dev`/`start`/`preview` (and the project `.env`, which the
real environment overrides): `MEEKO_PORT` (`PORT` is a permanent fallback), `MEEKO_HOST`,
`MEEKO_PUBLIC_ORIGIN` (needed behind a TLS proxy), `MEEKO_TRUST_PROXY`,
`MEEKO_TRUSTED_PROXIES`, `MEEKO_REDIS_URL`, `MEEKO_HMR_PORT`, `MEEKO_EDITOR_BRIDGE=0`,
`MEEKO_LINK_WATCH=0`. `HOST` and `PUBLIC_ORIGIN` are deprecated.

### Which command validates a change

| Situation                                                           | Run                                                                                            |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Any code change in a framework app (default)                        | `pnpm exec meeko check .`                                                                      |
| Quick feedback on one component                                     | `pnpm exec meeko check app/components/Foo.meeko` (add `--json` for machine output)             |
| Added a page/API/RPC/socket file and the editor shows missing types | `pnpm exec meeko routes .` (or just `check`)                                                   |
| Production confidence / adapter-specific code                       | `pnpm exec meeko check . && pnpm exec meeko build .`                                           |
| Engine-only project (`meeko init` starter)                          | `pnpm exec meeko types src/App.meeko && pnpm exec tsc --noEmit` (the starter's `check` script) |
| "Cannot find package", missing generated types, editor misbehaving  | `pnpm exec meeko doctor .` then `pnpm exec meeko check .`, reopen editor                       |
| Stale caches after upgrades or weird HMR                            | `pnpm exec meeko clean .` (then `dev`/`check`)                                                 |

Never hand-edit `.meeko/` (generated; `clean` deletes it). Do not commit it.

## 2. Diagnostics

Terminal format (from `check`, `build`, `dev`, compile errors):

```text
app/pages/index.meeko:12:5 MEEK022: <message in Spanish>
app/pages/index.meeko:20:3 aviso MEEK101: <message>
```

`aviso` = warning (never fails `check`). Codes are stable contract (`MEEK0xx`, `MEEK1xx`,
`MEEK_*`); message text is not. Retired codes are never reused. TypeScript errors appear
with their `TSxxxx` codes on the same files (template expressions are type-checked).
The editor shows the same diagnostics, plus quick fixes for several (e.g. `MEEK020`,
`MEEK022`, `MEEK101`).

How to look one up: the public stability policy has the full table ("Diagnostic codes" in
the 1.x stability page of meekojs.com docs); the message usually names the fix. Search
`node_modules/@meekojs/meeko` docs/types if offline. Retired: `MEEK005`, `MEEK023`,
`MEEK049` (removed in 1.1; the constructs became valid).

| Code                                                                                 | Meaning                                                                                                                                 | Typical fix                                                                                     |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `MEEK001`                                                                            | Invalid component HTML (e.g. `<foo />` unknown name, `<template />` self-closed).                                                       | Close the tag explicitly; since 1.8 normal HTML elements may self-close (`<div />`).            |
| `MEEK002`                                                                            | Top-level content other than `<script>`, `<template>`, `<style>`.                                                                       | Move markup into `<template>`.                                                                  |
| `MEEK006`                                                                            | `<script>`/`<script server>` without `lang="ts"`.                                                                                       | Add `lang="ts"`.                                                                                |
| `MEEK007`                                                                            | Missing `<template>`.                                                                                                                   | Add one.                                                                                        |
| `MEEK008`                                                                            | Invalid template HTML (orphan closing component tag; `<input>`/`<select>` inside `<select>`).                                           | Fix nesting.                                                                                    |
| `MEEK013` / `MEEK020`                                                                | Syntax error in `<script>` / in a template expression. `MEEK020` also flags Vue-style `{{ x }}`.                                        | Meeko interpolates with **single braces** `{expr}`.                                             |
| `MEEK014`/`MEEK015`                                                                  | Multiple declarators per statement; unsupported `defineProps` destructuring (nested, array, computed key, `let`).                       | One `const` per statement; flat destructuring.                                                  |
| `MEEK017`                                                                            | `defineProps` without type argument / misplaced.                                                                                        | `const props = defineProps<Props>()`.                                                           |
| `MEEK018`                                                                            | Unsupported top-level statement in `<script>` (value `export`, class, `enum`, `namespace`…).                                            | Move to a `.ts` module and import it.                                                           |
| `MEEK021`/`MEEK022`                                                                  | `if:when` + `each:of` on the same node; invalid/duplicate `each:as`/`each:index`.                                                       | Wrap in `<template>`; add `each:as="item"`.                                                     |
| `MEEK032`                                                                            | Attribute on a component that cannot be a prop (`is`, `ref="x"`, hyphenated non-directive).                                             | Use `bind:`/`ref:` directives or declare the prop.                                              |
| `MEEK033`/`MEEK034`                                                                  | Component import not a relative `.meeko` path/alias, or file missing.                                                                   | Fix path; prefer auto-imported components.                                                      |
| `MEEK044`                                                                            | `<script server>` outside `app/pages` (or in `+layout`/`+error`).                                                                       | Server code only in pages, `*.route.ts` or `server/`.                                           |
| `MEEK063`–`MEEK066`                                                                  | `defineModel`/`model` misuse (prop named like the model, `model` + `on:update:modelValue`, `model` on unsupported element).             | Remove the duplicate prop/event; `model` only on form controls/components.                      |
| `MEEK101` (warn)                                                                     | A prop read once in setup (loses reactivity).                                                                                           | `computed(() => props.x)` or destructure `defineProps`; `untrack` if intentional.               |
| `MEEK106` (warn)                                                                     | A project component shadows a built-in tag (`MeekoLink`, `MeekoOutlet`…).                                                               | Rename the component.                                                                           |
| `MEEK107` (warn → error in 2.0)                                                      | `html="..."` with an unbranded `string`.                                                                                                | Wrap with `trustHtml(...)` where the HTML is produced/sanitized, or render `{text}`.            |
| `MEEK108`                                                                            | API not available where used (server auto-import like `defineApiRoute` in a component, `server/` import in client code).                | Move to `<script server>`/`server/`; use `import type`.                                         |
| `MEEK109` (warn → error in 2.0)                                                      | `definePage` in `<script>`/template, or value import from `@meekojs/meeko/node`, `/bun`, `/deno`, `/password`, `/build` in a component. | `definePage` inside `<script server>` or a `*.route.ts` sidecar.                                |
| `MEEK111`                                                                            | `<MeekoThemeToggle>` without `theme` in config.                                                                                         | `theme: true` (and migrate to `UIThemeToggle`).                                                 |
| `MEEK113`                                                                            | Bad `bind="obj"` (no value, `on*`/`data-meeko*` key, key not an attribute/prop).                                                        | Pass events with `on:`; fix keys.                                                               |
| `MEEK117` (warn)                                                                     | Unawaited `useApi`/`useRpcQuery` data in `each:of` without loading handling.                                                            | Wrap in `<MeekoAwait>` or handle `pending`.                                                     |
| `MEEK118`                                                                            | `@/` alias used from `shared/` (cannot see `app/`).                                                                                     | Relative import or shared alias.                                                                |
| `MEEK120` (warn)                                                                     | Local props interface not named `Props`.                                                                                                | Rename to `Props`.                                                                              |
| `MEEK121` (warn)                                                                     | Deprecated `<MeekoPopover>`, `<MeekoSelect>`, `<MeekoThemeToggle>`.                                                                     | `UIPopover`, `UICombobox` (native alternative: `UISelect`), `UIThemeToggle` from `@meekojs/ui`. |
| `MEEK122` (warn → error in 2.0)                                                      | Literal attribute value outside the HTML standard (`type="sumbit"`).                                                                    | Use a valid value.                                                                              |
| `MEEK123`–`MEEK125`                                                                  | `defineProps` defaults reading setup values; defaults both in pattern and argument; assigning a destructured prop.                      | Defaults from literals/imports only; one place; props are read-only.                            |
| `MEEK126` (warn)                                                                     | `modules: [importedModule]` or `[module, options]`.                                                                                     | `modules: ['@meekojs/ui']` + options under its key (`ui: {…}`).                                 |
| `MEEK127` (warn)                                                                     | Config key of an installed module missing from `modules`.                                                                               | Add the module name to `modules`.                                                               |
| `MEEK128`–`MEEK130` (warn → error in 2.0)                                            | `onCleanup` with browser APIs in SSR code, after `await`, or at module top level.                                                       | Register inside `onMounted`, before the first `await`, inside a composable/`createRoot`.        |
| `MEEK133` (warn)                                                                     | Same attribute static and with `bind:` (`id="a" bind:id="b"`).                                                                          | Keep one.                                                                                       |
| `MEEK134` (warn)                                                                     | Old `<FolderIndex>` name of `Folder/Index.meeko`.                                                                                       | Use `<Folder>` (and `FolderProps`).                                                             |
| `MEEK136`                                                                            | Component module stored in a `signal`/`useState` initial value (cannot serialize).                                                      | Store a key; resolve with `computed`/`resolveComponent`.                                        |
| `MEEK_PAGE_PROPS`, `MEEK_LAYOUT_PROPS`, `MEEK_ERROR_PROPS`, `MEEK_PAGE_LAYOUT_PROPS` | Page/layout/error-page prop contract mismatch.                                                                                          | Align the props with what the route provides.                                                   |
| `MEEK_AUTOIMPORT`, `MEEK_CHECK`, `MEEK_PROJECT_CHECK`                                | Language-server only: ambiguous auto-import, component check failure, project check failure.                                            | Run `meeko check .` in a terminal for the real error.                                           |

## 3. Vite integration (engine-only use)

`meeko dev`/`meeko build` configure Vite themselves; add the plugin manually only for a
custom Vite host (the `meeko init` starter, a component library, `.meeko` inside another
Vite app).

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { meeko } from '@meekojs/meeko/vite'

export default defineConfig({ plugins: [meeko()] })
```

- `meeko()` takes **no options**; it reads `meeko.config.*` (aliases, auto-imports,
  `css.scopeAttribute`, `theme`) and `tsconfig.json` near each file.
- Importing a `.meeko` yields `renderWithState`, `renderToString`, `hydrate`, `css`,
  `Props` …; `<style>`/`<style scoped>` become CSS (injected in dev, extracted in build);
  HMR preserves signals.
- SSR + hydration pattern: server calls `renderWithState(props)`, embeds
  `rendered.html` and `serializeJson({ props, state: rendered.state })` in a
  `<script type="application/json">`; client calls `hydrate(root, props, state)`.
  Server and browser must see identical props, initial values and list order.
- TypeScript in such projects needs `allowArbitraryExtensions` and `rootDirs` overlaying
  sources with `.meeko/types/` (written by `meeko init`), plus `meeko types <entry>` before `tsc`.
- Root `@meekojs/meeko` exports only reactivity and context APIs (`signal`, `computed`,
  `effect`, `batch`, `untrack`, `createRoot`, `onCleanup`, `createContext`, `provide`,
  `inject`, `provideErrorHandler`, `serializeJson`, `isTooLargeToAnimate`, …). Tools use
  `@meekojs/meeko/parse` and `/compiler`; never import `dist/` paths.

## 4. Ecosystem packages

Official modules are registered **by package name** in `modules` and configured under
their `configKey`; options are typed without imports (types land in
`.meeko/types/config.d.ts`; add `{ "path": "./.meeko/tsconfig.config.json" }` to
`tsconfig.json` `references` for editor completion).

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	modules: ['@meekojs/ui', '@meekojs/i18n', '@meekojs/icon'],
	theme: true,
	ui: { defaults: { button: { radius: 'full' } } },
	i18n: { defaultLocale: 'es', catalogs: { es: { common: 'i18n/es/common.json' }, en: { common: 'i18n/en/common.json' } } },
	icon: { collections: ['lucide'] },
})
```

### `@meekojs/ui`

`pnpm add @meekojs/ui`; enable `modules: ['@meekojs/ui']` (`theme: true` only for theme
switching). The module auto-registers components with the **`UI` prefix** (no imports),
adds its stylesheet via Vite/PostCSS before `app/styles/main.css` (app CSS wins), a
global base in layer `ui-base` (`ui: { base: false }` to omit) and the Inter font.

- Components: structure `UIContainer`, `UIPage`, `UIPageHeader`, `UIHeader`, `UIFooter`;
  actions `UIButton`, `UILink`, `UILinkCard`, `UIBadge`, `UIThemeToggle`; forms `UIField`,
  `UIInput`, `UITextarea`, `UICheckbox`, `UIRadioGroup`, `UISwitch`, `UISlider`, `UISelect`
  (native), `UICombobox` (search/multiple); navigation `UITabs`, `UIBreadcrumb`,
  `UIPagination`, `UINavigationTree`, `UITableOfContents`, `UILocaleSwitcher`; data
  `UICard`, `UITable`, `UIStat`, `UIDescriptionList`, `UIDisclosure`, `UICodeBlock`,
  `UIProse`; feedback `UIAlert`, `UIToast`, `UIEmpty`, `UISkeleton`; overlays `UIModal`,
  `UIDrawer`, `UIPopover`, `UITooltip`, `UICommandPalette`, host `UIApp`.
  `UIMarkdownEditor` lives in the separate `@meekojs/ui/editor` module.
- `UIButton` renders `<MeekoLink>` with `to`, `<a>` with `href`, else `<button type="button">`.
  `UILink` requires `to` or `href`. Variants `primary|secondary|outline|ghost`, sizes
  `sm|md|lg`, shapes `rounded|pill`.
- `UIField` requires `id` + `label` and passes `id`/`describedBy` via its default snippet
  (`<snippet name="default" params="id, describedBy">`).
- Modals: mount `<UIApp><MeekoOutlet /></UIApp>` in `app/app.meeko`;
  `useModal().open<R>(name, props)`. `UITable` needs `rows`, `columns`, `rowKey`
  (`TableColumn<T>` from `@meekojs/ui/runtime`).
- Theming: override `--ui-*` CSS variables (`--ui-color-primary-9`, `--ui-radius-md`) in
  app CSS, `:root[data-theme='dark']` for dark; or `ui.tokens` / `ui.defaults`. Types
  `UIOptions`, `UITokens`, `UIDefaults` from `@meekojs/ui`; prop types (`UIPopoverProps`,
  `UIComboboxProps`, …) from `@meekojs/ui/runtime`.
- Texts follow `useI18n().locale` when i18n is active; otherwise `ui.locale` (default `es`)
  and `ui.messages`.

### `@meekojs/i18n`

`pnpm add @meekojs/i18n`; `modules: ['@meekojs/i18n']`, options under `i18n` (write
`'@meekojs/i18n'`, not `'@meekojs/i18n/module'`). Catalogs are JSON per locale and
namespace; every locale needs `common` and identical keys/params. Keys and params are
typed after `meeko check`.

- In components: `const { t, locale, number, date, localePath, switchLocalePath } = useI18n()`
  (auto-imported); `t('items', { total: 3 })`. Plural/select objects must declare `other`.
- Markup in messages: `<I18nT key values?>` with one snippet per tag. In
  `<script server>`: `usePageI18n()` (`@meekojs/i18n/server`, auto-imported).
- Routing: `strategy: 'prefix_except_default'` generates `/en/...` routes from existing
  pages; link with `<MeekoLink to="/guide">` / `<UILink to>` (prefix added automatically).
  Options: `defaultLocale`, `catalogs`, `global`, `routes`, `multilingual`, `exclude`,
  `partial`, `cookie`, `hreflang`, `ogLocale`, `sitemap`, `directions`, `strategy`.
- Never redirects by `Accept-Language`; use `suggestedLocale()` in `onMounted`.
- Missing key in a loaded route renders the key and logs `[meeko:i18n] Missing message`.
- `@meekojs/meeko/i18n` is the legacy built-in entry; new code uses `@meekojs/i18n`.

### `@meekojs/icon`

`pnpm add @meekojs/icon` plus each Iconify collection as a project dependency
(`pnpm add -D @iconify-json/lucide`). `modules: ['@meekojs/icon']`,
`icon: { collections: ['lucide'], componentName?: 'AppIcon', include?: [...] }`.
`<UIIcon name="lucide:search" />` (decorative) or with `label="Delete"` (accessible).
Icons are resolved at compile time and inlined (no runtime fetch, CSP-safe). Unknown names
are type errors in `check`/`build`/editor (`TS2820` with a suggestion in config).

### `@meekojs/eslint-plugin`

`pnpm add -D eslint jiti @meekojs/eslint-plugin` (ESLint 10, flat config; `jiti` loads
`eslint.config.ts`).

```ts
// eslint.config.ts
import { defineEslint } from '@meekojs/eslint-plugin'

export default defineEslint(
	{ unusedImports: true, rules: { 'meeko/button-has-type': 'error' } },
	{ files: ['tests/**/*.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
)
```

Options: `javascript`, `typescript`, `meeko` (all on by default), `perfectionist`
(default: sort imports only, as warnings; `true` sorts more; `false` none),
`unusedImports` (default `false`), `ignores`, `rules` (typed; unknown rules fail).
Extra arguments are plain flat-config overrides. `.meeko` linting is syntactic (no
`project`/`projectService`); type-aware TS-ESLint rules are rejected in `options.rules`.
`meeko/rules-of-composables` (error) enforces `useX()` calls at setup root, before
`await`/early return. Ignores `.meeko/`, `dist/`, `*.d.meeko.ts`, `*.generated.ts` by default.
Run: `pnpm exec eslint .`.

### `@meekojs/prettier-plugin`

`pnpm add -D prettier @meekojs/prettier-plugin`;
`prettier.config.mjs`: `export default { plugins: ['@meekojs/prettier-plugin'] }`.
Formats script, `<script server>`, template and style. Options: `meekoIndentSections`
(default `false`), `meekoPreserveArrayBreaks` (default `true`), `meekoSortClasses`,
`meekoClassFunctions` (`tv`, `clsx`, `cn`…). Formatting never changes rendered whitespace.
The editor's formatter uses the same rules and respects `.prettierignore`/`.gitignore`.
`@meekojs/meeko/prettier` is the legacy 1.x entry (kept for compatibility).
Run: `pnpm exec prettier . --check`.

### Editors and `meeko lsp`

- VS Code: extension **Meeko Language** (`meekojs.meeko-language`). It uses the project's
  installed `@meekojs/meeko` server (install it locally: `pnpm add -D @meekojs/meeko`), in
  trusted workspaces runs project contract checks on save, shows live signal values from a
  running `meeko dev` (editor bridge; disable with `MEEKO_EDITOR_BRIDGE=0`), CodeLens,
  quick fixes, snippets (`mmounted`, `mrpc`, `mmiddleware`…).
- Other editors (Neovim, Helix, Zed, JetBrains LSP4IJ, Sublime): associate `*.meeko` and run
  `meeko-language-server --stdio` (or `meeko lsp --stdio`) from the project's
  `node_modules/.bin`. Format setting: `meeko.format.indentSections`.
- Tailwind: install Tailwind CSS IntelliSense; the extension registers
  `tailwindCSS.includeLanguages: { meeko: 'html' }`.
- Editor diagnostics are a convenience; `meeko check .` is authoritative.

### DevTools

`devtools: true` in `meeko.config.ts` (default `false`) mounts the in-page panel during
`meeko dev` only (never in build/start/preview/prerender); `{ position: 'bottom-left' }`,
`{ panel: false }`. Manual alternative (don't combine):
`if (import.meta.env.DEV) (await import('@meekojs/meeko/devtools-ui')).mountDevtoolsPanel()`.
It inspects hydrated instances, props, signals, timeline, navigation/data and lets you edit
signals; built on the dev-only `window.__MEEKO_DEVTOOLS__` hook. A Chrome DevTools panel
extension consumes the same hook.

## 5. Testing Meeko apps

There is no Meeko-specific test utility. The supported loop:

1. Static gate: `pnpm exec meeko check .` then `pnpm exec meeko build .`.
2. Browser behaviour and hydration: Playwright against `meeko dev`.

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
	use: { baseURL: 'http://localhost:4173' },
	webServer: { command: 'pnpm exec meeko dev .', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI },
})
```

```ts
// tests/home.spec.ts
import { expect, test } from '@playwright/test'

test('counter responds after hydration', async ({ page }) => {
	await page.goto('/')
	await page.getByRole('button', { name: 'Count: 0' }).click()
	await expect(page.getByRole('button', { name: 'Count: 1' })).toBeVisible()
})
```

Setup: `pnpm add -D @playwright/test && pnpm exec playwright install chromium`; run
`pnpm exec playwright test`. CI order: install deps + Chromium, `meeko check .`,
`meeko build .`, `playwright test`.

Notes for unit-style tests:

- Under Vitest with the Meeko Vite plugin, a component's `css` export is the compiler
  string unless `test.css: true`; SSR-rendering via `renderToString`/`renderWithState`
  works in Node.
- Since 1.8 every API `POST/PUT/PATCH/DELETE` and RPC call without an allowed `Origin`
  returns `403 INVALID_ORIGIN`, even without a session. Scripts/tests using `fetch`,
  `executeApiRoute` or `executeRpc` must send `headers: { origin: 'http://localhost:4173' }`
  (`createApiClient`/`createRpcClient` accept `headers`).
- Hydration mismatches show as `Hydration mismatch …` in the browser console; assert
  interactivity after hydration, not just SSR HTML.

## 6. Version and migration notes

Migration guides exist per minor (`Upgrade from 1.x to 1.y`); 1.9 has no breaking changes
(it adds `ClientOptions.credentials` for API/RPC clients). Deprecated APIs keep working in
1.x and are removed in 2.0; do **not** write them in new code.

| Since         | Removed / changed / deprecated                                                      | Use instead                                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0           | `server/session.ts` no longer loaded                                                | Default export of `server/runtime.ts` (optional since 1.2)                                                                                                                  |
| 1.0           | `renderLayout` handler option removed; root exports only public reactivity API      | Layouts with `<MeekoOutlet />`; internals only in `@meekojs/meeko/internal`                                                                                                 |
| 1.1           | `model`, `html`, `ref:` became directives on standard elements                      | `bind:model` / `bind:html` to write a literal attribute                                                                                                                     |
| 1.1           | `useSocket(url, contract, opts)` from `/framework` deprecated                       | `useSocketClient` (same signature)                                                                                                                                          |
| 1.2           | `HOST`, `PUBLIC_ORIGIN` deprecated                                                  | `MEEKO_HOST`, `MEEKO_PUBLIC_ORIGIN` (`PORT` still fine)                                                                                                                     |
| 1.2           | `api.users.byId.get({ params })` deprecated                                         | `api.users({ id }).get()`                                                                                                                                                   |
| 1.2           | Layer folders inside `modules` deprecated                                           | `layers: [...]` (`extends` is an alias)                                                                                                                                     |
| 1.2           | Generated tsconfigs use `moduleResolution: "Bundler"`                               | Relative imports without `.js`                                                                                                                                              |
| 1.3           | `html="..."` with plain string → `MEEK107`                                          | `trustHtml(...)` / `TrustedHtml`; `documentHtml(...)` (1.8) to avoid double payload                                                                                         |
| 1.3           | `definePage` in `<script>`; server-only imports in components → `MEEK108`/`MEEK109` | `<script server>` / `*.route.ts`; `import type`                                                                                                                             |
| 1.5           | Unnamed `bind="..."` is the bulk-attributes directive                               | `bind:bind="'text'"` for a literal, or `data-*`                                                                                                                             |
| 1.6           | `app/middleware/*.server.ts` are server route middleware                            | Default export must be `defineServerRouteMiddleware(...)`                                                                                                                   |
| 1.7           | Assigning `computed().value` throws `TypeError`                                     | Change source signals or use `signal`                                                                                                                                       |
| 1.7           | `PageInputError.name === 'PageInputError'`                                          | `instanceof PageInputError` / `error.code`                                                                                                                                  |
| 1.8           | `<MeekoPopover>`, `<MeekoSelect>`, `<MeekoThemeToggle>` deprecated (`MEEK121`)      | `UIPopover`, `UICombobox` (or native `UISelect`), `UIThemeToggle` with `@meekojs/ui` module; types from `@meekojs/ui/runtime`. `useThemeToggle()`/`useTheme()` stay in core |
| 1.8           | `modules: [importedModule]`, `[module, opts]` deprecated (`MEEK126`)                | `modules: ['@meekojs/ui']` + `ui: {…}`                                                                                                                                      |
| 1.8           | `Folder/Index.meeko` named `<Folder>`; `<FolderIndex>` deprecated (`MEEK134`)       | `<Folder>`, `FolderProps`                                                                                                                                                   |
| 1.8           | `<Name>Props` no longer includes `defineEmits` callbacks                            | `ComponentProps<'Name'>` for props+callbacks; `<Name>Emits` for the event map                                                                                               |
| 1.8           | Origin required on all mutations (`403 INVALID_ORIGIN`)                             | Webhooks/public APIs: `origin: 'none'` + signature/token check                                                                                                              |
| 1.8           | `onCleanup` misuse warnings `MEEK128`–`MEEK130` (errors in 2.0)                     | Cleanup in `onMounted`, before `await`                                                                                                                                      |
| 1.8           | `defineProps` destructuring is reactive; defaults in pattern **or** argument        | `const { label, size = 'md' } = defineProps<Props>()`                                                                                                                       |
| 2.0 (planned) | `css.scopeAttribute` default `"all"` → `"matched"`                                  | Opt in early with `css: { scopeAttribute: 'matched' }`                                                                                                                      |

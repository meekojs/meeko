---
source-hash: 04942a42d304076e82b3174749d6482d199cb7bcf3b9a08d66b4afc93a4ba6e6
---

# Upgrade from 1.3 to 1.4

**From:** 1.3.x. **To:** 1.4.0. **Status:** published on npm; the latest version checked on November 5, 2026 is 1.9.0. **Who acts:** maintainers upgrading an application from 1.3.x to 1.4.0.

`1.4` is a minor release: new features (light/dark theming with `theme`, `useTheme()` and `<MeekoThemeToggle>`, `data-theme-choice`, `if:when` on `<snippet>`, types named after each component, `defineSnippets` with `Snippet<Args>`, `MeekoLinkProps` and `RouteId`, auto-imports in `@utilities` modules and CSP with style hashes) are optional. One change is released as an [approved exception](stability.md#approved-exceptions) to the stability policy: a module cannot use a `MeekoConfig` key as its `meta.configKey`, and `theme` is one as of this version. Other changes are noticeable when updating: auto-imports and configuration execution when generating `@utilities` CSS, a child's `snippets` object, the `MEEK106` warning for your own component named `MeekoThemeToggle`, editor completion and `meeko dev` with a linked Meeko. This guide collects them and what you should review for each. The full list, including additions and fixes, is in the [CHANGELOG](../../packages/meeko/CHANGELOG.md); compatibility commitments are in the [stability policy](stability.md).

## Recommended order

1. Update `@meekojs/meeko` to the exact version `1.4.0` and recompile or rebuild, including prerendered pages: generated code and runtime must have the same version. If you use the VS Code extension, update it to `1.4.0`; Meeko DevTools is unchanged (still `1.0.0`).
2. If a module in `modules` declares `meta.configKey: "theme"` (like the module example in the `1.3` guide) or another `MeekoConfig` key, change it before starting: configuration does not load (see [A module with `configKey: "theme"`](#a-module-with-configkey-theme)).
3. Run `meeko check`. Your own component named `MeekoThemeToggle` now produces warning `MEEK106`, which does not fail the check (see [`<MeekoThemeToggle>`, `MEEK106` and `MEEK111`](#meekothemetoggle-meek106-and-meek111)).
4. If you use `@meekojs/meeko/postcss` in a Meeko project, regenerate CSS and review PostCSS warnings: `@utilities` modules receive auto-imports and the plugin executes `meeko.config.*` and its modules' `setup` functions (see [Auto-imports in `@utilities`](#auto-imports-in-utilities)).
5. If you enable `theme`, remove your existing theme script from `<head>` and review CSP, SSR page caching and CSS (see [Light/dark theme](#lightdark-theme)).

## Approved exception

### A module with `configKey: "theme"`

Since `1.4`, `theme` is Meeko's light/dark theme option. The module example in the `1.3` guide defined a theme module with `meta.configKey: "theme"`, options `{ initial, storageKey }` and a `MeekoConfig.theme` augmentation. That module can no longer coexist with Meeko's option: it would read Meeko's theme options as its own, its augmentation conflicts with Meeko's type (`TS2717`), and its options in `theme` would enable Meeko's theme or fail validation.

Therefore, since `1.4`, a module whose `meta.configKey` is a `MeekoConfig` key (`layers`, `extends`, `modules`, `imports`, `server`, `css`, `document`, `dev`, `site`, `sitemap`, `robots` or `theme`) fails configuration loading in `meeko dev`, `meeko build` and `meeko check`:

```text
Meeko module @acme/meeko-theme uses meta.configKey "theme", which is an option of Meeko itself since 1.4: give the module another configKey and move its options in meeko.config.* to that key (see docs/migration-1.4.md)
```

And that module's options written in `theme` fail earlier, during configuration validation, with `theme: unknown field initial` and an explanation pointing to this conflict.

What to change:

- **In the module**, use another key in `meta.configKey` and its `MeekoConfig` augmentation:

  ```ts
  // Before
  declare module "@meekojs/meeko/framework" {
    interface MeekoConfig { readonly theme?: Partial<ThemeOptions> }
  }
  export default defineMeekoModule<ThemeOptions>({ meta: { name: "@acme/meeko-theme", configKey: "theme" }, /* … */ });

  // After
  declare module "@meekojs/meeko/framework" {
    interface MeekoConfig { readonly acmeTheme?: Partial<ThemeOptions> }
  }
  export default defineMeekoModule<ThemeOptions>({ meta: { name: "@acme/meeko-theme", configKey: "acmeTheme" }, /* … */ });
  ```

- **In `meeko.config.ts`**, put its options under the new key: `theme: { initial: "dark" }` becomes `acmeTheme: { initial: "dark" }`. Options in `[módulo, opciones]` in `modules` are unchanged.
- **Or replace the module with `theme`** (see [If you already had your own theme](#if-you-already-had-a-custom-theme)). If the module added its own `useTheme` with `addAutoImports`, that still takes precedence over Meeko's while the module remains in `modules`.

A module without `configKey`, or with a non-Meeko key, is unchanged.

## Light/dark theme

### What enabling `theme` adds

Without `theme` in `meeko.config.ts`, nothing changes: no script or style in `<head>`, no cookie, headers or `POST /_meeko/theme`. With `theme: true` (or its options), Meeko adds:

- **In `<head>`, a blocking inline script** applying the saved theme before first paint, immediately after `meta` tags and before linked stylesheets, and a minimal `<style>` (only `display: none`) for `<MeekoThemeToggle>` icons. In SSR they carry `DocumentOptions.nonce`; in prerendered pages and the `static` adapter, their hashes go into `scriptHashes` and `styleHashes` and the CSP written by `static`. If serving HTML with your own CSP without `'unsafe-inline'`, allow them by nonce or hash (see [Hash-based CSP](framework.md#csp-with-hashes)).
- **On `<html>`, the theme** (`data-theme="dark"` or, with `attribute: "class"`, a class) and the choice in `data-theme-choice`. With `"class"`, the runtime changes only the theme class and preserves all others, including those added by other scripts.
- **A cookie**, `meeko-theme` by default (`cookie`), and the same key in `localStorage` (`storageKey`, which defaults to the cookie name). Cookies are per host, not port: in development, `localhost` applications share `meeko-theme` even on different ports; give each its own `cookie` to separate them.
- **Headers on SSR documents**: `Vary: Cookie, Sec-CH-Prefers-Color-Scheme`, `Accept-CH: Sec-CH-Prefers-Color-Scheme` and, with the `"system"` choice, `Critical-CH` (without `clientHints`, only `Vary: Cookie`). If a proxy or CDN caches SSR pages, it must include the theme cookie in the key or avoid caching them. Prerendered and `static` pages do not vary by theme.
- **`POST /_meeko/theme`**, the endpoint for the `<MeekoThemeToggle>` form without JavaScript. Exists only with `theme`; other methods return `405`.

See [Light/dark theme without flicker](framework.md#lightdark-theme-without-flashing).

### If you already had a custom theme

Remove the script applying the theme in `<head>` (for example, from `document.head.script` or a module using `meeko.addHead`) and the code writing the attribute: `theme` does the same and the server also writes it. Meeko's script reads the cookie, then `localStorage`, then `default`, so a choice saved only in `localStorage` still works and is restored to the cookie. If your script used another `localStorage` key, specify it in `storageKey` (`theme: { storageKey: "theme" }`) and visitors keep their choice, as long as stored values are `themes` names or `"system"`.

`useTheme()` is auto-imported in `.meeko` files; your own export with that name from auto-import directories, or a module's `useTheme`, takes precedence, so your composable keeps working until you remove it.

### `data-theme-choice`

With `theme`, `<html>` also carries the user's choice, including `"system"`: `data-theme-choice="system"` while `data-theme` states the effective theme. It is written by the `<head>` script before first paint, by the server when known from the cookie, and by the runtime on each change. Use it for your own CSS, with or without `<MeekoThemeToggle>`. If your application already used that attribute name on `<html>`, rename it; `theme.attribute` cannot be `"data-theme-choice"` either. See [`data-theme-choice`](framework.md#data-theme-choice).

### `<MeekoThemeToggle>`, `MEEK106` and `MEEK111`

`<MeekoThemeToggle>` is a Meeko built-in tag, like `<MeekoLink>`, without an import: a theme selector that works without JavaScript. Using it without `theme` is error `MEEK111`. `meeko dev` and `meeko build` know this from configuration, which they execute; `meeko check` and the editor read `theme` from `meeko.config.*` without executing it and, when they cannot determine it that way (a variable `theme`, nonliteral configuration or a directory without `meeko.config.*`, such as a layer with its own `package.json`), they do not warn: the component produces the same error when rendered.

A project component named `MeekoThemeToggle` (in `app/components`, from a module, imported or declared in `<script>`) remains that tag, with its props, rather than Meeko's; `meeko check`, `meeko build` and the editor warn with `MEEK106`. Rename it if you want the built-in tag. Its auto-imported `MeekoThemeToggleProps` also describes its own props. See [`<MeekoThemeToggle>`](framework.md#meekothemetoggle).

## Snippets

### `if:when` on `<snippet>` and `MEEK110`

`<snippet name="footer" if:when="snippets.actions">…</snippet>` passes the snippet to the child only while the condition is truthy. Until `1.3`, any `<snippet>` attribute except `name` and `params` was `MEEK061`, so no existing code changes meaning. Only valid for a snippet the child declares optional (`x?:`): on a required one, it is the new `MEEK110` type error from `meeko check` and the editor, marked on `if:when`. `MEEK061` also flags an empty or valueless `if:when`. See [Snippets with `defineSnippets`](api.md#snippets-with-definesnippets).

### A child's `snippets` object

To let a parent's `<snippet if:when>` reach a mounted child without remounting it, the object returned by `defineSnippets()` in a child with reactive props follows the parent: each read of `snippets.x` in the template, a `computed` or an `effect` updates when the parent starts or stops passing that snippet. In `1.3`, it was a frozen object with the first render's snippets. What to review:

- **A value copied in setup** (`const hasFooter = Boolean(snippets.footer)`) keeps the initial value, like a copied prop: read it in the template or a `computed`.
- **Still read-only:** assigning, defining or deleting a key throws `TypeError`. It is no longer a frozen object, so `Object.isFrozen(snippets)` returns `false`.
- **Children without reactive props** (with a top-level data `await`, or compiled before `1.2`) remount when a snippet changes, preserving editable signals by name, as with props.

### `defineSnippets` with `Snippet<Args>`

Each key's value in `T` can be a `Snippet<Args>` as well as a tuple. This lets `T` build on another component's snippet map: `defineSnippets<Omit<AppCardSnippets, "footer"> & { actions?: [close: () => void] }>()`, or the `ComponentSnippets` imported from a `.meeko`, which produced `TS2344` in `1.3`. Tuple declarations have the same type as before.

## Types

### Component types

Each auto-imported component provides `<Nombre>Props`, `<Nombre>Snippets`, `<Nombre>Models` and `<Nombre>Exposed` without an import: `app/components/App/Card.meeko` gives `AppCardProps`, `AppCardSnippets`, `AppCardModels` and `AppCardExposed`. These are new names in `app/` scope (`.meeko` and `.ts` files in `app/`, not `shared/`), declared in `.meeko/types/autoimports/`. A project auto-import with the same name (for example, `AppCardProps` from `app/types`) takes precedence without warning, and a file import or declaration takes precedence as usual, so existing code is unchanged. See [Types for each component](framework.md#component-types).

### `MeekoLinkProps`, `MeekoOutletProps`, `MeekoThemeToggleProps` and `RouteId`

`@meekojs/meeko/framework` exports prop types for its tags and `RouteId`, the ID of any application route. They are auto-imported: tag types with `AppCardProps` scope, and `RouteId` throughout the project, like `href`. A project type with one of these names takes precedence, and a project component replacing a tag (`app/components/MeekoLink.meeko`, with `MEEK106`) provides its own `MeekoLinkProps`. With them, a component receives a route without an import (`defineProps<{ href: MeekoLinkProps["to"] }>()` or `RouteId`) and `meeko check` verifies that the parent passes an existing route.

## Configuration and build

### Auto-imports in `@utilities`

In a Meeko project (a directory with `meeko.config.*` or a `package.json` depending on `@meekojs/meeko`), `meekoUtilities()` applies value auto-imports from `app/` and `shared/` (with `imports.appDirs`, `imports.sharedDirs`, layers and modules) to the `@utilities` module and its imported local TypeScript modules when bundling with rolldown (Vite 8). What to review:

- **A free name previously treated as a global** (for example, a constant read with `typeof NOMBRE === "undefined"`) now resolves to the project's export of that name, if any.
- **Configuration executes when generating CSS.** To read the registry, the plugin executes `meeko.config.*` and its modules' `setup` functions, like `meeko dev`, once per stylesheet. If a `setup` has effects (writing files, contacting a service), they occur then too. If configuration or a `setup` throws, the stylesheet is generated without auto-imports and PostCSS warns with the reason.
- **What is unavailable** (exports from `server/` and `serverDirs`, `.client.ts` and `.server.ts`, components, generated clients and framework APIs such as `signal` or `useState`) produces, when used, an error naming the auto-import, its source and the reason.

`meekoUtilities({ autoImports: false })` restores `1.3` behavior: no auto-imports or configuration execution. Outside a Meeko project or without rolldown, nothing changes either. See [TypeScript-generated utilities](framework.md#generated-utilities-with-typescript).

### CSP with style hashes

`inlineStyleHashes(html)` from `@meekojs/meeko/build` computes the SHA-256 of each inline `<style>`, the prerender index stores them in `pages[ruta].styleHashes`, and `contentSecurityPolicy(policy, scriptHashes, styleHashes)` accepts a third argument. The `static` adapter applies them to `server.contentSecurityPolicy`: it adds hashes to `style-src-elem`, `style-src` or a copy of `default-src`, unless the directive already allows `'unsafe-inline'`. If your `static` site has a style policy without `'unsafe-inline'`, the generated header changes: it includes hashes of each page's inline `<style>` elements (the theme's and components'). If you compare or set that header elsewhere (a proxy, a test), update it. See [Hash-based CSP](framework.md#csp-with-hashes).

## Development

### `meeko dev` with a linked Meeko

With `@meekojs/meeko` linked (pnpm `link:`, `npm link` or a workspace), `meeko dev` only restarts on writes, creations and deletions in the package's `dist/` and `package.json`: on Windows, reading a build older than an hour no longer restarts it. With `MEEKO_LINK_WATCH=0`, which disables restarts, the server keeps its loaded Meeko code while the browser receives the new `dist/`; it now warns in the terminal once per rebuild so you restart `meeko dev` before checking the result. See [Create an application](framework.md#create-an-application).

## Editor

VS Code extension `1.4.0` includes Meeko `1.4`'s language server. Visible changes:

- **Filtered completion.** Completion in `<script>` and the template no longer offers virtual-code helper types (`__MeekoEmit`…), internal paths from a linked `@meekojs/meeko`, Node globals and modules (`__dirname`, `process`, `userInfo` from `os`…), which do not exist in the browser, or compiled component exports (`renderToString`, `hydrate`…). `<script server>` keeps Node entries. Package exports follow local names and project auto-imports.
- **Project checking.** `MEEK_PROJECT_CHECK` updates when saving, creating, deleting or renaming any `.meeko`, module, configuration or application directory, using unsaved text from open files; an empty `.meeko` no longer leaves an error in every file.
- **Built-in tags and types.** Hover on `<MeekoLink>`, `<MeekoOutlet />` and `<MeekoThemeToggle>` shows their reference with real types, each component's types complete without imports, and `MEEK110` and `MEEK111` are marked on their lines. With `@meekojs/meeko` older than `1.4`, tag references use the description bundled with the server. See [Editors](editors.md).

## Repository: ESLint

The Meeko repository adds ESLint (`pnpm lint`, with `eslint.config.ts`) for its own code. Nothing changes for applications: the published package includes neither ESLint nor its configuration, and the compiler and `meeko check` still validate `.meeko` files. See [CONTRIBUTING](../../CONTRIBUTING.md).

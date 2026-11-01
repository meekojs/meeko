---
source-hash: 8626afad1b4d9418664ca59781b218d70565cbe531f240eeceaeb5e6246e15ec
---

# Upgrade from 1.2 to 1.3

`1.3` is a minor release: new features (the `static` adapter, `site`, `sitemap`, `robots`, `document.seo`, hash-based CSP, `trustHtml`, `isClientError`, `imports.appDirs` and `imports.sharedDirs`, CSS class completion in the editor, class sorting with Prettier…) are optional. One type-only change is released as an [approved exception](stability.md#approved-exceptions) to the stability policy: csstype-typed `@meekojs/meeko/postcss` declarations. Other changes are noticeable when updating: new diagnostics, Prettier formatting output, handling of global failures in the browser and server, and server logs in the browser console during `meeko dev`. This guide collects them and what you should review for each. The full list, including additions and fixes, is in the [CHANGELOG](../../packages/meeko/CHANGELOG.md); compatibility commitments are in the [stability policy](stability.md).

## Recommended order

1. Update `@meekojs/meeko` to the exact version `1.3.0` and recompile or rebuild, including prerendered pages: generated code and runtime must have the same version. If you use the VS Code extension, update it to `1.3.0`; Meeko DevTools is unchanged (still `1.0.0`).
2. Run `meeko check`. Fix `MEEK108` errors, which identify code that already failed, and review `MEEK107` and `MEEK109` warnings, which do not fail the check (see [New diagnostics](#new-diagnostics)).
3. If you use `@meekojs/meeko/postcss`, check your `@utilities` modules with TypeScript (see [csstype-typed `@meekojs/meeko/postcss` declarations](#meekojsmeekopostcss-declarations-typed-with-csstype)).
4. If you format with the Prettier plugin, run `prettier --write` once and save the result in a separate commit: formatting output changes (see [Formatting with Prettier](#formatting-with-prettier)).
5. Review `onError` in `mountClientApp` and `server/runtime.ts`, and `switch` statements over `ErrorSource`: they receive failures they did not receive before, and an unhandled rejection no longer terminates the server process (see [Errors](#errors)).
6. If `meeko.config.ts` has an `imports.serverDirs` entry outside `server/`, fix it: configuration no longer loads (see [Auto-import directories](#auto-import-folders)).

## Approved exception

### `@meekojs/meeko/postcss` declarations typed with csstype

The declarations object of `rule()` and `atRule()` (`UtilityDeclarations`) uses [csstype](https://github.com/frenic/csstype) types instead of accepting any key with a string or number. The editor completes standard and vendor-prefixed properties, in camelCase and kebab-case, and each value's keywords. Plugin-generated CSS is unchanged: this is a type-only fix, and almost everything now rejected already failed in the browser, which silently discards an unknown property or `padding: 4`. `csstype` becomes a type-only package dependency.

What to review when checking `@utilities` modules with TypeScript:

- **A property csstype does not know** (`backgroundColr`) is an error: correct the name. For a recent property or at-rule not yet in csstype, write CSS with `` css`…` ``.
- **Lengths and times are strings with units**, except `0`: `padding: 4`, which the plugin wrote without a unit, is an error. Write `padding: "4px"`. Numbers remain valid where CSS accepts them without units (`opacity`, `zIndex`, `flexGrow`, `lineHeight`, `fontWeight`…).
- **An object constructed outside the call** loses its keywords: `const base = { position: "absolute" }` is `{ position: string }`, which is no longer assignable. Annotate it with `UtilityDeclarations` or use `as const`.
- **Reading declarations with a `string` key** (`decls[key]` in a `for` over `Object.keys(decls)`) produces `TS7053` with `noImplicitAny` (included in `strict`), because `UtilityDeclarations` no longer has the `[property: string]` index signature. Use `Object.entries(decls)` or a `keyof UtilityDeclarations` key.

```ts
// app/styles/utilities/surface.ts
import { defineUtilities } from "@meekojs/meeko/postcss";
import type { UtilityDeclarations } from "@meekojs/meeko/postcss";

// Antes: compilaba, pero el navegador descartaba «padding: 4»
const base = { position: "absolute", padding: 4 };

// Después
const base: UtilityDeclarations = { position: "absolute", padding: "4px" };
// o: const base = { position: "absolute", padding: "4px" } as const;

export default defineUtilities(({ rule }) => [rule(".surface", base)]);
```

`--*` properties, kebab-case keys, fallback arrays (also with `as const`), `undefined`, `!important` and dynamic keys from `Object.fromEntries` or a `Record<string, string>` still compile. `atRule()` also accepts descriptors from `@font-face`, `@property`, `@page`, `@counter-style`, `@font-palette-values` and `@view-transition`, with the new `UtilityAtRuleDeclarations` type. See [TypeScript-generated utilities](framework.md#generated-utilities-with-typescript).

## New diagnostics

### `MEEK107`: `html="..."` without `trustHtml`

`meeko check`, `meeko build` and the editor warn with `MEEK107` when the value of `html="..."` is not assignable to `TrustedHtml | null | undefined`: a `string`, `string | undefined`, concatenation with a `string` or `any` (for example, the result of `JSON.parse` or `response.json()`). It is a warning: it does not fail the check or change SSR, hydration or generated code. Inserting an unmarked `string` is deprecated and will become a `meeko check` error in `2.0`.

Mark HTML where it is produced, not immediately before the template. `trustHtml` does not sanitize, only declares trust: sanitize HTML from users or third parties first. To display text, `{expr}` escapes and needs none of this.

```ts
// server/content/articles.ts
import DOMPurify from "isomorphic-dompurify";
import { trustHtml } from "@meekojs/meeko";
import type { TrustedHtml } from "@meekojs/meeko";

export function commentHtml(input: string): TrustedHtml {
  return trustHtml(DOMPurify.sanitize(input));
}
```

- Import `TrustedHtml` and `trustHtml` from `@meekojs/meeko`; they are not auto-imports.
- The marker reaches the template from `<script server>`, `load` and `ServerData<T>`: declare `TrustedHtml` in the shared types for that data.
- String literal types and their unions do not warn (`html="'<br>'"`). An unannotated `<script>` constant, such as `const icon = "<svg>…</svg>"`, reaches the template as `string`: write `as const` or mark it with `trustHtml`.

See [Trusted HTML](api.md#trusted-html-trustedhtml-and-trusthtml).

### `MEEK108` and `MEEK109`: each API in its place

A component's `<script>` and template run in SSR and in the browser; `<script server>` and `*.route.ts` sidecars run only on the server. `meeko check`, `meeko build` (also the Vite plugin in `meeko dev`) and the editor now identify every API used where it does not exist, with a message stating where it is used:

- **`MEEK108` error.** In `<script>` or the template: a server auto-import (`defineApiRoute`, `defineRpc`, `defineServerMiddleware`, `defineSocketChannel`, `defineServerRuntime`, `ApiError` or one from `server/utils`, `imports.serverDirs` or a `*.server.ts`), a value import from `@meekojs/meeko/server` or `/cloudflare`, or an import from `server/` or a `*.server.*` module. In `<script server>`: a component macro (`defineProps`, `defineEmits`, `defineExpose`, `defineModel`, `defineSnippets`, `useElementRef`) and `onMounted`. All of this already failed before `1.3` (the auto-import did not resolve in the browser bundle, `/server` and `/cloudflare` throw when loaded there, importing `server/` stopped `meeko build`); the error now arrives earlier, on its line. Request data with `useApi` or `useRpcQuery`, or move the code to `<script server>`.
- **`MEEK109` warning.** In `<script>` or the template: `definePage`, which does not configure the route there, and value imports from `@meekojs/meeko/node`, `/bun`, `/deno`, `/password` or `/build`, whose functions only work on the server. That code compiles and loads, so it is a warning; it is deprecated and will be an error in `2.0`.
- `usePage`, `redirect` and `notFound` without imports in `<script>` produce `MEEK073`, as they already did when imported.

`import type` remains allowed in all cases, and a component inside `server/` (an email template, for example) can use everything. The build and `meeko dev` only apply `MEEK108` to the browser bundle, so a component outside `server/` importing only server code still compiles; `meeko check` and the editor, which do not know the import graph, check it as browser code: place it in `server/` for them to accept it.

```html
<!-- Antes: app/pages/about.meeko. definePage no tenía efecto aquí (MEEK109) -->
<script lang="ts">
const route = definePage({ render: "prerender" });
</script>

<!-- Después -->
<script server lang="ts">
export const route = definePage({ render: "prerender" });
</script>
```

Also, completion in `<script>` and the template no longer offers exports from `@meekojs/meeko/server`, `/node`, `/bun`, `/deno`, `/password`, `/build` and `/cloudflare`, `server/` and `*.server.*` modules, or `definePage`, `usePage`, `redirect` and `notFound`; `<script server>` still offers them. See [Where each API is used](framework.md#where-each-api-is-used).

## Formatting with Prettier

The first two changes affect formatting output, which the [stability policy](stability.md) allows to change in a minor release. `prettier --check` may flag files that passed with `1.2`, and editor format-on-save may change untouched lines. Format the project once after updating and save the result in a separate commit to avoid mixing it with other changes.

### Normalized `class` attribute

In `.meeko` templates, the value of each static element `class="…"` is always normalized, with no option, as Prettier does with standalone HTML: leading and trailing whitespace is removed, any sequence of spaces, tabs or line breaks becomes one space, and duplicate classes disappear (keeping the first). The element's classes are unchanged because Meeko's static attributes do not interpolate `{expr}`. `bind:class`, `class` on a component tag (`<Card class="…">`, a static prop) and values with character references (`&amp;`) are untouched.

### Arrays: `meekoPreserveArrayBreaks`

The new `meekoPreserveArrayBreaks` option, enabled by default, applies objects' `objectWrap: "preserve"` rule to arrays: an array, destructuring pattern or tuple with a line break between `[` and its first item prints one item per line even if it fits in `printWidth`. Without that break, Prettier decides; to collapse an array, join `[` with the first item and format again.

To do this, the plugin replaces Prettier's `estree` printer, so with the plugin in project configuration, the rule reaches all JavaScript and TypeScript formatted by Prettier (`.ts`, `.js`, `.tsx`, `.mjs`…), not just `.meeko` files. The printer delegates to the running Prettier's `estree`, even if it is a different 3.x version from Meeko's dependency. If another configured plugin also replaces `estree`, Prettier uses only the last in the `plugins` list. To restore Prettier's exact output, disable it in project Prettier configuration, also read by the editor (the language server has no separate setting):

```json
{ "plugins": ["@meekojs/meeko/prettier"], "meekoPreserveArrayBreaks": false }
```

### Class ordering: `meekoSortClasses`

Optional and disabled (`"off"`). `"alphabetical"` sorts classes in each static `class="…"` by character code, and `"stylesheet"` by first appearance in `app/styles/main.css` (processed with the project's Vite and PostCSS, as in `meeko dev`) and then the component's `<style>`, like `prettier-plugin-tailwindcss`. In the CLI, the option is only recognized when passing the plugin through `--plugin` (`--plugin @meekojs/meeko/prettier --meeko-sort-classes stylesheet`). If the stylesheet is absent or fails, classes are only normalized and stderr warns once. In an untrusted VS Code workspace, sorting is disabled because stylesheet processing executes project code. The `prettier --cache` cache does not know about the stylesheet: after changing it, run the CLI without `--cache`. See [Sorting by the global stylesheet](editors.md#ordering-by-the-global-stylesheet).

## Errors

### Global browser failures

While the application is mounted, `mountClientApp` listens for `error` and `unhandledrejection` on `window`. Uncaught exceptions and unhandled promise rejections in code outside Meeko (a throwing `setTimeout`, `fetch().then()` without `catch`, a library) reach `onError` and plugins' `app.onError`, with new sources `"uncaught"` and `"rejection"`; without either, they reach the first active `provideErrorHandler`. What to review:

- **More failures in observers.** An `onError` sending every error to a logging service now also receives those from libraries and detached asynchronous code. The same applies to `provideErrorHandler` in `app/app.meeko` in an application without `onError`.
- **Fewer console messages.** When an observer receives a failure, Meeko calls `preventDefault()` and the browser does not repeat it in the console. If you relied on seeing it there, log it yourself from the observer. Without any observer, the browser displays it as usual.
- An error already received by a Meeko observer is not reported again, and the opaque `"Script error."` from a cross-origin script loaded without CORS is left to the console.

See [Global browser failures](framework.md#global-browser-failures).

### `ErrorSource` gains `"uncaught"` and `"rejection"`

`ErrorSource`, the browser observers' second argument, is a union Meeko delivers to the application, so according to the [stability policy](stability.md#public-api), it can gain members in a minor release. An exhaustive `switch` checking `never` stops compiling: add a default branch.

```ts
provideErrorHandler((error, source) => {
  switch (source) {
    case "navigation":
      showNavigationError(error);
      break;
    case "uncaught":
    case "rejection":
      report(error, { global: true });
      break;
    default:
      report(error);
  }
});
```

To narrow errors in these observers, which receive `unknown`, `isClientError(error, "UNAUTHENTICATED")` from `@meekojs/meeko/framework` checks a `ClientError` and its code, including one from another copy of Meeko on the page, where `instanceof` fails.

### Failures outside a request: `processErrors`

On the server, an unawaited promise inside a handler, a throwing `setTimeout` or a library callback falls outside the request's `try`. Until `1.2`, Node, Bun and Deno terminated the process on the first unhandled rejection or uncaught exception, including in `meeko dev`. Since `1.3`, `meeko dev`, `meeko build` outputs (Node, Bun, Deno and Workers), and `serveNode` and `serveDeno` with `handleSignals` apply this policy by default:

- **An unhandled rejection** reaches `onError` in `server/runtime.ts` and **the server keeps serving**.
- **An uncaught exception** reaches `onError` and the server shuts down gracefully: it stops accepting connections, waits for open responses and `waitUntil` tasks, closes the application and **exits with code 1**.

What to review:

- If deployment relied on a rejection restarting the process (a supervisor, `restart: always`), declare `processErrors: { unhandledRejection: "shutdown" }`.
- `onError` receives these failures with a third argument, `{ kind, inRequest }` (type `ServerErrorInfo`); request failures do not carry it. The ID is the request's (`x-request-id`) when the runtime retains its asynchronous context until the event; otherwise it is a new ID. Without `onError`, Meeko writes the full error to the console.
- If the application registered its own `process.on("uncaughtException" | "unhandledRejection")`, Meeko only reports to `onError` and lets the application decide.
- Cloudflare Workers has no process to close: only rejections are reported.

```ts
// server/runtime.ts
export default defineServerRuntime(() => ({
  processErrors: { unhandledRejection: "shutdown" }, // o false para el comportamiento del runtime
  onError(error, requestId, info) {
    if (info) logger.fatal({ kind: info.kind, inRequest: info.inRequest, requestId }, error);
    else logger.error({ requestId }, error);
  },
}));
```

`processErrors: false` disables both cases and lets the runtime decide, as in `1.2`; `"off"` for one disables only that case. A custom host using neither `serveNode` nor `serveDeno` can apply the same policy with `handleProcessErrors(app, { close })` from `@meekojs/meeko/server`. See [Failures outside a request](framework.md#failures-outside-a-request).

## Development

### Server logs in the browser console

In `meeko dev`, anything server code writes with `console.log`, `info`, `warn`, `error` or `debug` while handling a request also appears in the browser console, grouped by request with the `server` badge, like Nuxt's `features.devLogs`. Terminal output remains the same. This exists only in development, never in `meeko build`, `meeko start` or `meeko preview`, and only reaches the browser on the same machine: requests from loopback, to a loopback host and without proxy headers, so not visitors through a tunnel such as ngrok or cloudflared either.

If an end-to-end test against `meeko dev` fails on any browser console error, it now also sees server `console.error` messages. To disable it:

```ts
// meeko.config.ts
export default defineMeekoConfig({ dev: { serverLogs: false } });
```

The HMR WebSocket port (`MEEKO_HMR_PORT`) must not be published through a tunnel: anyone connecting to it receives logs from all requests. See [Server logs in the browser console](framework.md#server-logs-in-the-browser-console).

### `.meeko/styles/main.css`

`meeko dev` writes processed `app/styles/main.css` (with resolved `@import` rules and expanded `@utilities`) to `.meeko/styles/main.css` so the editor completes generated classes. This is a new file inside `.meeko/`, which already contains other generated files: do not edit or version it. Vite does not watch it, so writing it does not reload the page; `meeko build` does not write it and `meeko clean` deletes it. Its content is not contractual, but its path stays during `1.x`, so you can name it in `"css.styleSheets"` of extensions such as HTML CSS Support. See [Processed global stylesheet for the editor](framework.md#processed-global-stylesheet-for-the-editor).

## Configuration and build

### Auto-import folders

`imports.appDirs` and `imports.sharedDirs` add, alongside `imports.serverDirs`, auto-import directories inside `app/` (with `app/` scope: browser and SSR) and `shared/` (with `shared/` scope). They are optional:

```ts
// meeko.config.ts
export default defineMeekoConfig({
  imports: {
    appDirs: ["app/services"],
    sharedDirs: ["shared/validators"],
    serverDirs: ["server/services"],
  },
});
```

When adopted, an export from those directories with the same name as another auto-import in its scope produces a collision error, as in default directories, and a `*.server.ts` in an `appDirs` directory is server code (a component using it reports `MEEK108`).

What changes without adopting them is validation: each `imports` entry must be a relative path inside its directory, without `.` or `..`, and is checked when loading `meeko.config.ts`. An invalid `serverDirs` entry (`"lib/services"`, `"../shared"`, an absolute path), rejected until `1.2` when reading auto-imports, now stops configuration loading, and therefore every command reading it, with an error naming the entry: `imports.serverDirs[0] must be a relative path inside server/: lib/services`. An `imports` value that is not an object is also an error. In a trusted workspace, the editor flags the entry with `MEEK_CONFIG`. If a script searched for the old text (`serverDir de autoimports debe ser…`), make it use the exit code. See [Auto-import directories](framework.md#auto-import-folders).

### Static site, `site`, `sitemap`, `robots` and `document.seo`

Optional and change nothing until enabled:

- **`static` adapter.** `meeko build --adapter static` (or `server: { adapter: "static" }`) writes a site for any static hosting to `.meeko/output/static/`, with each page as `<ruta>/index.html`, its payload `<ruta>/index.meeko.json` and `404.html` from `app/error.meeko`. All pages must use `render: "prerender"`, and the build fails before compilation with a list of what requires a server (`"ssr"`, `"stream"` or `"client"` pages, API, RPC, Socket, server middleware and module server handlers). See [Static site](framework.md#static-site).
- **`site`.** The public origin for absolute URLs written by the build; without it, `MEEKO_PUBLIC_ORIGIN` from the build environment is used. Does not change `Origin` checks, which still read `MEEKO_PUBLIC_ORIGIN` or `publicOrigin` at runtime.
- **`sitemap` and `robots`.** Generate `sitemap.xml` and `robots.txt` during the build, for every adapter. With `sitemap` and no origin, the build fails. If the project already has `public/sitemap.xml` or `public/robots.txt`, remove it before enabling the corresponding option: the build fails on collisions. See [`sitemap.xml` and `robots.txt`](framework.md#sitemapxml-and-robotstxt).
- **`document.seo`.** Adds `<link rel="canonical">`, `og:url`, `og:title` and `og:description` to each document. A page or layout already declaring the same tag overrides it, preserving your tags. With `canonical` or `ogUrl` enabled and no origin, `meeko build` fails. See [Canonical and Open Graph per page](framework.md#per-page-canonical-url-and-open-graph).

### CSP with hashes

`prerender/manifest.json` gains the optional `scriptHashes` field on each page, with the `'sha256-…'` sources of its inline scripts; a custom index reader must tolerate that field. `inlineScriptHashes(html)` from `@meekojs/meeko/build` and `contentSecurityPolicy(policy, hashes)` from `@meekojs/meeko/server` let you construct the header on your own host, and the `static` adapter does so with `server.contentSecurityPolicy`, `server.headers` and `server.headerFiles`. With `server.contentSecurityPolicy` on the `static` adapter, an `on*` attribute or `javascript:` URL on a page fails the build because a hash cannot allow them: use a script or the component's `on:`. `meeko start` does not add that header: for SSR pages the approach remains `DocumentOptions.nonce`. See [Hash-based CSP](framework.md#csp-with-hashes).

## Types

### `definePage` with a single signature

A new first signature, whose option is the union of `PageDefinition` and `ClientPageDefinition`, resolves calls without type arguments. With an incomplete `render`, the editor now offers `"ssr"`, `"stream"`, `"prerender"` and `"client"` instead of only `"client"`. Inference is unchanged (the `load` context by mode, `head` data and required `load` in the result), but two visible things change:

- **The error message** for `render: "client"` with `prerenderEntries` now starts with “No overload matches this call” and identifies `render`, `prerenderEntries` and `load` as incompatible. If a type test checked the old text, update it.
- **Hover** shows the new signature, with one more type parameter, `T`.

The four `1.2` overloads remain afterward for calls specifying type arguments through `D` (`definePage<P, S, D, C>(…)`, the way to type context `C`): the result remains the `render` mode's type, with required `load` if declared. A call with partial type arguments (`definePage<P>(…)` or `definePage<P, S>(…)`) still checks options by mode, but its result is now `PageDefinition<P, S, unknown, unknown>`, even if `render` is `"client"`, and `load` is optional in the type. If your code reads the result type, remove the type arguments, which are inferred from options, or specify them through `D`.

## Editor

VS Code extension `1.3.0` includes Meeko `1.3`'s language server and Prettier plugin. Visible changes:

- **CSS class completion** in `class="…"` and `bind:class` strings: classes from the component's `<style>`, other components' `<style>` without `scoped`, and `app/styles/main.css` with its local `@import` rules, plus those from `.meeko/styles/main.css` if `meeko dev` wrote it. Hover shows the rule and go to definition leads to the selector. Works in untrusted workspaces because it only reads CSS. If you used HTML CSS Support only for this, you no longer need it. See [CSS class completion](editors.md#css-class-completion).
- **Format on save:** `class` normalization, `meekoPreserveArrayBreaks` and, if requested by project Prettier configuration, `meekoSortClasses` (see [Formatting with Prettier](#formatting-with-prettier)). The extension's bundled server does not bundle Vite: with `"stylesheet"`, it loads the project's Vite and, if absent, only normalizes.
- **`MEEK107`, `MEEK108` and `MEEK109` diagnostics** on their lines, and `<script>` and template completion without server APIs (see [New diagnostics](#new-diagnostics)).
- **`imports.appDirs` and `imports.sharedDirs`** are also read in an untrusted workspace, as literal string arrays, like `imports.serverDirs`.

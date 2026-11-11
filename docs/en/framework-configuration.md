---
source-hash: 8f62493af480ea8c8be90ccd2250f3bf0341c0375a15055b3e607ad625bc756d
---

# Configure and extend an application

This guide expands [the framework overview](framework.md).

## Configuration

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	document: { lang: 'en' },
})
```

`meeko.config.ts` (or `.mts`, `.js`, `.mjs`) loads with Node. The starter already contains a valid file; change only what your application needs. Advanced options include:

- `layers` (since `1.2`): folders that contribute pages, components, auto-imports and plugins; see [Layers](#layers). `extends`, the previous name, still works as an alias.
- `modules`: names of modules created with `defineMeekoModule` (packages or paths), which configure the project through code; their options go in each module's key, such as `seo`. See [Modules](#modules).
- `imports`: auto-import folders in addition to the defaults, with the scope of their containing folder; see [Auto-imports and TypeScript](#auto-import-folders).
  - `imports.appDirs` (since `1.3`): folders inside `app/` (`"app/services"`), with `app/` scope: browser and SSR, not `shared/` or `server/`.
  - `imports.sharedDirs` (since `1.3`): folders inside `shared/` (`"shared/validators"`), with `shared/` scope: application and server.
  - `imports.serverDirs`: folders inside `server/`, exclusive to the server.
- `server`: the `meeko build` adapter; see [Build, deployment and verification](framework-deployment.md#build-deployment-and-verification).
- `document` (since `1.2`): `lang` and `<head>` entries for all documents. Modules add their own with `meeko.addHead`; `document.head` entries apply afterward, so the project's `title` wins. Since `1.3`, `document.seo` adds each page's canonical URL and Open Graph; see [Canonical URL and Open Graph per page](framework-rendering.md#per-page-canonical-url-and-open-graph). Since `1.5`, `document.idPrefix` is the ID prefix for [`useId`](api.md#stable-ids-useid) and `form.field` (`m` by default).
- `dev` (since `1.3`): `meeko dev` options. `serverLogs: false` disables [server logs in the browser console](#server-logs-in-the-browser-console).
- `devtools` (since `1.8`): `true` makes `meeko dev` mount the [Meeko DevTools panel](devtools.md#in-page-panel) on the page, without application code; `{ position: "bottom-left" }` chooses its corner. Default: `false`. It never reaches `meeko build` or `meeko start`.
- `site` (since `1.3`): the site's public URL (`"https://example.com"`, origin only). This is the origin for absolute URLs Meeko writes: `sitemap.xml`, `robots.txt` and `document.seo`. Without `site`, the build uses `MEEKO_PUBLIC_ORIGIN`. It does not change `Origin` checks, which still read `MEEKO_PUBLIC_ORIGIN` or `publicOrigin` from `server/runtime.ts` at runtime.
- `sitemap` and `robots` (since `1.3`): `sitemap.xml` and `robots.txt` generated at build time; see [`sitemap.xml` and `robots.txt`](framework-deployment.md#sitemapxml-and-robotstxt).
- `theme` (since `1.4`): light/dark theme and custom themes, without a flash, with `useTheme()`; see [Light/dark theme without a flash](framework-rendering.md#lightdark-theme-without-flashing).
- `alias` (since `1.5`): custom path aliases, or changes to `~/`, `@/`, `#shared/` and `#server/`, Meeko's defaults; see [Path aliases](#path-aliases).

Since `1.2`, `css: { scopeAttribute: "matched" }` limits the `<style scoped>` attribute to elements that a scoped selector can match; with `"all"`, the default in `1.x`, it goes on every template element. `"matched"` will become the default in `2.0`. See [Scoped styles](api.md#which-elements-receive-the-attribute), including classes added by a script through the DOM API.

Configuration runs in `meeko dev`, `meeko build` and `meeko check`. In a trusted workspace, the language server also executes it, including its modules, so lists can be built dynamically; in an untrusted workspace (or with `trusted: false`, see [editors](editors.md)), the editor does not execute project code: it reads `layers`, `extends`, `imports.appDirs`, `imports.sharedDirs` and `imports.serverDirs` as literal string arrays and, from `modules`, only literal strings that are layer folders. Since `1.5`, it also reads `alias` when it is a literal object of strings and `false`. Module auto-imports and components do not exist for that editor until you trust the workspace.

Server discovery also rejects impossible client trees. For example, it does not allow `api.users.get()` to be both a function and the parent of `api.users.get.post()`, or a procedure `rpc.users()` to be the parent of `rpc.users.get()`. The error occurs when generating the manifest and identifies both files, before initializing the client or emitting contradictory types.

`meeko routes .` discovers all sources, emits `.meeko/manifests/routes.json` and route, contract and auto-import declarations; since `1.7`, it prepares `.meeko/` just like `meeko check` (including Vite entry points, `services.d.ts` and `tsconfig.*.json`), without running TypeScript. Vite generates virtual modules from the same discovery for SSR, hydration and navigation. During development, editing an existing page or layout updates the SSR module and reloads the browser; the server keeps its session store. Existing sidecars and API/RPC handlers load from Vite when called.

When you create or delete a page, a layout, `app/app.meeko`, `app/error.meeko`, middleware in `app/middleware` or `server/middleware`, a plugin in `app/plugins`, or a module in `server/api`, `server/rpc` or `server/socket`, in the project or its layers, `meeko dev` rediscovers routes and recreates the application without restarting the process:

- Incoming requests wait for the new application, and the browser reloads.
- The Socket server reattaches to the new application; open connections close.
- The new application calls `server/runtime.ts` again, so an in-memory session store starts empty and open sessions are lost.
- If the new application cannot be created (for example, with two root layouts), Meeko logs the error and continues serving the previous one until you fix it.

When Vite restarts (after a change to an `.env` or a configuration dependency), `meeko dev` also recreates the application, with the same consequences, once the new Vite server is ready. If this coincides with creating or deleting a route, it creates only one application.

Creating, editing or deleting a `.ts` file in an auto-import folder (the defaults and, since `1.3`, those in `imports.appDirs`, `sharedDirs` and `serverDirs`) rereads the auto-import registry and invalidates modules, and the browser reloads; no restart is needed. Editing an existing Socket channel, changing `meeko.config.ts` (including `imports` lists) or editing a module's `setup` code still requires restarting `npm run dev` (module runtime files, such as plugins or components, reload like project files). Types and manifests in `.meeko/` are not regenerated in `meeko dev`: run `npm run check` to update them.

Vite's file watcher ignores all of `.meeko/` except `.meeko/generated`, the entry points it serves. As a result, `meeko check`, the language server or a build writing to `.meeko/check`, `routes`, `types`, `manifests`, `output`, `build` or generated `tsconfig.*` files while `meeko dev` runs do not reload the browser, and Vite's dependency scanner does not enter `.meeko/` either.

### Server logs in the browser console

Since `1.3`, in `meeko dev`, anything server code writes with `console.log`, `info`, `warn`, `error` or `debug` while handling a request also appears in the browser console, like Nuxt's `features.devLogs`. The terminal still shows it as usual: logs are copied, not redirected.

- **What is forwarded.** Each call is associated with its request through that request's asynchronous context, so simultaneous requests do not mix their logs. Everything executed for it counts: server and route middleware, loaders, `<script server>`, `*.server.ts` plugins, rendering, SSR `api.*` and `rpc.*` clients, API and RPC handlers and the asynchronous work they start, including `waitUntil`. Anything written outside a request (startup, the `server/runtime.ts` factory, Vite, Socket callbacks) only goes to the terminal.
- **How it arrives.**
  - The HTML document carries its render logs in `<head>`, and the browser prints them on load, in practice before hydration. The two scripts Meeko adds there carry the document nonce (the `'nonce-…'` in its `Content-Security-Policy` header or, without it, the `nonce` attribute of its scripts, written by `DocumentOptions.nonce`), so they work with a nonce-based CSP or `'strict-dynamic'`.
  - With `render: "stream"`, logs written as deferred values arrive go in the stream, after their corresponding block and always outside `#app`, which the browser hydrates.
  - Client navigation receives its data request's logs in the payload.
  - API and RPC request logs, and anything written after a response completes, arrive through Vite's HMR WebSocket. Since the requesting tab is unknown, they print in every open application tab, with the method, path and `requestId`.
- **How it looks.** Each request is a console group with the `server` badge, method, path and beginning of the `requestId` (from the `x-request-id` header), and each log has the same badge and its level (`console.warn` is a warning, `console.error` an error). Objects can be expanded as on the server: `Map`, `Set`, dates, `bigint`, circular references and class names. An `Error` shows the server stack trace, with its files and lines, and its `cause`. Functions, symbols and binary data display by name or description. Getters are not executed and proxies are not traversed. A value deeper than 8 levels, a collection with more than 100 items or text longer than 10,000 characters is truncated; a request with more than 500 logs, or more than 1 MB of logs, warns how many stayed only in the terminal.
- **No duplicates.** Each log reaches the browser once, through a single path. Meeko's existing request error report (`[meeko] request error <id>` and the error with its stack trace) also arrives through this path, once. With Vite's `server.forwardConsole`, which copies the browser console to the terminal, server logs do not return to the terminal.
- **Development only.** Neither `console` capture nor browser code exists in `meeko build`, `meeko start` or `meeko preview`: production HTML, payloads and bundles do not include them.
- **Only for the developer's browser.** Responses only carry logs if the request arrives from loopback (`127.0.0.0/8` or `::1`), with a loopback `Host` header (`localhost`, a `.localhost` subdomain, `127.x.x.x` or `[::1]`) and without proxy headers (`Forwarded`, `Via`, `X-Forwarded-*`, `X-Real-IP`, `CF-Connecting-IP`, `True-Client-IP` and similar). The `MEEKO_PUBLIC_ORIGIN` host does not count as local: a tunnel or local proxy (ngrok, cloudflared, VS Code _dev tunnels_, Tailscale) connects from loopback and publishes exactly that name, so its visitors do not receive logs even if the tunnel rewrites `Host` to `localhost`, because it adds forwarding headers. With `MEEKO_HOST=0.0.0.0` (for testing from a phone, for example), or behind a tunnel, a browser on another machine does not receive logs in its responses: its request logs print in tabs on the developer's own machine, because Meeko's HMR WebSocket only listens on `127.0.0.1`. That port (`MEEKO_HMR_PORT`) must not be exposed through a tunnel: anyone connecting to it receives logs for all requests, like a local tab.

To disable it:

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({ dev: { serverLogs: false } })
```

Typed `href` does not accept `params` for routes without parameters. For dynamic routes it requires the keys declared in the manifest; the runtime also checks their values and rejects extra keys.

`href` has two forms with the same types. `href(id, options)` uses the running application's manifest: on the server, the current request's manifest (SSR, loaders, `head`, prerendering, API, RPC and server middleware); in the browser, the one received by `mountClientApp`, from hydration until `dispose()`. This is the usual form in pages and layouts:

```ts
const link = href('/users/[id]', { params: { id: user.id }, search: { tab: 'profile' } })
```

Outside an application (for example, in a unit test without an app), the short form throws an error; pass the manifest with `href(routes, id, options)` there, which remains unchanged.

## Layers

A layer is a project folder with the same structure as the application: its `app/pages`, components and auto-imports (`app/components`, `app/composables`, `app/utils`, `app/stores`, `app/types`, `shared/` and `server/utils`) and, since `1.2`, its `app/plugins` plugins. The project's `imports.appDirs`, `sharedDirs` and `serverDirs` folders are also searched inside each layer, using the same relative path (`app/services` is `layers/base/app/services` in the `./layers/base` layer). Use layers for a shared base (design, common pages) or to split a large application into areas.

```ts
export default defineMeekoConfig({
	layers: ['./layers/base', './layers/admin'],
})
```

Source order is: the application, `extends`, `layers`, layer folders remaining in `modules` (see below), and layers added by modules with `meeko.addLayer`. Each layer needs its `app/pages` folder and a unique folder name containing lowercase letters, digits and hyphens; that name appears in diagnostics. Paths in `layers` and `extends` must live inside the project, including after resolving links.

Layer pages appear inside the project's shell: `app/app.meeko` and the application's root layout (`app/layouts/default.meeko` or `app/pages/+layout.meeko`) also wrap layer pages, and the layer's own `+layout.meeko` files nest inside. Since `1.5`, a layer's [named layouts](framework-rendering.md#named-layouts) (`layers/base/app/layouts/docs.meeko`) also serve pages in the project and other layers; see [Layouts from layers and modules](framework-rendering.md#layouts-from-layers-and-modules). If the project has `app.meeko` or a root layout, they replace the layer's equivalents; otherwise, the layer's are used. A failing layer page uses the closest `+error.meeko` in its own tree, then the layer's `app/error.meeko` and finally the project's root error page. A `404` for a URL without a route always uses the project's error page. Programmatic route modules (`RouteModule.routes()` from `composeFrameworkRoutes`) still declare their own layouts. The manifest rejects URL collisions and the registry rejects duplicate auto-import names; the diagnostic includes the conflicting files.

`extends` was the name of `layers` until `1.1` and continues working in `1.x` without a warning; its folders come before those in `layers`.

Since `1.5`, the [path aliases](#path-aliases) `~/`, `@/`, `#shared/` and `#server/` are searched in the project and then each layer, in this same order; see [Aliases in layers](#aliases-in-layers).

### Folders in `modules` (deprecated)

Until `1.1`, `modules` also listed folders containing `app/pages`, which behaved as layers. Since `1.2`, `modules` is for [modules](#modules). A `modules` string pointing to a folder with `app/pages` and no module (no `package.json` or `index.ts`) still works as a layer throughout the `1.x` series, in the same position as before. `meeko dev`, `meeko build` and `meeko check` print once per process:

```text
[meeko] Aviso: "./modules/auth" en modules de meeko.config.ts es una carpeta de layer (tiene app/pages y no es un módulo). Muévela a layers: ["./modules/auth"]; las carpetas en modules dejarán de funcionar en Meeko 2.0.
```

To migrate, move the string from `modules` to `layers`. A layer folder does not accept options: `["./modules/auth", { … }]` is an error.

## Modules

A module configures the project through code, like Nuxt modules: it adds components, auto-imports, plugins, server middleware and handlers, `<head>` entries, public files and Vite plugins, and responds to build hooks. Create it with `defineMeekoModule`, register it in `modules` by name and give it options in its own `meeko.config.ts` key, declared by its `meta.configKey`:

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	modules: ['@meekojs/i18n', '@meekojs/ui', './modules/accent'],
	i18n: { defaultLocale: 'es', catalogs: { es: 'app/locales/es.json', en: 'app/locales/en.json' } },
	ui: { defaults: { button: { shape: 'pill' } } },
	accent: { initial: 'teal' },
})
```

Nothing is imported: `meeko.config.ts` only names the modules. A string is an installed package name or a project-relative path:

- **A package** (`'@meekojs/i18n'`, with or without a subpath) resolves from the project. If the package exports the `./module` subpath (like `@meekojs/i18n`, whose root is its runtime), the module is the default export of `<paquete>/module`; otherwise, it is the root's default export (like `@meekojs/ui`).
- **A path** (`'./modules/accent'`) is a file or a folder with `package.json` (its `import`/`default` export) or with `index.ts`, `index.mts`, `index.js` or `index.mjs`.

The default export must be the result of `defineMeekoModule`. Options merge as follows: the module's `defaults`, then `config[meta.configKey]`; plain objects merge deeply and arrays are replaced. Modules run in `modules` order, one after another (Meeko awaits each `setup`), then the `ready` hook; that order determines their plugins, middleware, `<head>` entries and stylesheets. Two modules with the same `meta.name` or `meta.configKey` are an error. With `meta.compatibility.meeko` (an npm range, such as `">=1.2"` or `"^1.2.0"`), loading fails if the Meeko version is outside it.

Errors explain what is missing:

- An unresolved string: `No se encuentra el módulo de Meeko @meekojs/i18m: no es un paquete instalado ni una ruta del proyecto. ¿Quisiste decir "@meekojs/i18n"?` (or, without a similar name, how to install it).
- A package without a module: `El paquete x no es un módulo de Meeko: … debe exportar por defecto defineMeekoModule(...), en su subpath ./module o en su raíz`.
- The key of an installed module missing from `modules`, such as `i18n: { … }` without `'@meekojs/i18n'`, produces warning `MEEK127`, which indicates the missing entry: `[meeko] Aviso MEEK127: meeko.config.ts tiene la clave "i18n", que es la configKey del módulo @meekojs/i18n, pero @meekojs/i18n no está en modules, así que Meeko ignora sus opciones. Añádalo: modules: ["@meekojs/i18n"].` It is a warning rather than an error during `1.x`, because that configuration loaded (ignoring the key) until `1.7`. Any other unknown key produces the usual warning, with the most similar known key.

#### Option types without imports

Each module's key is typed even if `meeko.config.ts` imports nothing, as Nuxt does with `.nuxt/nuxt.d.ts`. The module augments `MeekoConfig` with its key (`declare module '@meekojs/meeko/framework' { interface MeekoConfig { readonly i18n?: I18nModuleOptions } }`) and Meeko writes `.meeko/types/config.d.ts`, which imports types from every module in `modules`, so the augmentation loads automatically. It is generated by `meeko dev`, `meeko check`, `meeko build` and `meeko routes`, and also by the language server in a trusted workspace when opening the project, before the first generation (it only reads `modules` strings, without executing anything).

- **`meeko check`** checks `meeko.config.ts` with those types (since `1.8`; previously only when loading failed): `i18n: { defaultLocale: 1 }` produces `TS2322` with its line and column. So does `meeko build`, which runs the same checks.
- **The editor** types the file through `.meeko/tsconfig.config.json`, referenced by the `tsconfig.json` created by `meeko init`. In a project predating `1.8`, add `{ "path": "./.meeko/tsconfig.config.json" }` to `references`. With it, the editor completes and documents the key (`i18n`, `ui`) and marks incorrectly typed options.
- **Name completion.** Inside `modules: ['…']`, the editor offers installed packages that are modules: dependencies from the project's `package.json` with the `meeko-module` keyword in their own (`"keywords": ["meeko-module"]`), plus those already listed. A published module must declare it. Any other string remains valid.

- **Module-generated types.** Declarations written by a module with `meeko.addTypeTemplate` (in `.meeko/types/modules/`, linked by `.meeko/types/modules.d.ts`) also type `meeko.config.ts` in `meeko check` and the editor. This lets a module type its options with what it discovers when running: `@meekojs/icon` generates the union of available icon names, and `icon: { include: ['lucide:chek'] }` produces `TS2820` with the suggestion `"lucide:check"`. `meeko check` runs modules before checking configuration, so the union is up to date.

The official modules `@meekojs/ui`, `@meekojs/i18n` and `@meekojs/icon` (Iconify icons resolved at compile time, with `<UIIcon>`; see [its guide](https://ui.meekojs.com/icons)) register this way.

Registration forms from before `1.8` continue working during `1.x` with warning `MEEK126`, which indicates their replacement string and key; see [Upgrade from 1.7 to 1.8](migration-1.8.md#modules-by-name).

### Write a module

`setup` runs in Node, once per configuration and process, when loading configuration: in `meeko dev`, `meeko build`, `meeko check` and the language server of a trusted workspace. It never reaches the browser. It receives the merged options and the `meeko` object. Paths received by `meeko` can be absolute, `file:` URLs (`new URL("./x", import.meta.url)`, typical in a package) or relative to the project root.

An accent color module, chosen by the user and applied before rendering (no module is needed for light/dark themes: Meeko includes them since `1.4`, see [Light/dark theme without a flash](framework-rendering.md#lightdark-theme-without-flashing)):

```ts
// modules/accent/index.ts
import { defineMeekoModule } from '@meekojs/meeko/framework'

export type Accent = 'teal' | 'violet' | 'amber'

export interface AccentOptions {
	initial: Accent
	storageKey: string
}

// Types the `accent` key in meeko.config.ts.
declare module '@meekojs/meeko/framework' {
	interface MeekoConfig {
		readonly accent?: Partial<AccentOptions>
	}
}

export default defineMeekoModule<AccentOptions>({
	meta: { name: '@acme/meeko-accent', configKey: 'accent', compatibility: { meeko: '>=1.2' } },
	defaults: { initial: 'teal', storageKey: 'accent' },
	setup(options, meeko) {
		const here = (path: string) => new URL(path, import.meta.url)
		// <AccentPicker /> in any component, without an import.
		meeko.addComponentsDir(here('./components'), { prefix: 'Accent' })
		// useAccent() without an import, in components and app/.
		meeko.addAutoImports({ name: 'useAccent', from: here('./runtime/use-accent.ts') })
		// Expose the accent signal before hydration; options are passed to the plugin.
		meeko.addPlugin({ src: here('./runtime/accent.plugin.ts'), options: { initial: options.initial, storageKey: options.storageKey } })
		// Apply the saved accent before painting, without flicker.
		meeko.addHead({
			script: [{ key: 'accent', children: `document.documentElement.dataset.accent = localStorage.getItem(${JSON.stringify(options.storageKey)}) ?? ${JSON.stringify(options.initial)};` }],
		})
	},
})
```

```ts
// modules/accent/runtime/use-accent.ts
import { createContext, inject } from '@meekojs/meeko'
import type { Signal } from '@meekojs/meeko'
import type { Accent } from '../index.ts'

export const accentKey = createContext<Signal<Accent>>('accent')

export function useAccent(): Signal<Accent> {
	return inject(accentKey)
}
```

```ts
// modules/accent/runtime/accent.plugin.ts
import { effect, signal } from '@meekojs/meeko'
import { definePlugin } from '@meekojs/meeko/framework'
import type { Accent } from '../index.ts'
import { accentKey } from './use-accent.ts'

export default definePlugin<{ initial: Accent; storageKey: string }>((app, options) => {
	// The same initial value on the server and in the browser, so hydration matches.
	const accent = signal(options.initial)
	app.provide(accentKey, accent)
	if (app.side === 'client') {
		let first = true
		effect(() => {
			const value = accent.value
			// The <head> script has already applied the saved accent; each subsequent change is applied and saved.
			if (first) {
				first = false
				return
			}
			document.documentElement.dataset.accent = value
			localStorage.setItem(options.storageKey, value)
		})
	}
})
```

An SEO module generates `sitemap.xml` from routes, and `robots.txt`:

```ts
import { defineMeekoModule } from '@meekojs/meeko/framework'

export default defineMeekoModule<{ siteUrl: string }>({
	meta: { name: '@acme/meeko-seo', configKey: 'seo' },
	setup(options, meeko) {
		let routes: readonly { id: string }[] = []
		meeko.hooks.hook('routes:resolved', (context) => {
			routes = context.routes
		})
		meeko.addPublicFile('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${options.siteUrl}/sitemap.xml\n`)
		// A function is evaluated when writing the build (and on each request in dev), with routes already discovered.
		meeko.addPublicFile('sitemap.xml', () =>
			[
				'<?xml version="1.0" encoding="UTF-8"?>',
				'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
				...routes.filter((route) => !route.id.includes('[')).map((route) => `<url><loc>${options.siteUrl}${route.id}</loc></url>`),
				'</urlset>',
			].join('\n'),
		)
	},
})
```

A module's runtime files (plugins, components, auto-imports, middleware and handlers) are processed by Vite like project files, but outside application folders they receive no auto-imports: import them explicitly. `.meeko` components from `addComponentsDir` do receive the project's auto-imports.

### The `meeko` object

| Member                                         | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rootDir`, `dev`, `config`                     | Project folder, `true` in `meeko dev`, and loaded configuration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `addLayer(dir)`                                | Adds a layer after those in `layers`. It must have `app/pages` and be inside the project; a package installed in `node_modules` is inside it, including with pnpm.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `addComponentsDir(dir, { prefix?, exclude? })` | Automatically imports `.meeko` files from the folder and its subfolders, using a PascalCase name after the prefix (`components/picker.meeko` with `prefix: "Accent"` is `AccentPicker`). `exclude` accepts globs relative to that folder, such as `['internal/**', '**/*.private.meeko']`: excluded files do not enter `ComponentName`, loaders or generated global types, but remain available through explicit imports.                                                                                                                                                                                                                                                      |
| `addLayout(name, file)`                        | Since `1.5`, adds a [named layout](framework-rendering.md#named-layouts), like an `app/layouts` file: `meeko.addLayout("docs", here("./docs-layout.meeko"))`. The file must be inside the project. A project or layer layout with the same name wins; two modules with the same name are an error.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `extendRoutes(fn)`                             | Since `1.8`, transforms the discovered route manifest (application, layers and modules) before it is used by the server, browser, prerendering, sitemap and types. `fn(routes)` returns the complete list: it can add routes reusing a page file (`{ ...route, id: "/en" + route.id }`, as `@meekojs/i18n` does), change them or remove them. Transformations apply in module order and the result is validated as a manifest: a URL collision is an error with the module name.                                                                                                                                                                                               |
| `addAutoImports(entries)`                      | Automatically imports package or file exports: `{ name, as, from, type?, scope?, componentOnly? }`; `scope` defaults to `"app"` (components and `app/`, in the browser and SSR), or is `"client"`, `"server"` or `"shared"`. With `componentOnly: true` and `scope: "app"`, the name is offered in components and `app/` modules that can run in the browser, but not in `<script server>` or `server/`.                                                                                                                                                                                                                                                                       |
| `addAutoImportsDir(dir, { scope })`            | Automatically imports exports from a folder's `.ts` files, with `"app"`, `"server"` or `"shared"` scope; `.client.ts`, `.server.ts` and `.shared.ts` suffixes take precedence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `addPlugin({ src, mode?, options? })`          | Adds an [application plugin](#application-plugins). `mode` comes from the file suffix or is `"universal"`. `options` must be JSON and reaches the browser if the plugin runs there.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `addServerMiddleware(file)`                    | Adds middleware like those in `server/middleware`; module middleware runs before project middleware.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `addServerHandler({ route, handler })`         | Handles an exact route with the default export of `handler`, `(request) => Response`, after server middleware.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `addPublicFile(path, contents, options?)`      | Adds a public file. Since `1.8`, `options.headers` adds headers to its response in `meeko dev` and on the adapters with a server; for example, `Access-Control-Allow-Origin` on a font that an `<iframe sandbox srcdoc>` uses. In production they act like `server.headers` for that path, which wins if it sets the same one. In `meeko dev`, public files do not go through the application: they carry only these headers, and `server.headers` does not affect them. The `static` adapter does not write them. `meeko build` writes it to client output before calculating the asset manifest; `meeko dev` serves it. It conflicts with a `public/` file of the same name. |
| `addStylesheet(file)`                          | Registers a `.css` file processed by Vite and the project's PostCSS. It accepts a path relative to `rootDir` or a module file URL. Stylesheets are deduplicated by real file and keep registration order; `app/styles/main.css` loads last. Includes HMR, import and asset resolution, CSS in SSR HTML and hashed production assets.                                                                                                                                                                                                                                                                                                                                           |
| `addHead(input)`                               | Adds entries to `document.head`: `meta`, `link`, `script` and `style` concatenate in module order; `title`, `titleTemplate`, `htmlAttrs` and `bodyAttrs` keep the last value; the project's `document.head` applies last. It receives a `DocumentHead`: `titleTemplate` is a string, and `title` is the site title without a template.                                                                                                                                                                                                                                                                                                                                         |
| `addVitePlugin(plugin)`                        | Adds a Vite plugin to `meeko dev` and each `meeko build` build step, after Meeko's plugin.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `extendViteConfig(fn)`                         | Modifies each step's inline Vite configuration; `fn(config, { command, ssr })` changes the object or returns another one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `hooks.hook(name, fn)`                         | Registers a [hook](#hooks).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `warn(message)`                                | Prints a warning with the module name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

A custom Vite host that only uses the `meeko()` plugin receives module auto-imports, components, layers and application plugins, but not their `addVitePlugin`, `extendViteConfig`, public files or hooks: those are applied by `meeko dev` and `meeko build`.

Meeko has no separate `runtimeConfig`: a module passes values to its runtime through `addPlugin` `options` (public if the plugin reaches the browser), and secrets are read on the server from environment variables or `server/runtime.ts`.

### Hooks

| Hook               | When                                                                                          | Context                                                                                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ready`            | All modules have finished their `setup`.                                                      | —                                                                                                                                                                                                                            |
| `routes:resolved`  | Before the client build in `meeko build`; at startup and on every rediscovery in `meeko dev`. | `{ routes }`, the manifest with absolute file paths.                                                                                                                                                                         |
| `build:before`     | At the start of `meeko build`.                                                                | `{ adapter, output }`, the adapter's absolute folder.                                                                                                                                                                        |
| `prerender:routes` | Before prerendering, in `meeko build` and `meeko prerender`.                                  | `{ urls }`: the `pathname` values to prerender; the hook can add or remove entries, which must match a route.                                                                                                                |
| `sitemap:resolved` | Since `1.8`, in `meeko build` with `sitemap`, before writing `sitemap.xml`.                   | `{ urls }`: sorted URLs (`{ pathname, lastmod?, changefreq?, priority?, alternates? }`); the hook can replace, add or remove them. Each `alternates: [{ hreflang, pathname }]` is written as `<xhtml:link rel="alternate">`. |
| `build:done`       | When `meeko build` finishes, including prerendering.                                          | `{ adapter, output }`; the module can write more files to `output`.                                                                                                                                                          |

Hooks run in registration order, and Meeko awaits each one. `hook()` returns a function that removes it.

### Application plugins

Files in `app/plugins` (in the application and its layers) and those added by modules run when the application starts. Each one exports `definePlugin` by default:

```ts
// app/plugins/analytics.client.ts
import { definePlugin } from '@meekojs/meeko/framework'

export default definePlugin((app) => {
	effect(() => navigator.sendBeacon('/api/visits', app.route.path.value))
	app.onError((error, info) => console.error('[app]', info.side, error))
})
```

- **Where.** `*.client.ts` only in the browser, once, before hydration. `*.server.ts` only on the server, once per page request, before rendering (also during prerendering; not on already prerendered pages, or in API, RPC or handlers). An unsuffixed `.ts` runs in both. Only files directly inside `app/plugins` count; subfolders can hold their helpers. `*.test.ts`, `*.spec.ts` and `*.d.ts` are excluded.
- **Order.** Module plugins, in the order they are added; then each layer's and the application's, by filename. Meeko awaits each `setup`, which can be asynchronous.
- **`app.provide(key, value)`.** Publishes a value for all application components, which read it with `inject(key)` (and any composable wrapping it): pages, layouts, `app.meeko`, the error page and pages navigated to in the browser. On the server, the value belongs to that request: do not share mutable state between requests. A hydrating component must receive the same value on the server and in the browser; that is why rendered values usually come from a universal plugin.
- **`app.onError(handler)`.** In the browser, the observer receives the same as `mountClientApp({ onError })` (navigation, Socket and events, effects and cleanups without a closer `provideErrorHandler` and, since `1.3`, the page's global exceptions and rejections; see [Errors](framework-server.md#errors)), with `{ side: "client", source }`. On the server, it receives that request's render failures with `{ side: "server", requestId }`, in addition to `onError` in `server/runtime.ts`.
- **`app.resolveLink(resolver)`.** Since `1.8`, receives every `<MeekoLink>` in the application (`{ to, href, hreflang }`: the route ID, the `href` built by `href()` and the link's `hreflang`) and returns its final `href`; `aria-current` is computed from that `href`. Multiple resolvers are chained in plugin order. It runs when the link renders on the server, during hydration and during client navigation, so it must be pure: the same link produces the same `href` on both sides. `@meekojs/i18n` uses it for the language prefix; see [`<MeekoLink>`](framework-rendering.md#meekooutlet--and-meekolink).
- **`app.route`.** The route, like `useRoute()`. On the server it is the request's route; in the browser it follows the confirmed route, so an `effect` that reads it reruns on navigation. `app.request` is the request on the server and `undefined` in the browser; `app.side` tells you where it runs.
- **Failures.** A plugin throwing on the server fails the request, which shows the error page without plugin values. In the browser, hydration never starts and the page keeps the server HTML.

A custom host passes plugins to `mountClientApp({ plugins })` and `createServerApp({ plugins })` or `createFrameworkHandler({ plugins })` as `PluginRegistration`s (`{ plugin, options?, name? }`).

### Server and client boundaries

A module's `setup` and its entry point never reach the browser bundle, nor do its `"server"` plugins, middleware, handlers, auto-import folders with `scope: "server"` or `*.server.ts` files in module folders. Meeko's Vite plugin rejects the build if the client graph reaches them (`Server-only module reached the client bundle`), or if a file loaded by the browser imports `defineMeekoModule` (`Meeko module setup reached the client bundle`): only `meeko.config.ts` should import modules. Options for a plugin that runs in the browser do travel in the client bundle.

## Auto-imports and TypeScript

The `.meeko` components in configured directories also form a [registry typed by name](reference/components/componentregistry.md): `ComponentName`, `ComponentOf<Name>` and `ComponentProps<Name>` describe the discovered modules, and `resolveComponent(name)` loads them asynchronously. `resolveComponent(name, props)` also lets you associate their props and returns a `ResolvedComponent<Name>` rendered directly with `<component is>`. The guide covers configuration, layers, modules and the SSR limitations of lazy loading.

**Extensionless imports.** Since `1.2`, Meeko checks types with `"module": "ESNext"` and `"moduleResolution": "Bundler"`, like Vite and Nuxt: a relative import needs no extension (`import { format } from "../utils/format"`), because Vite resolves and bundles all code in `meeko dev` and `meeko build`, and Node never executes a `.ts` directly. Imports with `.js` still work. `meeko init-framework` generates `tsconfig.json` with these values; an older project can change its two lines `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` so the editor also accepts extensionless imports in its `.ts` files.

Meeko analyzes AST exports from `app/{components,composables,utils,stores,types}` (`app/types` since `1.2`), `shared/{types,schemas,utils,constants,enums}` and `server/utils`: their named exports, never an `export default` (`export default function formatPrice()` is not auto-imported; write `export function formatPrice()`). Types used only by the application go in `app/types`; types shared by the application and server go in `shared/types`. An auto-imported `type` or `interface` arrives with `import type`. Symbols from `app/` are available on the client and in SSR, but not from `shared/`; the `.client.ts` and `.server.ts` suffixes restrict a module to its environment. `imports.serverDirs` adds private server-only directories and, since `1.3`, `imports.appDirs` and `imports.sharedDirs` add folders from `app/` and `shared/` (see [Auto-import folders](#auto-import-folders)). The framework symbols `api`, `rpc`, `socket`, `useSocket`, `useApi`, `useRpcQuery`, `useRpcMutation`, `useState`, `href` and `useRoute`, since `1.2` `useForm`, `useStorage`, `useApiMutation`, `useHead`, `useSeoMeta`, `definePage`, `defineRouteMiddleware` and `definePlugin`, since `1.4` `useTheme` (`definePage` only takes effect in `<script server>` and sidecars: in a component's `<script>` it produces warning `MEEK109`), and in server code (`server/` and `<script server>`) `defineApiRoute`, `defineRpc`, `defineServerMiddleware`, `defineSocketChannel`, `defineServerRuntime` and `ApiError` (and, since `1.6`, `defineServerRouteMiddleware`, also auto-imported in `*.server.ts`; since `1.7`, `defer`, also in `*.route.ts` sidecars and within route options), and from the root `signal`, `computed`, `effect`, `batch`, `untrack` (since `1.2`), `onCleanup`, `onMounted`, `provide`, `inject`, `createContext` and `provideErrorHandler`, also appear in the registry, with `useNavigation` and `createRoot` since `1.7`; your own export named `useRoute`, `useForm`, `useStorage`, `useApiMutation`, `useHead`, `useSeoMeta`, `useTheme` or, since `1.6`, `defineServerRouteMiddleware` and, since `1.7`, `useNavigation`, `createRoot` or `defer` takes priority over the framework's. `redirect` and `notFound` are not auto-imported outside `<script server>`, including in `app/middleware/*.server.ts`: their types would be global throughout the `server` project, including APIs, where they would fail at runtime with `MEEK073`. Explicit imports take precedence. A collision produces an error; file order never decides the winner. An auto-imported `enum` or class also works as a type, with its members (`Scope.App`); if a file only uses it as a type, Meeko inserts `import type`. Schemas from `shared/schemas` can reach API, RPC and Socket contracts through auto-imports. `meeko check` checks the `.ts` files imported by a `.meeko` with their scope's auto-imports and generated routes, just like the `tsconfig.*` projects.

<a id="auto-import-folders"></a>**Auto-import folders.** Each folder is read recursively, in the project and in each layer; its `.ts` and `.mts` files contribute exports (excluding `*.test.ts`, `*.spec.ts` and `*.d.ts`), and `.meeko` files are only components in `app/components` and module component folders. Export names are flat: the subfolder is not added to the name, unlike components (`App/Card.meeko` is `AppCard`). `export function total()` in `app/utils/cart/total.ts` is `total`, not `CartTotal`, and two files that export `total` in a scope are the duplicate name error, even in different folders. A `.mts` contributes its exports like a `.ts`. A `.cts` only works for types: `export type` works, but a value with `export` gives `TS1287` in `meeko check` and `meeko build` and makes the page respond `500` in `meeko dev`, and `export =` contributes no name. A file without a suffix takes the scope of its containing root folder; `.client.ts`, `.server.ts` and `.shared.ts` override it:

| Folder                                                                               | Scope     | Available in                                                                                                               |
| ------------------------------------------------------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `app/components`, `app/composables`, `app/utils`, `app/stores`, `app/types`          | `app/`    | Components and `.ts` files in `app/`, in the browser and in SSR; also in `server/` and `<script server>`. Not in `shared/` |
| `imports.appDirs` (since `1.3`), e.g. `"app/services"`                               | `app/`    | Same as the `app/` folders above                                                                                           |
| `shared/types`, `shared/schemas`, `shared/utils`, `shared/constants`, `shared/enums` | `shared/` | The entire project                                                                                                         |
| `imports.sharedDirs` (since `1.3`), e.g. `"shared/validators"`                       | `shared/` | The entire project                                                                                                         |
| `server/utils` and `imports.serverDirs`, e.g. `"server/services"`                    | `server/` | `server/`, `<script server>` and sidecars; in a component, `MEEK108`                                                       |

Each option only accepts relative paths within its folder (`appDirs` within `app/`, `sharedDirs` within `shared/`, `serverDirs` within `server/`), with `/` or `\` and without `.` or `..`: any other path stops `meeko dev`, `meeko build` and `meeko check` with a `meeko.config.ts` error naming the entry (`imports.appDirs[1] debe ser una ruta relativa dentro de app/: …`), which the editor marks on that entry in a trusted workspace (`MEEK_CONFIG`). A folder already covered by auto-imports (`"app/composables"`) or contained within another listed folder is not read twice. Exports from these folders follow the same rules as those from the default folders: `import type` for `type` and `interface`, priority over framework auto-imports and an error if two files export the same name in a scope. A `*.server.ts` in an `appDirs` folder belongs to the server, and a component using it produces `MEEK108`.

<a id="folder-with-index"></a>**A folder with `Index.meeko`.** Since `1.8`, `Button/Index.meeko` (or `index.meeko`) takes the name of its folder: `<Button>`, also in `resolveComponent("Button")`, in `is` with names and in its types. This applies in `app/components`, in layers and in module folders with their prefix (`UIButton`). An `Index.meeko` at the root of the folder has nowhere to take a name from and stays `<Index>`. The previous name, `<ButtonIndex>` with its types, keeps working in `1.x` with the `MEEK134` warning and is removed in `2.0`; the editor no longer offers it, and a component that really has that name keeps it. That warning comes from compiling a `.meeko`: outside one, `meeko check` does not warn, so `ButtonIndexProps` in a `.ts` simply compiles, with the `@deprecated` mark of its declaration.

If `Button.meeko` and `Button/Index.meeko` both exist, also in different sources, nothing changes file: `Button.meeko` keeps `<Button>` and `Button/Index.meeko` keeps `<ButtonIndex>`, not marked as deprecated because it is its only name, with its types and in `resolveComponent` and `is`. The `MEEK135` warning, on that `Index.meeko`, explains the conflict and suggests renaming or moving one of them.

A name that already existed does not change file with a nested `Index` either. With `Button/Index.meeko` and `Button/Index/Index.meeko`, the first is `<Button>` and keeps `<ButtonIndex>` with `MEEK134`, and the second remains `<ButtonIndexIndex>`, not marked as deprecated, because `<ButtonIndex>` belonged to the first. The `MEEK135` warning, on the inner file, says which file keeps each name and suggests renaming or moving one of them.

<a id="component-types"></a>**Types for each component.** Since `1.4`, each auto-imported component (`.meeko` files in the project's and its layers' `app/components`, and in module component folders) also contributes several types named after its tag, without an import: the component name, following the same rule as the tag and including the module prefix, followed by `Props` (since `1.8`, without the callbacks of `defineEmits`), `Emits` (since `1.8`), `Snippets`, `Models` or `Exposed`. A component from a package published before `1.8` gives the ones its `.d.meeko.ts` exports: its `Props` is its `ComponentProps`, with the callbacks, and it has no `Emits`.

| Component                                                       | Tag              | Types                                                                                |
| --------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------ |
| `app/components/App/Card.meeko`                                 | `<AppCard>`      | `AppCardProps`, `AppCardEmits`, `AppCardSnippets`, `AppCardModels`, `AppCardExposed` |
| `app/components/Button/Index.meeko`                             | `<Button>`       | `ButtonProps`, `ButtonEmits`, `ButtonSnippets`, `ButtonModels`, `ButtonExposed`      |
| `app/components/user-menu.meeko`                                | `<UserMenu>`     | `UserMenuProps`, `UserMenuSnippets`, `UserMenuModels`, `UserMenuExposed`             |
| `components/picker.meeko` from a module with `prefix: "Accent"` | `<AccentPicker>` | `AccentPickerProps`, `AccentPickerSnippets`, …                                       |

- **What they are.** Exactly the component module's `ComponentProps`, `ComponentSnippets`, `ComponentModels` and `ComponentExposed` (see [Generated module](api.md#generated-module)), with their type parameters for a generic component (`DataTableProps<User>`). A component without `defineSnippets`, `defineModel` or `defineExpose` yields `null` for the corresponding type, just like its module: the alias does not become `{}`, so the tag-based name and the generic never differ and `null` still distinguishes a component that does not declare the channel. With `null`, `Omit<PlainSnippets, "x">` is `{}`, but `PlainSnippets & { … }` is `never`: reuse snippets from a component that declares them.
- **Where.** With the same scope as the component: in the `<script>` and template of `.meeko` files and in `app/` `.ts` files (and, like components, in `server/` and `<script server>`), never in `shared/`, where they produce `TS2304` like any `app/` symbol. They arrive as `import type` from the `.meeko`, so they add no code to the bundle.
- **Priority.** A project auto-import with the same name wins without a warning, like your own export named `useRoute` over the framework's: if `app/types` exports `AppCardProps`, that is the `AppCardProps` throughout the project. An import or declaration in the file takes precedence, as always.
- **Built-in tags.** Meeko tags likewise contribute their props type, with the same scope and priority, from the public exports of `@meekojs/meeko/framework`: `MeekoLinkProps` for `<MeekoLink>`, `MeekoOutletProps` for `<MeekoOutlet />` and `MeekoThemeToggleProps` for `<MeekoThemeToggle>` (see [`<MeekoOutlet />` and `<MeekoLink>`](framework-rendering.md#meekooutlet--and-meekolink)). They arrive as `import type { MeekoLinkProps } from "@meekojs/meeko/framework"`. A project component replacing the tag (`app/components/MeekoLink.meeko`, with warning `MEEK106`) contributes its own types under that name, like any component: its `MeekoLinkProps` describes its own props, not those of the Meeko tag.
- **Editor and `meeko check`.** They use the same registry: the types are declared in `.meeko/types/autoimports/client.d.ts` (and `server.d.ts`) alongside the component; the language server completes them where you write a type, and hover and go to definition lead to the component, to the macro declaring each type (`defineSnippets` for `AppCardSnippets`).

With these types, a component reuses another's snippets without an import: `defineSnippets<Omit<AppCardSnippets, "footer"> & { actions?: [close: () => void] }>()` (see [Snippets with `defineSnippets`](api.md#snippets-with-definesnippets)).

Regular `.ts` files in `app/` (composables, utils, stores) run in SSR and in the browser, like the `.meeko` files using them, and their framework auto-imports (`api`, `rpc`, `socket`, `useSocket`, `useApi`…) resolve by environment: the server client in SSR and the browser client in the browser. Before `1.1` they always used the browser client, and `meeko dev` or `meeko build` failed with “Client-only module reached the server bundle”. A `.client.ts` remains browser-only.

**`.client.ts` modules in `app/`.** A `.meeko` is compiled twice, for SSR and for the browser, so it cannot use a symbol from a `.client.ts` or import it statically: `meeko check` and the build reject it (“unavailable in server scope”, “Client-only module reached the server bundle”). Load it with `import()` inside code that only runs in the browser (an event handler or an `effect`) and guard it with `import.meta.env.SSR`, which the server build replaces with `true` and uses to eliminate that import:

```ts
async function exportCsv(): Promise<void> {
	if (import.meta.env.SSR) return
	const { downloadCsv } = await import('../utils/download.client.js')
	downloadCsv(rows.value)
}
```

A `.client.ts` can be imported normally from other `.client.ts` files.

**Stores (`app/stores`).** This is an auto-import folder like `app/composables`; Meeko does not define a store API. A `signal` created at module level lives for the lifetime of the process, so on the server all requests and users share it. For application state, use `useState(key, init)` inside the store function: it is per-request in SSR, transferred to the browser in the payload and shared between components in the browser:

```ts
// app/stores/cart.ts
export function useCart() {
	const items = useState('cart:items', (): string[] => [])
	const add = (id: string): void => {
		items.value = [...items.value, id]
	}
	return { items, add }
}
```

The `.meeko` compiler and `.ts` transformation insert real ESM imports. Per-scope declarations regenerate under `.meeko/types/autoimports/` only when content changes, for completion and go to definition. Re-exported generic types retain parameters, constraints and defaults; overload signatures of the same symbol are registered only once, while a collision between different origins still fails. The language server uses the same registry and the compiler's AST positions. The app, server and shared projects generated by `meeko check` also apply `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` and `verbatimModuleSyntax`. `shared/` cannot depend on app or server symbols; the client bundle rejects `server/` modules, including transitive imports. `*.route.ts` files belong to the server scope.

When migrating code that did not use these strict options, change imports used only as types to `import type`, check the result of indexed accesses before using it and add `| undefined` only when absence is a real part of the contract. Do not silence diagnostics by widening props or public contracts to `any`: Meeko uses these types to generate the client, validate the server and keep the CLI and editor consistent.

## Path aliases

Since `1.5`, Meeko defines four path aliases without configuration. They work the same in Vite (`meeko dev` and `meeko build`, in the browser and in SSR, with every adapter: `node`, `bun`, `deno`, `cloudflare` and `static`), in the `tsconfig` files Meeko generates (`.meeko/tsconfig.app.json`, `server` and `shared`, used by `meeko check` and the editor) and in [`@utilities`](#generated-utilities-with-typescript) modules and their imports (except with `meekoUtilities({ autoImports: false })`, which does not read the configuration):

| Alias      | Points to        | Where you can use it                                                                                              |
| ---------- | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| `~/`       | The project root | The entire project                                                                                                |
| `@/`       | `app/`           | `app/` (components, pages and `.ts` files, which run in the browser and in SSR) and server code; not in `shared/` |
| `#shared/` | `shared/`        | The entire project                                                                                                |
| `#server/` | `server/`        | Server code only: `server/`, `*.server.ts`, `*.route.ts` sidecars and `<script server>`                           |

`~/` is the root and `@/` is `app/`: the reverse of Nuxt, deliberately. `~/app/utils/price` and `@/utils/price` are the same module.

```ts
// app/pages/products/[id].route.ts
import { findProduct } from '#server/products'
import { productSchema } from '#shared/schemas/product'

export const route = definePage({ load: ({ params }) => productSchema.parse(findProduct(params.id)) })
```

```html
<!-- app/pages/products/[id].meeko -->
<script lang="ts">
	import { formatPrice } from '@/utils/price'
	import * as ProductCard from '@/components/catalog/ProductCard.meeko'
</script>
```

You can also import a component with an alias (`@/components/Card.meeko`); `MEEK033` still flags a `.meeko` import that is neither relative nor an alias.

Schemas for [API and RPC](framework-api.md#api-and-rpc) and [WebSocket](framework-websocket.md#websocket) contracts can also be imported with an alias: `import { loginInput } from "#shared/schemas/auth"` in `server/api/auth/login.post.ts`, or with your own alias pointing to a `shared/` folder. The contract generator resolves the alias like `meeko check` and Vite, and generated clients (`api`, `rpc`, `socket`) name the `shared/` file by its path, without the alias. The rule is the same as with a relative path: the file must be in the project's `shared/`, so an alias pointing to another folder still produces `body debe venir de shared/`.

### Alias scopes

Each alias has the scope of its target folder, like [auto-imports](#auto-import-folders): `#server/` only exists in the generated `tsconfig.server.json`, `@/` does not exist in `tsconfig.shared.json` (because `shared/` cannot see `app/`) and `~/` and `#shared/` exist in all three. Using one outside its scope is a clear error, before TypeScript says the module does not exist:

- `#server/` in a component (its `<script>` or template), in an `app/` `.ts` or in `shared/` produces `MEEK108` in `meeko check`, the editor and the browser build, including with `import type`. To read a server type, use `~/server/…`, which exists in every scope; a value import from `server/` with `~/` (or a relative path) still produces `MEEK108`, as it has since `1.3`.
- `@/` in `shared/` (or a `*.shared.ts`) produces the new error `MEEK118` in `meeko check`, `meeko dev` and the build. Move that code to `shared/` or use the alias from `app/` or the server.

In the SSR graph, `meeko dev` and `meeko build` still load a `#server/` from `app/` used only by the server (an email template in `app/emails/` rendered by an API route), just like a relative import from `server/`; `meeko check` still flags it.

In the editor, aliases complete folders and files after `~/`, `@/`, `#shared/` and `#server/` (the latter in `<script server>`), and “Go to Definition” leads to the module. In `.ts` files, the editor's TypeScript server uses the generated `tsconfig` files: a `#server/` in `app/` appears there as a missing module, and `meeko check` gives it its `MEEK108`.

### Custom aliases: `alias`

`alias` in `meeko.config.ts` adds aliases or changes Meeko's. Each key is a prefix ending in `/` and each value is a project folder relative to its root (including a layer's folder), or `false` to remove the alias:

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	alias: {
		'ui/': 'app/components/ui/',
		'db/': 'server/db/',
		'#server/': false,
	},
})
```

- **Scope.** That of its target folder, following the same rule as Meeko's aliases: within `server/`, only in server code (`db/` in a component produces `MEEK108`); within `app/`, in `app/` and on the server, not in `shared/` (`MEEK118`); in any other folder (`shared/`, the root, `lib/`), throughout the project.
- **One folder only.** A custom alias points exactly to its folder; it does not search layers like Meeko's aliases. Changing one of Meeko's (`"@/": "src/"`) turns it into a custom alias, with its new folder's scope.
- **Validation.** A key without a trailing `/`, with spaces, `*` or `\`, or starting with `.` or `/`, and a value that is neither a relative path within the project nor `false`, stop `meeko dev`, `meeko build` and `meeko check` with a `meeko.config.ts` error (`alias "lib" debe ser un prefijo que termine en / …`), which the editor marks on `alias` in a trusted workspace (`MEEK_CONFIG`). A folder that does not exist is not an error: the import fails during resolution.
- **Where it applies.** In Vite, generated `tsconfig` files, the editor and `@utilities`, like Meeko's aliases. In an untrusted workspace, the editor reads `alias` without executing the configuration only if it is an object literal of strings and `false`; otherwise, it uses the default aliases.

Node loads `meeko.config.ts` directly, without Vite: the configuration and its imported modules cannot use aliases.

### Aliases in layers

Meeko's aliases search the project and then each layer, in source order (see [Layers](#layers)); the first existing file wins. Thus, in a `layers/base` file, `@/lib/format` is `layers/base/app/lib/format.ts` unless the project has `app/lib/format.ts`; if it does, the project's file wins, just as its `app.meeko` and root layout replace the layer's. To target the layer's own file, use a relative path.

They do not resolve against the importing layer's `app/` because TypeScript `paths` apply to a whole project, not each file: with this rule, Vite, `meeko check`, the editor and `@utilities` always choose the same file. Generated `tsconfig` files declare this with a list of folders per alias (`"@/*": ["../app/*", "./types/app/*", "../layers/base/app/*", …]`, where `./types/…` contains component declarations).

### Alias priority and conflicts

- **`paths` in the project's `tsconfig.json`.** Your own pattern with a Meeko alias prefix pointing to another folder (`"@/*": ["./src/*"]`) wins and disables that Meeko alias throughout the project: in the editor, `meeko check`, generated `tsconfig` files (which since `1.5` also copy the project's `paths`), `meeko dev` and `meeko build`, and scope checks (`MEEK108` and `MEEK118`), so importing `@/utils` from `shared/` is no longer an error. `meeko dev`, `meeko build` and `meeko check` warn about it once per process. A pattern with the same folders as Meeko's does not disable it. Vite does not read these `paths`: for the build to resolve that prefix, also define it with `alias` (`alias: { "@/": "src/" }`, which with the same folder does not count as a redefinition) or with a `resolve.alias`.
- **Vite's `resolve.alias`.** The `resolve.alias` of a Meeko module (`meeko.extendViteConfig`) or a custom Vite host applies before Meeko's aliases. If it covers a whole Meeko prefix (`{ find: "@", replacement: … }` or a regular expression like `/^@\//`), it also disables Meeko's alias for that prefix and its scope checks, with the same warning; one covering only some specifiers (`/^@\/lib\/label$/`) wins for those and leaves Meeko's for the rest. The editor, which does not execute modules, cannot see a module's `resolve.alias`: to make them match, disable the alias with `alias: { "@/": false }`.
- **`imports` in `package.json`.** Meeko aliases starting with `#` do not conflict with Node's [_subpath imports_](https://nodejs.org/api/packages.html#subpath-imports) as long as the project does not declare them. If your `package.json` has an `"imports"` entry starting with `#shared/` or `#server/` (or a pattern like `"#*"`), yours wins: Meeko does not define that alias anywhere (neither in Vite nor in `tsconfig` files) and warns once per process. To remove the warning, disable the alias with `alias: { "#shared/": false }`.
- **Packages.** Modules in `node_modules` never receive project aliases: a package's `#…` belongs to that package.

## Clean the project

`meeko clean [directorio]` deletes everything Meeko generates to leave the project clean:

| Command                 | Deletes                                                                                                          | Preserves                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `meeko clean`           | `.meeko/` (types, entry points, manifests, builds, generated `tsconfig.*`) and Vite's `node_modules/.vite` cache | The rest of `node_modules` and all application files |
| `meeko clean --all`     | The above and `node_modules`                                                                                     | Lockfiles, `.env`, `package.json` and source code    |
| `meeko clean --dry-run` | Nothing: shows what it would delete, with file count and size                                                    | Everything                                           |

The command only operates on a Meeko project (with `meeko.config.*` or `@meekojs/meeko` in `dependencies`/`devDependencies`) and rejects drive roots and the user's directory. It deletes only that fixed list of paths within the project and **never follows links**: a symlink or junction is removed as a link without entering its target, making it safe with pnpm's `link:`, where `node_modules/@meekojs/meeko` points to another repository. If `node_modules` is a link, Vite's cache is skipped with a warning. A locked file is retried; if the error persists, it is reported, processing continues with the rest and the command exits with code 1. To reinstall from scratch: `meeko clean --all` followed by `pnpm install`.

## Project setup and migration

### Migrate an earlier full-stack starter

An application generated with `0.0.4` can adopt the current project host without maintaining manual entry points. Change its scripts to `meeko dev`, `meeko check`, `meeko build` and `meeko start`; run the new build first and compare any customizations. You can then remove `server.mjs`, the client/server entry points, Vite configurations and per-scope `tsconfig.*` files that Meeko now generates under `.meeko/`. Keep the root `tsconfig.json` as the editor link.

If you want the current layout convention, move the root layout to `app/layouts/default.meeko`. Do not keep both that file and `app/pages/+layout.meeko`, because they would represent the same tree level. Move customizations that can be expressed through supported public conventions to middleware, handlers and those conventions. If a host or Vite customization has no equivalent public API yet, keep the manual host; migration must not delete customizations or attribute capabilities to `meeko.config.ts` that it does not offer.

### Migrate `server/session.ts` to `server/runtime.ts`

Meeko no longer loads `server/session.ts`. If the file exists, `meeko check`, `meeko dev` and `meeko build` stop with migration instructions rather than ignoring it. Move the `SessionManager` returned by `createSessionManager(production)` to the default export of `server/runtime.ts` and remove `server/session.ts`:

```ts
// Before: server/session.ts
export function createSessionManager(production: boolean) {
	return new SessionManager({ store: createStore(production), production })
}

// After: server/runtime.ts
import { defineServerRuntime, SessionManager } from '@meekojs/meeko/server'

export default defineServerRuntime(({ production, prerendering }) => ({
	sessions: new SessionManager({ store: createStore(production && !prerendering), production: production && !prerendering }),
	services: (request) => ({/* per-request services */}),
}))
```

`meeko build` creates the runtime with `prerendering: true` to render `render: "prerender"` routes; no client traffic is served during that phase, so the application can use an in-memory store instead of opening the production database. Applications that imported build tools from `@meekojs/meeko/server` must import them from `@meekojs/meeko/build` (`discoverRoutes`, `discoverServerManifest`, `loadMeekoConfig`, `prerenderProject`…), and import `toNodeListener`, `attachNodeWebSocketServer` and `createNodeSocketUpgradeHandler` from `@meekojs/meeko/node`. `createServerDispatcher`, `createLocalCalls`, `generateOpenApi` and `loadSocketChannels` now require an explicit loader, such as `(file) => import(pathToFileURL(file).href)` in Node.

`app/styles/main.css` is optional and loads automatically as a global stylesheet during development and build. Vite includes it in the production CSS asset; Meeko links that asset in SSR and prerendered HTML. `.meeko` `<style>` blocks remain available for local styles.

<a id="postcss-and-tailwind"></a>**PostCSS and Tailwind.** Vite processes both `app/styles/main.css` and component `<style>` blocks with PostCSS, using the project root's `postcss.config.*`. For Tailwind 4, install `tailwindcss` and `@tailwindcss/postcss`, declare the plugin and load Tailwind in the global stylesheet; Tailwind reads classes from `.meeko` files:

```js
// postcss.config.mjs
export default { plugins: { '@tailwindcss/postcss': {} } }
```

```css
/* app/styles/main.css */
@import 'tailwindcss';
```

In a `<style scoped>`, `@apply` requires `@reference "tailwindcss";` (or the stylesheet path with your theme) at the start of the block. Since `1.2`, each component's CSS is the module `Componente.meeko?meeko-style=…&lang.css`, next to its file, so PostCSS plugins resolve `@reference` and relative `@import` paths from the component folder. The selector already has the scope attribute when Tailwind expands `@apply`, so the declarations inherit the scope:

```html
<!-- app/components/Card.meeko -->
<style scoped>
	@reference '../styles/main.css'; /* with the project's @theme */

	.card {
		@apply rounded-lg bg-brand p-4;
	}
</style>
```

Tailwind also generates classes that only appear in `bind:class` literals (`bind:class="open.value ? 'ring-4' : undefined"`), because it reads the text of `.meeko` files. `meekoUtilities()` works alongside Tailwind if it comes first in the plugin list (`plugins: [meekoUtilities(), tailwindcss()]`, with `import tailwindcss from '@tailwindcss/postcss'`): Tailwind receives the generated rules instead of `@utilities`.

`@tailwindcss/postcss` detects sources from the working directory (`process.cwd()`), not the project root. CLI commands that accept the project (`dev`, `build`, `start`, `preview`, `check`, `routes`, `prerender` and `check-app`) change the working directory to that root before loading configuration and PostCSS, so `meeko dev ../app` works from any folder; relative argument paths are resolved first, against the launch folder. Programmatic APIs (`buildProject`, `startProject`…) do not change the process cwd: call them with the cwd at the root or set the source with `@import 'tailwindcss' source('../..');` (relative to the stylesheet) or the plugin's `base` option. From a broader folder, Tailwind scans all of its contents; from a drive root it can exhaust memory.

During SSR and prerendering, Meeko embeds component `<style>` CSS already processed by PostCSS and Vite CSS plugins in the document (since `1.8`; previously it arrived unprocessed), so a scoped `@apply` or an `@utilities` inside a component applies from the first render, without waiting for JavaScript. It is the same CSS as the component asset; inline `<style>` elements preserve the CSP nonce or hashes, deduplication and tree order (layouts, page and children). They go at the end of `<head>`, after `app/styles/main.css`, module stylesheets and the `document` `head`, where the client later adds component CSS: a scoped rule and a global rule of equal specificity resolve the same way on the first render as after hydration (since `1.8`; previously the global rule won only until JavaScript loaded). In `meeko dev`, the Vite client adopts those `<style>` elements instead of adding a copy, and HMR replaces them: a rule removed from `<style>` stops applying without a reload. The error page for a server failure, which does not hydrate, also embeds its CSS.

**`@tailwindcss/vite`.** Meeko does not read `vite.config.*`, but a [module](#modules) can register Tailwind's Vite plugin with `addVitePlugin`. It replaces `@tailwindcss/postcss` (do not declare both); `meeko dev` and `meeko build` apply it to `app/styles/main.css` and component `<style>` blocks, with `@theme`, scoped `@apply` and `bind:class` classes. Unlike the PostCSS plugin, it detects sources from the Vite root, which is the project root:

```js
// modules/tailwind.mjs
import { defineMeekoModule } from '@meekojs/meeko/framework'
import tailwindcss from '@tailwindcss/vite'

export default defineMeekoModule({
	meta: { name: 'tailwind' },
	setup(_options, meeko) {
		meeko.addVitePlugin(tailwindcss())
	},
})
```

```js
// meeko.config.mjs
export default { modules: ['./modules/tailwind.mjs'] }
```

A custom Vite host that only uses the `meeko()` plugin does not receive `addVitePlugin` registrations; add `tailwindcss()` to its `plugins` there. With `@tailwindcss/vite`, `meekoSortClasses: "stylesheet"` does not see utilities (it processes the stylesheet without modules' Vite plugins); use `"tailwind"`.

**Class ordering with Prettier.** With `meekoSortClasses: "tailwind"` (since `1.8`), the Prettier plugin (`@meekojs/prettier-plugin` or `@meekojs/meeko/prettier`) sorts the classes in each static `class="…"` using the official Tailwind CSS 4 order, the same as `prettier-plugin-tailwindcss` (which does not recognize the `meeko` parser). It loads the design system from `app/styles/main.css`, or the stylesheet specified by `meekoTailwindStylesheet` (relative to the project root), with its `@import`, `@theme`, `@plugin` and `@utility`, using the project's installed `tailwindcss`; it works the same with `@tailwindcss/postcss` and `@tailwindcss/vite`. Classes unknown to Tailwind, such as those from `meekoUtilities()` or the component's `<style>`, go first, in their original order. It does not touch `bind:class` or a component tag's `class`.

```json
{ "plugins": ["@meekojs/prettier-plugin"], "meekoSortClasses": "tailwind", "meekoTailwindStylesheet": "app/styles/main.css" }
```

```html
<!-- before -->
<div class="text-white custom p-4 bg-brand flex hover:bg-brand/80"></div>
<!-- after -->
<div class="custom flex bg-brand p-4 text-white hover:bg-brand/80"></div>
```

If `tailwindcss` 4 is not installed, the stylesheet does not exist or Tailwind rejects it, classes are not sorted (only normalized), and a warning appears once. The design system is reused until the stylesheet or its imports change. In an untrusted editor workspace, `"tailwind"` behaves like `"off"`, as does `"stylesheet"`, because it would execute the project's `@plugin` declarations.

<a id="generated-utilities-with-typescript"></a>**Utilities generated with TypeScript.** Since `1.2`, the `meekoUtilities()` PostCSS plugin from `@meekojs/meeko/postcss` generates rules with a TypeScript function instead of repeating them by hand. The `@utilities "<ruta>" [layer(<nombre>)];` at-rule is replaced by the rules returned by the module's default export:

```ts
// postcss.config.ts
import { meekoUtilities } from '@meekojs/meeko/postcss'

export default { plugins: [meekoUtilities()] }
// Or, with the object form: { plugins: { "@meekojs/meeko/postcss": {} } }
```

```css
/* app/styles/main.css */
@layer tokens, utilities;
@import './tokens/colors.css' layer(tokens);
@utilities "./utilities/color.ts" layer(utilities);
```

```ts
// app/styles/utilities/palette.ts
export const colors = ['gray', 'blue', 'red'] as const
export const steps = Array.from({ length: 12 }, (_, i) => i + 1)
```

```ts
// app/styles/utilities/color.ts
import { defineUtilities } from '@meekojs/meeko/postcss'
import { colors, steps } from './palette'

export default defineUtilities(({ rule, atRule }) => [
	colors.map((name) => rule(`.color[data-color='${name}']`, Object.fromEntries(steps.map((step) => [`--color-${step}`, `var(--${name}-${step})`])))),
	rule('.color', { color: 'var(--color-11)' }, rule('&:hover', { backgroundColor: 'var(--color-3)' }), atRule('media', '(prefers-contrast: more)', { color: 'var(--color-12)' })),
])
```

It generates `@layer utilities { .color[data-color='gray'] { --color-1: var(--gray-1); … } … .color { color: var(--color-11); &:hover { … } @media (prefers-contrast: more) { … } } }`. A preprocessor loop, such as `@each $size in sm, md, lg` from `postcss-each` (which is not part of PostCSS: without that plugin, the rule reaches the browser unchanged and does nothing), is written as a TypeScript `map`:

```ts
// app/styles/utilities/button-sizes.ts
import { defineUtilities } from '@meekojs/meeko/postcss'

const sizes = { sm: '0.25rem 0.5rem', md: '0.5rem 1rem', lg: '0.75rem 1.5rem' }

export default defineUtilities(({ rule }) => Object.entries(sizes).map(([size, padding]) => rule(`.button[data-size='${size}']`, { padding })))
```

The at-rule:

- **Path.** Quoted and relative to the stylesheet containing the at-rule: the global stylesheet, a file it imports with `@import` or a `.meeko` `<style>`, which resolves from the component folder. It supports `.ts`, `.mts`, `.js` and `.mjs`. Without a source file (CSS processed without PostCSS's `from` option), the path is relative to `meekoUtilities({ root })`, which defaults to `process.cwd()`.
- **`layer(x)`** wraps the result in `@layer x { … }`; `layer` without a name creates an anonymous layer. Without `layer`, rules stay at the at-rule's position.
- **It has no block** `{ … }`. It can appear multiple times and inside other rules or at-rules.
- **It goes after `@import` declarations.** To CSS it is another rule, and `@import` declarations must precede every rule: Vite warns (`@import statements must precede all other statements`) and does not include an `@import` that follows an `@utilities`.
- **It does not conflict with Tailwind.** Its name is `@utilities`; Tailwind 4's `@utility` is left untouched.

The module's default export is `defineUtilities(fn)` or an unwrapped function. `fn` receives the helpers, can be `async` and returns a node, an array of outputs (nested to any depth, flattened in order) or `null`, `false` and `undefined`, which are omitted, so you can write `condición && rule(…)`.

| Helper                                             | Generates                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rule(selector, declaraciones?, ...hijas)`         | A rule. Children (other `rule` calls with `&`, `atRule`, `css` or arrays) are nested inside using native CSS nesting, as if you wrote them by hand. If the second argument is not a declarations object, it is the first child.                                                                                                    |
| `atRule(nombre, params, declaraciones?, ...hijas)` | An at-rule, without `@` in the name: `atRule("media", "(min-width: 48rem)", …)`, `atRule("supports", "(display: grid)", …)`, `atRule("property", "--angle", { syntax: "'<angle>'", inherits: "false", initialValue: "0deg" })`. With only `nombre` and `params` it is a statement: `atRule("layer", "a, b")` gives `@layer a, b;`. |
| `` css`…` `` or `css("…")`                         | Literal CSS, parsed with PostCSS, for anything the helpers cannot express (`@keyframes`, several copied rules). It preserves backslashes (`content: "\201C"`).                                                                                                                                                                     |

Declarations are an object: camelCase keys become kebab-case (`borderRadius` → `border-radius`, `WebkitAppearance` → `-webkit-appearance`, `msFlex` → `-ms-flex`); kebab-case keys (`"border-radius"`) and custom properties `--*` are written as-is. A value is a string, which can end in `!important`, or a number, written without units (`opacity: 0.5`, `zIndex: 10`). `undefined` omits the declaration, and an array writes one declaration per value, for fallbacks (`display: ["-webkit-box", "flex"]`, including an `as const` array).

Since `1.3`, declarations are typed with [csstype](https://github.com/frenic/csstype): the editor completes standard and vendor-prefixed properties and their value keywords (`position: "sticky"`), and a misspelled property (`backgroundColr`) or nonexistent keyword is a type error in the editor and when checking the module with TypeScript. Lengths and times are strings with units (`padding: "4px"`, `transitionDuration: "200ms"`), except for `0`: `padding: 4` is an error, because it would write `padding: 4`, which the browser discards. Numbers are valid where CSS allows them without units (`opacity`, `zIndex`, `flexGrow`, `lineHeight`, `fontWeight`…). In `atRule`, the object also accepts descriptors for `@font-face` (`src`, `fontDisplay`, `unicodeRange`…), `@property` (`syntax`, `inherits`, `initialValue`), `@page`, `@counter-style`, `@font-palette-values` and `@view-transition` (the `UtilityAtRuleDeclarations` type). An object built outside the call loses its keywords (`const base = { position: "absolute" }` is `{ position: string }`): annotate it with `UtilityDeclarations` or use `as const`. An object with dynamic keys, such as the `{ [k: string]: string }` from `Object.fromEntries` in the palette example or a `Record<string, string>`, is accepted without checking its keys. Conversely, `UtilityDeclarations` no longer has an index signature: reading it with a `string` key (`decls[key]`) produces `TS7053` with `noImplicitAny`; use `Object.entries(decls)` or a `keyof UtilityDeclarations` key. For a property or at-rule that csstype does not know yet, write the CSS with `` css`…` ``.

The types `UtilityHelpers`, `UtilityDeclarations`, `UtilityAtRuleDeclarations` (since `1.3`), `UtilityValue`, `UtilityOutput`, `UtilityNode`, `UtilityRule`, `UtilityAtRule`, `UtilityCss`, `UtilityFunction` and `MeekoUtilitiesOptions` are exported from the same subpath.

Errors stop the stylesheet with the CSS file and the `@utilities` line, which Vite shows in its overlay: a missing module or one with another extension, a module that does not compile, a default export that is not a function, an exception from the function (with its message), an invalid selector, property name, value or at-rule parameters (a `;` or brace in a value, a `NaN` number), and an output value that is not a helper node, such as a CSS string without `css`. After you fix the module, the next edit regenerates the stylesheet.

**Module loading and hot updates.** Native `import()` caches every module in the graph for the lifetime of the process: a query on the entry module reloads that module, but not the local files it imports. That is why the plugin bundles the module with rolldown, the bundler already included in Vite 8 (it adds no dependencies): local files, including those reached through a `tsconfig` alias or the same package's `#imports`, form a single ES module imported from a `data:` URL, while `node_modules` packages remain external and load once with Node, as in any program. This supports all TypeScript, including extensionless imports, and `import.meta.url`, `import.meta.dirname` and `import.meta.filename` still describe the original file. The result is reused until a file in the graph changes its modification time or size, so a stylesheet transformed many times does not rebundle anything. The plugin publishes each graph file as a stylesheet dependency (PostCSS `dependency` messages), so in `meeko dev`, editing `color.ts` or `palette.ts` regenerates the stylesheet and Vite hot-updates the CSS without reloading the page or restarting the server. Keep these modules outside folders that Meeko watches for auto-imports and routes (`app/components`, `app/composables`, `app/utils`, `app/stores`, `app/pages`, `app/layouts`, `shared/…`, `server/utils`, the `imports` folders…): a change there reloads the entire page, like any other file in those folders; `app/styles/` is the natural location. Outside Vite 8 (for example, `postcss-cli`), if rolldown is not found, the plugin imports the module with Node's native type stripping, which requires imports with extensions and erasable TypeScript syntax, reloads only the entry module and warns once.

**Auto-imports.** Since `1.4`, the `@utilities` module and the local TypeScript modules it imports receive the same value auto-imports as the rest of the project: inside the rolldown bundle, the plugin applies the Vite plugin's registry and transformation, so `app/styles/utilities/color.ts` can use the `THEME_COLORS` constant from `app/theme/constants.ts` without an import if `meeko.config.ts` declares `imports: { appDirs: ["app/theme"] }`, just like a component. As in the editor and `meeko check`, each module receives those for its scope according to its folder (`app/`, `shared/` or `server/` in the application or a layer); a module outside those folders receives none. `@utilities` modules run in Node while generating CSS, so the registry is limited to what makes sense there:

| Included                                                                                                                                                                                                                                                                                                               | Not included                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Value exports from `app/composables`, `app/utils`, `app/stores`, `app/types` and `imports.appDirs`; those from `shared/*` and `imports.sharedDirs` (including `.shared.ts`); those from the same layer folders, and those added by modules with `addAutoImportsDir` and `addAutoImports` with `app` or `shared` scope. | Those from `server/utils`, `imports.serverDirs` and `.server.ts`; `.client.ts`; `.meeko` components; generated clients (`api`, `rpc`, `socket`, `useApi`…), and framework APIs for components and the running application (`signal`, `computed`, `useState`, `href`, `useRoute`, `defineApiRoute`…). |

Using one from the second column does not produce an opaque `ReferenceError`: the name is replaced by a value that, when used (read, called, converted to text), throws an error with the auto-import, its origin and the reason, which the plugin shows on the `@utilities` line: `"./utilities/color.ts" lanzó un error al generar las utilidades: app/styles/utilities/color.ts usa el autoimport SECRET, que no está disponible al generar el CSS de @utilities: viene de server/utils/secret.ts, que sólo existe en el servidor. …`. Because the error only appears if the value is used, an auto-import file that the module imports and that also exports, for example, a composable using `signal`, still works for reading its constants. `defineUtilities` is not an auto-import: import it from `@meekojs/meeko/postcss`, because declaring it globally would also offer it to components and bring PostCSS into the browser bundle. Types are those of `app/` (`.meeko/tsconfig.app.json`), so `meeko check` and the editor report `TS2304` when using a `server/utils` export in `app/styles/`, just as in the rest of `app/`; however, they accept the browser and framework names in the table, which fail when generating the stylesheet with the error above.

The project is the closest folder to the module with a `meeko.config.*`, without going beyond its `package.json`, or that `package.json` folder if it depends on `@meekojs/meeko`; its configuration runs as in `meeko dev`, with its modules' `setup` functions, once per stylesheet and only if the module will be bundled with rolldown. If reading it fails (a configuration or `setup` that throws), the stylesheet is still generated without auto-imports, with a PostCSS warning giving the reason. Auto-import files used by the module are part of its graph: they are stylesheet dependencies, and changing them regenerates it. Adding or removing an export in an auto-import folder also rebundles the module on the next transformation, even if no graph file has changed; in `meeko dev`, those changes reload the entire page, as in any other auto-import folder. `meekoUtilities({ autoImports: false })` disables auto-imports and bundles modules as in `1.3`. Outside a Meeko project (`postcss-cli` or a bundler in another project), there is no registry and nothing changes. Without rolldown, using native `import()`, Node cannot add imports: the module receives no auto-imports, configuration does not run and the native loading warning says so; write the imports explicitly.

Rules generated inside a `<style scoped>` do not receive the scope attribute: Meeko applies the scope when compiling the block and PostCSS generates rules afterward, so they are global, like those in `app/styles/main.css`. The plugin only runs in Node during `meeko dev` and build; `@meekojs/meeko/postcss` is not part of the browser or server runtime.

**With Tailwind.** Declare `meekoUtilities()` before `@tailwindcss/postcss`:

```ts
// postcss.config.ts
import tailwindcss from '@tailwindcss/postcss'
import { meekoUtilities } from '@meekojs/meeko/postcss'

export default { plugins: [meekoUtilities(), tailwindcss()] }
```

In that order, Tailwind receives generated rules like the rest of the stylesheet and processes, for example, `@apply` from a `` css`…` ``; with `layer(utilities)` they go into the same `utilities` layer as Tailwind's. In the reverse order, Tailwind first compiles each stylesheet importing `tailwindcss` and removes unknown at-rules, including `@utilities`, without an error; the plugin warns once per process. In a stylesheet without `@import "tailwindcss"`, such as a component's `<style>`, the order does not matter.

<a id="processed-global-stylesheet-for-the-editor"></a>**Processed global stylesheet for the editor.** Classes generated by `@utilities`, and those in files imported by the stylesheet, are not written in any project CSS file. That is why `meeko dev` writes the processed `app/styles/main.css` to `.meeko/styles/main.css`: the same stylesheet served at `/app/styles/main.css?direct`, with `@import` declarations resolved, `@utilities` expanded and other PostCSS plugins applied, unminified and with an initial comment marking it as generated. It writes it in the background as soon as the server listens, without delaying startup, and rewrites it whenever the stylesheet or a dependency changes: an imported file, an `@utilities` module or a file that module imports. Also after a Vite restart (for example, when `.env` changes).

- It only replaces the file when its contents change, atomically (writing a temporary file and renaming it), so a reader never sees half a stylesheet. Vite does not watch `.meeko/`: writing it does not reload the page or trigger another regeneration.
- If the stylesheet does not compile (a PostCSS or `@utilities` module error), the file keeps the last good version, the server continues working and the console reports it once: `[meeko] .meeko/styles/main.css conserva la versión anterior: app/styles/main.css no compila (…)`. The next change that fixes it regenerates it.
- Without `app/styles/main.css`, there is no file; if the stylesheet is deleted while `meeko dev` is running, the file is also deleted.
- `meeko build` does not write it: build CSS is minified and combines the global stylesheet with component `<style>` blocks. The file remains when you stop `meeko dev`, so running it once is enough; `meeko clean` removes it along with the rest of `.meeko/`.
- Nothing loads it at runtime, and you must not edit it manually. `url()` values appear as rewritten by Vite during development.

It serves editor extensions that complete classes from CSS stylesheets on disk. With [HTML CSS Support](https://marketplace.visualstudio.com/items?itemName=ecmel.vscode-html-css) (`ecmel.vscode-html-css`) in VS Code:

```json
// .vscode/settings.json
{ "css.styleSheets": [".meeko/styles/main.css"] }
```

The path is relative to the workspace folder. The extension finds local files through VS Code search, which applies `files.exclude` but not `.gitignore` or `search.exclude`: it finds the file even if `.meeko/` is in `.gitignore`, as in the starter. If your `files.exclude` hides `.meeko`, the extension will not see it either; instead, hide only folders you do not want to see, for example `".meeko/output": true`. The extension caches each local stylesheet and only rereads it when saved from the editor itself: after a change that regenerates the file, run **CSS: Clear style sheets cache** from the command palette to see new classes. By default it only completes in HTML; for `.meeko` files, add `"css.enabledLanguages": ["html", "meeko"]` to user settings (the extension does not support it per workspace) and restart VS Code.

During development, Vite opens an HMR WebSocket on a port derived from the HTTP port so that two Meeko applications do not compete for Vite's default port. `MEEKO_HMR_PORT` lets you set it explicitly when the environment requires it; the browser must be able to access that port as well as the application's HTTP port.

<a id="environment-variables-and-env"></a>**Environment variables and `.env`.** Since `1.2`, `meeko dev`, `build`, `start`, `preview` and `check` load the project root's `.env` into `process.env`, like Vite and Nuxt during development. An environment variable that is already defined takes precedence, so a deployment's real environment is never replaced. The output of `meeko build` executed directly (`node .meeko/output/node/index.mjs`, a container) does not read `.env`: in production, variables come from the environment. Changing `.env` requires restarting `meeko dev`. Meeko reads these variables:

| Variable                                      | Commands                                                                                    | Effect                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MEEKO_PORT`, `MEEKO_HOST`                    | `dev`, `start`, `preview` and Node, Bun and Deno output                                     | Port and address; they override `server.port` and `server.host`. Default: `127.0.0.1:4173`. Without `MEEKO_PORT`, it reads `PORT`, injected by platforms such as Coolify, Railway or Cloud Run.                                                                                                                                                                                         |
| `MEEKO_PUBLIC_ORIGIN`                         | `dev`, `start`, `preview` and Node, Bun, Deno and Workers output; since `1.3`, also `build` | Public origin behind an HTTPS proxy, for HTTP and Socket `Origin` checks. In `build`, and only if `site` is missing from `meeko.config.ts`, the origin for absolute URLs in `sitemap.xml`, `robots.txt` and `document.seo`; the build only reads it when writing one of these. As on the server, only the URL's origin counts: `https://example.com/app` means `https://example.com`.   |
| `MEEKO_REDIS_URL`                             | Node, Bun and Deno output                                                                   | Redis for production sessions when `server/runtime.ts` does not declare `sessions`; see [Sessions without configuration](framework-auth.md#sessions-without-configuration).                                                                                                                                                                                                                              |
| `MEEKO_REDIS_PREFIX`                          | Same as above                                                                               | Prefix for its keys; default: `meeko:<name de package.json>:prod:`.                                                                                                                                                                                                                                                                                                                     |
| `MEEKO_ROOT`                                  | Node, Bun and Deno output (since `1.8`)                                                     | Project root received by `server/runtime.ts` as `root`, absolute or relative to the working directory, when the output is deployed elsewhere; see [Server runtime](framework-server.md#server-runtime).                                                                                                                                                                                                    |
| `MEEKO_SESSION_TTL`, `MEEKO_SESSION_SAMESITE` | `dev` and production                                                                        | Duration (`12h`, `7d`…; 7 days by default) and `SameSite` (`Lax` by default, or `Strict`) of those sessions.                                                                                                                                                                                                                                                                            |
| `MEEKO_TRUST_PROXY`                           | `dev` and production                                                                        | Trusted proxies in front of the server (a number, or `true` for all), whose `X-Forwarded-For` entries provide the client IP for `context.clientAddress`, `clientAddress(request)` and `rateLimit`; since `1.8`, `cloudflare` reads `CF-Connecting-IP` behind Cloudflare Tunnel. See [Client IP behind a proxy](framework-auth.md#client-ip-behind-a-proxy). Without it, `X-Forwarded-For` is never read. |
| `MEEKO_TRUSTED_PROXIES`                       | `dev` and production                                                                        | Since `1.8`, with `MEEKO_TRUST_PROXY=cloudflare`: networks (CIDR or IP) for `cloudflared` and proxies; loopback and private networks by default. See [Cloudflare Tunnel and Traefik](framework-auth.md#cloudflare-tunnel-and-traefik).                                                                                                                                                                   |
| `MEEKO_HMR_PORT`                              | `dev`                                                                                       | HMR WebSocket port; without it, derived from the HTTP port.                                                                                                                                                                                                                                                                                                                             |
| `MEEKO_EDITOR_BRIDGE=0`                       | `dev`                                                                                       | Disables the editor bridge (live values).                                                                                                                                                                                                                                                                                                                                               |
| `MEEKO_LINK_WATCH=0`                          | `dev`                                                                                       | Does not restart `meeko dev` when rebuilding a linked `@meekojs/meeko`; warns in the terminal that you need to restart it.                                                                                                                                                                                                                                                              |

Since `1.2`, all variables read by Meeko start with `MEEKO_`; the prefix is reserved for Meeko, so application variables must use another name. `HOST` and `PUBLIC_ORIGIN`, the previous names, continue working during 1.x when the new variable is missing, with a per-process warning naming its replacement, and will stop being read in `2.0`. `PORT` is not deprecated: it is the permanent fallback for `MEEKO_PORT`.

If neither `MEEKO_PORT` (or `PORT`) nor `server.port` sets the port, `meeko dev` uses the first available one starting at `4173` (up to `4192`), like Vite: with another `meeko dev` already on `4173`, the second prints `[meeko] El puerto 4173 está en uso; meeko dev usa el 4174` and the actual URL, and derives the HMR WebSocket port and editor bridge descriptor (`.meeko/dev/editor-bridge-4174.json`) from that port. A port set with `MEEKO_PORT`, `PORT` or `server.port` does not change: if occupied, `meeko dev` exits with `El puerto 4173 de 127.0.0.1 ya está en uso; usa MEEKO_PORT=<otro puerto> o cierra el otro meeko dev`.

<a id="displayed-url"></a>**Displayed URL.** Since `1.7.1`, `meeko dev`, `meeko start`, `meeko preview` and Node, Bun and Deno output print `http://localhost:4173` when listening on loopback (`127.0.0.1` or `::1`) or all interfaces (`0.0.0.0` or `::`). Only the text changes: the server still listens on the configured address, `serveNode(...).url` and `serveDeno(...).url` keep that address (`http://127.0.0.1:4173`) and, without `MEEKO_PUBLIC_ORIGIN`, Socket still uses it as its origin and accepts other loopback names, so a page opened on `localhost` connects the same way. With `MEEKO_HOST=0.0.0.0` (or `::`, or equivalent `server.host`), a `Red:` line is added for each network interface address, like Vite: IPv4 with `0.0.0.0`, and IPv4 and global IPv6 with `::`, excluding loopback and link-local IPv6 addresses. Deno output only lists them if it has `--allow-sys=networkInterfaces` (`meeko preview` grants `-A`); without that permission, it prints only the local URL and never prompts. With a specific host, such as `192.168.1.20`, that host is displayed. The first line is always the local URL alone, for scripts that read it:

```text
http://localhost:4173
Red: http://192.168.1.20:4173
```

Development SSR loads `@meekojs/meeko` from Node, outside Vite's module runner, like the build; this keeps a single runtime instance in an application consuming Meeko with `link:`, even when Vite reloads its modules. That is why, when `@meekojs/meeko` is linked (pnpm `link:`, `npm link` or a workspace: the package resolves outside any `node_modules`), `meeko dev` runs the server in a child process and watches the linked package's `dist/` and `package.json`. When you rebuild it, it waits until compilation finishes (400 ms without changes), prints `[meeko] Meeko enlazado cambió; reiniciando meeko dev…`, closes the previous server (Socket, HTTP, Vite and the editor bridge descriptor) and starts another process on the same port with the same environment. If the new process fails to start, for example because compilation was incomplete, it reports this and retries on the next change. Only writes count: reading the build does not restart it, even if Windows reports an update to the last access time as a change. `Ctrl+C` stops both processes. A normal registry installation watches nothing extra.

`MEEKO_LINK_WATCH=0` (also from the project's `.env`) disables restarting with a linked package: a single process serves until stopped. That process keeps the Meeko server code it loaded, while Vite serves the new `dist/` files to the browser, so after a rebuild, server HTML (headers, `<head>`, SSR) comes from the previous build and hydration uses the new one. For this reason, after each rebuild finishes, it prints `[meeko] Meeko enlazado cambió (…/dist), pero este meeko dev no se reinicia solo (MEEKO_LINK_WATCH=0): el servidor sigue con el código anterior y el navegador recibe el nuevo. Reinicia meeko dev.` Restart it before checking the result.

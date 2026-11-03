---
source-hash: 03ea5b2bc02cd487efde2eda05736ff03a80a786f736cff24977174fd447fe56
---

# Meeko as a full-stack framework

Meeko keeps the standalone engine in `@meekojs/meeko`. Application mode uses `@meekojs/meeko/framework`, and Vite uses `@meekojs/meeko/vite`. The server is split across these subpaths:

- `@meekojs/meeko/server`: portable application core (`createServerApp`, `defineServerRuntime`, API/RPC contracts, sessions, middleware, Socket, `createSocketUpgradeHandler`, OpenAPI and, since `1.3`, `contentSecurityPolicy`). It only uses Web APIs and `node:async_hooks`; it does not load TypeScript, Vite, `ws` or the filesystem.
- `@meekojs/meeko/node`: Node adapter (`serveNode`, `toNodeListener`, `createNodeAssetReader`, `attachNodeWebSocketServer` and `createNodeSocketUpgradeHandler`).
- `@meekojs/meeko/password` (since `1.2`): `hashPassword`, `verifyPassword` and `needsRehash` with scrypt; it requires `node:crypto`, so it works in Node, Bun and Deno, but not Workers (see [Passwords](#passwords)).
- `@meekojs/meeko/bun`: Bun adapter (`createBunServer` and `createBunAssetReader`).
- `@meekojs/meeko/deno`: Deno adapter (`serveDeno` and `createDenoAssetReader`).
- `@meekojs/meeko/cloudflare`: Cloudflare Workers adapter (`createWorker`, `createSocketRoomClass`, `DurableObjectSocketPubSub`, `D1SessionDriver`, `createCloudflareAssetReader` and `createCloudflarePrerenderSource`).
- `@meekojs/meeko/build`: build tools that read the filesystem and load TypeScript (`discoverRoutes`, `discoverErrorPage`, `discoverConfiguredRoutes`, `composeFrameworkRoutes`, `loadMeekoConfig`, `readMeekoConfigSync`, `resolveConfigSources`, `discoverServerManifest`, `prerenderRoutes`, `prerenderProject`, `buildProject` and, since `1.3`, `inlineScriptHashes`). The production server does not import this subpath.

All subpaths belong to the same package and version. Published server targets are Node 24, Bun, Deno and Cloudflare Workers, checked by the same conformance suite (see [Build, deployment and verification](#build-deployment-and-verification)). Since `1.3`, the `static` adapter also generates a file-based site, without a server, for static hosting (see [Static site](#static-site)). Build and development tools still run on Node. SSR is enabled by default.

The generated application requires Node 24 or later and TypeScript 7 to check its declarations; the `.meeko` compiler uses TypeScript 6 internally only during development and build. The package is ESM. `vite` is an optional peer: an application that only uses the engine can import `@meekojs/meeko` without starting the framework, server, sessions or Socket. The Node adapter loads `ws` when you enable `attachNodeWebSocketServer`, not when you import the engine.

## Create an application

```sh
meeko init-framework my-app
cd my-app
npm install
npm run dev
```

The starter creates `meeko.config.ts`, `app/app.meeko`, `app/pages`, `app/styles/main.css`, a layout with an outlet and an `.env.example` with Meeko's variables; it does not need `server/runtime.ts`, because sessions work without configuration (see [Authentication](#authentication)). Meeko generates client/server entry points and their build configurations under `.meeko/`; you run `meeko dev`, `meeko check`, `meeko build` and `meeko start` through the `package.json` scripts; `meeko preview` also runs the build. You can organize the application like this:

```text
app/{pages,layouts,middleware,components,composables,utils,stores,styles}/
server/{api,rpc,socket,middleware,utils}/
shared/{types,schemas,utils,constants,enums}/
layers/base/app/pages/
modules/auth/app/pages/
public/
meeko.config.ts
tsconfig.json
.meeko/{types,manifests,generated,output}/
```

Meeko generates Vite entry points and per-scope TypeScript configurations only under `.meeko/`. The single root `tsconfig.json` connects VS Code to these generated projects to preserve diagnostics and completion in `.ts` files. The optional `server/runtime.ts` is application code: it declares services, Socket policy and, if Meeko's sessions are not enough, your own sessions. The standalone engine starter remains available with `meeko init <directory>`.

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
| `MEEKO_REDIS_URL`                             | Node, Bun and Deno output                                                                   | Redis for production sessions when `server/runtime.ts` does not declare `sessions`; see [Sessions without configuration](#sessions-without-configuration).                                                                                                                                                                                                                              |
| `MEEKO_REDIS_PREFIX`                          | Same as above                                                                               | Prefix for its keys; default: `meeko:<name de package.json>:prod:`.                                                                                                                                                                                                                                                                                                                     |
| `MEEKO_ROOT`                                  | Node, Bun and Deno output (since `1.8`)                                                     | Project root received by `server/runtime.ts` as `root`, absolute or relative to the working directory, when the output is deployed elsewhere; see [Server runtime](#server-runtime).                                                                                                                                                                                                    |
| `MEEKO_SESSION_TTL`, `MEEKO_SESSION_SAMESITE` | `dev` and production                                                                        | Duration (`12h`, `7d`…; 7 days by default) and `SameSite` (`Lax` by default, or `Strict`) of those sessions.                                                                                                                                                                                                                                                                            |
| `MEEKO_TRUST_PROXY`                           | `dev` and production                                                                        | Trusted proxies in front of the server (a number, or `true` for all), whose `X-Forwarded-For` entries provide the client IP for `context.clientAddress`, `clientAddress(request)` and `rateLimit`; since `1.8`, `cloudflare` reads `CF-Connecting-IP` behind Cloudflare Tunnel. See [Client IP behind a proxy](#client-ip-behind-a-proxy). Without it, `X-Forwarded-For` is never read. |
| `MEEKO_TRUSTED_PROXIES`                       | `dev` and production                                                                        | Since `1.8`, with `MEEKO_TRUST_PROXY=cloudflare`: networks (CIDR or IP) for `cloudflared` and proxies; loopback and private networks by default. See [Cloudflare Tunnel and Traefik](#cloudflare-tunnel-and-traefik).                                                                                                                                                                   |
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

## Configuration

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	layers: ['./layers/base'],
	modules: ['@acme/meeko-seo', './modules/hello'],
	seo: { siteUrl: 'https://example.com' },
	imports: {
		appDirs: ['app/services'],
		sharedDirs: ['shared/validators'],
		serverDirs: ['server/services', 'server/repositories'],
	},
	document: { lang: 'es', head: { meta: [{ name: 'theme-color', content: '#0f172a' }] } },
})
```

`meeko.config.ts` (or `.mts`, `.js`, `.mjs`) loads with Node and exports an object created with `defineMeekoConfig`:

- `layers` (since `1.2`): folders that contribute pages, components, auto-imports and plugins; see [Layers](#layers). `extends`, the previous name, still works as an alias.
- `modules`: names of modules created with `defineMeekoModule` (packages or paths), which configure the project through code; their options go in each module's key, such as `seo`. See [Modules](#modules).
- `imports`: auto-import folders in addition to the defaults, with the scope of their containing folder; see [Auto-imports and TypeScript](#auto-import-folders).
  - `imports.appDirs` (since `1.3`): folders inside `app/` (`"app/services"`), with `app/` scope: browser and SSR, not `shared/` or `server/`.
  - `imports.sharedDirs` (since `1.3`): folders inside `shared/` (`"shared/validators"`), with `shared/` scope: application and server.
  - `imports.serverDirs`: folders inside `server/`, exclusive to the server.
- `server`: the `meeko build` adapter; see [Build, deployment and verification](#build-deployment-and-verification).
- `document` (since `1.2`): `lang` and `<head>` entries for all documents. Modules add their own with `meeko.addHead`; `document.head` entries apply afterward, so the project's `title` wins. Since `1.3`, `document.seo` adds each page's canonical URL and Open Graph; see [Canonical URL and Open Graph per page](#per-page-canonical-url-and-open-graph). Since `1.5`, `document.idPrefix` is the ID prefix for [`useId`](api.md#stable-ids-useid) and `form.field` (`m` by default).
- `dev` (since `1.3`): `meeko dev` options. `serverLogs: false` disables [server logs in the browser console](#server-logs-in-the-browser-console).
- `devtools` (since `1.8`): `true` makes `meeko dev` mount the [Meeko DevTools panel](devtools.md#in-page-panel) on the page, without application code; `{ position: "bottom-left" }` chooses its corner. Default: `false`. It never reaches `meeko build` or `meeko start`.
- `site` (since `1.3`): the site's public URL (`"https://example.com"`, origin only). This is the origin for absolute URLs Meeko writes: `sitemap.xml`, `robots.txt` and `document.seo`. Without `site`, the build uses `MEEKO_PUBLIC_ORIGIN`. It does not change `Origin` checks, which still read `MEEKO_PUBLIC_ORIGIN` or `publicOrigin` from `server/runtime.ts` at runtime.
- `sitemap` and `robots` (since `1.3`): `sitemap.xml` and `robots.txt` generated at build time; see [`sitemap.xml` and `robots.txt`](#sitemapxml-and-robotstxt).
- `theme` (since `1.4`): light/dark theme and custom themes, without a flash, with `useTheme()`; see [Light/dark theme without a flash](#lightdark-theme-without-flashing).
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

Layer pages appear inside the project's shell: `app/app.meeko` and the application's root layout (`app/layouts/default.meeko` or `app/pages/+layout.meeko`) also wrap layer pages, and the layer's own `+layout.meeko` files nest inside. Since `1.5`, a layer's [named layouts](#named-layouts) (`layers/base/app/layouts/docs.meeko`) also serve pages in the project and other layers; see [Layouts from layers and modules](#layouts-from-layers-and-modules). If the project has `app.meeko` or a root layout, they replace the layer's equivalents; otherwise, the layer's are used. A failing layer page uses the closest `+error.meeko` in its own tree, then the layer's `app/error.meeko` and finally the project's root error page. A `404` for a URL without a route always uses the project's error page. Programmatic route modules (`RouteModule.routes()` from `composeFrameworkRoutes`) still declare their own layouts. The manifest rejects URL collisions and the registry rejects duplicate auto-import names; the diagnostic includes the conflicting files.

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

An accent color module, chosen by the user and applied before rendering (no module is needed for light/dark themes: Meeko includes them since `1.4`, see [Light/dark theme without a flash](#lightdark-theme-without-flashing)):

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
| `addLayout(name, file)`                        | Since `1.5`, adds a [named layout](#named-layouts), like an `app/layouts` file: `meeko.addLayout("docs", here("./docs-layout.meeko"))`. The file must be inside the project. A project or layer layout with the same name wins; two modules with the same name are an error.                                                                                                                                                                                                                                                                                                                                                                                                   |
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
- **`app.onError(handler)`.** In the browser, the observer receives the same as `mountClientApp({ onError })` (navigation, Socket and events, effects and cleanups without a closer `provideErrorHandler` and, since `1.3`, the page's global exceptions and rejections; see [Errors](#errors)), with `{ side: "client", source }`. On the server, it receives that request's render failures with `{ side: "server", requestId }`, in addition to `onError` in `server/runtime.ts`.
- **`app.resolveLink(resolver)`.** Since `1.8`, receives every `<MeekoLink>` in the application (`{ to, href, hreflang }`: the route ID, the `href` built by `href()` and the link's `hreflang`) and returns its final `href`; `aria-current` is computed from that `href`. Multiple resolvers are chained in plugin order. It runs when the link renders on the server, during hydration and during client navigation, so it must be pure: the same link produces the same `href` on both sides. `@meekojs/i18n` uses it for the language prefix; see [`<MeekoLink>`](#meekooutlet--and-meekolink).
- **`app.route`.** The route, like `useRoute()`. On the server it is the request's route; in the browser it follows the confirmed route, so an `effect` that reads it reruns on navigation. `app.request` is the request on the server and `undefined` in the browser; `app.side` tells you where it runs.
- **Failures.** A plugin throwing on the server fails the request, which shows the error page without plugin values. In the browser, hydration never starts and the page keeps the server HTML.

A custom host passes plugins to `mountClientApp({ plugins })` and `createServerApp({ plugins })` or `createFrameworkHandler({ plugins })` as `PluginRegistration`s (`{ plugin, options?, name? }`).

### Server and client boundaries

A module's `setup` and its entry point never reach the browser bundle, nor do its `"server"` plugins, middleware, handlers, auto-import folders with `scope: "server"` or `*.server.ts` files in module folders. Meeko's Vite plugin rejects the build if the client graph reaches them (`Server-only module reached the client bundle`), or if a file loaded by the browser imports `defineMeekoModule` (`Meeko module setup reached the client bundle`): only `meeko.config.ts` should import modules. Options for a plugin that runs in the browser do travel in the client bundle.

## Route and server middleware

Put route middleware in `app/middleware/*.ts` (including subfolders). Each file exports by default a function created with `defineRouteMiddleware` from `@meekojs/meeko/framework` (automatically imported). It runs before the sidecar and loader, both for an SSR page request and client navigation. The context provides `url`, `match`, `signal` and `phase`; `request` only exists during SSR. Returning `undefined` continues; returning a `Response` stops the route. An HTTP redirect during client navigation uses `location.assign`, making a new page request. A non-redirect response cancels navigation and reports the error to the host's `onNavigationError` callback. Without a callback, click or history navigation failures appear in the console; if the callback fails, Meeko logs that failure without creating an unobserved rejection. When a history navigation is blocked or fails, Meeko restores the URL of the page still visible. A direct `app.navigate()` call returns its rejection to its caller.

There are two kinds of route middleware:

- **Global** (the original kind, without options): runs on every route, by filename. `match.route.id` lets you restrict it to specific routes.
- **Named** (since `1.6`): `defineRouteMiddleware(fn, { global: false })`. It only runs on routes that request it through `middleware` in `definePage` or a [`+group.ts`](#per-folder-options-groupts).

Both also have server-only versions in `app/middleware/*.server.ts` with `defineServerRouteMiddleware` (since `1.6`): see [Server route middleware](#server-route-middleware).

```ts
// app/middleware/10-locale.ts: global, on all routes
export default defineRouteMiddleware(({ url, match }) => {
	if (match.route.id !== '/dashboard') return
	if (!url.searchParams.has('locale')) {
		const target = new URL(url)
		target.searchParams.set('locale', 'es')
		return Response.redirect(target)
	}
})
```

### Named middleware

Declare a guard affecting only part of the application as named middleware, requested by the routes that need it, without comparing `match.route.id` or file paths:

```ts
// app/middleware/auth.ts
export default defineRouteMiddleware(
	({ url, phase, request }) => {
		// A public cookie indicating the session: Meeko's session cookie is HttpOnly.
		const cookies = phase === 'server' ? (request.headers.get('cookie') ?? '') : document.cookie
		if (!cookies.includes('signed-in=1')) {
			const login = new URL('/login', url)
			login.searchParams.set('next', url.pathname)
			return Response.redirect(login)
		}
	},
	{ global: false },
)
```

```ts
// app/pages/(dashboard)/+group.ts: all pages in the group
export default defineGroup({ layout: 'dashboard', middleware: ['auth'] })
```

```html
<!-- app/pages/(dashboard)/admin/users.meeko: the page adds its own -->
<script
	server
	lang="ts"
>
	export const route = definePage({ middleware: ['admin'] })
</script>
<template><h1>Users</h1></template>
```

- **Name.** The file path inside `app/middleware`, without `.ts` or each part's numeric ordering prefix: `auth.ts` and `10-auth.ts` are `"auth"`, and `admin/20-role.ts` is `"admin/role"`. Letters, digits, `-` and `_`, and `/` between folders. Two files producing the same name, if either is named middleware, stop discovery.
- **Inheritance.** `middleware` accumulates from outside inward: outer `+group.ts` files, inner ones and the page, without duplicates (the first occurrence counts). `middleware: false` in a group or page removes inherited middleware; inner groups and the page can add it again. `middleware: []` changes nothing.
- **Order.** First all globals, in their usual order; then the route's middleware in declared order. The first to return a `Response` stops the route, and subsequent middleware does not run. The contract is the same in SSR, browser navigation, `render: "client"`, prerendering and the `static` adapter.
- **Literals.** Like `render` and `layout`, Meeko reads it without executing the file: `{ global: false }` must be an object literal with the literal `true` or `false`, and `middleware` a literal array of strings or `false`. A computed value produces `las opciones de defineRouteMiddleware deben ser un objeto literal…` or `middleware debe ser un array literal…`, with the file. A spread in page options that may contain `middleware` (an imported object, or a file-local constant containing it) requires declaring `middleware` after the last spread: `definePage({ ...protegida, render: "ssr", middleware: ["auth"] })`, or `middleware: []` if adding none. Otherwise discovery stops with `el spread protegida puede llevar middleware…`, because the route would be served without it. If a page declares middleware absent from its manifest (an old build), the request fails with `500` before the loader, as with `layout`.
- **Errors.** They stop `meeko dev`, `meeko build` and `meeko check`, with the file declaring the name: `el middleware "nowhere" no existe; crea app/middleware/nowhere.ts con defineRouteMiddleware(..., { global: false }) (middleware con nombre disponibles: "admin", "auth"), o app/middleware/nowhere.server.ts…` and, for a global, `el middleware "locale" (…/10-locale.ts) es global y ya se ejecuta en todas las rutas`.
- **Types and editor.** `middleware` is typed with the union of named middleware (`RouteMiddlewareName`, declared by `.meeko/types/routes.d.ts`), with editor completion. In an application without named middleware, the union is empty (`never`), so `middleware: ["typo"]` is already a type error. Hovering over a name in `definePage` shows its file and pages, and Ctrl+click opens it.
- **Bundle.** Globals travel with the browser entry point. Each named middleware used by a route is a separate chunk, loaded by the browser the first time it navigates to one of its routes; middleware used by no route never reaches the browser. Hydration does not run them: the server already did.
- **Manifest.** Each route stores its resolved named middleware in `RouteRecord.middleware` (files, in execution order); `AppManifest.routeMiddleware` still lists only globals. A custom host using `createFrameworkHandler` or `mountClientApp` with routes declaring them passes `loadNamedMiddleware(file)`; without it, those routes fail instead of skipping their guards. `discoverRouteMiddleware` from `@meekojs/meeko/build` separates globals from named middleware.
- **Development.** Creating, deleting or renaming middleware, changing its `{ global }` or the `middleware` of a page or `+group.ts` makes `meeko dev` rediscover routes and recreate the application.
- **Layers and modules.** As before, only the project's `app/middleware` counts: layer pages choose from the project's named middleware, and modules do not add route middleware.

`app/middleware/*.ts` is also bundled for the browser, including named middleware: do not import `server/`, secrets or authorization logic that must be enforced on the server there. An isomorphic route guard, global or named, improves navigation but never replaces session validation and authorization in the loader, API or RPC; to protect a page with the session, use [server route middleware](#server-route-middleware). `*.test.ts`, `*.spec.ts`, `*.d.ts` and `*.client.ts` files are excluded from route middleware discovery; since `1.6`, `*.server.ts` files are server route middleware.

### Server route middleware

Since `1.6`, an `app/middleware/*.server.ts` file is **server-only** route middleware: declare it with `defineServerRouteMiddleware` (from `@meekojs/meeko/framework`; automatically imported in `*.server.ts` and throughout `server/`, like other server definitions), and it receives the request's session and never reaches the browser bundle. It expresses “this group requires a session” without repeating the check in every page's `<script server>`:

```ts
// app/middleware/auth.server.ts
import { redirect } from '@meekojs/meeko/framework'

export default defineServerRouteMiddleware(
	({ session, url }) => {
		if (!session.current) redirect(`/login?next=${encodeURIComponent(url.pathname)}`)
	},
	{ global: false },
)
```

```ts
// app/pages/(dashboard)/+group.ts: all pages in the group require a session
export default defineGroup({ layout: 'dashboard', middleware: ['auth'] })
```

- **Global or named.** The same rule as isomorphic middleware: without options it is global and runs on every route; with `{ global: false }` (read without executing the file), it is named middleware, and `auth.server.ts` (or `10-auth.server.ts`) is `"auth"`. `middleware: ["auth"]` in `definePage` or a `+group.ts` resolves to `auth.ts` or `auth.server.ts`, with the same inheritance and `middleware: false`; if both exist and either is named, the name is duplicated and discovery stops. The default export of a `*.server.ts` must be a call to `defineServerRouteMiddleware(...)`, directly or through a file-local constant (including `as const`), an aliased import or `export { auth as default }`. Until `1.5`, those files were ignored, so a helper living there without a default export or with another one (`export default function parseCookies…`) stops discovery with `un middleware de ruta de servidor debe exportar por defecto defineServerRouteMiddleware(...)… mueve los helpers a server/utils` instead of running on each request as global middleware. Each file kind uses its own definition: `defineRouteMiddleware` in a `*.server.ts`, or `defineServerRouteMiddleware` in a `*.ts`, is an error identifying the file.
- **Context.** The same as `usePage()` in `<script server>`: `url`, `params`, `search`, `request`, `signal` and `context` (the `RequestContext`), with `session`, `services`, `platform` and `requestId` readily available, plus `match`. The client IP, behind the proxy if `MEEKO_TRUST_PROXY` allows it, is `context.clientAddress`. `params` and `search` come from the URL and are not yet validated with page schemas, because middleware runs before its `<script server>` or `load`. `defineServerRouteMiddleware<Services>` types `services`, and `session` follows `MeekoSession`. With `createFrameworkHandler` without `createContext`, reading `context` or `session` throws an error.
- **How it stops execution.** Like `<script server>`: `redirect()`, `notFound()` or an error, and also returning a `Response`. Returning `undefined` continues.
- **When it runs.** On the document request (SSR), and during browser navigation within the page data request, the same one that executes `<script server>`: a redirect or error reaches the browser just like one from a `<script server>` `redirect()`, and navigation follows it. In `render: "stream"`, before the first byte, like the critical loader.
- **Order.** Always the same: first isomorphic middleware (globals, then named middleware in declared order), then server middleware (globals, then named middleware in declared order). During navigation, the browser runs isomorphic middleware and the data request runs it again on the server before server middleware, as before. The first to stop execution stops the route.
- **`render: "client"` and `render: "prerender"`.** A `render: "client"` page does not request its data from the server during navigation, and a prerendered page renders at build time, without each visitor's request or session. Requesting named server middleware on either (including inherited middleware from a `+group.ts`) stops discovery: `el middleware de servidor "auth" (…) necesita una página con datos del servidor, pero … usa render: "client"…`; remove it from that page with `middleware: false` or use `render: "ssr"` or `"stream"`. Global server middleware does not run on these pages, even on their first load, so behavior does not depend on how you reached them. The `static` adapter, which only supports prerendered pages, warns that it does not run them.
- **Security boundary.** The Vite plugin rejects any `*.server.*` reaching the browser graph, and the client middleware virtual module never includes these files; the browser manifest does not carry their paths either. They can import `server/` and `#server/…` without `MEEK108`, and `meeko check` checks them with server types.
- **Types and editor.** `RouteMiddlewareName` includes their names, except in the `middleware` of a `render: "client"` page, which only accepts isomorphic middleware; hovering over a name in `definePage` or `defineGroup` shows the file, marks it as “server-only” and shows its pages. A nonexistent or global name produces the same errors in `meeko dev`, `meeko build` and `meeko check`.
- **Manifest and custom host.** Each route stores its complete server chain in `RouteRecord.serverMiddleware`, in execution order: globals, then named middleware (`render: "client"` and `"prerender"` routes do not have it). A custom host using `createFrameworkHandler` passes `loadServerMiddleware(file)`, which loads each listed file; without it, a route listing any, even just a global, fails instead of skipping it. Routes from a programmatic `composeFrameworkRoutes` module also receive the project's globals.
- **Development.** Creating or deleting one, or changing its `{ global }`, makes `meeko dev` rediscover routes.

When to use each kind:

- **Isomorphic middleware (`*.ts`) improves navigation**: it decides in the browser, without a request, and redirects before requesting anything. It cannot read the session (its cookie is HttpOnly) or import server code.
- **Server middleware (`*.server.ts`) protects the page**: it checks the session before the server renders or sends its data.
- **Neither protects `server/api` or RPC.** Route middleware only runs for pages: API endpoints and RPC procedures need their own guards (`auth: "required"`, handler checks or server middleware), even if only protected pages call them.

### Server middleware

To intercept HTTP on the server before the page or API/RPC handler, put middleware in `server/middleware/*.ts` and use `defineServerMiddleware` from `@meekojs/meeko/server`. It receives `Request` and `next(request)`; it must return a `Response`. It can continue, modify a response or short-circuit. Meeko executes files by name, from outside inward; `next()` can only be called once. Middleware runs before creating the request's session context, including for prerendered pages; public build files are served before middleware. Built-in API/RPC authentication, authorization, contract and CSRF checks still run inside the handler.

```ts
// server/middleware/10-request-header.ts
import { defineServerMiddleware } from '@meekojs/meeko/server'

export default defineServerMiddleware(async (request, next) => {
	const response = await next()
	const headers = new Headers(response.headers)
	headers.set('x-content-type-options', 'nosniff')
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	})
})
```

Server middleware has no `RequestContext`: for the client IP, use `clientAddress(request)` (since `1.7`), which applies `MEEKO_TRUST_PROXY` like `context.clientAddress` and `rateLimit`; never read `X-Forwarded-For` manually (see [Client IP behind a proxy](#client-ip-behind-a-proxy)).

This pipeline wraps SSR pages, `/api` and `/_meeko/rpc`; static assets, the Vite development server and WebSocket upgrades have their own handlers. `*.test.ts`, `*.spec.ts`, `*.d.ts` and `*.client.ts` files are excluded. Automatic middleware discovery is currently limited to the root project: layers contribute routes, auto-imports and plugins, but their `app/middleware` and `server/middleware` folders do not participate. A module adds server middleware with `meeko.addServerMiddleware`, which runs before the project's middleware (see [Modules](#modules)). Editing an existing middleware file invalidates modules and reloads the browser during development; when you add or remove one, `meeko dev` recreates the application without restarting (see [Configuration](#configuration)). `npm run check` checks types in their respective scopes.

`onNavigationError` callbacks can return a promise: if the observer fails, Meeko logs both the observer failure and the original navigation error without generating an unhandled rejection. Server `onError` observers also do not change the response when they throw or reject; fallback logging includes the available `requestId` and error categories, without private messages.

Component events can be observed per root with `provideErrorHandler` in the `<script>` of `app/app.meeko` or a layout; it is automatically imported, and the callback receives `unknown` and its `ErrorSource`. Children inherit the closest observer, including after an HMR replacement. `mountClientApp({ onError })` defines the application-wide observer: it receives navigation, Socket channels, events, effects and cleanups without a closer `provideErrorHandler` and, since `1.3`, the page's uncaught exceptions and unhandled promise rejections ([Global browser failures](#global-browser-failures)). Without `onError`, navigation, Socket and those global failures consult the application's first active provider when there is no explicit `onNavigationError` or channel `onError`. That provider is unregistered when its root is disposed; an observer failure is logged with the original error. Direct calls to `app.navigate()` and `socket.emit()` keep their rejections for the code awaiting them. SSR has no browser events or Socket connections.

If server middleware calls `next()`, Meeko also awaits that work even if the middleware forgets to await the promise. A downstream failure propagates to the HTTP handler; if both fail, each error is preserved in an `AggregateError`. Middleware must return a pipeline response or its own response.

## Routing, layouts and SSR

`app/pages` supports `index.meeko`, `[id].meeko`, `[...slug].meeko`, `(group)` groups, `+error.meeko` and, for route options, a `<script server>` block in the page or a `*.route.ts` sidecar. The shared layout lives in `app/layouts/default.meeko` and receives `props.outlet`; the browser preserves it between routes and disposes of outgoing pages. Since `1.5`, any `app/layouts/<nombre>.meeko` is a [named layout](#named-layouts) that the page selects with `definePage({ layout })` or a `+group.ts`. `+layout.meeko` files alongside pages remain supported for older projects and nested layouts; you cannot combine one at the root of `app/pages` with `app/layouts/default.meeko`. A layer uses the same conventions. `href` checks IDs and parameters against the generated manifest.

The outlet type in `app/app.meeko` and each layout is `Component<Record<string, unknown>>`, imported from `@meekojs/meeko`. It includes `renderWithState`, required by `<component is="props.outlet">` to transfer SSR state.

### `<MeekoOutlet />` and `<MeekoLink>`

Since `1.2`, two built-in Meeko tags replace these patterns. You do not import them: the compiler recognizes them.

- **`<MeekoOutlet />`** renders the inner layout or page in `app/app.meeko` and layouts (`app/layouts/*.meeko` or `+layout.meeko`). It reads the `outlet` Meeko passes, so the layout does not need to declare `defineProps<{ outlet }>()`. Up to `1.4`, if it declared props, `outlet` had to be among them; since `1.5`, a layout with `<MeekoOutlet />` declares only its own (`defineProps<{ title?: string }>()`) and Meeko adds `outlet` to its `ComponentProps`. It is equivalent to `<component is="props.outlet">`: the browser preserves the layout between routes and only changes its contents. In another component, or with attributes or content, it produces `MEEK104`.
- **`<MeekoLink to="/users/[id]" bind:params="{ id: user.id }" bind:search="{ tab: 'perfil' }">`** renders an `<a>` whose `href` is built by `href()`: `to` only accepts existing routes, dynamic routes require `bind:params` with their keys, and `bind:search` adds the query string. `meeko check` and the editor flag the error on the attribute (`Argument of type '"/nowhere"' is not assignable…`). On the active route (the same path without query or fragment), it adds `aria-current="page"`, which navigation updates; with `match="prefix"`, it also marks its section (see below). Other attributes and children pass through to the `<a>` unchanged: `class`, `target`, `rel`, `aria-*`, `data-*` and `on:click`. `href` and `bind:href` are not supported, because `to` builds the link (`MEEK105`).
- **`match`: page or section.** Since `1.5`, `match="exact"` (the default) marks the link only on its own route, and `match="prefix"` also on routes below it. On its own route, the link has `aria-current="page"`; on a route below it, `aria-current="true"`, meaning “the current item in a set”: the section containing the page. Comparison uses complete segments, on paths encoded as by `href()`, without query or fragment: `/dashboard` covers `/dashboard/stats` and `/dashboard/r%201`, but not `/dashboards`; `/dash` does not cover `/dashboard`. `to="/"` only matches exactly, even with `match="prefix"`, since otherwise it would mark every page. On a dynamic route, the section follows its `params`: `<MeekoLink to="/users/[id]" bind:params="{ id: '7' }" match="prefix">` covers `/users/7/posts`, not `/users/8/posts`. `match` supports `bind:match` with an expression of type `"exact" | "prefix"`; another static value produces `MEEK105`. The value appears in the server HTML, hydration leaves it unchanged, and navigation updates it, including in a layout the browser preserves.
- **Link resolvers: language and other prefixes.** Since `1.8`, the `href` passes through the resolvers that plugins and modules register with [`app.resolveLink`](#application-plugins). With `@meekojs/i18n`, `<MeekoLink to="/guide">` points to `/en/guide` on an `/en/…` page and to `/guide` in the default language, without writing the prefix; `hreflang="es"` (or `bind:hreflang`, or the `hreflang` key of `bind`) forces another language and is also kept on the `<a>`. `bind:resolve="false"` leaves the `href` from `href()` as is, for a link that must not change; a static `resolve="false"` is `MEEK105`. The typing of `to`, `params` and `search`, `aria-current` (with the resolved `href`, so `/guide` is active on `/en/guide`) and client navigation do not change. Without resolvers, the `href` is the one from `href()`.

```html
<!-- /en/guide on an /en/… page, /guide in the default language -->
<MeekoLink to="/guide">Guide</MeekoLink>
<!-- /guide in any language -->
<MeekoLink
	to="/guide"
	hreflang="es"
>
	Spanish version
</MeekoLink>
<MeekoLink
	to="/admin"
	bind:resolve="false"
>
	Administration
</MeekoLink>
```

- **Prop types.** Since `1.4`, `@meekojs/meeko/framework` exports `MeekoLinkProps<K>` (`to`, `params` and `search` for route `K`; since `1.5`, also `match`, and since `1.8`, `resolve`), `MeekoOutletProps` (no props) and `MeekoThemeToggleProps` (the props of [`<MeekoThemeToggle>`](#meekothemetoggle)), plus `RouteId`, the ID of any application route (the type of `to`). All are auto-imported: prop types where the components are used, like [component types](#component-types), and `RouteId` throughout the project, like `href`. The editor shows props on tag hover and opens their type with “Go to definition”. You can use them to type a component that receives a route, without an import:

```html
<!-- app/components/NavLink.meeko -->
<script lang="ts">
	const props = defineProps<{ href: MeekoLinkProps['to']; label: string }>()
</script>
<template><a bind:href="href(props.href)">{props.label}</a></template>
```

`MeekoLinkProps["to"]` and `RouteId` are the same type: the union of routes declared by `.meeko/types/routes.d.ts` (`meeko check`, `meeko dev`), or `string` without those declarations. `<NavLink href="/nowhere">` is a type error in the parent. A project type with one of those names (for example, in `app/types`) takes priority.

```html
<!-- app/layouts/default.meeko -->
<template>
	<header>
		<MeekoLink
			to="/"
			class="brand"
		>
			Home
		</MeekoLink>
		<MeekoLink
			to="/users/[id]"
			bind:params="{ id: session.userId }"
		>
			My profile
		</MeekoLink>
	</header>
	<main><MeekoOutlet /></main>
</template>

<style scoped>
	a[aria-current='page'] {
		font-weight: 700;
	}
</style>
```

A section menu marks the section on all its pages and marks the exact page differently. CSS distinguishes the two `aria-current` values, the same ones screen readers read:

```html
<!-- app/layouts/default.meeko -->
<template>
	<nav aria-label="Secciones">
		<MeekoLink
			to="/"
			match="prefix"
		>
			Home
		</MeekoLink>
		<MeekoLink
			to="/dashboard"
			match="prefix"
		>
			Dashboard
		</MeekoLink>
		<MeekoLink
			to="/users"
			match="prefix"
		>
			Users
		</MeekoLink>
		<MeekoLink
			to="/settings"
			match="prefix"
		>
			Settings
		</MeekoLink>
	</nav>
	<main><MeekoOutlet /></main>
</template>

<style scoped>
	/* The current page section: /dashboard/stats marks “Dashboard”. */
	nav a[aria-current='true'] {
		border-bottom: 2px solid currentColor;
	}
	/* The exact page: /dashboard marks “Dashboard” with a heavier weight. */
	nav a[aria-current='page'] {
		border-bottom: 2px solid currentColor;
		font-weight: 700;
	}
</style>
```

On `/dashboard/stats`, “Panel” has `aria-current="true"`; on `/dashboard`, `aria-current="page"`; on `/dashboards`, neither, and “Inicio” is only marked on `/`. For your own link or component, `useRoute().isActive()` applies the same rule (see [Current route](#current-route)).

In the editor, `to="` suggests project routes and takes you to their page with Ctrl+click. `meeko init-framework` generates the shell and layout with these tags.

A project from before `1.2` with its own component named `MeekoLink` or `MeekoOutlet` (in `app/components`, from a module, or imported or declared in `<script>`) keeps it: the tag is that component, with its props, rather than Meeko's tag. `meeko check`, `meeko build` and the editor warn with `MEEK106`; rename the component to use the built-in tag.

### `<MeekoTeleport>`

Since `1.5`, `<MeekoTeleport to="…">` renders its content elsewhere in the document while keeping it within the component that declares it. You do not import it either. A typical case is a page putting its actions in its layout's toolbar:

```html
<!-- app/layouts/default.meeko -->
<template>
	<header class="bar">
		<MeekoLink to="/">Home</MeekoLink>
		<div id="toolbar"></div>
	</header>
	<main><MeekoOutlet /></main>
</template>

<!-- app/pages/notes/[id].meeko -->
<script lang="ts">
	const isMobile = signal(false)
	async function save(): Promise<void> {
		/* … */
	}
</script>
<template>
	<MeekoTeleport
		to="#toolbar"
		bind:disabled="isMobile.value"
	>
		<AppButton on:click="save">Save</AppButton>
	</MeekoTeleport>
	<article>…</article>
</template>
```

- **Target.** `to="body"` appends the content to `<body>` and `to="#id"` inserts it inside the element with that `id`, after its existing content. Only these two forms are supported: `body`, or `#` followed by a letter and ASCII letters, digits, `-` or `_`. Meeko looks up the `id` with `getElementById` and never interprets `to` as a CSS selector or HTML. A static `to` that does not match this form produces `MEEK114`; `bind:to` accepts an expression of type ``"body" | `#${string}` `` (`MeekoTeleportTarget`), validated at render time. `<MeekoTeleport>` supports `to`, `bind:to`, `disabled`, `bind:disabled`, `if:when` and `each:of`; any other attribute produces `MEEK114`.
- **Author scope.** The content compiles in the declaring component's template, like the content of an `if:when`: it reads its signals, its events call its functions, it receives its `provide`/`inject` and error handlers, can use its snippets, and retains its `<style scoped>` attribute. It is disposed of with the component: on unmount, on page changes, or when its `if:when` or `each:of` row disappears, its nodes leave the target too.
- **Initial HTML.** In SSR, `"stream"` and `"prerender"` (including the `static` adapter), the HTML already contains the content at its target, without shifts during hydration: `to="body"` content goes after the application and before Meeko's scripts; `to="#id"` content goes inside that element, whether it renders before or after the teleport. Multiple teleports to the same target retain their order on the page. Hydration finds the content by its markers (`<!--meeko:portal:…-->`) and leaves the DOM unchanged.
- **Missing target.** If the page does not render the `#id` element (or it is a void element such as `<input>`), rendering fails with a clear error in development. In production, the content renders in place, where it hydrates, and the server warns once with `console.warn`. In the browser, a missing target leaves content in place with a warning; the next change to `to` or `disabled` looks it up again.
- **`disabled`.** With `disabled` (or while `bind:disabled` is true), content renders in place. Changing it moves the same nodes between the target and their original position without rerendering, so they retain their state; the focused element loses focus, as with any DOM move.
- **Browser.** Content rendered by the browser (navigation, an appearing `if:when`, a new row or a deferred child) first renders in place and moves to its target at the end of that mount, before the next paint, appending to the target. The target must live at least as long as the teleport: a layout or `app/app.meeko` element for a page, or an element of the component itself.

Modals, menus and tooltips do not need a teleport: `<dialog>` with `showModal()` and the `popover` attribute already show them in the browser's _top layer_, above everything and without `z-index` or `overflow` issues, handling focus and `Escape`. Use `<MeekoTeleport>` when content must live elsewhere in the layout, such as an action bar, breadcrumbs or a notice at the end of `<body>`.

Pages, layouts, `app/app.meeko` and `app/error.meeko` cannot be [generic components](api.md#generic-components-generic): Meeko passes their props and cannot choose their type parameters, so `generic` on their `<script>` produces `MEEK100`. Move generic content into an `app/components` component and use it from the page.

If a page fails and `+error.meeko` exists, Meeko loads and renders it with the same request context and SSR state. The server observer receives the original failure with its `requestId`; the HTML shows a public message without private details. If the error page also fails, the server logs that second failure and returns a safe response.

### Named layouts

Since `1.5`, each `app/layouts/<nombre>.meeko` is a named layout: `default`, `dashboard`, `auth`, `blank`… A subfolder forms part of the name: `app/layouts/admin/panel.meeko` is `"admin/panel"`. The name contains letters, digits, `-` and `_` (and `/` between folders), starting with a letter or digit; a file with another name (`_partes.meeko`) is not a layout and can hold other components. A named layout is a normal layout: it renders the page with `<MeekoOutlet />` and declares its props with `defineProps`.

The page selects its layout in its route options, in `<script server>` or the `*.route.ts` sidecar:

```html
<!-- app/pages/connections.meeko -->
<script
	server
	lang="ts"
>
	export const route = definePage({ layout: 'dashboard' })
</script>
<template><h1>Connections</h1></template>
```

- **Without `layout`**, the page uses the layout inherited from its folders' [`+group.ts`](#per-folder-options-groupts) files or, if none, `default`, as up to `1.4`.
- **`layout: false`** removes the named layout: `app/app.meeko` and its folders' `+layout.meeko` files remain.
- **A literal.** Like `render`, `meeko build` reads `layout` without executing the file: it must be a string literal or `false` inside `definePage({ ... })`. A computed value produces `layout debe ser un literal de texto…` with the file. A nonexistent name stops `meeko dev`, `meeko build` and `meeko check`: `el layout "nowhere" no existe; crea app/layouts/nowhere.meeko (layouts disponibles: …)`. In types, `layout` is the union of application layouts, with editor completion; hovering the name shows its file and pages, and Ctrl+click opens it.
- **Nesting order.** `app/app.meeko` → named layout → folder and group `+layout.meeko` files, from outermost to innermost → page. `(group)` groups and `+layout.meeko` files work as before, inside the named layout. Having both `app/pages/+layout.meeko` and `app/layouts/default.meeko` remains an error; an `app/pages/+layout.meeko` without `default` nests inside the named layout the page selects.

```text
app/app.meeko
└─ app/layouts/dashboard.meeko        (layout: "dashboard")
   └─ app/pages/(dashboard)/+layout.meeko
      └─ app/pages/(dashboard)/connections.meeko
```

**Navigation.** The browser preserves layouts shared by the outgoing and incoming pages, as always: if both use the same named layout, it stays mounted with its state (DOM, focus, sidebar scroll, text entered in a field) and only its contents change; if they use different layouts, the old one is disposed of and the new one mounts. This works equally for SSR, `render: "stream"`, `render: "client"`, prerendered pages and the `static` adapter.

**Error page.** A page that fails in the browser (its loader, `notFound()` or data) shows its `+error.meeko` or `app/error.meeko` inside its own layouts, including the named layout, with its `+group.ts` props and without the page's props. The `404` for an unmatched URL uses the `default` layout (if present), with its default values. Since `1.8`, a page that responds `404` on the server (`notFound()` or an `ApiError` with that status) gives the same document, which hydrates; with a nearer `+error.meeko`, that page goes inside the page's layouts, without hydration. If a layout fails while painting it, or the error is another one, the error document has no layouts, because a layout may be what failed.

#### Per-folder options: `+group.ts`

To avoid repeating `layout` on each page, a `+group.ts` in any `app/pages` folder (a `(dashboard)` group or a normal folder) declares options for that folder and its subfolders. `defineGroup` is auto-imported:

```ts
// app/pages/(dashboard)/+group.ts
export default defineGroup({ layout: 'dashboard', layoutProps: { showAlert: false } })
```

- **Cascading inheritance.** `+group.ts` files apply from outermost to innermost, then the page. The page's `layout`, or that of the innermost group declaring it, wins.
- **`layoutProps` merge by key** between groups and the page, with the page winning. A group or page selecting a different layout from the inherited one starts without inherited props, which belonged to another layout.
- **`layout: false`** on a page (or group) inside a group removes the named layout and keeps its `+layout.meeko` files.
- **Literals.** Meeko reads the file without executing it, like `render`: `layout` is a literal or `false`, `layoutProps` is an object literal of strings, numbers, booleans, `null`, arrays and objects, and `middleware` is an array literal of strings or `false`. A computed value, spread or unknown option stops discovery, naming the file. This is why it works equally in prerendering and a static site.
- **`middleware`** (since `1.6`). Named middleware for the group's pages, added to outer groups' middleware; `middleware: false` removes inherited middleware. See [Named middleware](#named-middleware).
- **Types.** `defineGroup({ layout: "dashboard", layoutProps: { … } })` checks `layoutProps` against that layout in the file itself. A group inheriting its layout, and a page not selecting one in `definePage`, are checked by `meeko check` against the inherited layout (`MEEK_PAGE_LAYOUT_PROPS`: `Las layoutProps de app/pages/(dashboard)/reports/+group.ts no coinciden con las props del layout dashboard`). A `+group.ts` outside `app/pages` configures nothing: `meeko check` warns with `MEEK115`.

To migrate a group with its own layout, such as `app/pages/(dashboard)/+layout.meeko`, move the file to `app/layouts/dashboard.meeko` and add `app/pages/(dashboard)/+group.ts` with `export default defineGroup({ layout: "dashboard" })`. The layout now replaces `default` rather than nesting inside it, and any page in another folder can select it; remaining subfolder `+layout.meeko` files still nest inside.

#### Layouts from layers and modules

A layer contributes its `app/layouts/*.meeko` to the entire application, and a module contributes its layouts with `meeko.addLayout(name, file)` (see [The `meeko` object](#the-meeko-object)). When two layouts have the same name, the project wins, then the page's own layer, then other layers in order, and finally modules; two modules with the same name are an error. `default` keeps the `1.4` rule: the project's layout also wraps layer pages; a layer's `default` only wraps its own pages when the project has none (nor `app/pages/+layout.meeko`), and a module's is used when neither project nor layer has one.

### Layout props from the page

The layout declares normal props. The page passes them, checked against the selected layout's `Props`, excluding `outlet`:

```html
<!-- app/layouts/dashboard.meeko -->
<script lang="ts">
	export interface Props {
		title?: string
		showAlert?: boolean
	}
	const props = defineProps<Props>({ showAlert: false })
</script>
<template>
	<header>{props.title}</header>
	<AppAlert if:when="props.showAlert" />
	<main><MeekoOutlet /></main>
</template>
```

Because Meeko renders the layout without props a page does not pass, named layout props must be optional or have default values; `meeko check` verifies this (`MEEK_LAYOUT_PROPS`).

**1. With route options (`layoutProps`).** Static or calculated from server data, like `head`: they reach the SSR HTML from the first byte.

```ts
// app/pages/connections.route.ts (or export const route in <script server>)
export const route = definePage({ layout: 'dashboard', layoutProps: { title: 'Connections', showAlert: true } })
```

```ts
export const route = definePage({
	layout: 'dashboard',
	load: async ({ context }) => ({ user: await users.current(context) }),
	layoutProps: ({ data }) => ({ title: data.user.name }),
})
```

With top-level code in `<script server>`, write the props as one more export. Since `1.8`, `export const layoutProps` is typed by its own values and checked against the layout; like `head`, it does not reach the page, so data that only the layout reads travels once, unless you also export it separately:

```html
<script server lang="ts">
	export const route = definePage({ layout: 'docs' })

	const { params } = usePage()
	const snapshot = await readPage(params.slug)
	export const doc = { html: snapshot.html }
	export const layoutProps = { nav: snapshot.nav, title: snapshot.title }
</script>
```

Exporting it and also declaring `route.layoutProps` is `MEEK072`.

The function receives the same context as `head` (`params`, `search`, `request`, `context`, `signal`, `state` and `data`); with top-level code in `<script server>`, `data` contains its exports, typed since `1.8` when the options are an object literal without a spread. They merge with `+group.ts` props and take priority. They travel in the payload (`layoutProps`), so they must be JSON-serializable: an `undefined` prop (`{ title: data.user?.name }` without a user, or `layout.set({ title: undefined })`) leaves the prop unset, so the layout uses its default value on both server and browser; a value JSON cannot represent (a date, a `Map`, an instance) fails the page with an error naming the page, layout and prop. On a `render: "client"` page, the object already reaches the server HTML and the function runs in the browser after `load`. `export const layoutProps` in `<script server>` is not an option: it would be another page data field.

**2. From the page's `<script>`: `useLayout()`.** It is auto-imported and, in a page, its type follows the layout selected by its `definePage` or `+group.ts` files (in another component, `useLayout<"dashboard">()`):

```html
<!-- app/pages/connections.meeko -->
<script lang="ts">
	const layout = useLayout() // LayoutHandle for "dashboard"
	const failing = signal(false)
	effect(() => layout.set({ showAlert: failing.value }))
</script>
<template>
	<p>Current title: {layout.props.title}</p>
	<button on:click="() => failing.value = !failing.value">Test connection</button>
</template>
```

- `layout.set(patch)` changes the named props and preserves the others; `layout.props` reads the props the layout receives (reactive); `layout.name` is the layout's name. A prop the layout does not declare, or with another type, is a type error.
- The layout does not remount: with `1.2` reactive props, only what reads those props changes.
- **Nothing carries over.** On navigation to another page, the layout receives the new page's props (its `layoutProps`, those of its `+group.ts` files and, for the rest, the layout's default values), even if the layout is preserved. A page that has already left cannot write.
- **SSR without mismatches.** The layout renders before the page, so what the page setup writes with `set` during rendering reaches the HTML through a second server render of the page (with the same request state and data, like an `await` pass), and the payload contains those props: the browser hydrates exactly that HTML. A render writing different values each time stops on the third pass. In the browser, what the page writes while rendering and hydrating applies when mounting finishes; afterwards, each `set` applies immediately.
- A page without a named layout (`layout: false`) receives a `useLayout()` that does nothing. Outside a page rendered by Meeko (a unit test), `useLayout()` throws an error.

**Markup in layout areas.** Props are for data. To put page content in a layout area (header buttons, breadcrumbs), use `<MeekoTeleport>`, which moves page markup to a layout target.

**Types.** `.meeko/types/routes.d.ts` declares `GeneratedLayouts` (each layout's props) and `GeneratedPageLayouts` (each route's layout). `LayoutProps<"dashboard">` (auto-imported) is the type of props a page can pass to `dashboard`; `LayoutName` is the union of names, and `PageLayout<"/connections">` is a route's layout.

**Comparison with Nuxt.** In Nuxt, `definePageMeta({ layout: "dashboard" })` selects the layout, but there is no typed way to pass it props: you resort to `useState`, `provide`/`inject` or `route.meta` (such as a `showAlert` in `meta`), without checking against the layout's types and with state that can carry over from the previous page. In Meeko, `layout` and `layoutProps` are checked against the layout's `Props`, reach the server HTML, `useLayout()` changes them reactively, and each navigation resets to the new page's props.

### Application error page (`app/error.meeko`)

`app/error.meeko`, alongside `app/app.meeko`, is the application-wide error page. It receives the same props as `+error.meeko`, `{ status: number; message: string }`, and `meeko check` checks them in the same way. It is used in two cases:

- **Unmatched URL.** A page request (GET or HEAD with `accept: text/html`, or navigation with `accept: application/meeko+json`) responds `404` with `app/error.meeko` inside the root layouts: `app/app.meeko` and `app/layouts/default.meeko` (or `app/pages/+layout.meeko`). The props are `{ status: 404, message: "NOT_FOUND" }`. Like a route's error page, the document is titled `Error` (`<title>` in SSR and `document.title` when navigating to an unmatched URL). The document includes the hydration payload, so the browser hydrates it and subsequent navigation works. In the browser, a link or `navigate()` to an unmatched URL loads the document: that URL may belong to server middleware, a file or a redirect, and checking it first with `fetch` would run a `GET` with side effects twice. If nothing else handles it, the server responds with `app/error.meeko`. For the same reason, returning through history to an unmatched entry reloads the document; navigation from the `404` page to application routes is client-side.
- **Failed page.** The nearest `+error.meeko` still takes priority; if none exists, `app/error.meeko` is used. The same applies to a `render: "client"` route's browser loader.

`/api/...`, `/_meeko/...`, assets and non-page requests keep their `404` responses (JSON or text). Without `app/error.meeko`, nothing changes: an unmatched URL responds `404` in plain text and the browser reloads the document. `app/error.meeko` and `app/pages/+error.meeko` would define the same level, so having both is a discovery error. In a layer or module, `app/error.meeko` backs up its own pages; the `404` uses the project's page. A custom host passes the page through `errorPage` to `createFrameworkHandler` and `mountClientApp` (`AppManifest.errorPage` in `createServerApp`).

### Page server code

A page declares its server code in a `<script server lang="ts">` block inside the `.meeko` file itself, so `app/pages` contains only `.meeko` files. The block supports two forms. They can coexist in the same block, except `load`, which cannot be combined with top-level code:

- **Top-level code** (since `1.1`). The block is normal server code: it reads the request, queries the database, redirects or responds `404`, and each `export const` is page data that reaches `<script>` and the template with its type.
- **Route options.** `export const route = definePage({ params, search, render, prerenderEntries, load, head })`, the `1.0` form, still works unchanged; since `1.5`, also `layout` and `layoutProps` (see [Named layouts](#named-layouts)), and since `1.7`, `sitemapEntries` (see [Dynamic routes in the sitemap](#dynamic-routes-in-the-sitemap-sitemapentries)).

#### Top-level code and exported data

```html
<!-- app/pages/users/[id].meeko -->
<script
	server
	lang="ts"
>
	import { definePage } from '@meekojs/meeko/framework'
	import * as v from 'valibot'

	export const route = definePage({ params: v.object({ id: v.string() }) })

	const { params, context } = usePage() // the current request, typed by route.params
	if (!context.session.current) redirect('/login')
	const row = await db.users.findById(params.id) // db: an auto-import from server/utils; row stays on the server
	if (!row) notFound()
	export const user = { id: row.id, name: row.name } // sent to the page
	export const head = { title: `Profile of ${user.name}` }
</script>

<script lang="ts">
	const name = signal(user.name) // `user` is in scope and typed
</script>

<template>
	<h1>{user.name}</h1>
	<input model="name" />
</template>
```

- **When it runs.** Block statements other than imports, types and `export const route` run on each request: in SSR and each client navigation's data request, after middleware and validation of `params` and `search` with `route`, just like `load`. They support top-level `await`. Imports, types and route options evaluate once per module.
- **Exports.** Each `export const` or `export let` (including destructuring, `export const { a, b } = ...`) except `route` and `head` is a page data field. Only exported names cross the boundary: the rest of the block, its imports and private variables do not reach the client bundle or payload. An export that is a promise is awaited before rendering.
- **In the page.** `<script>` and the template see each export as a normal, deeply read-only value, with the already-awaited export type. It is not a signal: it arrives in the payload and is replaced on each navigation when the block runs again. For editable state, create a signal from it (`signal(user.name)`). Declaring a name in `<script>` that the block already exports produces `MEEK075`. The page does not need to declare `data` in `defineProps`; if it does, `meeko check` checks compatibility with the exports.
- **`export const head`.** Sets the page's `<head>` like `route.head`: a `{ title, description }` object or a zero-argument function returning it, calculated on the server from block values. It is not part of the data. Declaring both `export const head` and `route.head` produces `MEEK072`. Since `1.2`, top-level `useHead` and `useSeoMeta` in the block are an alternative, with `export const head` taking priority (see [Document head](#document-head-document-usehead-and-useseometa)).
- **Request API.** `usePage()` returns `{ url, params, search, request, context, signal }`: `params` and `search` come from `route` schemas or, without a schema, from the route ID segments; `context` is the request context (session, services, platform) and `signal` aborts if the client disconnects, the session is revoked or the response is canceled. `redirect(url, status?)` stops the block and responds with a redirect (`302` by default; supports `301`, `302`, `303`, `307` and `308`), which client navigation follows like a loader redirect. `notFound()` stops the block and responds `404` with the nearest error page (`+error.meeko` or `app/error.meeko`). All three are imported from `@meekojs/meeko/framework` or used without an import inside the block. They work while top-level code runs: also inside a block helper called by that code (`function requireAdmin() { … redirect("/login") }`), even if it is `async`. Where no page is in progress, they produce `MEEK073`, and at runtime throw an error with that code: in route options, in a block without top-level code, in the component's `<script>` (since `1.3`, also without an import in `<script>` and the template) and, since `1.7`, in a function Meeko calls to calculate the head after top-level code has finished (`export const head = () => …` and the function passed to `useHead(() => …)` or `useSeoMeta(() => …)`); read values obtained by top-level code there. `meeko check` cannot know whether a block function is called later (from a timer, for example): in that case, the error only appears at runtime.
- **Serialization.** Exports travel in JSON, like `load` data. `meeko check` produces a type error for a non-serializable export: functions, `undefined`, `bigint`, symbols and class instances such as `Date` or `Map`. At runtime, a value rejected by `serializeJson` fails the response with `500`, like a loader.
- **State between requests.** Because the block runs on each request, a top-level variable (`const cache = new Map()`) is new each time. A value that must be shared between requests belongs in an imported module.

Meeko considers a block to have top-level code if it exports a name other than `route` (including `head`) with `export const` or `export let`, or uses `usePage`, `redirect` or `notFound` (since `1.2`, also `useHead` or `useSeoMeta`) outside any function and outside route options. A block with neither retains `1.0` behavior: it evaluates once as a module and supports `export default`, `export function` or a private constant used by `load`. With top-level code, these rules apply:

| Code      | Cause                                                                                                                                                                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MEEK070` | Top-level code and `route.load` together: exports are the page data. Choose one.                                                                                                                                                                                           |
| `MEEK071` | `export function`, `export class`, `export enum`, `export default`, `export { ... }` or `export const route` alongside other declarations in the same statement.                                                                                                           |
| `MEEK072` | Both `export const head` and `route.head`.                                                                                                                                                                                                                                 |
| `MEEK073` | `usePage`, `redirect` or `notFound` where no page is in progress: in route options, in a block without top-level code, in the component's `<script>` and template and, since `1.7`, in `export const head = () => …` or the function passed to `useHead` and `useSeoMeta`. |
| `MEEK074` | Top-level code on a `render: "client"` page, whose block runs in the browser. Use `useApi` or `useRpcQuery`, or render on the server.                                                                                                                                      |
| `MEEK075` | A name exported by the block is also declared in `<script>`.                                                                                                                                                                                                               |
| `MEEK076` | Route options read a name declared by top-level code, which runs later and on each request. Move the shared value to an imported module.                                                                                                                                   |

The editor gives exports their type in `<script>` and the template, and “Go to definition” on `user` takes you to the block's `export`.

#### Route options with `definePage`

```html
<!-- app/pages/users/[id].meeko -->
<script
	server
	lang="ts"
>
	import { definePage } from '@meekojs/meeko/framework'
	import * as v from 'valibot'

	export const route = definePage({
		params: v.object({ id: v.string() }),
		load: async ({ params, signal }) => ({ id: params.id, signalAborted: signal.aborted }),
		head: ({ data }) => ({ title: data.id }),
	})
</script>

<script lang="ts">
	export interface Props {
		params: { id: string }
		search: Record<string, string | string[]>
		data: { id: string; signalAborted: boolean }
	}
	const props = defineProps<Props>()
</script>

<template><h1>{props.data.id}</h1></template>
```

#### Common rules

The block is a TypeScript module independent of the component:

- **Server only.** The compiled component never includes it. It runs on the server with `server/utils` auto-imports and can import `server/` and `*.server.*` modules; relative imports resolve from the page's folder. Only a `render: "client"` route sends it to the browser (see “Rendering modes”).
- **Route options.** Just like a sidecar: `export const route = definePage({ ... })` or, without top-level code, `export default`. `render` and, since `1.5`, `layout` must be literals that `meeko build` can read without executing it.
- **Pages only.** A `<script server>` in a component, layout, `+layout.meeko` or `+error.meeko` is an error (`MEEK044`). A second block produces `MEEK004`, omitting `lang="ts"` produces `MEEK006`, and a value (`server="..."`) produces `MEEK043`.
- **Checking.** `meeko check` checks the block with TypeScript in server scope and compares its loader or exports with the page props; errors point to the `.meeko` line and column.

`head({ data })`, or `export const head`, returns the page's `title` and, since `1.1`, its `description`. In SSR, `title` goes in `<title>` and `description` in `<meta name="description">`, before the host's `<head>`; on navigation, they apply to `document.title` and that meta tag. A page without `title` or `description` leaves those provided by the host in `document.head`, or none, equally in SSR and navigation. Since `1.2`, route `head` also supports `useHead` tags and attributes (`meta`, `link`, `script`, `style`, `htmlAttrs`, `bodyAttrs` and `titleTemplate` as a string), with the highest priority over `useHead` and configuration `document`; the host's title and description remain after Meeko's managed head (see [Document head](#document-head-document-usehead-and-useseometa)).

Alternatively, route options can live in a `*.route.ts` sidecar next to the page (`app/pages/users/[id].route.ts`), the form available since `1.0`. A sidecar does not support top-level code. A page cannot declare both: Meeko stops route discovery with an error naming both files.

Route options validate params and search before the loader and top-level code. A loader can return a `Response` to redirect; top-level code uses `redirect()`. On client navigation, if the data request responds `404` (from `notFound()` or a loader `ApiError` with status `404`), the browser shows the nearest `+error.meeko`, or `app/error.meeko`, with `{ status: 404, message }`, where `message` is the public error code (`NOT_FOUND`), just like the SSR document. `meeko check .` compares each page's `ComponentProps` with the `params`, `search` and data its sidecar provides; a contract error identifies both files. It also checks that `app/app.meeko` and layouts accept the `outlet` supplied by Meeko, and that `+error.meeko` and `app/error.meeko` accept `status` and `message`. These contracts reject props declared as `any`, `never` or `unknown`. Loader data is required for the page when the sidecar declares `load`; a repeated query parameter without a schema can produce `string[]` as well as `string`. The SSR handler creates `useState` state and session context per request; it transfers only props, public state and serializable route data. The browser hydrates that payload and requests server data during navigation, so a private sidecar does not enter the client bundle; only `render: "client"` sidecars are public (see “Rendering modes”). `mountClientApp` manages history, cancellation and cleanup. If a host uses `loadRoute` directly on the client, its loader receives provisional state: Meeko applies its changes when confirming the route and discards them on cancellation or failure. That state's signals must be used during `load`, without retaining references after returning. You can use `render: "prerender"` with `prerenderEntries` for dynamic routes; without them, `meeko build` fails (`Dynamic prerender route /posts/[id] requires prerenderEntries`) and, since `1.7`, so do `meeko check` and `meeko dev` during route discovery, unless an options spread might supply them, which is left to the build. `meeko build` reads `render` from the sidecar without executing it: it must be a string literal inside `definePage({ ... })`, an exported object or a local constant in the same file; a calculated value, a computed key (`["render"]` or `[clave]`) not followed by a literal `render`, a spread without a subsequent explicit `render`, or a re-export stops the build, naming the affected file. The build writes HTML and navigation payloads under `.meeko/output/node/prerender/` (`meeko prerender .` repeats that step on an existing build). The server serves these pages through server middleware, session context and route middleware; it inserts the session CSRF meta tag in `<head>` without rewriting the document. Without a session, it responds with `ETag`, `Vary: cookie` and `cache-control: public, max-age=0, must-revalidate`, returning `304` for `If-None-Match`; with a session, it responds `private, no-store`. A CDN or shared cache in front of the server must respect `Vary: cookie` or avoid storing responses to requests with cookies; if it ignores `Vary`, configure it to bypass caching when a request has the session cookie, otherwise it could deliver the anonymous version to a user with a session, leaving them without a CSRF meta tag. `PrerenderedPage.headOffset` in the `prerender/manifest.json` index is measured in UTF-16 code units of the stored HTML read as text (JavaScript string indices), not bytes: an adapter must read the file as UTF-8 text and use the value as is, without calculating it from bytes. A URL with a query string, an ungenerated dynamic entry or a host with its own CSP nonce (without `server.contentSecurityPolicy`, which since `1.7` serves the file with its hashes) renders with SSR.
Loader checking covers both `definePage({ load() { /* ... */ } })` and `definePage(options)` when the type of `options` retains a required `load`.

#### Where each API is used

A component's `<script>` and template run in SSR and in the browser; `<script server>` and `*.route.ts` sidecars run on the server, outside the component. Since `1.3`, `meeko check`, `meeko build` and the editor flag each API where it does not exist, with a message explaining where to use it, and `<script>` and template autocomplete no longer offer server APIs:

| API                                                                                                                                    | `<script server>`                        | `<script>` and template                                              | `*.route.ts` sidecar | `server/`               |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------- | -------------------- | ----------------------- |
| `definePage`                                                                                                                           | Yes: `export const route`                | No effect: `MEEK109` warning, error in `2.0`                         | Yes                  | No effect               |
| `usePage`, `redirect`, `notFound`                                                                                                      | Yes, at top level; outside it, `MEEK073` | No: `MEEK073`                                                        | No: throw `MEEK073`  | No: throw `MEEK073`     |
| `defineApiRoute`, `defineRpc`, `defineServerMiddleware`, `defineSocketChannel`, `defineServerRuntime`, `ApiError`                      | Yes, without an import                   | No: `MEEK108`. In the browser, an API error arrives as `ClientError` | Yes                  | Yes, each in its folder |
| Auto-imports from `server/utils`, `imports.serverDirs` and `*.server.ts` files in any auto-import folder (including `imports.appDirs`) | Yes                                      | No: `MEEK108`. Request data with `useApi` or `useRpcQuery`           | Yes                  | Yes                     |
| Imports from `server/` and `*.server.*` modules                                                                                        | Yes                                      | No: `MEEK108`; `import type` is allowed                              | Yes                  | Yes                     |
| Value imports from `@meekojs/meeko/server` and `/cloudflare`                                                                           | Yes                                      | No: `MEEK108`; `import type` is allowed                              | Yes                  | Yes                     |
| Value imports from `@meekojs/meeko/node`, `/bun`, `/deno`, `/password` and `/build`                                                    | Yes                                      | `MEEK109` warning, error in `2.0`; `import type` is allowed          | Yes                  | Yes                     |
| `defineProps`, `defineEmits`, `defineExpose`, `defineModel`, `defineSnippets`, `useElementRef`, `onMounted`                            | No: `MEEK108`                            | Yes                                                                  | No                   | No                      |

Since `1.6`, [server route middleware](#server-route-middleware) (`app/middleware/*.server.ts`) is server code like `server/`: it uses `redirect()` and `notFound()` while running, like top-level `<script server>` code, and `defineServerRouteMiddleware` is auto-imported there; in a component's `<script>` or template it produces `MEEK108`.

With `render: "client"`, the block or sidecar runs in the browser (see [Rendering modes](#rendering-modes)) and cannot use the table's server APIs: a server auto-import, an import from `server/` or a `*.server.*` import stops the build, and the editor flags the auto-import with `MEEK_AUTOIMPORT`. A component inside `server/` (an email template, for example) only renders on the server, so it can use server APIs. The build and `meeko dev` only apply `MEEK108` to the browser bundle: a component outside `server/` imported only by server code (a template in `app/emails/` rendered by an API route) still compiles, as in `1.2`. `meeko check` and the editor, which do not know the import graph, check every component outside `server/` as browser code, just as in `1.2`; put those components in `server/` for them to be accepted.

`MEEK108` flags code that already failed before `1.3`: the server auto-import did not resolve in the browser bundle, `@meekojs/meeko/server` and `/cloudflare` cannot load there, a `server/` import stopped `meeko build`, and macros and `onMounted` do not exist outside `<script>`. `MEEK109` is a warning because that code compiles and loads: `definePage` in a component does not configure the route, and `/node`, `/bun`, `/deno`, `/password` and `/build` functions only fail when called in the browser (see [Stability policy](stability.md#deprecated-apis)).

### Rendering modes

The sidecar's `render` selects how each page reaches the browser:

| Mode              | Server HTML                                                          | Loader and `head`    | Usage                                                     |
| ----------------- | -------------------------------------------------------------------- | -------------------- | --------------------------------------------------------- |
| `"ssr"` (default) | Complete page on each request                                        | Server               | Indexable or personalized content                         |
| `"stream"`        | Page without `defer` values, which arrive later in the same response | Server               | Pages with slow, secondary data                           |
| `"prerender"`     | Complete page generated by `meeko build`                             | Server, during build | Static content                                            |
| `"client"`        | Layouts only, with an empty outlet                                   | Browser              | Dashboards and interactive views without SEO requirements |

Top-level `<script server>` code follows the mode like a loader: with `"ssr"` and `"stream"` it runs on each request, and with `"prerender"` once per entry during `meeko build`. In `"stream"`, an export created with `defer(...)` arrives after the page, like a deferred loader value (see [Streaming SSR](#streaming-ssr-render-stream)). It is not supported with `"client"` (`MEEK074`), because the block runs in the browser.

```html
<!-- app/pages/notes/index.meeko: the block runs in the browser -->
<script
	server
	lang="ts"
>
	import { definePage } from '@meekojs/meeko/framework'

	export const route = definePage({
		render: 'client',
		load: async ({ url, params, search, signal, state }) => api.notes.list({ signal }),
		head: ({ data }) => ({ title: `${data.length} notas` }),
	})
</script>
```

With `render: "client"`, the `<script server>` block (or sidecar) is public: it enters the browser bundle with client auto-imports, even though its tag says `server`.

With `render: "client"`, the server runs server and route middleware, creates session context and validates `params` and `search` against the sidecar schemas (invalid input responds `400`). It then renders `app/app.meeko` and layouts with an empty outlet, without calling `load` or `head`, and sends a payload with `render: "client"` and only `params` and `search`. Without layouts, `#app` is empty. In the browser, Meeko hydrates the layouts, runs `load` with `ClientPageLoadContext` (`url`, `params`, `search`, `signal` and `state`, without `request` or `context`) and confirms the page through the same transactional path as navigation; `head` runs after `load` and its `title` applies to `document.title`. A loader failure shows the nearest `+error.meeko` inside the layouts, with the same public message as the server (`500` reports to the navigation error observer; a 4xx `ClientError` retains its status and code).

Navigation works in both directions between SSR and client pages, preserving common layouts: each route selects its data source. `"client"` pages use their sidecar in the browser and others request their payload from the server. Only `"client"` sidecars enter the client bundle, through the `virtual:meeko-client-routes` virtual module; the generated entry point loads them with `mountClientApp({ loadClientRoute })`. This is why the build applies the same boundary as for other client code: importing `server/` or a `*.server.*` module from that sidecar stops `meeko build`, and only client auto-imports exist in the browser, so using a `server/utils` utility fails with an error naming the auto-import.

Tradeoffs of `"client"`:

- **SEO.** The initial HTML contains neither page data nor its `<title>`. Search engines that do not run JavaScript only see the layouts. Use `"ssr"` or `"prerender"` for indexable content.
- **Data security.** The sidecar is public: it cannot contain secrets or check permissions. Data arrives through API or RPC, and each endpoint must apply its own guards (session, CSRF, authorization and validation). Route middleware protects navigation, but not data.
- **Prerendering.** A `"client"` page cannot be prerendered: declaring `prerenderEntries` alongside `render: "client"` stops `meeko check`/`meeko build` with an explicit error.
- **Consistent build.** The server compares the sidecar's `render` with the build manifest's and responds with an error if they differ; rerun `meeko build` (or restart `meeko dev`) when changing a route's mode.

### Streaming SSR (`render: "stream"`)

A loader uses `defer` to mark data that can arrive after the page. `defer(promise, { timeoutMs })` or `defer((signal) => promise, { timeoutMs })` returns a `Deferred<T>` with `status` (`"pending"`, `"resolved"` or `"rejected"`), `value` and `error` (`{ code, status }`). Reading these fields in a template or `effect` subscribes to the result, because they are backed by signals.

With a factory, Meeko invokes it when the loader returns and passes an `AbortSignal` that aborts when the value is no longer awaited: on `timeoutMs`, if the client disconnects, the session is revoked, the stream is canceled, on a `HEAD` request or, in the browser, when leaving the route. Pass it to `fetch` or your database client to actually cancel the work. An already-started promise cannot be canceled: Meeko only stops awaiting it, unless the work itself uses the loader's `context.signal`, which also aborts in those cases (except the timeout, which is specific to each value).

```ts
// app/pages/posts/[id].route.ts
import { defer, definePage } from '@meekojs/meeko/framework'

export const route = definePage({
	render: 'stream',
	load: async ({ params }) => ({
		post: await api.posts.get({ params }), // critical: included in the initial HTML
		comments: defer((signal) => api.comments.list({ params, signal }), { timeoutMs: 5_000 }),
	}),
	head: ({ data }) => ({ title: data.post.title }),
})
```

```html
<p if:when="props.data.comments.status === 'pending'">Loading comments…</p>
<ul if:when="props.data.comments.status === 'resolved'">
	…
</ul>
<p if:when="props.data.comments.status === 'rejected'">Could not load ({props.data.comments.error?.code}).</p>
```

**Phase 0, before the first byte.** The server resolves the route, creates context and session, runs middleware, validates `params` and `search`, awaits the critical loader (everything outside `defer`), synchronously renders the page and all its layouts with deferred values in `pending`, and calculates `head`, which sees state written during rendering. It then seals state (`StateStore.seal()`: a later write throws `STATE_SEALED` and the deferred value causing it is rejected with `500`), awaits ongoing session changes (`create`, `rotate` or `revoke` started by the loader), and calls `context.session.verify()`; a session revoked while the loader ran responds `401` instead of a partial `200`. State, headers, cookies, CSRF token and `<title>` are fixed at that point: deferred work cannot redirect or change the session. From then on, `create`, `rotate` and `revoke` fail with `SESSION_LOCKED`/`500` before touching the store, so the browser session remains valid: only the deferred value attempting it is rejected, the failure reaches `onError`, and other values keep arriving.

Sealing applies to every rendering mode, not just `"stream"`. A state write from a promise nobody awaits (neither the loader with `await` nor a `defer`) throws `STATE_SEALED` inside that promise; without a catch, it is an unhandled rejection and Node terminates the process with its default configuration. Await that work in the loader or return it with `defer`.

**Phase 1, the stream.** The response has `cache-control: no-store, no-transform` and `x-accel-buffering: no`. First it sends the document through `#app`, the `#meeko-payload` payload (with `deferred: [{ id, path, status: "pending" }]` and `null` at each `path`) and the client entry point with `<script type="module" async>`, respecting the host's CSP nonce. For each value that resolves, in resolution order, a `<script type="application/json" data-meeko-deferred="N">{"deferred":N,"value":…}</script>` follows (or `"error":{"code","status"}`), and finally `</body></html>`. These are data blocks, not executable scripts, so a strict CSP without `'unsafe-inline'` needs no exceptions.

**Errors and cancellation.** A rejection serializes only as `{ code, status }`, with the same rules as the API: an `ApiError` retains its code and status; any other error becomes `INTERNAL_ERROR`/`500`, and its private cause goes to `onError` with the response's `requestId`. A value that does not finish within `timeoutMs` (10 s by default) is rejected with `DEFERRED_TIMEOUT`/`504`. Deferred values follow `RequestContext.signal`: if the client disconnects or an adapter write fails, the stream is canceled, Meeko stops awaiting pending deferred values and aborts their factory signals and the loader's `signal`, without reporting to `onError`; if the session is revoked, remaining values are sent as `SESSION_REVOKED`/`401`. A `HEAD` request receives final headers without a body and also aborts those signals. A promise passed directly to `defer` continues running until it finishes on its own.

**Browser.** The client hydrates with all deferred values in `pending`, as the server rendered them, and applies already-arrived values only when hydration finishes. It finds blocks already in the document and those subsequently added by the parser through a `MutationObserver` on `<body>`. It only accepts direct children of `<body>` after `#meeko-payload`, where the server writes them; a similar-looking block inside `#app` (user HTML, for example) is ignored. If the document ends without a value's block (for example, because a write failed), that value is rejected with `DEFERRED_INCOMPLETE`/`502`. On client navigation to a `"stream"` route, Meeko requests `accept: application/meeko+json` and the server responds `application/meeko+ndjson`: the first line is the payload, with which the route is confirmed, and each following line is `{ "deferred": id, "value" | "error" }`. A malformed line is reported to `onError` without stopping reading; if the connection fails halfway through, the failure is reported and values that did not arrive are rejected with `DEFERRED_INCOMPLETE`/`502`. Navigating to another route cancels the pending read. Other routes still respond `application/meeko+json`.

**`stream` versus `ssr`.** With `render: "ssr"` or `"prerender"`, a `defer` is awaited inside the server before rendering: HTML always contains the resolved value (or its error) and is safe for SEO, so a page can switch modes without changing its template. With `"prerender"`, a rejected value is not saved: the request responds `500` and `meeko build` stops, naming the route and the value's `path`. Prerendered HTML and its `index.meeko.json` come from the same loader execution. Use `"stream"` when a secondary part of the page (comments, recommendations, metrics) is slow and must not delay the first paint or interactivity. Tradeoffs:

- **SEO.** Deferred content is absent from the initial SSR HTML; it is in subsequent data blocks shown only when JavaScript runs. Content that must be indexed must go in the critical loader or an `"ssr"` page.
- **Proxies and CDNs.** A proxy, load balancer or CDN that stores the entire response before forwarding it defeats streaming: the user waits as with `"ssr"`. Meeko sends `x-accel-buffering: no` (respected by nginx) and `cache-control: no-store, no-transform`: `no-transform` asks intermediaries not to compress or rewrite the body, since buffered compression or rewriting would hold back blocks. On Cloudflare, `no-transform` disables compression to the visitor and features that modify HTML, but not read-only inspection: if a zone enables it, create a Configuration Rule with “Response Body Buffering” set to “None” for those routes. Locally, `wrangler dev` and `meeko preview --adapter cloudflare` (Miniflare) gzip `text/html` responses even with `no-transform` and write the compressed body only when finished, so a `"stream"` page appears to arrive all at once at the end unless the client sends `accept-encoding: identity`. In production, Cloudflare compression does respect `no-transform`. Other intermediaries or serverless functions without streaming responses require separate configuration. Node, Bun and Deno adapters write each block as soon as it is produced; the conformance suite checks that the first byte arrives before the deferred value.
- **Final headers.** Redirects, cookies, CSRF and `<title>` depend only on critical data. Moving something into `defer` removes it from those decisions.
- **Browser loaders.** A `"client"` sidecar (or a host using `loadRoute`) can also return `defer`: the browser applies the same `timeoutMs`, updates the value when its promise finishes, and aborts a factory's signal on timeout or when leaving the route.
- **Keys.** A deferred value can be under any own key, including `constructor` and `prototype`, except `__proto__`: the server responds `500` when rendering.

### SSR page caching

Since `1.7`, `definePage`'s `cache` lets you revalidate and cache an `"ssr"` or `"stream"` page without running its loader or render on each request:

```html
<!-- app/pages/docs/[...slug].meeko -->
<script
	server
	lang="ts"
>
	import { definePage } from '@meekojs/meeko/framework'

	export const route = definePage({
		cache: {
			// Cheap: query the modification date, rather than the document.
			etag: async ({ params }) => (await docs.updatedAt(params.slug))?.toISOString(),
			maxAge: 60,
			staleWhileRevalidate: 600,
			memory: { maxEntries: 500 },
		},
		load: ({ params }) => docs.get(params.slug),
	})
</script>
```

- **`etag(ctx)`** returns the content version (a string or number) and runs before the loader and render, with validated `url`, `params` and `search`, plus `request`, `signal` and `context`. Meeko combines it with the request theme (cookie and client hint), build and response type (document or navigation payload) into a weak `ETag`, `W/"…"`. If it matches `If-None-Match`, it responds `304` without a loader, plugins or render. It must change with everything that changes the HTML except the theme: if the page reads a header or search parameter outside `params`, include it. `undefined` leaves that response without an `ETag`.
- **`maxAge`** and **`staleWhileRevalidate`** (seconds) write `Cache-Control: public, max-age=N, stale-while-revalidate=M`. Without `maxAge`, `public, max-age=0, must-revalidate`: the browser revalidates each time and the `ETag` saves the body transfer.
- **`memory`** (`true` or `{ maxEntries, maxBytes }`, defaulting to 1000 entries and 32 MiB per route and process) stores rendered HTML and payload in an LRU, keyed by URL, theme and response type, with the `ETag` used to render them. Since `1.7`, on a route with a `search` schema, the URL part after `?` is the validated `search`: an undeclared parameter (`?utm_source=…`, a random number to bypass the cache) shares the copy instead of filling the LRU; without a schema, the query counts as received, because the page receives it all. While `etag` returns the same value, Meeko serves the copy without a loader or render; when it changes, the copy is discarded and the page renders again. Requires `etag`. Two simultaneous requests finding no copy both render.

The response has `Vary: Accept, Cookie` (and `Sec-CH-Prefers-Color-Scheme` with the theme in `"system"`), because document and payload share a URL and HTML depends on theme and session. With `server.contentSecurityPolicy`, a cached page's document has no nonce and its CSP contains hashes of inline code Meeko writes, never of a `<script>` or `<style>` arriving inside the page (see [CSP and headers in server adapters](#csp-and-headers-in-server-adapters)); the `304` has no CSP, so the browser keeps its copy's policy.

**What is never cached.** Caching only applies in production (in `meeko dev`, each request renders what was just compiled) and to sessionless `GET` and `HEAD` requests:

- a request with the session cookie, even expired, or with `session.current`, goes out as usual with `no-store` and no `ETag`: its HTML contains that session's CSRF token;
- a response setting a cookie (a loader creating a session, for example) goes out with `no-store`, no `ETag` and no memory copy; in development, Meeko warns once per route in the console;
- since `1.7`, a request with the `Authorization` header goes out with `no-store` and no `ETag`, without reading or writing the copy: the response is for those credentials;
- a host with its own nonce (`DocumentOptions.nonce` without `server.contentSecurityPolicy`) does not cache: the copy would contain another response's nonce;
- a request with the single-use cookie containing a JavaScript-free form's result (`__Host-meeko-form`, or `meeko-form` without HTTPS) receives neither `304` nor the memory copy, is not stored, and on a prerendered page renders instead of serving the file;
- and, in any application response, `Set-Cookie` with a `public` `Cache-Control` or, since `1.7`, with `s-maxage` (including when added by `server.headers`) becomes `private, no-store` without an `ETag`.

**Personalizing with your own cookies.** Meeko only recognizes its session cookie. A page with `cache` that personalizes HTML using another cookie (language, currency, anonymous cart, A/B test) shares it: `etag` does not see it unless it reads it, and `memory` serves the same copy to everyone. `Vary: Cookie` only prevents a shared cache mixing responses with different cookies. If HTML depends on your own cookie, include its value in what `etag` returns and do not use `memory`, or do not use `cache` on that page.

**Middleware.** Route middleware (isomorphic and server) always runs, before the `304` and the memory copy: caching never bypasses a guard. With `memory`, application plugins do not run on a request served from the copy.

**`render: "stream"`.** Only uses `ETag` and `304`: its body goes out as `defer` values resolve, so storing it would require waiting for all of them (the opposite of a stream) and fix values that can change on each request. Its `Cache-Control` adds `no-transform`, as always, and its CSP contains the document hashes without deferred values, which are JSON data blocks. With `"prerender"`, `cache` only affects SSR for URLs that were not prerendered; a `"client"` page does not support `cache` (type error and `TypeError` when defining it).

`cache` is read when the route executes, like `load`: `meeko build` does not read it from the file. `definePage` validates it when loading the module (an unknown field, a negative number or `memory` without `etag` throws `TypeError`).

### Links, anchors and scrolling

`mountClientApp` turns clicks on same-origin links to application routes into client navigation, including links in HTML inserted with `html`. A link to a current-page fragment (`#seccion`, or `/docs#seccion` while on `/docs`) is not intercepted: the browser scrolls the page and adds the history entry without requesting or rendering the page again, and going back or forward between those fragments does not render it either. `app.navigate("#seccion")` does the same.

A new navigation starts at the top of the page or, if its URL has a fragment naming an element (`id` or `name`), at that element, immediately even if the page uses `scroll-behavior: smooth`. History navigation or navigation with `replace` only scrolls to the fragment, if any. If a navigation data request receives HTML instead of a payload (static hosting serving the prerendered `index.html`, a proxy or CDN), Meeko loads that document instead of failing.

### Native View Transitions

Enable client navigation transitions in `meeko.config.ts`:

```ts
export default defineMeekoConfig({
	viewTransitions: true,
})
```

The option is boolean and disabled by default. Meeko loads the page, its modules and data before starting `document.startViewTransition()`, placing the DOM and head change inside the callback. It does not animate SSR, initial hydration or current-page fragment changes. It works with internal links and back/forward navigation. Without the API, with a hidden tab or with `prefers-reduced-motion: reduce`, it navigates normally.

It does not animate a page that is too large either: above 4,000 elements, on the source or the destination page, it navigates without a transition. In a document that size, on a high-density screen or a phone, each frame of the transition blocks the page for seconds. If the destination is the large one, Meeko captures the source page and skips the animation when it applies the change. If you call `document.startViewTransition()` yourself, check the same with [`isTooLargeToAnimate`](reference/utils/istoolargetoanimate.md).

The browser provides a basic transition; customize the animation from `app/styles/main.css` with native CSS:

```css
.project-surface {
	view-transition-name: project-surface;
}

::view-transition-group(project-surface) {
	animation-duration: 280ms;
	animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
}
```

Use the same `view-transition-name` on the source and destination elements. Each name must be unique among visible elements on a page; duplicates can prevent animation, though navigation still completes. No directive or wrapper component is needed. See the [native API](https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition).

Since `1.8`, a navigation's transition has the type `meeko-route`, so CSS can tell it from one that a component starts. Name an element only during navigations:

```css
html:active-view-transition-type(meeko-route) .tabs-indicator {
	view-transition-name: tabs-indicator;
}
```

A browser without transition types (Chrome before 125, Safari before 18.2, Firefox before 147) still animates the navigation and ignores those rules.

To disable or enable a particular navigation, use `app.navigate('/projects', { viewTransition: false })` in a host with the `ClientApp` returned by `mountClientApp`. Links support a standard HTML attribute, on both `<MeekoLink>` and `<a>`:

```html
<MeekoLink
	to="/projects"
	data-meeko-view-transition="false"
>
	Open without a transition
</MeekoLink>
```

`data-meeko-view-transition="true"` enables that link even when the global option is disabled; reduced motion still takes priority. The navigation promise waits for the DOM change, without waiting for the animation to finish. A subsequent navigation or application unmount skips the previous animation; an aborted update cannot replace the new page. Animation failures do not become navigation failures; render errors continue propagating as before.

This option controls changes within the same document. Navigation to new documents can use `@view-transition { navigation: auto; }` in both same-origin pages' stylesheets, subject to browser support and that API's rules. UI modals keep their local animations and do not need whole-page snapshots. The `/transitions` example on the `apps/ui` public site includes a shared surface between list and detail, plus links without a transition.

### Navigation state

`useNavigation()` returns `{ pending }`, a read-only signal that is `true` from the start of navigation until its page is confirmed, fails or is canceled, including the first load of a `"client"` page and loading the new page's `await useApi`/`await useRpcQuery` calls (see [Navigation and `render: "client"`](#navigation-and-render-client)). In SSR and outside `mountClientApp`, it is always `false`. Since `1.7`, it is auto-imported, like `useRoute` (your own export with that name takes priority).

```ts
import { useNavigation } from '@meekojs/meeko/framework'

const nav = useNavigation()
// <p if:when="nav.pending.value">Loading…</p>
```

### Current route

Since `1.2`, `useRoute()` returns the confirmed route rendered by the component, with a read-only signal for each value (`RouteState` type):

| Field                                | Value                                                                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `url`                                | Origin-relative URL as a string: `pathname`, `search` and, in the browser, the fragment (`/users/42?tab=a#bio`). It excludes the origin, so it matches HTML prerendered on another domain.                               |
| `path`                               | `pathname`, encoded as in `location.pathname` (`/users/42`).                                                                                                                                                             |
| `id`                                 | Route ID in the manifest (`"/users/[id]"`), or `null` on the `app/error.meeko` `404` page for an unmatched URL.                                                                                                          |
| `params`                             | Route parameters, in the same shape the page receives (validated by its schema).                                                                                                                                         |
| `search`                             | Search parameters, in the same shape the page receives; on the `404` page, the query string with repeated keys in arrays.                                                                                                |
| `isActive(to, { params?, prefix? })` | Since `1.5`, a function, not a signal: whether route `to` is active, using the `<MeekoLink match>` rule. Returns `"page"` on the exact route and, with `prefix: true`, `"true"` on a route below it; otherwise, `false`. |

It is auto-imported in applications (your own export named `useRoute` in `app/composables` or another auto-import folder takes priority over the framework's), and, like `useNavigation`, can also be called from nested code running with the component (a composable, `computed`, `effect` or `onMounted`), but not from an event handler, timer or promise callback, where no root is active: there it throws (`useNavigation` returns a fixed state with `pending` set to `false`); get it in the script and use it in the handler. It works in pages, layouts, `app/app.meeko`, `app/error.meeko` and their components:

- **SSR.** Values are those of the request, including on `"prerender"` and `"stream"` routes and in layouts of a `"client"` route. The server does not receive the fragment, so SSR `url` never includes it.
- **Hydration.** The browser hydrates with the same values as SSR, without mismatches, even when the HTML was rendered for another URL: the `static` adapter's `404.html`, served by hosting for any nonexistent URL, or a prerendered page served by static hosting with any query string. The payload includes the render URL (optional `url` field, since `1.6`). Just after hydration, `url` and `path` become those of the browser address, including its `#fragmento`; on the `404` page, so does `search`, while on a page, `params` and `search` remain those validated by the server.
- **Navigation.** Values change only when navigation is confirmed, together with the outlet, never while `useNavigation().pending` is `true`; the previous page is disposed of before effects reading the route update. Values also change when going back or forward in history and on fragment-only navigation, where `path` stays the same and `url` changes. The preliminary render loading the new page's data `await` calls already sees the destination route.
- **Outside an application.** Outside framework rendering or `mountClientApp` (for example, in a unit test with `renderToString`), `useRoute()` throws an explanatory error instead of inventing a route; pass the route to the component as a prop in those tests.

**`isActive`.** Since `1.5`, `route.isActive(to, { params, prefix })` tells you whether a route is active with the same rule as [`<MeekoLink match>`](#meekooutlet--and-meekolink), for your own links and components. `to` is a `RouteId` and `params` are that route's parameters, with the type used by `href()`: required on a dynamic route, unsupported on others, and a nonexistent route is a type error. It returns `"page"` when the confirmed route is `to`, `"true"` with `prefix: true` when it is below it by complete segments, and `false` otherwise; `"/"` only matches exactly. It ignores query strings and fragments and compares encoded paths. The result works directly for `bind:aria-current`, because `bind:` removes the attribute when its value is `false`, and as a condition, because `"page"` and `"true"` are truthy. It reads `path`, so a template, `computed` or `effect` using it updates on navigation; in SSR and hydration it returns the same result, without mismatches.

A layout with a sidebar marks the active section this way, both in server HTML and after each navigation:

```html
<!-- app/layouts/default.meeko -->
<script lang="ts">
	const route = useRoute()
	const links = [
		{ to: '/', label: 'Home' },
		{ to: '/users', label: 'Users' },
		{ to: '/settings', label: 'Settings' },
	] as const
	const inSettings = computed(() => route.isActive('/settings', { prefix: true }) !== false)
</script>

<template>
	<aside>
		<nav>
			<a
				each:of="links"
				each:as="link"
				each:key="link.to"
				bind:href="href(link.to)"
				bind:aria-current="route.isActive(link.to, { prefix: true })"
			>
				{link.label}
			</a>
		</nav>
		<p if:when="inSettings.value">Changes are saved when you leave.</p>
	</aside>
	<main><MeekoOutlet /></main>
</template>
```

Components received as props retain the contract's direction: a component requiring `label` does not satisfy an outlet that can render it without `label`. `meeko check` diagnoses the expression passing the component. When you save a TypeScript module imported by an open `.meeko`, the VS Code extension rechecks its diagnostics and semantic tokens.

### Document head: `document`, `useHead` and `useSeoMeta`

Since `1.2`, Meeko manages each document's `<head>` and the attributes of `<html>` and `<body>` from three sources, combined using one priority rule:

- **`document` in `meeko.config.ts`.** The application's common document: `lang` and a `head` with tags and attributes. It renders in all HTML documents: SSR, `"stream"`, `"prerender"`, the `app/error.meeko` `404` page, a failed route's error document, and a `"client"` route's shell. It is fixed at build time (and also reaches the browser bundle, because it ends up in HTML), so it must be serializable: `titleTemplate` can only be a string (its type, `DocumentHead`, does not accept a function, so the editor and `meeko check` flag it as a type error in `meeko.config.ts`) and `meeko build` rejects a function. Its `title` is the site title: pages without their own title show it unchanged, without a template (see **Title** below). Meeko modules add their head before the application's, which wins.
- **`useHead(input)`.** In pages, layouts, `app/app.meeko`, `app/error.meeko`, components and composables, at script top level or in a composable it calls. Also in top-level `<script server>` code, as an alternative to `export const head` (see below). `input` can be an object, getter or signal; with a getter or signal, the browser updates the document when the values it reads change.
- **`useSeoMeta(input)`.** Typed shorthand for `useHead`: `description`, `robots`, `themeColor`, `colorScheme`, `author`, `keywords`, `applicationName`, `referrer` and `twitter*` fields produce `<meta name>`; `og*` fields (`ogTitle`, `ogDescription`, `ogImage`, `ogImageAlt`, `ogImageWidth`, `ogImageHeight`, `ogUrl`, `ogType`, `ogSiteName`, `ogLocale`) produce `<meta property>`; `title` is the title and `canonical` is `<link rel="canonical">`. An `undefined` or `null` field produces nothing.

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	document: {
		lang: 'es',
		head: {
			// “Shoes · My store” on a titled page; “My store” on an untitled one.
			title: 'My store',
			titleTemplate: '%s · My store',
			link: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
			// Runs while the browser reads <head>, before painting; hydration does not repeat it.
			// (For a light/dark theme, use theme: Meeko provides the script, cookie and useTheme().)
			script: [{ children: 'document.documentElement.dataset.theme = localStorage.getItem("theme") ?? "light"' }],
		},
	},
})
```

```html
<!-- app/pages/products/[id].meeko -->
<script
	server
	lang="ts"
>
	const { params } = usePage()
	export const product = await findProduct(params.id)
</script>

<script lang="ts">
	const quantity = signal(1)
	useSeoMeta({
		title: product.name,
		description: product.summary,
		ogImage: product.image,
		twitterCard: 'summary_large_image',
		canonical: `https://tienda.example/products/${product.id}`,
	})
	useHead(() => ({ title: `${product.name} (${quantity.value})` }))
</script>
```

`HeadInput` supports `title`, `titleTemplate` (`"%s · Sitio"` or `(title) => string`; in `document.head`, `meeko.addHead` and route `head`, only the string), `meta`, `link`, `script` (external with `src` or inline with `children`; `async`, `defer`, `module` and `type`), `style` (with `children` and `media`), `htmlAttrs` and `bodyAttrs` (`lang`, `dir`, `class`, `data-*`; an `undefined` value contributes nothing and `on*` attributes are rejected).

**Priority.** Lowest to highest: configuration `document`, `app/app.meeko`, each layout (innermost wins), the page with its components and, finally, route `head` (`export const head`, `route.head` or `useHead` in `<script server>`). Within a level, the later call wins, so a page component mounting later (after an `if:`, for example) replaces what the page set. `<html>` and `<body>` attributes merge by name with the same priority.

**Title.** `titleTemplate` comes from the highest-priority entry declaring it, and applies to the highest-priority title from `app/app.meeko`, layouts, page and route `head`, including error pages: `"Error"` or, above it, the title the error page itself (`app/error.meeko` or `+error.meeko`) declares with `useHead`, which its layouts' titles do not override. The `title` in `document.head` (or added by a module with `meeko.addHead`) is different: it is the site title and never passes through the template. A page without its own title shows that title unchanged, as does one whose winning title is an empty string, instead of a template around nothing. Without a site title, a page without a title has no managed `<title>` (the host's remains, if any), and an empty title is written empty. The rule is the same in SSR, hydration and client navigation. With the example configuration:

| Page title | `<title>`          |
| ---------- | ------------------ |
| `"Shoes"`  | `Shoes · My store` |
| none       | `My store`         |
| `""`       | `My store`         |

**Deduplication.** Each tag has a key: `key` if declared, otherwise its natural key. For `meta`, `name` (case-insensitive), `property` or `httpEquiv`, together with its `media` if present (two `theme-color` tags for light and dark coexist); for `link`, `rel` and `href`, except `rel: "canonical"` and `rel: "icon"`, which are unique even if `href` changes; for `script`, `src` or the code; for `style`, the CSS. With the same key, only the highest-priority tag remains, in the position where the first appeared. Thus a `document` `icon` replaces the `<link rel="icon" href="data:,">` Meeko writes by default, and a `meta name="viewport"` replaces the default viewport.

**SSR and CSP.** The server writes `<html lang="…">` and attributes as real, escaped attributes. Inside `<head>`, after the CSRF meta tag and component styles, the title and managed tags go between `<!--meeko:head-->` and `<!--/meeko:head-->` comments, before trusted host HTML (`DocumentOptions.head`, which keeps its own `<title>` as the default title). Attribute values are escaped; inline `script` and `style` content is not escaped but cannot close its tag: `</` is written `<\/` (and `<!--` as `<\!--` in a script), and in JSON scripts (`application/ld+json`, `application/json`, `importmap`, `speculationrules`) each `<` is written `\u003c`. The request's CSP nonce (`DocumentOptions.nonce`) is added to managed `<script>` and `<style>` tags. A prerendered page keeps the head and receives the CSRF meta tag just after `<meta charset>` and default tags the application did not replace.

**Browser.** On hydration, Meeko adopts SSR tags without duplicating them or rerunning scripts. When a `useHead` getter or signal changes, it updates title, attributes and tags. On navigation, unmounted components' entries disappear and what they replaced returns (for example, the layout's `canonical` or `app/app.meeko`'s `description`); going back restores the page's entries. New tags are inserted before `<!--/meeko:head-->` with the document's CSP nonce; a changed script is a new element, which the browser executes. Route `head` travels in the navigation payload, just like `title` and `description` in `1.1`. Outside a Meeko application (for example, in a unit test with `renderToString`), `useHead` does nothing. A custom host passing `DocumentOptions.config` to `createFrameworkHandler` must pass the same value to `mountClientApp({ document })`; Meeko's generated entry point already does this.

**`<script server>`.** Top-level `useHead` and `useSeoMeta` make the block have top-level code, like `usePage`. Their entries form the route `head` together with `export const head` (or `route.head`), which takes priority over them. Because they travel in the payload, their `titleTemplate` must be a string.

#### Per-page canonical URL and Open Graph

Since `1.3`, `document.seo` adds tags depending on the page to each document, which each page would otherwise need to repeat with `useSeoMeta`:

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	site: 'https://example.com',
	document: { seo: true, head: { titleTemplate: '%s · Mi sitio' } },
})
```

| Option          | Tag                                | Value                                                                                 |
| --------------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| `canonical`     | `<link rel="canonical">`           | The page's origin and path, without the query string: `https://example.com/docs/api`. |
| `ogUrl`         | `<meta property="og:url">`         | The same URL.                                                                         |
| `ogTitle`       | `<meta property="og:title">`       | The final title, with `titleTemplate` applied.                                        |
| `ogDescription` | `<meta property="og:description">` | The page's `description` (from route `head`, `useSeoMeta` or `document.head`).        |

`seo: true` enables all of them; an object disables those set to `false` (`seo: { ogDescription: false }`). The origin is `site` or, without it, `MEEKO_PUBLIC_ORIGIN` from the build environment; with `canonical` or `ogUrl` enabled and neither supplied, `meeko build` fails with a message requesting it. It is fixed at build time (`seo.origin` in the manifest), so an SSR-rendered page uses the same origin as a prerendered one. In `meeko dev` without an origin, these two tags are not written.

These are the lowest-priority tags: a page or layout declaring the same tag (with `useSeoMeta`, `useHead` or route `head`, with any `key`) replaces it, just like `document.head` tags. Error pages (`app/error.meeko`, `+error.meeko` and the `static` adapter's `404.html`) receive neither `canonical` nor `og:url`, because they are served at any URL. On client navigation, tags follow the confirmed page. A custom host passing `DocumentOptions.config` with `seo` must include `seo.origin`.

### Light/dark theme without flashing

Since `1.4`, Meeko includes light/dark themes (and custom themes): the choice is saved in a cookie, the server writes the theme on `<html>` from the first byte, and components render the correct icons in server HTML without waiting for JavaScript. When the server cannot know it (a prerendered page, the `static` adapter or `"system"` mode without a client hint), a minimal blocking `<head>` script applies it before the first paint.

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	theme: true, // light and dark, "system" by default, data-theme and the meeko-theme cookie
})
```

```css
/* app/styles/main.css: each theme's colors, with color-scheme even without JavaScript. */
:root {
	color-scheme: light;
	--bg: #fff;
	--ink: #111;
}
:root[data-theme='dark'] {
	color-scheme: dark;
	--bg: #111;
	--ink: #eee;
}
/* Without the attribute (unresolved "system" mode and no JavaScript), the system takes precedence. */
@media (prefers-color-scheme: dark) {
	:root:not([data-theme]) {
		color-scheme: dark;
		--bg: #111;
		--ink: #eee;
	}
}
```

Without `theme`, nothing changes: no script or style in `<head>`, cookie, headers or `POST /_meeko/theme`. `theme` accepts `true` or an object:

| Option        | Default                                  | What it does                                                                                                                                                    |
| ------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `themes`      | `["light", "dark"]`                      | The themes. Each name uses letters, digits, `-` or `_` and cannot be `"system"`.                                                                                |
| `default`     | `"system"`                               | The choice for someone who has not chosen: `"system"` or a theme (the first if `system: false`).                                                                |
| `system`      | `true`                                   | `"system"` mode, following `prefers-color-scheme`. `true` uses `light` and `dark`; `{ light: "day", dark: "night" }` selects other themes; `false` disables it. |
| `darkThemes`  | the dark theme from `system` (or `dark`) | Themes receiving `color-scheme: dark`.                                                                                                                          |
| `attribute`   | `"data-theme"`                           | Where the theme goes on `<html>`: a `data-*` attribute or `"class"` (adds the theme name to classes and removes the other theme's).                             |
| `colorScheme` | `true`                                   | Applies `color-scheme` to `<html>` via CSSOM (`style.colorScheme`).                                                                                             |
| `cookie`      | `"meeko-theme"`                          | The choice cookie.                                                                                                                                              |
| `storageKey`  | the value of `cookie`                    | The `localStorage` key, notifying other tabs: by default, the cookie name (`"meeko-theme"` if `cookie` is unchanged); `false` uses only the cookie.             |
| `clientHints` | `true`                                   | Requests and reads `Sec-CH-Prefers-Color-Scheme` to resolve `"system"` on the server.                                                                           |

Cookies are per host, not per port: in development, all Meeko applications on `localhost` (or `127.0.0.1`), on any port, share the `meeko-theme` cookie, so choosing a theme in one changes the others on reload (`localStorage` is per port). To separate them, give each application its own name with `cookie`, for example `theme: { cookie: "mi-app-theme" }`.

#### `useTheme()`

`useTheme()` is auto-imported in `.meeko` files (your own export with that name takes priority) and called while a component's script runs. It returns:

- `theme`: the choice, including `"system"`. It is a writable signal: assigning it is equivalent to `set`, and works for `model="theme"`.
- `resolved`: the effective theme, read-only; in `"system"`, the one from `prefers-color-scheme`.
- `themes`: the list of themes, without `"system"`.
- `set(theme)`: changes the choice. Updates the `<html>` attribute (or class), `color-scheme`, cookie and `localStorage`. A name other than a theme or `"system"` throws `TypeError`.

In `"system"`, `resolved` follows `prefers-color-scheme` changes while the page is open, and a change in another tab arrives through the `localStorage` `storage` event. Client navigation preserves the theme, because it does not reload `<html>`. On the server, `theme` and `resolved` are those of the request and cannot be changed (`set` throws an error). Without `theme` in the configuration, `useTheme()` throws an error requesting it.

`meeko check` types themes from the configuration: with `themes: ["light", "dark", "sepia"]`, `resolved` is `"light" | "dark" | "sepia"` and `set("purple")` is a type error. Declarations are generated in `.meeko/types/routes.d.ts` (`GeneratedTheme`); without them, themes are `string`. The editor does not need them: it declares `GeneratedTheme` from `theme` read without executing `meeko.config.ts`, even before the first `meeko check`, when its value is a literal (`true` or an object with literal values).

#### Icons that do not shift

The shortest approach is [`<MeekoThemeToggle>`](#meekothemetoggle), which already does the following. Manually, there are two ways to render icons, and both are correct in server HTML when the server knows the theme (cookie, or client hint in `"system"`):

- **With CSS (recommended).** The component renders both icons and CSS shows one according to the `<html>` attribute. It never shifts, even when the server does not know the theme (a prerendered page, the `static` adapter or `"system"` without a client hint), because the `<head>` script sets the attribute before painting and CSS reads it from the first frame.
- **From `resolved`.** `{resolved.value === "dark" ? "luna" : "sol"}` or an `if:` on `resolved`. It is correct whenever the server knows the theme; when it does not, server HTML and hydration render the light theme from `system`, and the icon changes when hydration finishes.

```html
<!-- app/components/ThemeToggle.meeko -->
<script lang="ts">
	const { resolved, set } = useTheme()
	const toggle = (): void => set(resolved.value === 'dark' ? 'light' : 'dark')
</script>

<template>
	<button
		type="button"
		class="theme-toggle"
		aria-label="Theme oscuro"
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
	.theme-toggle .moon {
		display: none;
	}
	:root[data-theme='dark'] .theme-toggle .sun {
		display: none;
	}
	:root[data-theme='dark'] .theme-toggle .moon {
		display: inline;
	}
</style>
```

`aria-pressed` depends on `resolved`, so in the unknown case it changes on hydration; this is invisible, and a screen reader announces it once the page is interactive. A three-option selector (system, light, dark) uses `theme` with `model`:

```html
<script lang="ts">
	const { theme } = useTheme()
</script>
<template>
	<select
		aria-label="Theme"
		model="theme"
	>
		<option value="system">System</option>
		<option value="light">Light</option>
		<option value="dark">Dark</option>
	</select>
</template>
```

<a id="data-theme-choice"></a>**`data-theme-choice`.** Since `1.4`, `<html>` also carries the choice, including `"system"`: `data-theme-choice="system"` while `data-theme` gives the effective theme (`dark`). The `<head>` script always writes it before the first paint, as does the server when it knows it from the cookie; the runtime updates it on each change. It is useful for your own CSS, whether or not you use `<MeekoThemeToggle>`: a “system” icon that does not shift, or a selector's checked radio.

```css
.theme-toggle .icon {
	display: none;
}
:root[data-theme-choice='light'] .theme-toggle .sun,
:root[data-theme-choice='dark'] .theme-toggle .moon,
:root[data-theme-choice='system'] .theme-toggle .monitor {
	display: inline;
}
```

Without a cookie, server HTML does not include it (it does not know whether `localStorage` stores another choice, and a prerendered page is the same for everyone); the script writes it before painting. Without JavaScript, a `:root:not([data-theme-choice])` selector corresponds to `default`.

#### Custom theme selector

Since `1.8`, `useThemeToggle()` from `@meekojs/meeko/framework` is the public API for building a selector. Call it in a component script with `theme` enabled in `meeko.config.ts`; without that configuration or outside an application, it throws `MEEK111`. It takes no parameters and returns a `ThemeToggleState`, shared by the entire application:

| Member        | Description                                                                                                                                                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `theme`       | The same `ThemeState` as `useTheme()`: `theme`, `resolved`, `themes` and `set(choice)`.                                                                                                                                                               |
| `choices`     | List of configured choices, in order, including `"system"` if enabled. Read-only.                                                                                                                                                                     |
| `system`      | `ThemeToggleSystem`: `{ light, dark }`, the theme names for `"system"`; `undefined` without system mode.                                                                                                                                              |
| `known`       | `ReadonlySignal<boolean>`: the server knows the choice if it received the cookie; in the browser, becomes `true` when hydration finishes. While `false`, use a neutral accessible name, such as “Change theme”, without announcing an unknown choice. |
| `interactive` | `ReadonlySignal<boolean>`: `false` during SSR and hydration; `true` when browser handlers are ready. Use the native form while it is `false`.                                                                                                         |

The form sends `POST /_meeko/theme` with `theme` (the valid choice) and `return` (the current URL). The endpoint validates the theme and `Origin`, saves the cookie and returns `303` to a same-origin path. The `static` adapter has no endpoint: changing the theme requires JavaScript. This example uses native submit buttons, each with its own accessible name, without implementing a radio group:

```html
<script lang="ts">
	import { useRoute, useThemeToggle } from '@meekojs/meeko/framework'

	const toggle = useThemeToggle()
	const route = useRoute()
</script>

<template>
	<form
		method="post"
		action="/_meeko/theme"
	>
		<input
			type="hidden"
			name="return"
			bind:value="route.url.value"
		/>
		<button
			each:of="toggle.choices"
			each:as="choice"
			each:key="choice"
			type="submit"
			name="theme"
			bind:value="choice"
			on:click="(event) => { if (toggle.interactive.value) { event.preventDefault(); toggle.theme.set(choice); } }"
		>
			Usar {choice}
		</button>
	</form>
</template>
```

For a cycling button with icons, render all icons and mark each with `data-meeko-theme-icon="light"`, `"dark"`, `"system"` or a custom theme name. The rule `theme` adds to `<head>` shows the icon for the choice on `<html>` from the first frame: do not select a single icon with a conditional on `resolved`. If the selector omits `"system"`, add the `system-light` or `system-dark` token to the corresponding theme's icon (for example, `data-meeko-theme-icon="light system-light"`); `toggle.system` identifies those themes. These decorative icons have `aria-hidden="true"`; the button needs text or an `aria-label`.

The `theme` configuration, cookie, `<head>` script, this icon rule and `POST /_meeko/theme` remain in core. For a complete control with keyboard support and accessibility, use `UIThemeToggle` from `@meekojs/ui` 0.2. See the [useThemeToggle reference](reference/composables/usethemetoggle.md).

#### `<MeekoThemeToggle>`

> **Deprecated since 1.8; removal in 2.0.** Use `<UIThemeToggle>` from the `@meekojs/ui` 0.2 module, with the same props, snippets and markup. In 1.x it still works and emits `MEEK121`. See [Migration to 1.8](migration-1.8.md).

Since `1.4`, with `theme` in `meeko.config.ts`, Meeko includes its own theme selector: a built-in tag, like `<MeekoLink>`, without an import.

```html
<MeekoThemeToggle>
	<snippet name="light"><IconSun /></snippet>
	<snippet name="dark"><IconMoon /></snippet>
	<snippet name="system"><IconMonitor /></snippet>
</MeekoThemeToggle>
<MeekoThemeToggle mode="select" />
<MeekoThemeToggle
	bind:themes="['light', 'dark']"
	bind:labels="{ light: 'Light', dark: 'Dark', system: 'System' }"
	class="toggle"
/>
```

| Prop          | Default                      | What it does                                                                                                                                                        |
| ------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`        | `"cycle"`                    | `"cycle"`: a button advancing to the next choice in the list. `"select"`: a radio group.                                                                            |
| `themes`      | the themes and `"system"`    | Choices and their order (`bind:themes="['light', 'dark']"`).                                                                                                        |
| `labels`      | “Claro”, “Oscuro”, “Sistema” | Each choice's name; an unlabeled custom theme uses its theme name.                                                                                                  |
| `messages`    | in Spanish                   | Accessible text: `cycle(current, next)` (the button's `aria-label`), `unknown` (“Cambiar tema”) and `group` (“Tema”), for localization. Type `ThemeToggleMessages`. |
| `class`, `id` | —                            | On the root `<form>`. Other attributes do not pass through: wrap the tag if you need them.                                                                          |

Each snippet (`light`, `dark`, `system` or a custom theme name) is that choice's icon; without a snippet, its label renders. `meeko check` and the editor type snippets, `themes` and `labels` with the themes from `meeko.config.ts` (`system` only if enabled) and `mode` as `"cycle" | "select"`; the editor completes the tag, its props and snippets, and hovering shows the tag's reference entry. Its prop type is `MeekoThemeToggleProps`, auto-imported like `MeekoLinkProps`. It has no visual styles of its own: the button and radios are native elements styled by the application (`.toggle button`, `[role="radio"][aria-checked="true"]`, `[data-meeko-theme-option="dark"]`). To mark the selected radio before hydration too, when the choice is unknown and there is no `aria-checked`, use `data-theme-choice`, like the icons: `[data-theme-choice="dark"] [data-meeko-theme-option="dark"]`.

**Icons that never shift.** The component renders all icons, each in `<span data-meeko-theme-icon="light|dark|system|…">`, without selecting any: with `theme` enabled, Meeko adds a minimal CSS rule to `<head>`, only `display: none`, hiding all except the one for `data-theme-choice`. Since the `<head>` script writes that attribute before the first paint, the icon is correct from the first frame in every case (with a cookie, in `"system"` without a cookie or client hint, on a prerendered page or in `static`), without JavaScript in the component, and hydration changes no component nodes. A list without `system` (`bind:themes="['light', 'dark']"`) shows the effective theme's icon in system mode, according to `prefers-color-scheme`, like the script. In `mode="select"`, each radio has its icon and all are visible.

**Accessibility.** In `mode="cycle"`, it is a `<button>` whose `aria-label` announces the choice and the next one, “Tema: oscuro. Cambiar a sistema”, updating on each change. When HTML is generated without knowing the choice (without the cookie, a prerendered page), the `aria-label` is neutral, “Cambiar tema”, until hydration finishes: this avoids announcing something false or causing a hydration mismatch, because hydration renders the same thing as the server. In `mode="select"`, it is a `role="radiogroup"` with an `aria-label` (“Tema”) and a `role="radio"` button per choice, with `aria-checked` and the choice's name. When HTML does not know the choice, no radio has `aria-checked`, neither `"true"` nor `"false"`: a group with all set to `"false"` would say nothing is checked, and checking `default` would tell someone who chose another theme something false, since the prerendered page is the same for everyone. When hydration finishes, each radio receives its `aria-checked` once, with visual state already supplied by CSS using `data-theme-choice`; with JavaScript, arrow keys, `Inicio` (Home) and `Fin` (End) move focus and selection, with roving `tabindex`, like a native radio group. Without JavaScript, each radio is a button reachable with Tab.

**Without JavaScript (progressive enhancement).** The component is a `<form method="post" action="/_meeko/theme">`: the `"cycle"` button submits the next choice and each radio submits its own, together with the page URL (`return`). With JavaScript, submission is intercepted and the change is immediate, using `useTheme().set()`, without navigation. Without it, the server handles the form:

- `POST /_meeko/theme` exists only with `theme` enabled (other methods respond `405`).
- It only accepts `application/x-www-form-urlencoded` up to 2 KB; `theme` must be a theme from `themes` or `"system"` (with system mode enabled); otherwise, `400 INVALID_THEME`, without writing anything.
- It writes the cookie like the browser runtime (`Path=/`, one year, `SameSite=Lax`, `Secure` on HTTPS) and responds `303` to `return`, which must be a path on this origin (`/docs?tab=a`). An absolute URL, `//otro.sitio`, a backslash or control characters fall back to `/`: there is never an open redirect. The next SSR document already has the new theme.
- **CSRF.** It does not use the session or CSRF token (`x-meeko-csrf`, which only exists with JavaScript): it only changes the theme cookie. Like an API mutation, it requires an `Origin` matching the request's, which after `createServerApp` is the configured `publicOrigin`; a missing, `null` or other-site `Origin` responds `403 INVALID_ORIGIN` before reading the body. Browsers send `Origin` on every `POST`; a page with `Referrer-Policy: no-referrer` sends it as `null`, so the JavaScript-free form does not work there (it does with JavaScript). Behind a proxy, configure the public origin, as for mutations with a session.
- **Prerendering with Node.** The endpoint also exists on the server of an application with prerendered pages and writes the cookie; but prerendered HTML is the same for everyone and, without JavaScript, does not apply the cookie (the `<head>` script does), so the page still shows the default theme. Without JavaScript, the change is only visible on SSR pages.
- **`static` adapter.** There is no server: the form renders the same way (the HTML comes from prerendering, common to all adapters) and works with JavaScript, but without it, the `POST` reaches hosting, which rejects it. This is a documented limitation; on a static site, the selector needs JavaScript.

Using `<MeekoThemeToggle>` without `theme` produces `MEEK111`. `meeko dev` and `meeko build` know from the configuration, which they execute; `meeko check` and the editor read `theme` from `meeko.config.*` without executing it. When this cannot determine it (`theme: variable`, a nonliteral configuration, or a folder without `meeko.config.*`, such as a layer with its own `package.json`), they do not warn, and the component produces the same error at render time. A project component named `MeekoThemeToggle` takes priority over Meeko's tag, with the `MEEK106` warning, as with `MeekoLink`.

#### How flashing is prevented in each case

| Case                                                        | Who sets the theme on `<html>`                                                                                                        | `useTheme()` in server HTML                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| SSR with the cookie (`light`, `dark`, a custom theme)       | The server, from the first byte.                                                                                                      | The cookie's theme. Hydration changes nothing.                                              |
| SSR in `"system"` with `Sec-CH-Prefers-Color-Scheme`        | The server, with the client hint.                                                                                                     | The system theme. Hydration changes nothing.                                                |
| SSR in `"system"` without the client hint (Firefox, Safari) | The `<head>` script, before the first paint; HTML has no attribute, so `prefers-color-scheme` CSS is also correct without JavaScript. | `resolved` is the light theme from `system`; it changes on hydration if the system is dark. |
| Prerendered page or `static` adapter                        | The `<head>` script, with the cookie or `localStorage`.                                                                               | The build's default value; it changes on hydration if the user chose another.               |

The script reads the cookie, then `localStorage` (so a choice saved only there, as on a site previously using `localStorage`, still applies and returns to the cookie), and finally `default`; in `"system"`, it queries `prefers-color-scheme`. It writes the theme and [`data-theme-choice`](#data-theme-choice). A cookie written by the server (the JavaScript-free `<MeekoThemeToggle>` form) transfers to `localStorage` and other tabs on the next load with JavaScript. It always runs and is idempotent: where the server already wrote the theme, it writes the same one. It goes among managed `<head>` tags, just after `meta` tags (so a CSP in `<meta http-equiv>` also applies to it) and before all linked stylesheets, those from `document.head` and `useHead` and from the build, so it waits for none.

**Client Hints.** An SSR response includes `Accept-CH: Sec-CH-Prefers-Color-Scheme` and, when the choice is `"system"`, `Critical-CH: Sec-CH-Prefers-Color-Scheme`. Chromium remembers `Accept-CH` for the origin and, on the first visit, responds to `Critical-CH` by repeating the request with the hint before showing anything: once per origin, with one extra round trip on that first visit. Firefox and Safari do not send the hint and use the script. With `clientHints: false`, Meeko neither requests nor reads the hint.

**Hydration.** The browser hydrates with the values rendered by the server (they travel in page state, `sharedState["meeko:theme"]`) and receives its own when hydration finishes, before `onMounted`, like `useStorage`. This prevents hydration mismatches, changing only what depended on a theme the server did not know.

**Security.** The server only accepts a theme from `themes` (or `"system"`) in the cookie; any other value is ignored and never written into HTML. The browser writes the cookie with `Path=/`, `SameSite=Lax`, a one-year lifetime and `Secure` on HTTPS; it is not `HttpOnly`, because the client writes it, and contains nothing private.

#### CSP

- **SSR.** The script and `<style>` for `<MeekoThemeToggle>` icons carry the nonce from `DocumentOptions.nonce` or, since `1.7`, the one Meeko generates with `server.contentSecurityPolicy`, like any `useHead` script or style. A page with [`cache`](#ssr-page-caching) has no nonce: its hashes enter that response's CSP ([CSP and headers in server adapters](#csp-and-headers-in-server-adapters)).
- **Prerendering and `static`.** The script and style are in each page's HTML, so their hashes enter `scriptHashes` and `styleHashes` in the prerender index and the CSP written by the `static` adapter ([CSP with hashes](#csp-with-hashes)). Their text depends only on `theme`: it is the same across pages and its hash only changes if the configuration changes.
- **Why a hashed `<style>`.** The icon rule must precede the first paint and work without JavaScript (the `<MeekoThemeToggle>` form), so the script cannot apply it through CSSOM. An inline `<style>` with a nonce (SSR) or hash (prerendering and `static`) is allowed by a CSP without `'unsafe-inline'`, without another file to request. The hash is only added to a directive without `'unsafe-inline'`: with a hash, the browser would ignore `'unsafe-inline'` and block `style="…"` attributes the policy allowed.
- **`color-scheme`.** This is not an HTML `style` attribute, which a CSP without `'unsafe-inline'` in `style-src` would block: the script and runtime apply it through CSSOM (`style.colorScheme`), which CSP allows. For the page to have the right scheme without JavaScript too, declare it per theme in your CSS, as in the example above.

#### Caching

An SSR document depends on the cookie and client hint, so it has `Vary: Cookie, Sec-CH-Prefers-Color-Scheme` (without `clientHints`, `Vary: Cookie`). SSR responses are `cache-control: no-store` except those of a page with [`cache`](#ssr-page-caching), whose `ETag` already includes the theme; if a proxy or CDN caches your pages, it must include the theme cookie in its key or avoid caching them, or it will serve one user's theme to another. Many CDNs do not vary by `Cookie` and do not cache a response with `Vary: Cookie`. Prerendered pages and the `static` adapter do not vary by theme: the same file serves everyone and the script applies each visitor's theme, so caching works as before. A prerendered page served by `meeko start` does vary by session, as without themes: without a session, it responds with `Vary: cookie` and `cache-control: public, max-age=0, must-revalidate`, and with a session, `private, no-store`, because it inserts the session's CSRF meta tag (see [Common rules](#common-rules)).

A custom host passing `DocumentOptions.config` to `createFrameworkHandler` puts the theme in `config.theme` (as does `mountClientApp({ document })`); the build copies it there from `theme` in `meeko.config.ts`, where `document.theme` is unsupported.

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
- **Built-in tags.** Meeko tags likewise contribute their props type, with the same scope and priority, from the public exports of `@meekojs/meeko/framework`: `MeekoLinkProps` for `<MeekoLink>`, `MeekoOutletProps` for `<MeekoOutlet />` and `MeekoThemeToggleProps` for `<MeekoThemeToggle>` (see [`<MeekoOutlet />` and `<MeekoLink>`](#meekooutlet--and-meekolink)). They arrive as `import type { MeekoLinkProps } from "@meekojs/meeko/framework"`. A project component replacing the tag (`app/components/MeekoLink.meeko`, with warning `MEEK106`) contributes its own types under that name, like any component: its `MeekoLinkProps` describes its own props, not those of the Meeko tag.
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

Schemas for [API and RPC](#api-and-rpc) and [WebSocket](#websocket) contracts can also be imported with an alias: `import { loginInput } from "#shared/schemas/auth"` in `server/api/auth/login.post.ts`, or with your own alias pointing to a `shared/` folder. The contract generator resolves the alias like `meeko check` and Vite, and generated clients (`api`, `rpc`, `socket`) name the `shared/` file by its path, without the alias. The rule is the same as with a relative path: the file must be in the project's `shared/`, so an alias pointing to another folder still produces `body debe venir de shared/`.

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

## API and RPC

The files `server/api/users/index.get.ts`, `index.post.ts` and `[id].get.ts` create `/api/users` and `/api/users/:id`. Procedures under `server/rpc/users/get.ts` create `/_meeko/rpc/users/get`. Public schemas live in `shared/`. Handlers use `defineApiRoute` and `defineRpc`, and the server validates input, output, session, authorization, CSRF and, since `1.8`, the `Origin` of every mutation (see [Origin in anonymous mutations](#origin-in-anonymous-mutations)).

**Validator: Standard Schema, Valibot by default.** Meeko validates with any library implementing [Standard Schema](https://standardschema.dev), such as Valibot, Zod or ArkType, in API, RPC, Socket, routes, `useForm` and `useStorage`. Examples in this documentation use Valibot (`import * as v from "valibot"`, from version 1), the recommended validator: it is small and modular, so the browser bundle only includes functions used by the `shared/` schemas shared by server and client. Choosing another library changes no Meeko API; only OpenAPI export needs that library's JSON Schema converter (for Valibot, `@valibot/to-json-schema`).

```sh
npm install valibot
```

```ts
// shared/schemas/user.ts
import * as v from 'valibot'
export const userParams = v.object({ id: v.string() })
export const userSchema = v.object({ id: v.string(), name: v.string() })
export const usersSchema = v.array(userSchema)
```

```ts
// server/api/users/index.get.ts
import { defineApiRoute } from '@meekojs/meeko/server'
import { usersSchema } from '../../../shared/schemas/user.js'

export default defineApiRoute({
	response: usersSchema,
	handler: () => [{ id: '123', name: 'Ada' }],
})
```

```ts
// server/api/users/[id].get.ts
import { defineApiRoute } from '@meekojs/meeko/server'
import { userParams, userSchema } from '../../../shared/schemas/user.js'

export default defineApiRoute({
	params: userParams,
	response: userSchema,
	handler: ({ params }) => ({ id: params.id, name: 'Ada' }),
})
```

```ts
// server/rpc/users/get.ts
import { defineRpc } from '@meekojs/meeko/server'
import { userParams, userSchema } from '../../../shared/schemas/user.js'

export default defineRpc({
	input: userParams,
	output: userSchema,
	handler: ({ input }) => ({ id: input.id, name: 'Ada' }),
})
```

```ts
// app/pages/users/index.meeko, without manual imports
const loadUsers = async () => {
	const users = await api.users.get()
	const user = await api.users({ id: '123' }).get()
	const result = await rpc.users.get({ id: '123' })
	return { users, user, result }
}
```

These symbols also work in `.ts` files according to scope. `meeko routes .` generates `.meeko/generated/clients.client.ts` and `clients.server.ts` with public descriptors and inferred types; they do not import private handlers. In SSR, clients look up the current context on every call and dispatch locally through the same HTTP pipeline if the host supplies `createLocalServerFetch`. The starter already connects it. Credentials, session, services, state and `requestId` remain bound to the original request. Outside an SSR context, a call to the server client fails with a clear error. In the browser, same-origin `fetch` is used and the CSRF token is read from the `meeko-csrf-token` meta tag, updated after responses and navigation. `createApiClient` and `createRpcClient` remain available for explicit or external clients. Non-JSON responses require `contentType: "response"`.

An API/RPC response started before a token change cannot restore a CSRF token already removed by logout or overwrite the token applied by navigation. The client compares the current document and token with those it had when the request started before applying the response header.

API `params` schemas must describe exactly the route's dynamic segments as required strings. A static route does not declare `params`. `query` inputs must accept strings or lists of strings, with optional fields if a key may be absent. If you need numbers, convert them from text within the schema; the generator rejects a contract directly requiring a number that the URL cannot deliver.

Public API, RPC and Socket schemas must expose concrete Standard Schema types: generation rejects `any`, `unknown` and `never` in both input and output, including when nested, as well as generic parameters left unresolved in the exported contract. Make those parameters concrete and explicitly model the public type before generating clients. The manifest also rejects names that cannot be represented unambiguously in the client. For example, `server/api/users/index.get.ts` (`api.users.get()`) cannot coexist with `server/api/users/get.post.ts` (`api.users.get.post()`), nor `server/rpc/users.ts` with `server/rpc/users/get.ts`. `server/api/index.<method>.ts` is rejected because it would produce an empty client key. Each diagnostic includes the conflicting paths; there are no silent overwrites.

`meeko check .` generates separate TypeScript projects for client, server and shared. It includes sources from layers declared in `meeko.config.ts` (including those added by modules), even if their paths do not use the conventional `layers/` name, and components from modules' `addComponentsDir` that live inside the project outside `node_modules`. An `app/` `*.server.ts` file is checked in the server project and a `*.shared.ts` in the shared project; files with a scope suffix retain that selection within `shared/` and `server/` too.

API and RPC errors are normalized on the server: an `ApiError` retains `code` and `status`, the response adds `requestId` and `x-request-id`, and an unknown failure is returned as `INTERNAL_ERROR` without exposing its message. The same normalization applies to local SSR dispatch and Node transport, even when Vite loads modules in different graphs. Navigation requesting `application/meeko+json` receives the same format; an HTML error page retains the HTTP status and `x-request-id` without including private details. The generated server observes 5xx failures: in production it logs type and ID, and in development it also shows the original error. Expected 4xx responses are not logged as internal failures.

### Public schemas

A contract's schemas (`input` and `output` of `defineRpc`; `params`, `query`, `body` and `response` of `defineApiRoute`) are public: they generate the `api` and `rpc` client types. The generator (`meeko routes`, `meeko check`, `meeko dev` and `meeko build`) neither executes nor imports the handler, which may contain private server code: it reads the contract as code and names each schema by its module, so `.meeko/types/server-contracts.d.ts` contains `typeof import("../../shared/schemas/user.js")["userSchema"]`. That is why a public schema lives in `shared/`, which contains no server code and can be imported by the browser; its dependencies cannot leave `shared/` either (except `node_modules` packages), and a schema local to the handler or from `server/` produces `output debe venir de shared/`.

Since `1.8`, the contract also accepts a **simple composition** of these schemas with package functions, such as `v.array(snapshotSchema)` or `v.optional(filterSchema)`: calls, property reads, literals, arrays and object literals whose names are imports from `shared/` or a package (`valibot`, `zod`…). The generator copies the expression, with those imports, into a `.meeko/types/contract-schemas/` module (`rpc.snapshots.list.output.ts`) from which only the type is read: it is never executed or included in the bundle.

```ts
// server/rpc/snapshots/list.ts
import * as v from 'valibot'
import { snapshotSchema } from '../../../shared/schemas/snapshot.js'

export default defineRpc({
	input: v.object({}),
	output: v.array(snapshotSchema),
	handler: () => listSnapshots(),
})
```

An expression containing anything else (a function like the one in `v.transform`, an operator, a local variable or a type argument) is rejected with the reason: `output debe ser un schema importado de shared/ o una composición simple de ellos (…); esta expresión contiene una función`. Define that schema in `shared/`, export it and import it in the contract. [WebSocket](#websocket) schemas do not accept compositions: the browser imports each one to validate messages, so they must be an export from `shared/`.

### Dynamic segments in `api.*`

Each `server/api` folder or file is a level of `api.*`, and each file contributes the method from its suffix. Since `1.2`, you call a dynamic segment with its parameters: `node({ nombre: valor })` returns that segment's client, and methods reached this way no longer receive `params`. `query`, `body` and `signal` remain unchanged, and the URL is built and encoded as with `params`.

```ts
// server/api/menu/categories/index.get.ts         → api.menu.categories.get()
// server/api/menu/categories/[id].patch.ts        → api.menu.categories({ id }).patch({ body })
// server/api/menu/categories/[id]/archive.post.ts → api.menu.categories({ id }).archive.post()
// server/api/orgs/[org]/users/[id].get.ts         → api.orgs({ org }).users({ id }).get()
const list = await api.menu.categories.get()
await api.menu.categories({ id }).patch({ body: { name } })
await api.menu.categories({ id }).archive.post()
const user = await api
	.orgs({ org })
	.users({ id })
	.get({ query: { tab: 'profile' } })
```

- The call receives an object with its segment's sole parameter, as a string: TypeScript rejects a missing parameter, an extra key, a non-text value and `params` in methods following the call. An object without the parameter or with a different one throws a `TypeError` on calling; an empty value, `.`, `..` or one containing `/` rejects the request just as with `params`.
- A level retains its methods and static children alongside the call: `api.menu.categories.get()` and `api.menu.categories({ id })` coexist. If a level has multiple dynamic child segments (`users/[id].get.ts` and `users/[slug]/posts.get.ts`), the parameter name selects the segment: `api.users({ id })` or `api.users({ slug }).posts.get()`.
- A catch-all `[...path]` receives, as in `params`, a string with segments joined by `/`: `api.files({ path: "docs/a b.txt" }).get()` requests `/api/files/docs/a%20b.txt`, with each segment encoded separately.
- `useApi` is unchanged: it still receives the bracketed path and `params`, such as `useApi("/api/menu/categories/[id]", { params: { id } })`.
- The editor completes the call, its parameters and the segment's methods, and hover and “go to definition” on `api.menu.categories({ id }).archive.post` lead to the handler.

In `clientKey`, the dynamic segment for `[id]` or `[...id]` is named `byId`: `by` followed by the parameter name with its first letter capitalized. This lets the client recognize which segment each parameter belongs to, including in an explicit `createApiClient` client. That is why the manifest rejects, with the conflicting paths, a static segment named the same as the dynamic segment at its level (`users/byId/` alongside `users/[id]`) or in its own route (`[id]/byId.get.ts`), and two parameters whose names differ only in the initial letter's case (`[id]` and `[Id]`) at the same level or in the same route.

The previous form, `api.menu.categories.byId.archive.post({ params: { id } })`, continues to work throughout the 1.x series and will be removed in `2.0`. It has been deprecated since `1.2`: the editor strikes through each method called through `byId` and its hover shows the replacement; there is no console warning. It only exists before the first segment call: `api.orgs({ org }).users.byId` does not exist.

### Form validation errors

Since `1.2`, when `params`, `query`, `body` or an RPC's `input` fails its schema, the `400` response (`INVALID_PARAMS`, `INVALID_QUERY`, `INVALID_BODY` or `INVALID_INPUT`) includes `issues`: a list of `{ path, message }` with at most 20 items. `path` is the Standard Schema issue path's keys joined by `.` (`"items.0.name"`), or `""` for the entire input; `message` is the schema's message. Only these two fields are transferred: never the received value, expected value or a stack trace. Issues without a message are omitted, and with none the response has no `issues`. A handler result failing `response` or `output` remains a `500` without details, because it is a server failure.

```ts
// shared/schemas/auth.ts
import * as v from 'valibot'
export const loginInput = v.object({
	email: v.pipe(v.string(), v.email('Enter a valid email address.')),
	password: v.pipe(v.string(), v.minLength(1, 'Enter your password.')),
})
```

```json
{ "code": "INVALID_INPUT", "status": 400, "requestId": "…", "issues": [{ "path": "password", "message": "Enter your password." }] }
```

On the client, `ClientError.issues` is this read-only list (type `ValidationIssue`), or `undefined` if the response does not include it. It arrives the same way from `api.*`, `rpc.*` and the `error` of `useApi`, `useRpcQuery` and `useRpcMutation`:

```ts
import { ClientError } from '@meekojs/meeko/framework'

const login = useRpcMutation('auth.login')
const fieldError = (path: string) => {
	const error = login.error.value
	return error instanceof ClientError ? error.issues?.find((issue) => issue.path === path)?.message : undefined
}
```

Write your own schema messages: some default Valibot messages quote the received value.

`useForm` sends these `issues` to each form field without custom code (see [Forms: `useForm`](#forms-useform)).

### Field errors: `ApiError` with `issues`

Since `1.5`, an error that is not a validation error but belongs to a field, such as an email already associated with an account, carries `issues` through the third argument of `ApiError`, which accepts `{ message, issues }` in addition to the usual internal message:

```ts
throw new ApiError('EMAIL_TAKEN', 409, {
	message: `duplicate key for ${body.email}`, // internal: never sent
	issues: [{ path: 'email', message: 'That email already has an account.' }],
})
```

```json
{ "code": "EMAIL_TAKEN", "status": 409, "requestId": "…", "issues": [{ "path": "email", "message": "That email already has an account." }] }
```

- `issues` have the same shape as those of a `400` (`{ path, message }`, with `path` joined by `.` or `""` for the whole form) and are sent the same way: at most 20, in API and RPC responses, including local SSR dispatch. They are public messages written for the user; the error's `message` remains internal.
- They are only sent with a `4xx` status: a `5xx` is a server failure and responds without them. An issue without a `path` or a text `message` throws a `TypeError` when creating the error.
- An `ApiError` from another module graph (Vite) retains its `issues` during normalization. Another error with the same shape, such as an SDK's `ApiError` or a `ClientError` from another Meeko service that the handler lets escape, does not send its `issues`: Meeko only forwards those of its own `ApiError`.
- On the client they arrive in `ClientError.issues`, and `useForm` distributes them like those of a `400`.

### Per-request values: `locals`

Since `1.2`, `defineApiRoute` and `defineRpc` accept `locals(context)`, which computes a per-request value (for example, the current user) and passes it to the handler as `locals`, with the type inferred from its return value. Without `locals`, the handler receives `locals: undefined`. `authorize` is unchanged and still returns a boolean.

The order of each request is: Origin (since `1.8`, on every mutation except with `origin: "none"`), session Origin and CSRF, `rateLimit` (since `1.2`), `auth`, `authorize`, input validation (`params`, `query` and `body`, or `input`), `locals`, handler and response validation. Thus, `locals` only runs with valid input and an already authorized request. If it throws an `ApiError`, that error is the response (for example, `401` if the session user no longer exists or `403` if they lost access); any other error is `500`.

```ts
// server/rpc/orders/create.ts
import { ApiError, defineRpc } from '@meekojs/meeko/server'
import { newOrder, orderSchema } from '../../../shared/schemas/order.js'
import { createOrder, findUser } from '../../utils/store.js'

export default defineRpc({
	input: newOrder,
	output: orderSchema,
	auth: 'required',
	locals: async ({ session }) => {
		const user = await findUser((session.current!.data as { userId: string }).userId)
		if (!user) throw new ApiError('UNAUTHENTICATED', 401)
		return { user }
	},
	handler: ({ input, locals }) => createOrder(locals.user, input),
})
```

Declare `locals` before `handler` in the object: if `locals` uses its parameter, TypeScript only infers its type for the handler when it appears first. With the session typed through [`MeekoSession`](#session-types-meekosession), `session.current!.data.userId` does not need `as`.

### Response status: `status`

Since `1.2`, `defineApiRoute` accepts `status` to choose the status of a successful response without giving up JSON, `response` validation or the generated client's type:

| `status`        | Response                                        | `api.*` resolves to  |
| --------------- | ----------------------------------------------- | -------------------- |
| `200` (default) | JSON validated with `response`                  | the `response` value |
| `201`           | JSON validated with `response` (`201 Created`)  | the `response` value |
| `202`           | JSON validated with `response` (`202 Accepted`) | the `response` value |
| `204`           | no body or `content-type` (`204 No Content`)    | `undefined`          |

```ts
// server/api/orders/index.post.ts
import { defineApiRoute } from '@meekojs/meeko/server'
import { newOrder, orderSchema } from '../../../shared/schemas/order.js'
import { createOrder } from '../../utils/store.js'

export default defineApiRoute({
	body: newOrder,
	response: orderSchema,
	status: 201,
	handler: ({ body }) => createOrder(body),
})
```

```ts
// server/api/orders/[id].delete.ts
import { defineApiRoute } from '@meekojs/meeko/server'
import { orderParams } from '../../../shared/schemas/order.js'
import { deleteOrder } from '../../utils/store.js'

export default defineApiRoute({
	params: orderParams,
	status: 204,
	handler: async ({ params }) => {
		await deleteOrder(params.id)
	},
})
```

- `status` must be a literal (`status: 201`): the generator reads it without executing the handler and rejects any other value. A constant or expression does not work.
- With `204`, the handler returns nothing and `response` is not declared; returning a value responds with `500` `INVALID_RESPONSE`. In the generated contract the output is `undefined`, so `await api.orders({ id }).delete()` resolves to `undefined`, as does `useApi`.
- `status` cannot be combined with `contentType: "response"`: that handler already returns its own `Response` with whatever status it needs.
- An unsupported `status`, one combined with `contentType: "response"` or a `204` with `response` responds with `500` `INVALID_RESPONSE_STATUS` before reading the input, although the generator already rejects it in `meeko routes`, `meeko check` and `meeko dev`.
- Errors are unchanged: they still come from `ApiError` with their own status.
- `generateOpenApi` documents the declared status (`201 Created`, `202 Accepted` or `204 No Content`, the latter without `content`).
- The status is fixed per endpoint. To choose it per request (for example, `201` on creation and `200` on update in the same `PUT`), use `contentType: "response"` or two endpoints.
- RPC has no `status`: a procedure always responds with `200` and its `output`.

### Forms without JavaScript: `form`

Since `1.7`, an API endpoint can also handle a native `<form method="post">`, which works before JavaScript loads or without it. Enable it with `form`, and the form is validated with the **same `body` schema** as JSON:

```ts
// shared/schemas/feedback.ts
import * as v from 'valibot'
export const feedbackInput = v.object({
	page: v.pipe(v.string(), v.startsWith('/')),
	helpful: v.boolean('Choose yes or no.'),
	comment: v.optional(v.pipe(v.string(), v.maxLength(500, 'Use at most 500 characters.')), ''),
})
export const feedbackSaved = v.object({ id: v.string() })
```

```ts
// server/api/feedback.post.ts
import { defineApiRoute } from '@meekojs/meeko/server'
import { feedbackInput, feedbackSaved } from '../../shared/schemas/feedback.js'
import { saveFeedback } from '../utils/feedback.js'

export default defineApiRoute({
	body: feedbackInput,
	response: feedbackSaved,
	// Or { redirect: (saved) => `/graciasíid=${saved.id}` }. `echo` returns those fields' text after an error.
	form: { echo: ['comment'] },
	handler: ({ body }) => saveFeedback(body),
})
```

```html
<!-- app/components/Feedback.meeko -->
<script lang="ts">
	const route = useRoute()
	const form = useForm({
		schema: feedbackInput,
		initial: { page: route.path.value, helpful: false, comment: '' },
		action: '/api/feedback',
		submit: (values) => api.feedback.post({ body: values }),
	})
</script>
<template>
	<form
		method="post"
		action="/api/feedback"
		on:submit="form.submit"
		novalidate
	>
		<input
			type="hidden"
			name="return"
			bind:value="route.url.value"
		/>
		<input
			type="hidden"
			name="_csrf"
			bind:value="form.csrfToken"
		/>
		<input
			type="hidden"
			name="page"
			bind:value="form.fields.page.value"
		/>
		<p if:when="form.submitted.value">Thank you!</p>
		<p
			if:when="form.error.value"
			role="alert"
		>
			{form.error.value}
		</p>
		<button
			name="helpful"
			value="true"
			on:click="() => { form.fields.helpful.value = true; }"
		>
			Yes
		</button>
		<button
			name="helpful"
			value="false"
			on:click="() => { form.fields.helpful.value = false; }"
		>
			No
		</button>
		<textarea
			name="comment"
			model="form.fields.comment"
		></textarea>
		<p if:when="form.errors.value.comment">{form.errors.value.comment}</p>
	</form>
</template>
```

With JavaScript, `form.submit` cancels native submission and sends JSON with `submit`, as usual. Without it (or before hydration), the browser submits the form to `/api/feedback`, with the clicked button's `name` and `value`, and returns to the page with the result already rendered in the server HTML: `helpful` arrives as the text `"true"` and the schema receives it as `true` (see conversion below). The same definition serves both paths: each control needs its `name`, matching its field.

**Body.** With `form`, the endpoint accepts `application/x-www-form-urlencoded` and `multipart/form-data` as well as JSON. Without `form`, those types still respond with `415 UNSUPPORTED_MEDIA_TYPE`. JSON is unchanged and is never converted. Each `name` is an object key, passed through the `body` schema:

- A repeated name (`tag=a&tag=b`) or one ending in `[]` (`tags[]=a`) is a list; with `[]` it is a list even if only one value arrives, or none with an empty `<input type="file">`.
- Fields arrive as text. If the schema rejects some fields' text, Meeko validates it again **once** with the typed interpretation of those fields, and only those: `""` is `undefined` (an empty field was not provided), `"true"` and `"on"` (a checked checkbox) are `true`, `"false"` is `false` and a decimal number (`"4"`, `"-1.5"`, `"2e3"`) is a `number`; in a list, each item is converted, excluding empty ones. A field the schema accepts as text (`"42"` in a `v.string()`, a postal code `"01234"`) is never converted. Thus, `v.number()` and `v.boolean()` work without writing conversions; the schema's own conversions (`v.pipe(v.string(), v.toNumber())`) also work. An asynchronous schema (`v.pipeAsync`, `v.checkAsync`, which can query the database) runs **only once**, without a second attempt: its numeric or boolean fields must convert the text within the schema itself (`v.pipe(v.string(), v.toNumber())`).
- An unchecked checkbox sends nothing: declare it with a default value, `v.optional(v.boolean(), false)`, and a checkbox list with `v.optional(v.array(v.string()), [])`.
- If a converted field still fails the schema, its message is the one for its text, as entered by the user.
- `return` and `_csrf` are reserved fields: they never reach the schema.
- Nested objects are not constructed: `address.city` is a key with a dot.

**Response.** A successful submission (after validating `response`) responds with `303 See Other` to the path returned by `form.redirect(result, context)` or, without it, the `return` field's path, the `Referer` page if it belongs to this site, or `/`. `result` is the validated response, `undefined` with `status: 204` or the handler's `Response` with `contentType: "response"` (without `redirect`, that `Response` is the response). The path must belong to this application: a value with `//`, `\`, a scheme (`javascript:`, `https://otro.example`), control characters or dot segments that would leave `//` at the start is replaced with `/`, with the same checks as [`POST /_meeko/theme`](#lightdark-theme-without-flashing); an absolute URL of this same origin works as its path. The path works equally with an unencoded `/` (`return=/contacto`, as sent by `curl -d`) or an encoded one (`return=%2Fcontacto`, as sent by the browser), in `x-www-form-urlencoded` and `multipart/form-data`. When testing with `curl` from Git Bash on Windows, MSYS converts the argument `return=/contacto` to `return=C:/Program Files/Git/contacto` before sending it, and that path falls back to `/`; use `return=%2Fcontacto` or `MSYS_NO_PATHCONV=1`.

An error (validation, an `ApiError` from the handler or `locals`, `401`, `403 FORBIDDEN`, `429`, `413` or a `500`) also responds with `303`, back to the `return` field, `Referer` or `/`, never with the error's JSON. In both cases, the response sets a single-use, 60-second cookie, `__Host-meeko-form` (`meeko-form` without HTTPS), `HttpOnly`, `SameSite=Lax`, containing the result: code, status, `issues` (at most 20, as in a `400`) and, only for fields listed in `form.echo`, the submitted values. By default no values return: the form shows messages and its fields start from `initial`. Values travel in the cookie and page HTML, so `echo` must not include passwords, card numbers, PINs, IBANs or other sensitive data; even so, a field whose name contains `password`, `passcode`, `secret`, `token`, `cvc` or `cvv` never returns, nor do files. If it does not fit in the cookie, values are removed first, then the last `issues`.

**The page.** That page's `GET` reads the cookie, deletes it in the same response (`Max-Age=0`, `cache-control: no-store`) and renders the page even if it is prerendered. A `useForm` whose `action` matches the endpoint path takes the result during SSR, just as after a JavaScript submission: `form.echo` values in its fields, `errors` and `error` distributed by `issues`, `failure` holding a `ClientError` with the code and status (and `error` holding `errorMessage(failure)` if there are no `issues`), or `submitted` set to `true` after success. The result travels in page state, so hydration renders the same thing, and the browser uses it only once: when the form mounts again, it starts from `initial`. A field with a server message loses it on change, as after a JavaScript submission. A field still containing an error returns as text, exactly as entered.

Why a cookie: a signed query would leave values, sometimes personal, in the address bar, history, logs and `Referer`, and would need a secret shared between instances; storing the result in the session store would create a session for every anonymous visitor. A single-use `HttpOnly` cookie leaves no trace in the URL, needs no server state, works across multiple instances and, with the `__Host-` prefix, cannot be planted by any subdomain. Its contents are only rendered as escaped text, and it is not signed: whoever can write that cookie (the user's own browser) can only change what they themselves see.

**Security.**

- A form needs no _preflight_, so any site can submit one. That is why every native submission requires an allowed `Origin` (the application's or one from `SessionManager.allowedOrigins`), like any mutation since `1.8`: without it, it responds with `403 INVALID_ORIGIN` before reading the body. Since `1.8`, `origin: "none"` exempts it only without a session, for a webhook sending `application/x-www-form-urlencoded` without `Origin`; with a session, submission still needs `Origin` and `_csrf`. Browsers send `Origin` on every `POST`; a page served with `Referrer-Policy: no-referrer` sends it as `null` and cannot use native forms.
- With a session, the CSRF token JavaScript sends in `x-meeko-csrf` arrives in the hidden `_csrf` field: `form.csrfToken` supplies it in SSR and in the browser. Without it, `403 INVALID_CSRF`. These two `403` responses return error JSON without `303`: the request is not from this site. Everything else (`auth`, `authorize`, `rateLimit`, `locals`) works as with JSON, except the order of `rateLimit`: since `1.7`, a native submission is counted after `Origin` and **before reading the body**, so a flood of submissions is stopped without parsing each one; the CSRF token is in the body, so a submission with an invalid token also counts. A `429` returns to `Referer` or `/`, because the `return` field is in the unread body.
- The body has JSON's 1 MiB limit, changed by `form.maxBytes`; above it, `BODY_TOO_LARGE`.
- A `multipart/form-data` does not accept files except with `form.files: true`: they reach the `body` schema as `File` (for example, `v.instance(File)` or `v.file()`), and a file on an endpoint without `files` is `400 FILES_NOT_ALLOWED`. An empty `<input type="file">` does not count. Increase `maxBytes` according to the size you accept.

**Limitations.**

- It is handled by `dispatchApiRoute`, meaning `createServerApp` and every Meeko adapter. `executeApiRoute` still accepts JSON only, and a host rendering pages with `createFrameworkHandler` does not read the cookie.
- A shared cache in front of the server (a CDN) must pass through requests with the `meeko-form` cookie (or respect `Vary: Cookie`): if it serves a copy, the form does not show the result.
- A `render: "prerender"` page is rendered at build time, without a session, so its HTML has no CSRF token and `form.csrfToken` is empty until hydration. With JavaScript this does not matter (submission carries the token in `x-meeko-csrf`), but a user with a session submitting the native form without JavaScript receives `403 INVALID_CSRF`. If the form is for users with a session, use `render: "ssr"` (with `cache` if the page is expensive: a request with a session never uses the copy and carries its token).
- `generateOpenApi` describes the JSON body, not the form body.

### Data in components: `useApi`, `useRpcQuery` and `useRpcMutation`

Since `1.1`, a component can request its own data with composables auto-imported from the generated clients. They use the same contracts, types, session and CSRF as `api.*` and `rpc.*`:

| Composable                                              | Usage                                                            | Returns                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| `useApi(ruta, opciones?, recarga?)`                     | Read a `GET` endpoint                                            | `{ data, error, pending, refreshing, refresh }`             |
| `useRpcQuery(procedimiento, input, recarga?)`           | Read through an RPC procedure                                    | `{ data, error, pending, refreshing, refresh }`             |
| `useRpcMutation(procedimiento, opciones?)`              | Write on demand through RPC                                      | `{ mutate(input), data, error, pending }`                   |
| `useApiMutation(ruta, método, opciones?)` (since `1.2`) | Write on demand to a `POST`, `PUT`, `PATCH` or `DELETE` endpoint | `{ mutate({ params, query, body }), data, error, pending }` |

`ruta` is the endpoint path as described by `server/api`, with dynamic segments in brackets: `"/api/users"` or `"/api/users/[id]"`. Only `GET` endpoints are supported. `procedimiento` is the dot-separated procedure ID: `server/rpc/users/get.ts` is `"users.get"`. The editor completes paths and procedures, and TypeScript checks `params`, `query` and `input` against the contract. `data`, `error` and `pending` are read-only signals; `error` is an `Error` or `null`.

```html
<!-- app/pages/users/[id].meeko -->
<script lang="ts">
	const props = defineProps<{ params: { id: string }; search: Record<string, string | string[]> }>()
	const tab = signal('profile')
	const user = await useApi('/api/users/[id]', { params: { id: props.params.id } })
	const activity = await useRpcQuery('users.activity', () => ({ id: props.params.id, tab: tab.value }))
	const rename = useRpcMutation('users.rename')
	async function save(name: string): Promise<void> {
		await rename.mutate({ id: props.params.id, name })
		await user.refresh()
	}
</script>
<template>
	<h1>{user.data.value.name}</h1>
	<p>{activity.data.value.length} events</p>
</template>
```

#### With and without `await`

- **With `await`.** The component does not render until data is available, including in SSR, and `data` is no longer nullable in its type. A failed request is treated as a page failure.
- **Without `await`.** The component renders immediately with `pending` set to `true` and `data` to `null`. The request does not run in SSR: it starts in the browser when the component mounts. This is the pattern for showing a loading indicator:

```html
<script lang="ts">
	const users = useApi('/api/users')
</script>
<template>
	<p if:when="users.pending.value">Loading…</p>
	<p if:when="users.error.value">Could not load users.</p>
	<ul if:when="users.data.value">
		<li
			each:of="users.data.value ?? []"
			each:as="user"
			each:key="user.id"
		>
			{user.name}
		</li>
	</ul>
</template>
```

The options for `useApi` and the `input` for `useRpcQuery` can contain signals in their fields, or be a function reading them. Once the component is mounted in the browser, a change to those signals requests data again and updates `data`, `pending` and `error`; an earlier request still in progress is canceled. `refresh()` requests data again with the current input. While new data arrives, `data` retains the previous data (see [Previous data during a reload](#previous-data-during-a-reload-keepprevious)). A failed reload or `refresh()` only updates `error`: it does not show the error page.

Options are optional when the contract requires nothing. `useApi(ruta)` allows omitting them if the endpoint has no `params` and its `query` is absent or has only optional fields. `useRpcQuery(procedimiento)` allows omitting `input` if the schema accepts `{}`, and then sends `{}`. The same applies to generated clients: `api.users.get()` is called without arguments when the endpoint has no `params`, required `query` or body. The `rpc.x(input)` signature is unchanged.

```ts
const stats = await useRpcQuery('stats.summary') // optional input: sends {}
const users = await useApi('/api/users') // optional query
const page = await api.users.get({ query: { page: '2' } }) // the query is still available
```

#### SSR and hydration

In SSR, the server renders the page and its layouts, records requests for each data `await`, waits for them and renders again with the data, until no pass suspends. Discarded passes are disposed of, with their state and effects, and each starts from the state left by the loader. Requests are dispatched locally through the same pipeline as `api.*` and `rpc.*` in SSR, retaining the session and request context. On a `render: "stream"` route, they resolve before the first byte, like the critical loader. `head` is computed with loader data or top-level `<script server>` code, not these composables' data: if `<title>` depends on a value, load it there.

Resolved data travels in the payload's `resources` field, keyed by request (method or procedure and input). During hydration, the browser reads it synchronously from there and does not repeat the request. A data `await`'s input must depend only on props, route data and state: if the browser requests a key the server did not load, hydration fails with a `MEEKO_RESOURCE_MISSING` error naming the request. A component requesting new data on every pass stops rendering after 10 passes with an error.

#### Navigation and `render: "client"`

Before committing a navigation, the browser renders the new page without displaying it to discover and load its data `await` calls. Meanwhile the previous page stays visible and `useNavigation().pending` is `true`. If navigation requested the payload from the server, data the server already resolved arrives in `resources` and is not requested again. A failure shows the nearest `+error.meeko`, or `app/error.meeko`, within the layouts, like a loader failure. `render: "client"` routes use the same mechanism, entirely in the browser. In SSR, a failed data `await` also shows the error page, with the same public message as a loader failure.

That preliminary render is a dry run. Setup for the new page and layouts that are not preserved executes, with provisional state that is later discarded, but:

- no `effect` runs (`computed` does compute its value);
- `onMounted` does not run and the continuation after a browser `await` does not start;
- `useSocket` and `socket.x` return a client that does not connect.

What repeats is setup's top-level code itself: a request with `api.*`, an external write or a counter incremented there runs once more per navigation. Move these to `onMounted` or a handler.

The pass is skipped if no component in the new tree can await data. The compiler marks each module with two static pieces of information: whether its script has a data `await` and which components its template renders. The browser traverses these marks from the new page and layouts and, if none await data, commits navigation without a preliminary pass; setup then runs only once. A component chosen at runtime (`<component is>` with a setup variable, an `each:` item or a snippet parameter) and an unmarked module (handwritten or compiled by an earlier version) count as potentially awaiting data. A layout's outlet (`<component is="props.outlet">`) is not traversed, because the browser already checks the page. Limitation: a component that is not a layout and uses `<component is="props.outlet">` to render a component received in a prop named `outlet` is not traversed either; if that component awaits data, it is not loaded before navigation commits and mounts later, as described next, without an error.

#### Components that mount later

A component appearing after hydration or page commitment (when an `if:` becomes true, in a new `each:` row, when the `<component is>` component changes or when receiving new props: a component with a top-level data `await` remounts with them rather than updating them in place like other components; see [Reactive props](api.md#reactive-props)) reuses data the application already loaded. If it uses a data `await` for data that is not cached:

- Its area stays empty, without an error, while data loads.
- Loading uses dry runs under the containing component's root, with the same context (`inject`), without effects, `onMounted` or socket connections.
- When they finish, the component renders, hydrates and runs its `onMounted`. Data stays in the application cache for subsequent mounts.
- If the component is disposed of first (the `if:` becomes false again or the row disappears), the request is aborted and nothing renders, `onMounted` does not run and no error is reported.
- If the request fails, the area stays empty and the error reaches the nearest `provideErrorHandler`, with source `"mounted"`, or, if there is none, the `onError` of `mountClientApp`.

To show an indicator in the meantime, use the composable without `await` and read `pending`, as in the previous example, or wrap the area in [`<MeekoAwait>`](#meekoawait), which can also reserve its height. The `MEEKO_SUSPENDED` error only appears when calling `renderToString` or `renderWithState` on a component with a data `await` outside the framework (see [api.md](api.md#generated-module)).

#### Previous data during a reload: `keepPrevious`

Since `1.1`, a reload does not clear `data`: both `refresh()` and changes to input signals set `pending` to `true` and retain previous data until the new data arrives, replacing it in the same update that sets `pending` back to `false`. A list does not disappear while reloading. Since `1.5`:

- **`refreshing`.** It is `true` during a reload while `data` retains a previous load. The first load is `pending` without `refreshing`. Use it for a subtle indicator (dimming the list, a spinning icon) without hiding data.
- **`keepPrevious`.** The last argument of `useApi` and `useRpcQuery` accepts `{ keepPrevious }` (and, since `1.7`, [`debounceMs` and `enabled`](#search-as-you-type-debouncems-and-enabled)). It defaults to `true`, the existing behavior. With `false`, an input change clears `data` and `error` and becomes a first load again: useful when showing another input's data would be confusing (another user's profile while the new one arrives). `refresh()` always retains data because it belongs to the same input, as does a resource awaited with `await`, whose `data` is never `null`.

```html
<script lang="ts">
	const props = defineProps<{ params: { id: string }; search: Record<string, string | string[]> }>()
	const page = signal('1')
	// By default: the previous page remains on screen while the next one loads.
	const orders = useApi('/api/orders', { query: { page } })
	// A different user: show a skeleton instead of the previous user's card.
	const user = useApi('/api/users/[id]', () => ({ params: { id: props.params.id } }), { keepPrevious: false })
</script>
<template>
	<ul
		bind:class="orders.refreshing.value ? 'dimmed' : undefined"
		bind:aria-busy="orders.pending.value ? 'true' : undefined"
	>
		<li
			each:of="orders.data.value ?? []"
			each:as="order"
			each:key="order.id"
		>
			{order.total}
		</li>
	</ul>
</template>
```

| Situation     | `data`                                             | `pending` | `refreshing`                                 |
| ------------- | -------------------------------------------------- | --------- | -------------------------------------------- |
| First load    | `null`                                             | `true`    | `false`                                      |
| `refresh()`   | Previous data                                      | `true`    | `true`                                       |
| Input change  | Previous data (with `keepPrevious: false`, `null`) | `true`    | `true` (with `keepPrevious: false`, `false`) |
| Failed reload | Previous data; `error` says why                    | `false`   | `false`                                      |

`<MeekoAwait>` relies on this behavior: during a reload it keeps showing its content and marks the area with `data-meeko-refreshing` and `aria-busy`.

#### Search as you type: `debounceMs` and `enabled`

Since `1.7`, the options in the last argument of `useApi` and `useRpcQuery` include `debounceMs` and `enabled`, for search that queries as you type without a request per keystroke:

```html
<script lang="ts">
	const query = signal('')
	const results = useRpcQuery('docs.search', () => ({ q: query.value.trim() }), {
		debounceMs: 200,
		enabled: () => query.value.trim().length >= 2,
	})
</script>
<template>
	<input
		type="search"
		model="query"
		aria-controls="results"
	/>
	<ul
		id="results"
		bind:aria-busy="results.pending.value ? 'true' : undefined"
	>
		<li
			each:of="results.data.value?.hits ?? []"
			each:as="hit"
			each:key="hit.url"
		>
			<a bind:href="hit.url">{hit.title}</a>
		</li>
	</ul>
</template>
```

- **`debounceMs`.** Milliseconds the input must remain unchanged before requesting data: a burst of changes makes a single request, with the latest input. Each change cancels the current request, whose result is discarded if it still arrives. During the wait `pending` is already `true` (and `refreshing` if there is data) and `data` retains the previous result; with `keepPrevious: false` it is cleared on the first change. It does not delay the browser's first load or `refresh()`. Default: `0`, so each change requests immediately, as through `1.6`.
- **`enabled`.** A boolean, signal or function reading signals. While it is `false`, no request runs, neither on mount nor with `refresh()` (which resolves without doing anything); any request in progress is canceled, `pending` and `refreshing` are `false` and `data` retains the last result, or `null` if there was none (`error` does not change either). When it becomes `true` again, data for the current input is requested (with `debounceMs`, after the wait), unless `data` already belongs to that input. An `enabled` change counts as an input change.
- **SSR.** Both options only act in the browser. A resource with `await` is requested immediately in SSR, without a wait, and its data travels in the payload for hydration, as usual. A resource with `await` starting with `enabled` set to `false` cannot have its data: it fails with an error saying so, on the server and in the browser. Without `await`, the request never runs in SSR, and a disabled resource renders with `pending` set to `false`.

#### `<MeekoAwait>`

Since `1.5`, `<MeekoAwait>` is a built-in Meeko tag, like `<MeekoLink>`: it is not imported and the compiler converts it into a component compiled and distributed by Meeko. It wraps the area for data arriving after the first render, the result of `useApi` or `useRpcQuery` without `await`:

```html
<!-- app/components/ItemsCard.meeko -->
<script lang="ts">
	const items = useApi('/api/items')
</script>
<template>
	<section class="card">
		<h2>Items</h2>
		<MeekoAwait
			for="items"
			reserve
		>
			<snippet name="pending"><ItemsSkeleton /></snippet>
			<snippet
				name="error"
				params="error, retry"
			>
				<p role="alert">
					Could not load.
					<button on:click="retry">Retry</button>
				</p>
			</snippet>
			<ItemsList bind:items="items.data.value" />
		</MeekoAwait>
	</section>
</template>
```

- **`for`.** The resource, as an expression (like `each:of`; `bind:for` also works), or a list: `for="[items, stats]"`. Missing or empty is error `MEEK116`; something that is not a resource is a type error in `meeko check` and the editor, and a `TypeError` at render time. Any object with `data`, `error`, `pending` and `refresh` works (the `AwaitResource` type).
- **States.** The tag's content (`default`) renders when all resources have data. The `pending` snippet renders during the first load: while a resource has no data and is loading (or has not started yet; without `await` the request starts on mount). The `error` snippet renders when a resource without data failed: it receives the error and `retry`, which requests the failed resources again and goes through `pending` once more. Without an `error` snippet, it renders `<p role="alert">` with “No se pudieron cargar los datos.” and a “Reintentar” button (translate these with `bind:messages="{ error, retry }"`). A failed resource takes precedence over another still loading, to offer `retry` as soon as possible.
- **Reloads.** A reload with data (`refresh()`, an input change) does not return to `pending`: the content stays mounted, with its DOM, focus and state, and the `default` snippet receives `refreshing` (`<snippet name="default" params="refreshing">`) for a subtle indicator. A failed reload retains the content; `items.error.value` says why. With `keepPrevious: false`, an input change clears data and the area returns to `pending`.
- **Types.** Within the content, `meeko check` and the editor read `items.data.value` as loaded: no `!` or `?.` is needed, as within `if:when="items.data.value"`. This applies to each `for` resource written as a name (`items`, `page.items`); with another expression, the content uses the usual type. `pending` and `error` are not narrowed. Props are `MeekoAwaitProps` and snippets are `MeekoAwaitSnippets`, from `@meekojs/meeko/framework`; `MeekoAwaitProps` is auto-imported like `MeekoLinkProps`.
- **Markup.** A `<div>` with `class` and `id` if passed, which never changes its element, and with `data-meeko-await="pending|error|ready"`, `aria-busy="true"` while loading or reloading, `data-meeko-refreshing` during a reload and, with `reserve`, `data-meeko-reserve` and `data-meeko-reserve-min`. It includes no styles.
- **Accessibility.** `aria-busy` tells screen readers the area is loading. The error is announced with `role="alert"`: the default message has it; add it to your `error` snippet too. If focus was inside a node disappearing on a state change (the “Reintentar” button, a focusable skeleton), it moves to the area (`tabindex="-1"`, without scrolling the page) instead of being lost in `<body>`; when data arrives, it stays there.
- **SSR.** Without `await`, the request does not run on the server: the HTML carries the `pending` snippet and `aria-busy`, and hydration changes nothing until data arrives. If the resource already has data on the server (an `await useApi`, which also works in `for`), the HTML carries the content.
- **Custom name.** A project component named `MeekoAwait` takes priority over Meeko's tag, with warning `MEEK106`.

##### Reserve height: `reserve`

With `reserve`, while the area waits it occupies the height it last had with data:

- **Memory.** When showing data, a `ResizeObserver` measures the area (after layout, without blocking rendering) and stores its height in `sessionStorage` (`meeko:await`) and memory, under a key combining the path, request key (the payload's: method or procedure and input) and the area's order among those for the same request on the page. It stores the 100 most recent areas. If the browser blocks `sessionStorage` (private mode, a sandbox), memory lasts while the page stays open.
- **Application.** While the area is `pending`, a CSS rule gives it `min-block-size` with the remembered height. The rule lives in a constructed stylesheet (`adoptedStyleSheets`) and the area receives it through its attributes: there is no `style="…"` in the HTML, so it works with a strict CSP without `'unsafe-inline'` in `style-src`. With data, the area returns to its natural height.
- **Explicit minimum.** `reserve="320px"` (any CSS length: `px`, `rem`, `vh`…) also sets a minimum, including on the first visit, and memory never reserves less. Its rule goes in a `<style>` in `<head>` with the request's nonce or, on a static site, allowed by its hash (`inlineStyleHashes`). Anything else is a `TypeError`.
- **Reactive.** With `bind:reserve` (for example, `bind:reserve="compact.value ? false : '320px'"`), enabling, removing or changing the minimum in the browser adds or removes the script and rules in `<head>` and starts or stops measuring the area.

What happens in each case:

| Situation                                                               | First render                                                                                                                                     | When data arrives                                                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| First visit in the tab (no memory)                                      | The skeleton, at its natural height (or the minimum from `reserve="320px"`)                                                                      | The area grows once to fit the content: the same shift as without `reserve`, which only a skeleton of the same height avoids |
| Full load of a page already visited in the tab (reload, opening a link) | The skeleton with its remembered height: an inline `<head>` script, running before the first render, reads `sessionStorage` and adopts the rules | No shift if the content has the same height                                                                                  |
| Client navigation to a previously visited page                          | The area is inserted with its remembered height: the component adopts the rules before inserting it                                              | No shift                                                                                                                     |
| Area mounting later (an `if:`, a tab)                                   | Same as navigation                                                                                                                               | No shift                                                                                                                     |
| Data reload                                                             | Content stays on screen                                                                                                                          | No shift, unless the new content has a different height                                                                      |

The `<head>` script always has the same text, so it has a single CSP hash; it carries the request's nonce and a static site allows it through the hashes in `inlineScriptHashes`. It only touches the CSSOM, never the DOM, so hydration finds the server HTML. Meeko only adds it to pages with `<MeekoAwait reserve>` (with `useHead`, also in the first flush on a `render: "stream"` route). Without constructed stylesheets (browsers before 2023), the area uses its natural height.

Height depends on width: if the window changes significantly between visits, memory adjusts on the next measurement. Two areas with the same request on the same page have different keys based on their order; if the order changes between visits, they swap heights.

##### An optional transition

`<MeekoAwait>` animates nothing. To smooth the height change when the area releases its reservation, in browsers with [`interpolate-size`](https://developer.mozilla.org/docs/Web/CSS/interpolate-size):

```css
@media (prefers-reduced-motion: no-preference) {
	[data-meeko-await] {
		interpolate-size: allow-keywords;
		transition: min-block-size 200ms ease-out;
	}
}
```

A size transition moves what follows on every frame and the browser counts it as a shift (CLS): it smooths perception, not the metric. For the metric, what matters is that the reserved height matches the content's height.

#### Prevent layout shifts (CLS)

A card whose data arrives after the first render is empty in the HTML and grows when the list arrives, pushing what follows: a layout shift, measured by Core Web Vitals as CLS. In order of preference:

1. **`await` on initial load.** With `await useApi(...)`, SSR waits for data and renders the list: nothing needs to grow. This is recommended for what is visible when the page loads.

   ```html
   <!-- app/components/ItemsCard.meeko -->
   <script lang="ts">
   	const items = await useApi('/api/items')
   </script>
   <template>
   	<section class="card">
   		<h2>Items</h2>
   		<ul>
   			<li
   				each:of="items.data.value"
   				each:as="item"
   				each:key="item.id"
   			>
   				{item.name}
   			</li>
   		</ul>
   	</section>
   </template>
   ```

2. **`<MeekoAwait reserve>`.** For what cannot block SSR: secondary data, offscreen areas, components mounting later or data changing with interaction. From the second visit in the tab, the area appears at its height (see [Reserve height](#reserve-height-reserve)).

   ```html
   <script lang="ts">
   	const items = useApi('/api/items')
   </script>
   <template>
   	<section class="card">
   		<h2>Items</h2>
   		<MeekoAwait
   			for="items"
   			reserve
   		>
   			<snippet name="pending">
   				<ul class="skeleton">
   					<li
   						each:of="[1, 2, 3, 4]"
   						each:as="row"
   					></li>
   				</ul>
   			</snippet>
   			<ul>
   				<li
   					each:of="items.data.value"
   					each:as="item"
   					each:key="item.id"
   				>
   					{item.name}
   				</li>
   			</ul>
   		</MeekoAwait>
   	</section>
   </template>
   ```

3. **Skeletons of the same height.** A `pending` snippet with the same rows and heights as the content also avoids the shift on the first visit. If the list has a known size (a page of 20), give the skeleton that size; otherwise, `reserve="320px"` sets a reasonable minimum.
4. **`keepPrevious`.** By default, `refresh()` and an input change retain the previous list until the new one arrives: do not clear it manually before reloading (see [Previous data during a reload](#previous-data-during-a-reload-keepprevious)).
5. **`content-visibility` and `contain-intrinsic-size`.** For long offscreen sections, `content-visibility: auto` with `contain-intrinsic-size: auto 320px` reserves a size and the browser remembers the last one it rendered (`auto`). This is application CSS; it combines well with `<MeekoAwait>`.
6. **`interpolate-size`.** A transition smooths the change but does not remove it from the metric (see [An optional transition](#an-optional-transition)).

`meeko check`, `meeko build` and the editor warn with `MEEK117` about a page or layout rendering data from a `useApi` or `useRpcQuery` without `await` in an `each:of` without handling its loading. It is a hint, never an error: it disappears when you await data with `await`, wrap the list in `<MeekoAwait>`, read the resource's `pending` or `refreshing` (a skeleton with `if:when="items.pending.value"`), place the list under an `if:when` reading its data or pass the whole resource to another component (`bind:items="items"`), which can handle its loading.

#### Mutations

`useRpcMutation(procedimiento)` makes no request until `mutate(input)` is called, never in SSR. `mutate` sends the CSRF token like `rpc.*`, updates `pending`, `data` and `error` and returns the procedure's output, or rejects with its error. You cannot use `await` on it at the top level (`MEEK055`): await `mutate` inside a handler.

Since `1.2`, each submission starts with `pending` set to `true` and `error` to `null` in a single update, and ends by writing `data` or `error` and `pending` set to `false` together: an `effect` reading several of these signals never sees a mixture of the previous attempt and the new one. The options `onSuccess(output, intento)` and `onError(error, intento)` are called afterward, with state already updated, once per attempt (see [Per-attempt notifications](#per-attempt-notifications-onsuccess-and-onerror)).

Since `1.2`, `useApiMutation(ruta, método)` does the same with a non-`GET` API endpoint. `ruta` is written as in `useApi` (`"/api/notes/[id]"`) and `método` is `"POST"`, `"PUT"`, `"PATCH"` or `"DELETE"`; TypeScript only accepts methods existing for that path. `mutate({ params, query, body })` receives the operation's input, checked against the contract, and can be called without arguments if the operation requires nothing. A `204` endpoint resolves to `undefined`.

```html
<script lang="ts">
	const props = defineProps<{ params: { id: string }; search: Record<string, string | string[]> }>()
	const note = await useApi('/api/notes/[id]', { params: { id: props.params.id } })
	const save = useApiMutation('/api/notes/[id]', 'PUT')
	const remove = useApiMutation('/api/notes/[id]', 'DELETE')
	async function rename(text: string): Promise<void> {
		await save.mutate({ params: { id: props.params.id }, body: { text } })
		await note.refresh()
	}
</script>
<template>
	<p if:when="save.error.value">Could not save.</p>
	<button
		bind:disabled="remove.pending.value"
		on:click="() => remove.mutate({ params: { id: props.params.id } })"
	>
		Delete
	</button>
</template>
```

Like `useRpcMutation`, it is called while the component script runs (at its top level), and `await useApiMutation(...)` produces `MEEK055`. Your own application export named `useApiMutation` takes priority over the auto-import.

#### Retry-safe mutations

A write left without a response (the network drops, the server responds with `5xx` or the process dies) may or may not have been applied. Retrying blindly can charge twice; discarding it can lose a sale. Since `1.2`, `useRpcMutation` and `useApiMutation` accept the `retrySafe` option, which handles this case on the client and leaves deduplication to the server:

```ts
const charge = useRpcMutation('sales.checkout', { retrySafe: { key: 'pos:sale' } })
const step = useApiMutation('/api/kitchen/items/[id]/steps', 'POST', { retrySafe: { key: 'kitchen:step', storage: 'session' } })
```

- **Keyed intent.** `mutate(input)` creates a new UUID (the idempotency key), stores the intent (input, key and time) in browser storage under `retrySafe.key`, then sends it with the header `Idempotency-Key: "<uuid>"`, in the Structured Fields string format defined by the IETF draft. If the page closes mid-request, the intent remains stored.
- **Without a response.** A network failure, a `5xx`, a `408` or a `429` retains the intent: `mutate` rejects with the error, `error` reflects it and `charge.uncertain.value` shows the intent (`{ idempotencyKey, input, startedAt }`). It is retried with the **same** key when the browser comes back online (`online` event), when a component using the mutation mounts (including after a reload) and when calling `charge.retry()`. While retrying, `uncertain` retains its value, `pending` is `true` and `error` returns to `null`.
- **With a response.** A `2xx` clears the intent and `mutate` or `retry()` resolve with the output. Any other `4xx` also clears it: the server answered, so there is nothing to retry; the `ClientError` reaches `error` and rejects the promise. `uncertain` returns to `null` in the same update that writes `data` or `error` and sets `pending` to `false`, including in other components using the same key: an `effect` watching `uncertain` already reads that attempt's result, never a previous `error`.
- **One intent at a time.** While there is an uncertain intent under that key, `mutate` rejects with a `MUTATION_UNCERTAIN` error without sending anything. The application decides: `retry()` retries it, `discard()` forgets it without sending it (ask the user for confirmation first, because it may have been recorded) and clears `error`, which described that intent's failure.
- **Never in SSR or dry runs.** The server never sends or reads it, nor do navigation dry runs: only the mounted component retries it.
- **Storage.** `storage: "local"` (default) survives reloads and closing the browser; `"session"` only survives reloads of that tab. If the browser blocks storage, the intent lives in memory and is retried while the page stays open. The intent uses [`useStorage`](#persistent-state-usestorage) internally, so another tab sees it arrive through the `storage` event; if two tabs retry it simultaneously, the server receives the same key twice and responds with the same result.

Use one storage key per mutation, including what distinguishes users or accounts sharing the browser (`` `pos:sale:${restaurant.slug}` ``). An intent stored by another mutation under the same key is never sent to this endpoint. Input is stored and resent as it travels, in JSON.

```html
<script lang="ts">
	const charge = useRpcMutation('sales.checkout', { retrySafe: { key: 'pos:sale' } })
	const failure = signal('')
	async function pay(input: SaleInput): Promise<void> {
		failure.value = ''
		try {
			const receipt = await charge.mutate(input)
			notify(`Venta #${receipt.number} cobrada.`)
		} catch (error) {
			// No response: remains uncertain and will retry with the same key.
			if (!charge.uncertain.value) failure.value = errorMessage(error)
		}
	}
	function discard(): void {
		if (window.confirm('Discard this sale only if you have confirmed it was not recorded.')) charge.discard()
	}
</script>
<template>
	<div
		role="alert"
		if:when="charge.uncertain.value"
	>
		<p>Sale pending verification: no response was received. It will retry with the same key, so it will not charge twice.</p>
		<button
			bind:disabled="charge.pending.value"
			on:click="() => charge.retry().catch(() => {})"
		>
			Retry now
		</button>
		<button on:click="discard">Discard</button>
	</div>
	<p if:when="failure.value">{failure.value}</p>
</template>
```

##### Per-attempt notifications: `onSuccess` and `onError`

An automatic retry (when the connection returns or the component mounts) has no promise to await. Since `1.2`, the `onSuccess` and `onError` options of `useRpcMutation` and `useApiMutation`, with or without `retrySafe`, are called once for each completed attempt, whoever sent it, after updating `data`, `error`, `pending` and `uncertain`:

```ts
const charge = useRpcMutation('sales.checkout', {
	retrySafe: { key: 'pos:sale' },
	onSuccess(receipt, attempt) {
		// Also after a background retry: the sale pending verification was confirmed.
		if (attempt.trigger !== 'mutate') notify(`Venta #${receipt.number} cobrada.`)
		ticket.clear()
	},
	onError(error, attempt) {
		// Only rejections with a response: without a response, the sale remains pending verification.
		if (!attempt.uncertain) notify(`The sale was not recorded: ${errorMessage(error)}`)
	},
})
```

- **`intento`.** Carries the submitted input (`input`), its key (`idempotencyKey`, `null` without `retrySafe`) and who sent it (`trigger`): `"mutate"`, `"retry"` (a call to `retry()`) or `"resume"` (the automatic retry). In `onError`, `uncertain` is `true` when there was no response and the intent is retained for retry; without `retrySafe` it is always `false`.
- **Once per attempt.** If `mutate` and `retry()` await the same request, or two components with the same key share it, each mutation notifies only once. The `mutate` and `retry()` promise still resolves or rejects as usual: use notifications for what must also happen after a background retry and the promise for what belongs to that specific call.
- **Errors.** A failure inside the notification (or its rejected promise if asynchronous) reaches the nearest `provideErrorHandler` with source `"event"`, like an `on:` handler; it changes neither mutation state nor the promise's result.

**On the server**, the key arrives validated as `context.idempotencyKey`: the lowercase UUID, or `undefined` if the header is missing or is not a UUID (accepted with or without quotes). Meeko does not deduplicate: the application stores the key alongside the result, with a unique constraint, and on a repeated key returns the result already recorded instead of applying the write again.

```sql
ALTER TABLE sales ADD COLUMN idempotency_key uuid;
CREATE UNIQUE INDEX sales_idempotency_key ON sales (restaurant_id, idempotency_key);
```

```ts
// server/rpc/sales/checkout.ts
export default defineRpc({
	input: saleInput,
	output: saleReceipt,
	auth: 'required',
	handler: async ({ input, context }) => {
		const key = context.idempotencyKey
		if (!key) throw new ApiError('IDEMPOTENCY_KEY_REQUIRED', 400)
		const { db, restaurantId } = context.services
		// Retrying an already recorded sale returns the same receipt without charging again.
		const existing = await db.sales.findByKey(restaurantId, key)
		if (existing) return existing.receipt
		// The unique constraint also covers two simultaneous retries: the second INSERT fails
		// and reads the first one's sale again.
		return db.sales.insertOrGet(restaurantId, key, input)
	},
})
```

Scope the key to the user or account, as in the index, and, if you want to follow the IETF draft exactly, respond with `422` when the same key arrives with different input. The header does not change security: the request still needs the usual session, CSRF token and `Origin`. On a same-origin request the browser sends it directly; if a cross-origin client calls the API with CORS, add `Idempotency-Key` to `Access-Control-Allow-Headers` in your proxy or middleware.

##### A custom key in `api.*` and `rpc.*`

Since `1.2`, a generated client call accepts `idempotencyKey`, a UUID traveling in the same `Idempotency-Key` header. It goes alongside `params`, `query`, `body` and `signal` in `api.*`, and in the options of `rpc.*`:

```ts
const key = crypto.randomUUID()
await api.sales.post({ body: sale, idempotencyKey: key })
await rpc.sales.checkout(sale, { idempotencyKey: key, signal: AbortSignal.timeout(10_000) })
```

A non-UUID value rejects with `TypeError` without sending the request. The key is neither stored nor retried: it is the same header, and deduplication remains the server's responsibility.

| Situation                                                                                                                               | Use                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A write from a component that must survive a network drop or reload, with an “under verification” notice                                | `useRpcMutation` / `useApiMutation` with `retrySafe`: Meeko creates the key, stores the intent and retries it |
| Non-component code (a script, your own queue, a service worker) or a key that already exists outside Meeko, such as an offline order ID | `api.*` / `rpc.*` with `idempotencyKey`: you store the key and repeat the call with it                        |
| Testing server deduplication                                                                                                            | `api.*` / `rpc.*` with `idempotencyKey`, without writing the header manually                                  |

#### `load` or composables

| Need                                                                               | Use                                                                                          |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Page data determining `head`, a redirect, session or HTTP status                   | Top-level `<script server>` code (or `load`)                                                 |
| Slow, secondary data on a `"stream"` route                                         | An export, or a `load` field, with `defer`                                                   |
| Data belonging to a reusable component or layout                                   | `await useApi` / `await useRpcQuery`                                                         |
| Data depending on component signals and reloading when they change                 | `useApi` / `useRpcQuery`, with or without `await`                                            |
| Data that can arrive after the first render, with a loading indicator              | `useApi` / `useRpcQuery` without `await`, with [`<MeekoAwait>`](#meekoawait) to avoid shifts |
| Writes                                                                             | `useRpcMutation` / `useApiMutation`, or `api.*`/`rpc.*` in a handler                         |
| Writes that must not apply twice if the response is lost (payments, kitchen steps) | `useRpcMutation` / `useApiMutation` with `retrySafe`                                         |
| Browser state that must survive a reload (an open ticket, the selected register)   | [`useStorage`](#persistent-state-usestorage)                                                 |
| Forms submitting data, with validation and per-field errors                        | `useForm` with `api.*`/`rpc.*` in its `submit`                                               |

These composables' top-level rules (`MEEK054`, `MEEK055`) are described in [api.md](api.md#top-level-composables-and-await). A custom host can create them with `createUseApi(manifest, options)`, `createUseRpcQuery(manifest, options)`, `createUseRpcMutation(manifest, options)` and, since `1.2`, `createUseApiMutation(manifest, options)` from `@meekojs/meeko/framework`, which is what generated clients do; the types `DataResource`, `LoadedResource`, `RpcMutation`, `UseApi`, `UseRpcQuery`, `UseRpcMutation`, `ApiQueryContract`, `ApiQueryOptions` and `Reactive`, since `1.2` `ApiMutation`, `ApiMutationInput`, `ApiMutationContract`, `UseApiMutation`, `MutationOptions`, `RetrySafeOptions`, `RetrySafeMutation` and `UncertainMutation`, and since `1.5` `DataResourceOptions`, describe their shape.

### Persistent state: `useStorage`

Since `1.2`, `useStorage(clave, inicial, opciones?)` returns a writable signal whose value is stored as JSON in `localStorage` (or in `sessionStorage` with `storage: "session"`). It is auto-imported in `.meeko` files from `@meekojs/meeko/framework`, like `useState`, and called while a component's script runs (at its top level or inside a composable it calls).

```html
<script lang="ts">
	const lines = useStorage('pos:ticket', [] as TicketLine[])
	const registerId = useStorage('pos:register', '')
	const add = (line: TicketLine): void => {
		lines.value = [...lines.value, line]
	}
</script>
<template><p>{lines.value.length} items on the receipt</p></template>
```

- **SSR and hydration without mismatches.** The server never reads storage: the HTML uses `inicial`, as does hydration. The stored value is applied just after page hydration finishes, before `onMounted`, like `model` with a control the user edited before hydration. A component mounting later (an `if:` opening, a page reached by browser navigation) already renders the stored value on its first render. The signal does not travel in payload state: its source is storage.
- **Writes.** Every assignment is stored immediately, as JSON. Assign new values (`lines.value = [...lines.value, line]`), as with any signal: mutating the object neither notifies nor stores. Assigning `undefined` deletes the key, and the next read returns to `inicial` (declare the type with `| undefined`, for example `useStorage<string | undefined>("draft", undefined)`).
- **Invalid reads.** A value that is not JSON or fails `schema` is ignored and the signal holds `inicial`. `schema` is a synchronous Standard Schema (Valibot, Zod…); with it, the signal's type comes from the schema:

  ```ts
  import * as v from 'valibot'
  const theme = useStorage('theme', 'light', { schema: v.picklist(['light', 'dark']) })
  ```

- **Blocked storage.** In private mode, without permission or with a full quota, it never throws: the signal keeps working in memory. Only an unexpected failure, such as a value JSON cannot represent (`BigInt`, cycles) or a `schema` that throws or is asynchronous, reaches the nearest `provideErrorHandler` or the application's `onError`.
- **Other tabs.** While any component uses the key, another tab's `storage` event updates the signal (with the same validation); a `localStorage.clear()` returns it to `inicial`. The listener is disposed of with the last component using it.
- **One signal per key.** Two components using the same key and storage share a single signal; the first to create it sets `inicial` and `schema`. When no component uses it anymore, the next one reads storage again.

| Need                                                       | Use                      |
| ---------------------------------------------------------- | ------------------------ |
| Shared application state, identical in SSR and the browser | `useState`               |
| Browser state surviving a reload or shared between tabs    | `useStorage`             |
| Data belonging to the server                               | `useApi` / `useRpcQuery` |

Do not store secrets or tokens: storage is readable by any script on the page. Include in the key what distinguishes users or accounts sharing a browser (`` `pos:ticket:${restaurant.slug}` ``).

### Forms: `useForm`

Since `1.2`, `useForm` brings together what each form repeats: a signal per field, browser validation, `pending`, the error message, `event.preventDefault()` and the `issues` from a server `400` mapped to each field. It is auto-imported from `@meekojs/meeko/framework` and validates with any Standard Schema, such as Valibot's. Its types `Form`, `FormField` and `FormSubmission` are also auto-imported as types in components and `app/` modules; they are not available in `<script server>`, `server/` or `shared/`.

```ts
// shared/schemas/menu.ts
import * as v from 'valibot'

export const categoryInput = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Enter a name.'), v.maxLength(60, 'Use at most 60 characters.')),
	description: v.pipe(v.string(), v.trim(), v.maxLength(200, 'Use at most 200 characters.')),
})
export const categorySchema = v.object({ id: v.string(), name: v.string(), description: v.string() })
```

```ts
// server/api/menu/categories/index.post.ts
import { ApiError, defineApiRoute } from '@meekojs/meeko/server'
import { categoryInput, categorySchema } from '../../../../shared/schemas/menu.js'
import { createCategory } from '../../../utils/menu.js'

export default defineApiRoute({
	body: categoryInput,
	response: categorySchema,
	status: 201,
	handler: async ({ body }) => {
		const category = await createCategory(body)
		if (!category) throw new ApiError('CATEGORY_EXISTS', 409)
		return category
	},
})
```

```html
<!-- app/components/TextField.meeko -->
<script lang="ts">
	const props = defineProps<{ label: string; error?: string | undefined }>()
	const value = defineModel<string>('value')
</script>
<template>
	<label>
		{props.label}
		<input
			model="value"
			bind:aria-invalid="props.error ? 'true' : null"
		/>
	</label>
	<p
		class="field-error"
		if:when="props.error"
	>
		{props.error}
	</p>
</template>
```

```html
<!-- app/pages/menu/categories/new.meeko -->
<script lang="ts">
	import { ClientError } from '@meekojs/meeko/framework'

	const form = useForm({
		schema: categoryInput,
		initial: { name: '', description: '' },
		submit: (values) => api.menu.categories.post({ body: values }),
		errorMessage: (failure) => (failure instanceof ClientError && failure.code === 'CATEGORY_EXISTS' ? 'A category with that name already exists.' : 'Could not save. Check your connection and try again.'),
	})
</script>
<template>
	<form
		on:submit="form.submit"
		novalidate
	>
		<p
			class="alert"
			role="alert"
			if:when="form.error.value"
		>
			{form.error.value}
		</p>
		<label>
			Name
			<input
				model="form.fields.name"
				bind:aria-invalid="form.errors.value.name ? 'true' : null"
			/>
		</label>
		<p
			class="field-error"
			if:when="form.errors.value.name"
		>
			{form.errors.value.name}
		</p>
		<TextField
			label="Description"
			model:value="form.fields.description"
			bind:error="form.errors.value.description"
		/>
		<button bind:disabled="form.pending.value">{form.pending.value ? "Saving…" : "Save"}</button>
		<p if:when="form.submitted.value">Category saved.</p>
	</form>
</template>
```

`useForm(options)` receives:

| Option                    | Usage                                                                                                                                                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`                  | Optional. Standard Schema validating fields on submission.                                                                                                                                                                                                                  |
| `initial`                 | Each field's initial value. With `schema`, one for every input key, including optional ones (`undefined` if there is no value).                                                                                                                                             |
| `submit(values)`          | Submits data: receives the schema output (or field values, without a schema) and returns the result, or rejects.                                                                                                                                                            |
| `errorMessage(failure)`   | Optional. `error` text for a failure without `issues`; defaults to `failure.message`, which for a `ClientError` is its `code`.                                                                                                                                              |
| `onSuccess(result, form)` | Optional, since `1.5`. Runs after a successful submission, with `submitted` already `true`: for example, `(saved, form) => form.commit({ name: saved.name })`.                                                                                                              |
| `focusInvalid`            | Optional, since `1.5`. With `true`, moves focus to the first invalid control after a submission with field errors (see [Focus the first error](#focus-the-first-error)).                                                                                                    |
| `action`                  | Optional, since `1.7`. Path of the endpoint with `form` to which the `<form method="post">` submits without JavaScript, such as `"/api/feedback"`: on return from that submission, SSR renders its result (see [Forms without JavaScript](#forms-without-javascript-form)). |

and returns a `Form`:

| Property            | Value                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fields`            | A writable `Signal` per field, for `model` on an `<input>`, `<textarea>` or `<select>` and `model:nombre` on a component.                            |
| `errors`            | Signal with the first message of each path with an error (`errors.value.name`, `errors.value["items.0.name"]`); a field without an error has no key. |
| `error`             | Signal with the whole form's message, or `null`.                                                                                                     |
| `failure`           | Signal with the original error of the last failed submission (including the `ClientError` of a `400`), or `null`.                                    |
| `pending`           | `true` during asynchronous validation or while `submit` runs.                                                                                        |
| `submitted`         | `true` when the last submission succeeded.                                                                                                           |
| `dirty`             | `true` if any field differs from its initial value (arrays and objects are compared by content).                                                     |
| `submit(event?)`    | Submits the form; resolves with the return value of `submit`, or `undefined`. Never rejects.                                                         |
| `trySubmit(event?)` | Since `1.5`. Submits like `submit`, but resolves with a `FormSubmission` describing how it ended. Never rejects.                                     |
| `reset(values?)`    | Returns to `initial`, or `initial` combined with `values`; also accepts a `<form>`'s `reset` event.                                                  |
| `load(values)`      | Fills fields with a record to edit. Omitted keys retain their current value; loaded data is the `dirty` baseline.                                    |
| `commit(values?)`   | Since `1.5`. Writes `values` and takes field values as the new `dirty` baseline, without clearing `submitted`.                                       |
| `field(name)`       | Since `1.5`. A field's pieces for your own component: its signal, message and stable IDs (see [Field components](#field-components-formfield)).      |
| `csrfToken`         | Since `1.7`. The session's CSRF token for a native form's hidden `_csrf` field, or `undefined` without a session. It is not a signal.                |

All signals except `fields` are read-only (`csrfToken` is text, not a signal).

**Submission.** `form.submit(event)` calls `event.preventDefault()`, validates fields with the schema and, if valid, calls `submit` with the schema's output. While a submission is in progress, another `form.submit()` is ignored (resolves to `undefined`, and also prevents native browser submission). When a valid submission starts, `errors`, `error`, `failure` and `submitted` are cleared. `submit` can return a value or a promise; to do something with the result, wrap the call:

```ts
async function save(event: SubmitEvent): Promise<void> {
	const category = await form.submit(event)
	if (category) form.reset()
}
```

**Submission result.** `submit` resolves to `undefined` whether data is invalid, the network fails or `submit` returns `undefined`. Since `1.5`, `form.trySubmit(event)` submits the same way, but resolves with a `FormSubmission<Result>` discriminated by `ok` and `reason`:

| Result                                                     | When                                                                                                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ ok: true, result }`                                     | `submit` succeeded and returned `result`.                                                                                                                                             |
| `{ ok: false, reason: "invalid", errors, error, failure }` | Data failed the browser schema (`failure` is `null`) or the server responded with `issues` (`failure` is the `ClientError`). `errors` and `error` are the messages the form displays. |
| `{ ok: false, reason: "error", error, failure }`           | Submission failed without `issues`, such as a `409` or a network failure. `error` is the text from `errorMessage`, or `null` if a `reset` discarded it.                               |
| `{ ok: false, reason: "skipped" }`                         | Nothing was submitted: a submission was already in progress, the script is running only to produce HTML (SSR) or a `reset` discarded values while the schema was validating.          |

```ts
async function send(event: SubmitEvent): Promise<void> {
	const outcome = await form.trySubmit(event)
	if (outcome.ok) created.value = outcome.result.username
	else if (outcome.reason === 'error') console.warn(outcome.failure)
}
```

`submit` is unchanged: it still resolves with the result or `undefined`, and `on:submit="form.submit"` remains the short form when you do not need the result.

#### Focus the first error

With `focusInvalid: true`, a submission ending with field errors, from the schema or server `issues`, moves focus to the first invalid control once messages have rendered (in the next `requestAnimationFrame`). It searches in document order within the event's `<form>` (its `currentTarget`, or the submitting button's form), for a control whose `name` or `form.field` `id` matches a field with an error, or that has `aria-invalid="true"`. Without an event, it searches the entire document. A failure without `issues`, such as a `409` without them or a network failure, does not move focus.

```ts
const form = useForm({ schema: signupInput, initial: { email: '', password: '' }, submit: (values) => api.signup.post({ body: values }), focusInvalid: true })
```

**Validation.** The schema runs on submission, not while typing. Each issue goes to `errors` with its path joined by `.`, like server `issues`: `"name"`, or `"items.0.name"` for a nested field. If a path has several, the first is kept. An issue with path `""` (from a rule on the whole object) or for a key the form does not have goes to `error`. After an error, the field is validated again whenever it changes: its message updates or disappears as soon as it is valid, without waiting for the next submission. A field without an error is not validated until submission. If the schema is asynchronous, `pending` is `true` while it validates.

**Fields depending on others.** Since `1.5`, each change also revalidates other fields already showing a schema error, and the form message if it came from the schema (an issue with path `""`). The schema always runs over the entire form, so this costs no more. With a confirmation that Valibot forwards to its field using `v.forward(v.partialCheck([["password"], ["confirm"]], …), ["confirm"])`, changing the password removes “Las contraseñas no coinciden” from `confirm` as soon as they match, without touching confirmation. Rules still do not add messages to a field that had no error, and another field's server messages (an `issue` from a `400` or an `ApiError`) are not cleared by changing a different field: only when their own field changes. With an asynchronous schema, only the latest validation applies, covering all fields changed since the previous one.

**Server errors.** A `ClientError` with `issues` (the `400` response for input failing the server schema) is distributed the same way: each message in its field and the rest in `error`. This is useful without a browser schema, or when the server has rules the form does not check. Without a schema, changing a field clears its server messages:

```ts
// app/pages/ingresar.meeko: without a schema, only the server validates
const form = useForm({
	initial: { email: '', password: '' },
	submit: (values) => api.session.post({ body: values }),
	errorMessage: (failure) => (failure instanceof ClientError && failure.code === 'INVALID_CREDENTIALS' ? 'The details do not match any account.' : 'Could not connect to the server.'),
})
```

```json
{
	"code": "INVALID_BODY",
	"status": 400,
	"requestId": "…",
	"issues": [
		{ "path": "email", "message": "Enter a valid email address." },
		{ "path": "password", "message": "Enter your password." }
	]
}
```

With that response, `form.errors.value` is `{ email: "Enter a valid email address.", password: "Enter your password." }`, `form.error.value` is `null` and `form.failure.value` is the `ClientError`. A `401` `INVALID_CREDENTIALS` leaves `errors` empty and `error` with the text from `errorMessage`. To mark a field from `submit` itself (for example, after checking something in the browser), throw a `ClientError` with `issues`: `throw new ClientError("EMAIL_TAKEN", 409, undefined, [{ path: "email", message: "Ese correo ya tiene cuenta." }])`.

Since `1.5`, the server can also assign a non-validation error to a field, such as a `409` for an email that already exists: `new ApiError(code, status, { issues })` sends those `issues` with the same shape as those of a `400` (see [Field errors: `ApiError` with `issues`](#field-errors-apierror-with-issues)), and `useForm` distributes them the same way: the message in `errors.value.email`, `error` set to `null` and the `409`'s `ClientError` in `failure`.

```ts
// server/api/signup.post.ts
export default defineApiRoute({
	body: signupInput,
	response: signupResult,
	status: 201,
	handler: async ({ body }) => {
		if (await emailTaken(body.email)) throw new ApiError('EMAIL_TAKEN', 409, { issues: [{ path: 'email', message: 'That email already has an account.' }] })
		return createUser(body)
	},
})
```

`ClientError` and `isClientError` are auto-imported since `1.5` in components and `app/` modules (not in `server/`, where you throw `ApiError`), like `useForm`: `errorMessage: (failure) => isClientError(failure, "INVALID_CREDENTIALS") ? "…" : "…"` needs no import.

**Other failures.** An error without `issues` puts the text of `errorMessage(failure)` in `error` and the original error in `failure`, and `form.submit()` resolves to `undefined`. A `ClientError` is an expected server response and is not reported elsewhere. Any other error (a network failure, a programming error in `submit` or a schema that throws) also reaches the component's error observer, `provideErrorHandler` or the `onError` of `mountClientApp`, with source `"event"`; without an observer, it is written to the console. Thus an unexpected failure is never silently lost, even if the template does not show `error`.

**`reset`, `load` and `dirty`.** `reset()` always returns fields to `initial`, even after `load` or `commit`. `reset(values)` combines `values` with `initial` and takes that result as the `dirty` baseline. `load(values)` combines data with current fields and uses the result as the `dirty` baseline; use it when loading a record to edit, including after an asynchronous request: `form.load({ name: category.name, description: category.description })`. Both clear errors and the last submission's state, and discard earlier results still in progress (although `pending` stays `true` until completion). `reset` can also be connected to `on:reset="form.reset"`. As with any signal, replace arrays and objects instead of mutating them: `form.fields.items.value = [...form.fields.items.value, item]`.

**`commit`.** Since `1.5`, `commit(values?)` writes `values` to their fields and takes all field values as the new `dirty` baseline: `dirty` returns to `false`. `reset()` still returns to `initial`. Unlike `reset`, it does not clear `submitted`, `errors`, `error` or `failure`, nor discard an in-progress submission. Use it after saving, so saved data becomes the new baseline without losing the “Saved” state. Without `values`, it takes current values; if the user can keep typing during submission, pass what the server returned. With `onSuccess`, the form does this itself:

```ts
const profile = useForm({
	schema: profileInput,
	initial: { name: data.name, bio: data.bio },
	submit: (values) => api.profile.put({ body: values }),
	onSuccess: (saved, form) => form.commit({ name: saved.name, bio: saved.bio }),
})
```

```html
<p if:when="profile.submitted.value && !profile.dirty.value">Saved.</p>
```

**Types.** With `schema`, fields have the schema input's type and `submit` receives its output: with a `v.transform`, the field can be text (`price: Signal<string>`) and `submit` receive a number. Without a schema, fields and values have the type of `initial`. `meeko check` checks `initial` against the schema input, rejects a nonexistent field (`form.fields.nmae`) or a nonexistent `errors` path, and requires a `model` field to have the control's type (a `number` field does not work for a text `<input>`). The `Form<Values, Result>` type describes the result, for example to pass the form to a component.

#### Field components: `FormField`

Since `1.5`, `form.field(name)` returns what a field component needs, without receiving the entire form: a `FormField<Value>` typed by the field key (`form.field("nmae")` is a type error). It always returns the same object for the same field, so you can pass it as a prop in the template.

| Property                  | Value                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `value`                   | The same `Signal` as `form.fields[name]`, for `model`.                                                                                                                                                 |
| `name`                    | The field name, for the `name` attribute (and for `focusInvalid`).                                                                                                                                     |
| `id`, `errorId`, `hintId` | IDs for the control, its message (`${id}-error`) and hint text (`${id}-hint`). They come from [`useId`](api.md#stable-ids-useid): they match between SSR and hydration and do not repeat across forms. |
| `error`                   | Signal with the field's first message (or a nested path's, such as `items.0.name`), or `undefined`.                                                                                                    |
| `invalid`                 | Signal: `true` if the field has any error.                                                                                                                                                             |
| `describedBy`             | Signal: `errorId` while there is an error, or `undefined`; the value for `aria-describedby`.                                                                                                           |

```html
<!-- app/components/AppField.meeko -->
<script lang="ts">
	import type { FormField } from '@meekojs/meeko/framework'
	const props = defineProps<{ field: FormField<string>; label: string; hint?: string }>()
	const describedBy = computed(() => [props.hint ? props.field.hintId : '', props.field.describedBy.value ?? ''].filter(Boolean).join(' ') || null)
</script>
<template>
	<div class="field">
		<label bind:for="props.field.id">{props.label}</label>
		<input
			bind:id="props.field.id"
			bind:name="props.field.name"
			model="props.field.value"
			bind:aria-invalid="props.field.invalid.value ? 'true' : null"
			bind:aria-describedby="describedBy.value"
		/>
		<p
			if:when="props.hint"
			class="field-hint"
			bind:id="props.field.hintId"
		>
			{props.hint}
		</p>
		<p
			if:when="props.field.error.value"
			class="field-error"
			bind:id="props.field.errorId"
		>
			{props.field.error.value}
		</p>
	</div>
</template>
```

```html
<form
	on:submit="form.submit"
	novalidate
>
	<AppField
		bind:field="form.field('email')"
		label="Email"
	/>
	<AppField
		bind:field="form.field('password')"
		label="Password"
		hint="At least 10 characters."
	/>
</form>
```

**A field with `field` or `model`.** A reusable field component can work inside a form, with `bind:field`, and outside it, with `model` or nothing. Declare `field` as optional and the default model with unnamed options, `defineModel<string>({ default: "" })`, so it is optional too (see [Component models](api.md#component-models-definemodel-and-model)); with `defineModel<string>()`, `<AppTextField bind:field="…" />` produces `TS2741` because the model would be required. Choose between the two within a `computed`:

```html
<!-- app/components/AppTextField.meeko -->
<script lang="ts">
	import type { FormField } from '@meekojs/meeko/framework'
	const props = defineProps<{ field?: FormField<string>; label: string; hint?: string; error?: string }>()
	// Without field, the value is the model: the parent's signal (model="señal") or its own.
	const model = defineModel<string>({ default: '' })
	const ownId = useId()
	const id = computed(() => props.field?.id ?? ownId)
	const hintId = computed(() => `${id.value}-hint`)
	const errorId = computed(() => `${id.value}-error`)
	const value = computed(() => props.field?.value ?? model)
	const error = computed(() => (props.field ? props.field.error.value : props.error))
	const describedBy = computed(() => [props.hint ? hintId.value : '', error.value ? errorId.value : ''].filter(Boolean).join(' ') || null)
</script>
<template>
	<div class="field">
		<label bind:for="id.value">{props.label}</label>
		<input
			bind:id="id.value"
			bind:name="props.field?.name"
			model="value.value"
			bind:aria-invalid="error.value ? 'true' : null"
			bind:aria-describedby="describedBy.value"
		/>
		<p
			if:when="props.hint"
			class="field-hint"
			bind:id="hintId.value"
		>
			{props.hint}
		</p>
		<p
			if:when="error.value"
			class="field-error"
			bind:id="errorId.value"
		>
			{error.value}
		</p>
	</div>
</template>
```

```html
<form
	on:submit="form.submit"
	novalidate
>
	<AppTextField
		bind:field="form.field('email')"
		label="Email"
	/>
</form>
<AppTextField
	model="query"
	label="Search"
	hint="By name or email."
/>
<AppTextField label="Notes" />
```

`model="value.value"` binds the signal chosen by the `computed`: the field's or the model's. Field IDs come from `form.field` and, without it, from `useId`, with the same `-hint` and `-error` suffixes as `hintId` and `errorId`. `const value = props.field?.value ?? model` in setup would produce warning `MEEK101`, correctly: setup runs once and, with reactive props, the parent can change fields without remounting the child (`bind:field="editing.value ? form.field('email') : form.field('phone')"`). `form.field` returns the same object for the same field, but the prop can switch to another; within a `computed`, the value and IDs follow that change. Use `untrack(() => props.field)` only if that instance's field never changes.

For a field of another type, declare the prop with its type (`FormField<boolean>` for a checkbox). IDs from `form.field` take the `document.idPrefix` prefix. Call `useForm` at the script's top level, like `useId`, so its IDs match during hydration.

**SSR and hydration.** In SSR, the form renders with `initial` and never submits: events do not exist on the server, and `form.submit()` does nothing if called while the script runs solely to produce HTML (SSR or a navigation dry run). Fields are component state that does not travel in the payload: they are part of neither transferred state nor state preserved by HMR, because `form` is not a signal. During hydration, the browser runs `useForm` again with the same `initial`, so `initial` must depend only on props, route data and state, like the input of an `await useApi`. Anything the user types before page hydration is preserved: `model` copies it to the field signal when hydration finishes. Since `1.7`, with `action`, the result of a submission without JavaScript does travel in page state, so hydration renders the same as SSR (see [Forms without JavaScript](#forms-without-javascript-form)).

Call `useForm` at the top level of `<script>`, like any component state. Unlike `useApi`, it has no `MEEK054` restriction and does not accept `await`.

## WebSocket

`server/socket/chat.ts` exports a `defineSocketChannel` with separate schemas for each direction. Schemas exposed to the client must come from `shared/`. The generator emits a public contract without importing private handlers. Each event is declared as `evento: schema` or, since `1.2`, with the shorthand `{ kitchenChanged }` when the imported schema has the same name as the event; the same applies to `defineApiRoute` and `defineRpc` fields (`{ body, response }`).

```ts
// server/socket/chat.ts
import { defineSocketChannel } from '@meekojs/meeko/server'
import { chatInput, chatMessage } from '../../shared/schemas/chat.js'

export default defineSocketChannel({
	clientToServer: { message: chatInput },
	serverToClient: { message: chatMessage },
	auth: 'required',
	authorize: ({ context, roomId }) => !!context.session.current && roomId === 'general',
	handlers: { message: async ({ payload, emit }) => emit('message', payload) },
})
```

```ts
// Inside <script lang="ts"> in app/pages/chat/index.meeko
const chat = typeof window === 'undefined' ? undefined : useSocket('chat', { roomId: 'general' })
const unsubscribe = chat?.on('message', (message) => console.log(message.text))
const send = async () => chat?.emit('message', { text: 'Hello', roomId: 'general' })
```

Through `1.6`, `useSocket` without `await` could only be called in the browser (it threw during SSR), hence the `window` check; since `1.7`, during SSR it returns an inert client that stays in `"connecting"` (its `on` registers nothing and its `emit` rejects), so the check is no longer needed. Since `1.1`, top-level `await useSocket(...)` goes further: setup splits at that point and the rest runs only in the browser, after the component mounts and with the socket already open (`"open"` state). The template can only use names declared before the `await` (`MEEK057`), and if the socket never opens, the continuation keeps waiting (see [api.md](api.md#top-level-composables-and-await)):

```html
<script lang="ts">
	const messages = signal<string[]>([])
	const chat = await useSocket('chat', { roomId: 'general' })
	chat.on('message', (message) => {
		messages.value = [...messages.value, message.text]
	})
</script>
<template>
	<p
		each:of="messages.value"
		each:as="text"
	>
		{text}
	</p>
</template>
```

The signature and contract of `useSocket` without `await` do not change. `socket.chat.on(...)` and `socket.chat.emit(...)` offer an alternative typed registry. The registry opens connections only when you access the channel in the browser. Within `mountClientApp`, each application keeps its own connection per channel and closes it on unmount; listeners registered during setup unsubscribe when their root is disposed. Outside a mounted application, the registry keeps its shared client and the caller must dispose of its listeners. `useSocket` requires a component root and disposes of its connection on unmount. No connections open during SSR. In the browser, neither the render that produces a component's HTML before mounting it (under an `if:` or when committing navigation) nor dry runs open connections: there, `useSocket` and `socket.x` return a client that stays in `"connecting"`, whose `emit` rejects, and mounting opens the connection once. The client uses native WebSocket, reconnection with configurable backoff and at-most-once delivery: `emit` rejects while disconnected, with no queue or retries. Invalid incoming messages close the channel; a transport error is reported once per active connection and errors from replaced connections are ignored. A failing listener or `state` observer is reported without preventing other listeners from running or escaping the transport callback. The low-level client accepts `onError(error)` to observe these failures; without an application or component callback, it logs them to the console.
The `socket` registry is application-scoped: cancel listeners with the function returned by `on` and close the channel when you no longer need it.

**Authentication or authorization rejection.** Since `1.1`, when the server rejects the session, the client does not retry: its `state` enters the terminal `"unauthorized"` state, it stops listening and the error observer receives a `ClientError` with `status` `401` (code `UNAUTHENTICATED`) or `403` (`FORBIDDEN`), rather than a generic transport error. It detects this from close codes `4401` and `4403`, the hub's policy code (`1008`, with reason `Unauthorized`, `Session expired` or `Session revoked`) and a handshake rejected with `401` or `403` when the `WebSocket` implementation exposes the HTTP status, such as Node's `ws` package through `webSocketFactory`. `close()` moves an `"unauthorized"` client to `"closed"`; to retry, create another client (in a component, by mounting it again).

**Handshake closes `4401` and `4403`.** The browser's `WebSocket` (and Node's global one) does not expose the HTTP status of a rejected handshake, so since `1.1` Meeko adapters do not respond with `401` or `403` to session or channel authorization rejection. If the hub's precheck rejects the session (an `auth: "required"` channel without a session, `401`) or authorization (`authorize` returns `false`, `403`), the server accepts the upgrade and immediately closes with `4401` (reason `Autenticación requerida`, meaning authentication required) or `4403` (`Acceso denegado`, meaning access denied). It calls no handler and delivers no messages, and the reason is fixed text without session data. The client thus reaches `"unauthorized"` in the browser too, without retrying. Because the upgrade completes, `state` can briefly pass through `"open"` before closing, and an `emit` made at that moment is discarded. A hub reauthorizing an already accepted connection, such as a room's Durable Object on wakeup, closes with `4401` or `4403` in the same way.

Other handshake rejections keep their HTTP response, which the browser sees as a network failure and retries with backoff: an invalid channel name, method or non-upgrade request (`400`), nonexistent channel (`404`), limits (such as `431` on Cloudflare) and a disallowed Origin (`403` `INVALID_ORIGIN`). Origin is a request policy, rather than channel authorization: a foreign origin never completes an upgrade or reaches the session check, so it cannot distinguish `4401` from `4403` either.

`serveNode` connects `attachNodeWebSocketServer` to the same HTTP server when the application declares channels. The Node adapter uses `ws` for framing and upgrades; Bun uses `Bun.serve`'s native WebSocket and Deno uses `Deno.upgradeWebSocket` (see their limitations under [Bun](#bun) and [Deno](#deno)), and Cloudflare Workers hosts each room in a Durable Object with hibernation (see [Cloudflare Workers](#cloudflare-workers)). They all share `createSocketUpgradeHandler`, which checks the route, Origin and session before upgrading and returns `{ action: "reject", status, close }` for session or authorization rejections. A custom adapter that handles `close` upgrades and closes with `close.code` and `close.reason`; one written for `1.0`, which ignores it, still responds with `status`. The existing hub validates Origin, session, channel, room, event and payload; it applies message/buffer limits, heartbeat and graceful shutdown. Behind a proxy, the same `publicOrigin` from `server/runtime.ts` or `MEEKO_PUBLIC_ORIGIN` governs HTTP and Socket Origin checks.

### Clients with explicit URLs and contracts

The `useSocket("canal", opciones)` auto-import covers the application's own channels. For another URL or a custom contract, `@meekojs/meeko/framework` offers two functions with the signature `(url, contract, options)`:

- `useSocketClient` (since `1.1`) binds the client to the current component root, just like the auto-import: it does not connect during SSR (since `1.7` it returns an inert client there; through `1.6` it threw) or during a render that only produces HTML, uses the nearest error observer and closes the connection on unmount. It supports top-level `await useSocketClient(...)` in `<script>`.
- `createSocketClient` creates an independent client, including outside a component; the caller closes it with `close()`.

```ts
import { useSocketClient } from '@meekojs/meeko/framework'

// Inside <script lang="ts"> in a component
const feed = await useSocketClient('wss://feed.example.com/_meeko/socket/prices', pricesContract)
feed.on('price', (price) => console.log(price.symbol, price.value))
```

Through `1.0` this function was exported as `useSocket` from `@meekojs/meeko/framework`, with the same name as the generated auto-import and a different signature. That export remains available as a deprecated alias of `useSocketClient` (the same function) throughout 1.x and will be removed in `2.0`. The generated clients' `useSocket("canal")` auto-import is not deprecated. In a project without generated clients, the `useSocket` auto-import resolves to `useSocketClient`.

### Broadcast from the server

Since `1.2`, the `socket` auto-import in server code (API, RPC, `<script server>`, middleware and Socket handlers) adds `broadcast(roomId, event, payload)` to each channel, typed with the channel's generated contract. It replaces manually publishing to the runtime's `SocketPubSub`, which does not check the event or payload:

```ts
// server/socket/operations.ts
import { defineSocketChannel } from '@meekojs/meeko/server'
import { kitchenChanged, subscribe } from '../../shared/schemas/operations.js'

export default defineSocketChannel({
	clientToServer: { subscribe },
	serverToClient: { kitchenChanged },
})
```

```ts
// server/api/orders/[id]/ready.post.ts
import { defineApiRoute } from '@meekojs/meeko/server'
import { orderParams, orderSchema } from '../../../../shared/schemas/order.js'
import { markReady } from '../../../utils/orders.js'

export default defineApiRoute({
	params: orderParams,
	response: orderSchema,
	handler: async ({ params }) => {
		const order = await markReady(params.id)
		await socket.operations.broadcast(order.storeId, 'kitchenChanged', { orderId: order.id, status: 'ready' })
		return order
	},
})
```

- **The same checks as `hub.broadcast`.** The hub validates against the channel definition: an event missing from `serverToClient` rejects with `UNKNOWN_SOCKET_EVENT` (404), a payload that fails its schema with `INVALID_SOCKET_PAYLOAD` (400), and a serialized message larger than `socket.maxMessageBytes` with `SOCKET_LIMIT_EXCEEDED` (413), always before publishing. It resolves when the broker accepts the message; see [Broadcast and multiple instances](#broadcast-and-multiple-instances). Inside an API or RPC handler, an uncaught rejection becomes the error response, with that code and status.
- **Room.** `roomId` is the room from `?room=`; connections without a room use `""`.
- **Which hub.** `broadcast` publishes to the hub of the application handling the current HTTP request, including its asynchronous work (such as `platform.waitUntil` or a timer started in the request), or to the current Socket handler's hub. It works the same in Node, Bun, Deno and Cloudflare Workers, where the broker is each room's Durable Object.
- **Outside a request.** A task that starts at startup, outside any request, has no current application and `broadcast` throws. Create a registry with an explicit hub: `createServerSocketRegistry(socketContracts, { hub: () => app.socket?.hub })` from `@meekojs/meeko/server`, or use `app.socket.hub.broadcast(canal, sala, evento, payload)` without types.
- **Server only.** In the browser, `socket.<canal>` remains the WebSocket client and has no `broadcast`. On the server, `on`, `emit`, `state` and `close` on `socket.<canal>` throw, because there is no connection during SSR. Through `1.1`, simply reading `socket.<canal>` on the server already threw that error.

### Broadcast and multiple instances

`hub.broadcast(channel, room, event, payload)` validates the event and payload, and resolves when the broker accepts the message. It does not wait for delivery to peers or report their failures to the sender. It only rejects if the event does not exist, the payload fails its schema, the message is too large or the broker does not accept the publication.

- **`broadcast` rejects oversized messages.** The message is measured after serialization with `serializeJson`, which writes `<`, `>` and `&` as 6-byte sequences; if it exceeds the hub's `maxMessageBytes` (64 KiB by default), `broadcast` rejects with `SOCKET_LIMIT_EXCEEDED` (413) before publishing and no peer closes. Thus, a client message of about 11 KB full of `<` cannot be forwarded as is. A receiver with a lower `maxMessageBytes` than the sender still closes its peer with `1009`.
- **At-most-once delivery per peer.** There are no retries: a message published while an instance is disconnected from the broker is lost. Each peer receives messages from an instance in arrival order.
- **Bounded queue per peer.** Deliveries to a peer are processed one at a time. If a peer accumulates more than `maxPendingDeliveries` pending deliveries (256 by default, including the one in progress), it closes with `1013` ("try again later") and the `SOCKET_BACKLOG_EXCEEDED` (503) error reaches `onDeliveryError`, rather than allowing memory to grow without bounds.
- **Receiver checks.** Each receiving instance revalidates the payload against the schema and runs `authorize` and `authorizeSend` before sending to each local peer. The session is not reread on every delivery: revocation immediately closes the peer through `SessionHandle.signal`, and other changes (expiration, rotation or deletion without notification) are detected when rereading the store, at most once every `sessionRefreshMs` per peer (1000 ms by default; `0` rereads on every delivery). Every client event always rereads the session.
- **`authorizeSend` filters.** If it returns `false`, that peer does not receive the broadcast and stays connected. In a direct `emit`, the same rejection throws `FORBIDDEN`.
- **A failing peer closes.** Failures include an expired session, rejected `authorize`, size limit, full queue or send error. The peer closes with `1008` (policy failure), `1009` (size), `1013` (full queue) or `1011` (internal error) and unsubscribes. The error reaches `SocketHubOptions.onDeliveryError(error, { channel, room, event })` on the instance holding that peer. A payload that fails the receiver's schema is discarded and reported without closing the peer.
- **Default observer.** `createServerApp` forwards `onDeliveryError` to the runtime's `onError` with a new ID; `socket.onDeliveryError` in `server/runtime.ts` replaces it. Without an observer, the hub uses `console.error`.

`LocalSocketPubSub` covers a single instance, and its `publish` also waits for local delivery attempts. Since `1.7`, a production application with channels that does not declare `socket.pubsub` warns once that it uses this broker; for a single instance, declare `new LocalSocketPubSub()` to remove the warning. For multiple instances or processes, use `RedisSocketPubSub`:

```ts
// server/runtime.ts
import { createClient } from 'redis'
import { defineServerRuntime, RedisSessionStore, RedisSocketPubSub, SessionManager } from '@meekojs/meeko/server'

export default defineServerRuntime(async ({ env, production, prerendering }) => {
	const redis = createClient({ url: env.MEEKO_REDIS_URL })
	await redis.connect()
	const subscriber = redis.duplicate() // dedicated connection in subscriber mode
	await subscriber.connect()
	return {
		sessions: new SessionManager({ store: new RedisSessionStore(redis, { prefix: 'app:prod:session:', subscriber }), production: production && !prerendering }),
		socket: { pubsub: new RedisSocketPubSub({ publisher: redis, subscriber, prefix: 'app:prod:' }) },
		close: async () => {
			await subscriber.quit()
			await redis.quit()
		},
	}
})
```

- **Clients.** `publisher` and `subscriber` follow the node-redis 4 or later interface (`publish`, `subscribe(channel, listener)`, `unsubscribe(channel, listener)`); the subscriber needs its own connection. The application opens and closes both clients.
- **Redis channels.** Each channel/room pair uses the Redis channel `<prefix>socket:<canal>:<sala>`, with the channel and room encoded using `encodeURIComponent`. Each instance subscribes only once per room while it has local peers there and unsubscribes when the last one leaves. `hub.accept` resolves when Redis confirms the subscription.
- **Format.** The message travels as `{ v: 1, event, payload }`, serialized with `serializeJson`. `publish` rejects messages larger than `maxMessageBytes` (1 MiB by default) with `SOCKET_LIMIT_EXCEEDED` (413) before sending them to Redis. The receiver discards malformed messages or messages with another version and reports them to `RedisSocketPubSub`'s `onError` (by default, `console.error`).
- **Redis Cluster.** With Redis 7 or later, `sharded: true` uses `SPUBLISH`/`SSUBSCRIBE`/`SUNSUBSCRIBE`, which keep each room within its shard in a cluster. Clients must provide `sPublish`, `sSubscribe` and `sUnsubscribe`.

A custom `SocketPubSub` implementation must meet the same contract:

- `publish(channel, room, { event, payload })` resolves when the broker accepts the message.
- `subscribe(channel, room, listener)` returns, or promises, an `Unsubscribe` function that may be asynchronous.
- Hub listeners never reject, so the broker must not aggregate their errors.

## Server runtime

`server/runtime.ts` exports `defineServerRuntime(factory)` by default. Meeko calls the factory once per process with `{ env, production, platform, prerendering, root }` and waits for the application's resources:

```ts
import { defineServerRuntime, SessionManager } from '@meekojs/meeko/server'
import { createDatabase } from './utils/database.js'

export default defineServerRuntime(async ({ env, production, prerendering }) => {
	const db = await createDatabase(env.DATABASE_URL)
	return {
		sessions: new SessionManager({ store: db.sessionStore(), production: production && !prerendering }),
		services: (request, { platform }) => ({ db, region: platform.env.REGION }),
		socket: { allowedOrigins: [], maxMessageBytes: 64 * 1024 },
		publicOrigin: env.MEEKO_PUBLIC_ORIGIN,
		onError: (error, requestId) => console.error('request failed', requestId, error),
		close: () => db.close(),
	}
})
```

- `sessions` is optional since `1.2`. Without `server/runtime.ts`, or if it does not return `sessions`, Meeko creates them: in memory during development and in Redis with `MEEKO_REDIS_URL` in production (see [Sessions without configuration](#sessions-without-configuration)). Explicit `sessions` always take precedence.
- `services` can be a shared object or a per-request function; it reaches pages, API, RPC and Socket as `RequestContext.services`. Since `1.7` its type is inferred from this file, without casts (see [Service types](#service-types)).
- `RequestContext.platform` exposes `{ name, env, waitUntil(promise) }`. In Node, `serveNode` waits for tasks registered with `waitUntil` before closing the application. Tasks registered outside an HTTP request, such as in Socket callbacks, are the application's responsibility: `app.close()` waits for them and their failures reach the runtime's `onError` observer instead of the console.
- `publicOrigin` is the application's public origin, for example `https://example.com` behind a proxy terminating TLS. HTTP and Socket compare `Origin` against this value; `MEEKO_PUBLIC_ORIGIN` overrides it in `meeko dev` and Node, Bun, Deno and Workers outputs. Without `publicOrigin`, Socket uses the server's listening address. If that address or `publicOrigin` is loopback, Socket also accepts other loopback names (`localhost`, `127.0.0.1`, `[::1]`) with the same scheme and port. This assumes no other process listens on that port at another loopback address; if one does, configure `publicOrigin` with a non-loopback origin or change the port.
- `onError` receives internal failures with their request ID; without it, Meeko logs the error name and ID, and during development also the complete error. It also receives Socket delivery failures, unless `socket.onDeliveryError` observes them separately, and, since `1.3`, the process's unhandled promise rejections and uncaught exceptions, with a third argument (see [Errors](#errors)).
- `processErrors` (since `1.3`) decides what happens to these process failures; without declaring it, a rejection is reported and the server keeps serving, and an exception is reported and the server shuts down gracefully with code 1 (see [Failures outside a request](#failures-outside-a-request)).
- `socket.pubsub` selects the broadcast broker; `socket.maxPendingDeliveries` and `socket.sessionRefreshMs` limit each peer's queue and how often its deliveries reread the session. See [Broadcast and multiple instances](#broadcast-and-multiple-instances).
- `close` runs after sessions close, when stopping the server.
- `root` (since `1.8`) is the absolute project root path, for reading its files from the server (content, templates, a Git repository). Do not use `import.meta.url` for this, because the build moves server code to `.meeko/output/…`, or `process.cwd()`, which is only the root when the CLI launches the process. In `meeko dev` it is the project root; in Node, Bun and Deno outputs (including `meeko start`, `node .meeko/output/node/index.mjs` from any folder and during prerendering) it is the folder three levels above the output. If you deploy the output outside the project, `MEEKO_ROOT` (absolute or relative to the working directory) specifies its location; without it, the path would point to the folder three levels above the new location. In Cloudflare Workers, without a filesystem, and in a custom `createServerApp` that does not pass the `root` option, it is `undefined`. Pass it to services: `defineServerRuntime(({ root }) => ({ services: { docs: join(root!, "docs") } }))`.

`createServerApp({ manifest, load, runtime, production })` from `@meekojs/meeko/server` creates the same application from a manifest and module loader, exposing `fetch(request, platform?)`, `socket`, `publicOrigin`, `reportError` and `close()`. The entry point generated by `meeko build` uses it; a custom host can serve it with `serveNode(app, { host, port, publicOrigin, handleSignals, shutdownTimeout })` from `@meekojs/meeko/node`. If the server starts but the Socket connection fails, `serveNode` releases the port and closes the application before propagating the error.

### Service types

Since `1.7`, `context.services` has the type returned by `server/runtime.ts`, without `as unknown as MisServicios`. `meeko check`, `meeko dev` and the editor generate `.meeko/types/services.d.ts`, which augments the `GeneratedServices` interface from `@meekojs/meeko/server` with the type of `services` from the default export: the shared object or, if `services` is a per-request function, its return value (without the promise). The resulting type is called `AppServices`:

```ts
// server/runtime.ts
export default defineServerRuntime(async ({ env }) => {
	const db = await createDatabase(env.DATABASE_URL)
	return { services: { db, search: createSearch(db) }, close: () => db.close() }
})

// server/utils/docs.ts
import type { RequestContext } from '@meekojs/meeko/server'
export const findDoc = (context: RequestContext, slug: string) => context.services.db.docs.find(slug) // typed
```

- **Where.** In `usePage().context` in `<script server>`, in the handlers, `authorize`, `locals` and `rateLimit.key` of `defineApiRoute` and `defineRpc`, in `defineSocketChannel`, in `defineServerRouteMiddleware` (`services` and `context.services`) and in any `RequestContext` written without a type argument. `defineServerMiddleware` receives no context: it runs before one exists. The optional `context` in `definePage`'s `load` remains the type `C` from its type arguments.
- **Resolution.** `RequestContext<TServices>` uses `AppServices` when `TServices` is `unknown`, the default; an explicit type (`RequestContext<MisServicios>`, `defineServerRouteMiddleware<MisServicios>`) or `any` still takes precedence. Without `server/runtime.ts`, with a JavaScript one or without `services`, `AppServices` is `unknown`, as through `1.6`. An `as unknown as MisServicios` cast still compiles; a direct cast to a type incompatible with the inferred one becomes an error, because it is one.
- **Tests and contexts with other services.** `RequestContext` compares by its services type, so a context with any other services (a test's context, `createRequestContext(request, { db: falso }, session)`) is still accepted where a `RequestContext` without a type argument is expected, such as a route handler without an explicit type, as in `1.6`. In exchange, to receive a route context in a function, write `RequestContext` without a type argument (its `services` are already `AppServices`): `RequestContext<AppServices>` does not accept the `RequestContext` of an untyped route.
- **Auto-imports.** The declaration reads a copy of `server/runtime.ts` in `.meeko/types/server-runtime.ts` with its server auto-imports written as imports, so `defineServerRuntime` without importing it also works in the editor. The copy has `// @ts-nocheck`: errors are reported only once, in `server/runtime.ts`. It regenerates on every `meeko check`, when starting `meeko dev` and during editor checks.
- **Custom host.** Without generated declarations, augment `GeneratedServices` manually in a `.d.ts` under `server/`, like `MeekoSession`: `interface GeneratedServices { readonly services: MisServicios }`. `ServerRuntimeServices<typeof runtime>` calculates that type from a runtime definition.
- **Limitations.** This is a type; it does not validate at runtime. If a service mentions `RequestContext` in its own type, TypeScript may encounter a circular reference; write `RequestContext<MisServicios>` at that point.

## Errors

No failure is lost without passing through a Meeko observer: each level has its own, and anything a level does not handle moves to the next or, without an observer, to the console, as without Meeko.

| Level                 | What it catches                                                                                                                                                                   | Observer                                                                                                                                                                                                                                            | Policy                                                                                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Component             | `on:` handlers, `effect`, cleanup, `onMounted`, the continuation of a setup with `await`, forms, mutations and `useStorage` for that component and its children.                  | `provideErrorHandler((error, source) => …)` in `<script>`; the nearest wins ([Route and server middleware](#route-and-server-middleware), [api.md](api.md#meeko-components)).                                                                       | Observes without changing the interface. Without a provider, moves to the application.                                                                                                                                                              |
| Application (browser) | The above without a nearer provider, navigation, Socket clients and, since `1.3`, the page's uncaught exceptions (`"uncaught"`) and unhandled promise rejections (`"rejection"`). | `mountClientApp({ onError })` and plugins' `app.onError` ([Application plugins](#application-plugins)); `onNavigationError` takes precedence for navigation.                                                                                        | Without either, navigation, Socket and global failures go to the first active `provideErrorHandler`; without one, to the console.                                                                                                                   |
| Page (SSR)            | A failure in the loader, `<script server>`, rendering (also `render: "stream"` before the first byte) or a data `await`.                                                          | Nearest `+error.meeko` or `app/error.meeko` ([Application error page](#application-error-page-apperrormeeko)), and runtime and plugin `onError` with the response's `requestId`.                                                                    | HTML displays the status and a public message; a `5xx` is reported with its private error. A rejected deferred stream value is sent as `{ code, status }` and its cause reaches the same observers ([Streaming SSR](#streaming-ssr-render-stream)). |
| API and RPC           | Errors thrown by handlers, `auth`, `authorize`, `locals` and validation.                                                                                                          | Normalized response: `ApiError` preserves `code` and `status`, everything else is `INTERNAL_ERROR`, with `requestId` and `x-request-id` ([API and RPC](#api-and-rpc)). On the client, `ClientError` (`isClientError(error, "CODIGO")` since `1.3`). | Only `5xx` reach runtime `onError`; `4xx` are expected responses.                                                                                                                                                                                   |
| Server runtime        | `5xx` from pages, API, RPC, Socket, `waitUntil` and transport, and process failures since `1.3`.                                                                                  | `onError` in `server/runtime.ts` ([Server runtime](#server-runtime)).                                                                                                                                                                               | Never changes the response; a failing observer is logged without private details.                                                                                                                                                                   |
| Process (since `1.3`) | Unhandled promise rejections and uncaught exceptions outside the request flow.                                                                                                    | Runtime `onError`, with `{ kind, inRequest }` as its third argument.                                                                                                                                                                                | `processErrors`; see [Failures outside a request](#failures-outside-a-request).                                                                                                                                                                     |

`ErrorSource`, the second argument of browser observers, gains `"uncaught"` and `"rejection"` in `1.3`. It is a union Meeko delivers to the application, so under the [stability policy](stability.md#public-api), an exhaustive `switch` over it needs a default branch.

```ts
import { isClientError, mountClientApp } from '@meekojs/meeko/framework'

await mountClientApp({
	...options,
	onError(error, source) {
		if (isClientError(error, 'UNAUTHENTICATED')) return location.assign('/login')
		navigator.sendBeacon('/api/client-errors', JSON.stringify({ source, message: String(error) }))
	},
})
```

### Global browser failures

While an application is mounted, `mountClientApp` listens to `error` and `unhandledrejection` on `window`: a throwing `setTimeout`, a `fetch().then()` without `catch` in setup or a library failure reach `onError` and `app.onError` with source `"uncaught"` or `"rejection"`. The first argument is the thrown error or rejection reason, unchanged.

- **No duplicates.** An error already received by a Meeko observer (an event, navigation…) that the application rethrows or leaves rejected is not reported again.
- **Console.** When an observer receives it, Meeko calls `preventDefault()` and the browser does not repeat it in the console. Without any observer, the event is untouched and the browser displays it as usual. An event another listener already marked with `preventDefault()` is considered handled.
- **Cross-origin scripts.** The opaque `"Script error."` from a cross-origin script loaded without CORS has no error, file or line: it is left to the console. To observe it, load the script with `crossorigin` and serve `Access-Control-Allow-Origin`.
- **Lifecycle.** Listeners register on hydration and are removed with `app.dispose()` or if hydration fails. An HMR component change does not remount the application; an entry point change reloads the page. With two applications on the same page, only the first one observing each failure receives it.

### Failures outside a request

On the server, a promise nobody awaits inside a handler, a throwing `setTimeout` or a library callback fall outside the request's `try`. Without a policy, Node 15+, Bun and Deno terminate the process on the first unhandled rejection or uncaught exception, without passing through `onError` or shutting the server down gracefully. Since `1.3`, `meeko dev`, `meeko build` outputs (Node, Bun, Deno and Cloudflare Workers), and `serveNode` and `serveDeno` with `handleSignals` apply the `processErrors` policy from `server/runtime.ts`:

| Failure              | Default                                                                                                                                                                                                                 | Other options                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `unhandledRejection` | `"report"`: reaches `onError` and the server keeps serving.                                                                                                                                                             | `"shutdown"`: also shuts down gracefully with code 1. `"off"`: the runtime decides (in Node, the rejection becomes an uncaught exception). |
| `uncaughtException`  | `"shutdown"`: reaches `onError`, the server stops accepting connections, waits for open responses and `waitUntil` tasks, closes the application and exits with code 1, because the process state is no longer reliable. | `"off"`: the runtime decides.                                                                                                              |

```ts
// server/runtime.ts
export default defineServerRuntime(() => ({
	processErrors: { unhandledRejection: 'shutdown' },
	onError(error, requestId, info) {
		if (info) logger.fatal({ kind: info.kind, inRequest: info.inRequest, requestId }, error)
		else logger.error({ requestId }, error)
	},
}))
```

- **Observer.** Runtime `onError` receives the error, an ID and `{ kind, inRequest }` (type `ServerErrorInfo`); request failures do not include that third argument. Without `onError`, Meeko writes the complete error to the console, as the runtime would. `processErrors: false` disables both cases.
- **`requestId`.** If the failure occurs in a request's asynchronous work and the runtime retains that context until the event, the ID is the response's (`x-request-id`) and `inRequest` is `true`; otherwise, the ID is new. Node retains context for rejections and exceptions; Deno and workerd for rejections; Bun 1.4 only for exceptions.
- **Application listeners.** If the application registered its own `process.on("uncaughtException" | "unhandledRejection")` (or, in Deno, previously marked the event with `preventDefault()`), Meeko reports to `onError` and lets it decide: it does not terminate the process.
- **By runtime.** Node and Bun use `process` events; Deno uses `globalThis`'s `unhandledrejection` and `error`. In Cloudflare Workers there is no process to terminate: the isolate's unhandled rejections reach `onError` and an exception only fails the request or `waitUntil` task that threw it, which Meeko already reports. In `meeko dev`, an application rejection does not stop the development server; the policy is that of the runtime it started with.
- **Custom hosts.** `handleProcessErrors(app, { close, onError?, shutdownTimeout? })` from `@meekojs/meeko/server` applies the same policy to a host that uses neither `serveNode` nor `serveDeno`, such as `Bun.serve` with `createBunServer`; it returns the function that removes listeners. `close` must stop the server and close the application; `shutdownTimeout` (15 s by default) limits its duration before exiting anyway. Since `1.7` it installs only once per application: a second call (for example, your own alongside `serveNode` with `handleSignals`) adds no listeners and, if its options differ, ignores them with a console warning.

## Authentication

Since `1.2`, Meeko handles the delicate parts of login: an opaque `HttpOnly`, `Secure`, host-only cookie, Redis sessions across instances with revocation, Origin and CSRF, scrypt passwords, attempt limiting and session types. The application only decides who can log in. A private panel for one account looks like this:

**1. Variables** (`.env` in development, ignored by git; environment variables in production):

```sh
MEEKO_PUBLIC_ORIGIN=https://example.com       # the exact origin behind the HTTPS proxy
MEEKO_REDIS_URL=rediss://default:…@redis.example.com:6380
MEEKO_TRUST_PROXY=1                           # a proxy (Traefik, Caddy, nginx) in front
ADMIN_USERNAME=ada
ADMIN_PASSWORD_HASH=scrypt$131072$8$1$…       # npx meeko auth hash
```

The last two belong to the application, without the reserved `MEEKO_` prefix. Install the Redis client with `npm install redis`; in development sessions live in memory and Redis is unnecessary. There is no `server/runtime.ts`: see [Sessions without configuration](#sessions-without-configuration).

**2. The session type**, defined once for pages, API, RPC and Socket:

```ts
// server/types/session.d.ts
import type {} from '@meekojs/meeko/server'
declare module '@meekojs/meeko/server' {
	interface MeekoSession {
		user: string
		role: 'owner'
	}
}
```

**3. Login and logout:**

```ts
// server/api/auth/login.post.ts
import { verifyPassword } from '@meekojs/meeko/password'
import { loginInput, okResult } from '../../../shared/schemas/auth.js'

export default defineApiRoute({
	body: loginInput,
	response: okResult,
	origin: 'required',
	rateLimit: { limit: 5, window: '5m' },
	handler: async ({ body, context }) => {
		const valid = await verifyPassword(body.password, process.env.ADMIN_PASSWORD_HASH ?? '')
		if (!valid || body.username !== process.env.ADMIN_USERNAME) throw new ApiError('INVALID_CREDENTIALS', 401)
		await context.session.create({ user: body.username, role: 'owner' })
		return { ok: true as const }
	},
})
```

```ts
// server/api/auth/logout.post.ts
export default defineApiRoute({
	auth: 'required',
	status: 204,
	handler: async ({ context }) => {
		await context.session.revoke()
	},
})
```

`verifyPassword` always runs, even for an incorrect username, so the response time does not reveal which of the two failed. `defineApiRoute` and `ApiError` are auto-imported in `server/`. From the browser, `await api.auth.login.post({ body })` and `await api.auth.logout.post()`: the client sends Origin and the CSRF token.

**4. A protected page:**

```html
<!-- app/pages/dashboard.meeko -->
<script
	server
	lang="ts"
>
	const { context } = usePage()
	const session = context.session.current
	if (session?.data.role !== 'owner') redirect('/login')
	export const user = session.data.user
</script>

<template>
	<h1>Hello, {user}</h1>
</template>
```

What Meeko does for you in this example:

- The `__Host-meeko.sid` cookie is opaque, `HttpOnly`, `Secure`, `SameSite=Lax` and host-only; `MEEKO_SESSION_TTL` and `MEEKO_SESSION_SAMESITE` configure it. The ID changes on login and the entire family is revoked on logout, including on other instances.
- The `Origin` check on every mutation (since `1.8`; `origin: "required"` makes it explicit) and `session.create()` itself prevent _login CSRF_ (see [Origin in anonymous mutations](#origin-in-anonymous-mutations)); `auth: "required"` and the CSRF token protect logout.
- `rateLimit` counts attempts per IP in Redis (or, without Redis, in SQL; see [SQL rate limiting](#sql-rate-limiting)), and `MEEKO_TRUST_PROXY` ensures the IP is the client's rather than the proxy's.
- `verifyPassword` compares in constant time and accepts existing hashes with the same format.

### Session types: `MeekoSession`

Without a declaration, `context.session.current.data` is `unknown`, as through `1.1`, and `session.create(data)` accepts any serializable value. Since `1.2`, a module augmentation of the `MeekoSession` interface from `@meekojs/meeko/server` sets the shape throughout the application: `RequestContext.session` becomes `SessionHandle<MeekoSession>`, so `context.session.current?.data` and `create(data)` are typed in pages' `<script server>` (`usePage().context`), in API, RPC and Socket, and in `authorize` and `locals`. The resulting type is called `SessionData`. Declare it in a `.d.ts` file under `server/` (for example, `server/types/session.d.ts`), which `meeko check` and the editor include in all projects, and start with `import type {} from "@meekojs/meeko/server";`: this makes the file a module and ensures TypeScript always loads the module it augments, even if the code reading the session only imports `@meekojs/meeko/framework` (with `export {}`, the augmentation would be lost in those files). The type does not validate at runtime: if you change the shape, previously stored sessions keep the old one until they expire or are recreated.

### Passwords

`@meekojs/meeko/password` (since `1.2`) stores and checks passwords with scrypt:

- `hashPassword(password)` returns `scrypt$<N>$<r>$<p>$<sal>$<hash>`, with N = 2^17, r = 8, p = 1 (128 MiB per calculation), a random 16-byte salt and a 32-byte key, both in base64url. The format describes its own parameters, so a stored hash remains valid even if the defaults change.
- `verifyPassword(password, hash)` recalculates with the hash's parameters and compares in constant time (`timingSafeEqual`). It accepts manually written hashes with the same format, such as `scrypt$131072$8$1$…` with a 32-byte salt and a 64-byte key, without regenerating them. A malformed hash or parameters outside the limits (N a power of two between 2^10 and 2^20, `r` up to 32, `p` up to 16) throws `TypeError`: this is a configuration failure, rather than an incorrect password. An empty password or one larger than 4096 bytes returns `false` without any calculation.
- `needsRehash(hash)` indicates whether the hash uses weaker parameters than the current ones; after a successful login, store `await hashPassword(password)` in its place.

At most two hashes are calculated concurrently per process, to bound memory (256 MiB) and avoid occupying all `libuv` threads; combine login with [`rateLimit`](#rate-limiting-ratelimit). When the user does not exist, still compare against a fixed hash so response time does not reveal which accounts exist.

**Why a separate subpath.** Web Crypto, the only cryptography in `@meekojs/meeko/server`, does not offer memory-hard derivation functions (scrypt, Argon2), and a JavaScript implementation would be dozens of times slower, requiring a lower cost. `node:crypto` implements them natively and exists in Node, Bun and Deno, so `/password` imports it while `/server` remains portable (Web APIs and `node:async_hooks`). It is unsuitable for Cloudflare Workers: although `nodejs_compat` offers scrypt, the 128 MiB of a calculation with these parameters exhaust an isolate's memory; in Workers, delegate verification to an external service.

To obtain a hash without writing code:

```sh
npx meeko auth hash                       # prompts for the password twice, without displaying it
printf '%s' "$PASSWORD" | npx meeko auth hash   # or reads it from stdin
```

The command writes only the hash line to stdout, ready for `.env` (`ADMIN_PASSWORD_HASH=…`); warnings go to stderr.

### Rate limiting: `rateLimit`

Since `1.2`, `defineApiRoute` and `defineRpc` accept `rateLimit: { limit, window, key? }`: at most `limit` requests per fixed `window` (milliseconds or text such as `"30s"`, `"5m"`, `"1h"`). A request exceeding it receives `429 RATE_LIMITED` with `Retry-After` (seconds until the next window), without validating input or running the handler. It is checked after Origin and CSRF and before `auth`, `authorize`, input and `locals`, so it also limits anonymous clients.

```ts
export default defineApiRoute({
	body: loginInput,
	response: okResult,
	origin: 'required',
	rateLimit: { limit: 5, window: '5m' },
	handler: async ({ body, context }) => {
		/* … */
	},
})
```

- **Key.** Without `key`, each client IP has its own counter per route (IPv6 addresses by their /64 network, because a client has an entire /64). The IP is `context.clientAddress`: the connection IP provided by the adapter (Node, Bun, Deno; in Workers, `CF-Connecting-IP`, set by Cloudflare). If Meeko does not know it, all clients share the route's counter. `key: (context) => string` counts by another subject, such as the session user; it runs before input validation, so it receives no body. A dynamic route (`/api/users/[id]`) has a single counter for all its values.
- **Proxies.** `X-Forwarded-For` is never read without `MEEKO_TRUST_PROXY`, because any client can send it. With a number `n`, the IP is the entry added by the outermost trusted proxy, the `n`th from the right: with a single proxy (Traefik in Coolify, Caddy, nginx), use `MEEKO_TRUST_PROXY=1`, and entries forged by the client on the left are ignored. `true` takes the leftmost entry: this is only safe if the entry proxy replaces the header instead of appending itself. An entry with a port, such as one written by Azure Application Gateway (`203.0.113.7:5678` or `[2001:db8::1]:5678`), counts by its IP; if the selected entry is not an IP, the request counts with the connection's IP (the proxy's), never with the shared counter for unknown clients. Without the variable, behind a proxy all clients share the proxy's counter. An invalid value stops startup.
- **Middleware and local calls.** Server middleware passing a new request to `next()` (`next(new Request(request, { headers }))`) retains the connection IP. `createLocalCalls` uses the same route counter as the HTTP dispatcher and the IP of the `context` it receives, so a local call does not bypass the route limit. A custom host creating its `Request` objects without a Meeko adapter (`serveNode`, `toNodeListener`, `createBunServer`, `serveDeno` or `createWorker`) has no connection IP: its clients share the route counter unless it declares `key`.
- **Storage.** Counters live in the session store: in memory with `MemorySessionStore` and, with `RedisSessionStore` (including [Sessions without configuration](#sessions-without-configuration)), in `<prefix>ratelimit:<resumen>`, with a Lua script that performs `INCR` and `PEXPIRE` atomically across all instances. The key stores a SHA-256 digest of the route and subject, never the plaintext IP or key. If Redis fails, the request is rejected with `500` (_fail closed_) and the error reaches `onError`.
- **Custom store.** A `SessionStore` can implement `rateLimit(key, windowMs)`, which counts one request in fixed window `key` and resolves `{ count, resetInMs }` (type `RateLimitHit`); it must be atomic across instances and reject on failure. Since `1.7`, `SqlSessionStore` implements it when its driver provides `rateLimit` (see [SQL rate limiting](#sql-rate-limiting)); without it, counters live in each instance's or isolate's memory, and Meeko warns once in production.
- A `limit` that is not a positive integer, an invalid `window` or an empty `key` responds with `500 INVALID_RATE_LIMIT`.

### SQL rate limiting

Since `1.7`, an application without Redis shares `rateLimit` counters across instances through its database: `SqlSessionDriver.rateLimit(key, windowMs, now)` is optional and, if the driver implements it, `SqlSessionStore` delegates to it. Without it everything works as through `1.6`: counters in each instance's memory and a production warning.

The semantics match Redis and memory: a **fixed window** per key. The first request opens the window (`count = 1`, `window_ends_at = now + windowMs`); subsequent requests add one and retain its end; the first request after the end resets it. A route changing `window` does not shorten or extend an already open window. The driver returns the resulting row, `{ count, windowEndsAt }` (type `SqlRateLimitRow`; `Number()` accepts a `bigint` returned as text); Meeko calculates `resetInMs = windowEndsAt - now` and, above the limit, responds with `429` and `Retry-After` in seconds rounded up (at least 1). `now` is the instance's clock, as in `replace`. If the statement fails, the request is rejected with `500` (_fail closed_).

`key` arrives as the 32 bytes of the SHA-256 of the counter key, which Meeko already calculates as a SHA-256 digest of the route and subject: the table never stores a plaintext IP or key (including those from manually calling `SessionManager.rateLimit`) and the column has fixed width. The statement must be atomic against concurrent requests from all instances; in PostgreSQL, a single `INSERT … ON CONFLICT DO UPDATE … RETURNING` suffices:

```sql
-- Once, in a migration. UNLOGGED: no WAL, faster; after a server crash
-- the table is emptied and counters restart, which is acceptable for a limit.
CREATE UNLOGGED TABLE IF NOT EXISTS meeko_rate_limits (
  key bytea PRIMARY KEY,
  window_ends_at bigint NOT NULL,
  count integer NOT NULL
);
CREATE INDEX IF NOT EXISTS meeko_rate_limits_window_ends_at ON meeko_rate_limits (window_ends_at);

-- Each rate-limited request: $1 = key, $2 = now, $3 = windowMs.
INSERT INTO meeko_rate_limits AS r (key, window_ends_at, count) VALUES ($1, $2::bigint + $3::bigint, 1)
ON CONFLICT (key) DO UPDATE SET
  count = CASE WHEN r.window_ends_at <= $2 THEN 1 ELSE r.count + 1 END,
  window_ends_at = CASE WHEN r.window_ends_at <= $2 THEN EXCLUDED.window_ends_at ELSE r.window_ends_at END
RETURNING count, window_ends_at;

-- Periodic cleanup (cron, pg_cron or an application task): $1 = now.
DELETE FROM meeko_rate_limits WHERE window_ends_at <= $1;
```

Both `UPDATE` assignments read the previous row, so resetting `count` and `window_ends_at` happens together. A driver with `node-postgres`:

```ts
// server/runtime.ts (excerpt)
import pg from 'pg'
import type { SqlSessionDriver } from '@meekojs/meeko/server'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const rateLimitSql = `INSERT INTO meeko_rate_limits AS r …` // the statement above

const driver: SqlSessionDriver = {
	// read, write, remove, replace and revokeFamily, as usual.
	...sessionStatements(pool),
	async rateLimit(key, windowMs, now) {
		const { rows } = await pool.query<{ count: number; window_ends_at: string }>(rateLimitSql, [Buffer.from(key), now, windowMs])
		return { count: rows[0]!.count, windowEndsAt: Number(rows[0]!.window_ends_at) }
	},
}
```

In Cloudflare D1, `D1SessionDriver` implements it with the `rateLimitTable` option (see [Sessions in D1](#sessions-in-d1)).

### Client IP behind a proxy

The client IP has two access paths, with the same policy as `rateLimit`:

- **`context.clientAddress`**, wherever there is a `RequestContext`: API, RPC, pages' `<script server>`, server route middleware (`context.clientAddress`) and Socket channels.
- **`clientAddress(request, env?)`** from `@meekojs/meeko/server` (since `1.7`), wherever there is only a `Request`: `defineServerMiddleware` and `addServerHandler` handlers.

```ts
// server/middleware/10-access-log.ts
import { clientAddress, defineServerMiddleware } from '@meekojs/meeko/server'

export default defineServerMiddleware(async (request, next) => {
	// Behind Traefik with MEEKO_TRUST_PROXY=1, the visitor's address rather than the proxy's.
	const ip = clientAddress(request) ?? 'unknown'
	const response = await next()
	console.log(`${request.method} ${new URL(request.url).pathname} ${response.status} ${ip}`)
	return response
})
```

The policy is always the same:

- **Without `MEEKO_TRUST_PROXY`**, the IP is the connection IP provided by the adapter: the remote socket in Node (`serveNode`, `toNodeListener`), `server.requestIP()` in Bun, `remoteAddr` in Deno and `CF-Connecting-IP` in Workers, a header set by Cloudflare's edge that replaces the one sent by the client. `X-Forwarded-For` is never read: behind a proxy, all clients have the proxy's IP.
- **With `MEEKO_TRUST_PROXY=n`**, the IP is the `n`th `X-Forwarded-For` entry from the right, added by the outermost trusted proxy, without its port. Anything the client wrote to its left is ignored. With Traefik (Coolify), Caddy or nginx as the only proxy, `MEEKO_TRUST_PROXY=1`; with a CDN in front of Traefik that adds its entry, `2`. `true` takes the leftmost entry and is only safe if the entry proxy replaces the header. If the selected entry is not an IP, the connection IP is used.
- **With `MEEKO_TRUST_PROXY=cloudflare`** (since `1.8`), the IP is from `CF-Connecting-IP` (or, if absent, `True-Client-IP`), but only if the connection and every `X-Forwarded-For` hop come from the networks in `MEEKO_TRUSTED_PROXIES`; see [Cloudflare Tunnel and Traefik](#cloudflare-tunnel-and-traefik). In Workers nothing changes: the connection IP is already `CF-Connecting-IP`.
- The IP is normalized: IPv6 in lowercase without a zone, and IPv4 mapped into IPv6 (`::ffff:192.0.2.1`) as IPv4. It is `undefined` if unknown, as in a custom host creating its `Request` objects without a Meeko adapter.

Without `env`, `clientAddress` applies `MEEKO_TRUST_PROXY` from the environment of the application handling the request (the `platform.env` received by `ServerApp.fetch`), including on a new request passed to `next()` by middleware. With a request not handled by a `ServerApp`, it only uses the connection IP unless given the environment: `clientAddress(request, process.env)`. An invalid `MEEKO_TRUST_PROXY` throws `TypeError` (and stops application startup); with `cloudflare`, so does an invalid `MEEKO_TRUSTED_PROXIES`.

#### Cloudflare Tunnel and Traefik

With Cloudflare Tunnel, the request arrives as follows: Cloudflare → `cloudflared` → a proxy such as Traefik (Coolify) → the server. Traefik without `trustedIPs` replaces `X-Forwarded-For` with its peer's IP, `cloudflared`, so with `MEEKO_TRUST_PROXY=1` all visitors would share `cloudflared`'s IP and per-client `rateLimit` would be global. Cloudflare does send the visitor IP in `CF-Connecting-IP`, replacing it if the client sends it:

```dotenv
MEEKO_TRUST_PROXY=cloudflare
# Optional. Defaults to loopback and private networks:
# MEEKO_TRUSTED_PROXIES=127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, ::1/128, fc00::/7
```

The header is only valid when the request passed exclusively through your own infrastructure:

- **The connection** must come from a network in `MEEKO_TRUSTED_PROXIES`, where `cloudflared` and Traefik live: a comma- or space-separated list of CIDRs or IPs replacing the defaults (RFC 1918 networks, loopback and ULA `fc00::/7`). If it comes from outside, or the adapter does not know it, the header is ignored and the connection IP is used.
- **Every `X-Forwarded-For` hop**, from right to left, must also come from those networks. The first one that does not is the client seen by a trusted proxy: if someone directly reaches Traefik's public entry point with a forged `CF-Connecting-IP`, Traefik writes their IP into `X-Forwarded-For` and Meeko uses it. A hop that is not an IP returns the connection IP.
- **The value** must be a single IPv4 or IPv6 address, without a port or brackets. A list or arbitrary text returns the connection IP; `True-Client-IP` is only read if `CF-Connecting-IP` is absent.

If the server shares a private network with untrusted clients, restrict `MEEKO_TRUSTED_PROXIES` to the IPs or subnets of `cloudflared` and the proxy, such as Coolify's Docker network (`MEEKO_TRUSTED_PROXIES=10.0.1.0/24, 172.17.0.1`). Include the address from which `cloudflared` reaches the proxy, which the proxy writes in `X-Forwarded-For`: if excluded, Meeko treats it as the client and all visitors share an IP again. The default networks exclude CGNAT (`100.64.0.0/10`, used by Tailscale) and link-local: add them if `cloudflared` arrives through them. `MEEKO_TRUSTED_PROXIES` is only read in `cloudflare` mode.

## Sessions and security

Sessions use random opaque IDs in `HttpOnly`, host-only cookies, with `Secure` and `SameSite=Lax` by default. Each new session also receives an opaque `familyId` that stays unchanged when its ID rotates. `SessionHandle` supports creation, rotation and revocation; rotation and revocation of the entire family require atomic store operations. Thus, logout started with an earlier handle invalidates the active ID even if another request already rotated it. Cookie-authenticated mutations verify Origin and `x-meeko-csrf`; since `1.8`, anonymous mutations verify Origin (see [Origin in anonymous mutations](#origin-in-anonymous-mutations)). SSR and API responses deliver the CSRF token through a same-origin meta tag or header. The application must define identity verification and authorization rules; Meeko does not store authentication secrets in the browser.

`MemorySessionStore` is for development only. `SessionManager({ production: true, store })` requires `persistent: true`, atomic `replace` and `revokeFamily`; an application without `MEEKO_REDIS_URL` or its own `sessions` does not start in production. `RedisSessionStore` accepts a client compatible with `get`, `set` with `PX`, `del` and `eval`; it uses a family index with the active session's TTL. Use a dedicated prefix per application and environment. Earlier Redis records without `familyId` remain readable and acquire a family on their first rotation. `SqlSessionStore` accepts a `SqlSessionDriver` with `read`, `write`, `remove`, transactional `replace`, `revokeFamily`, optional `close` and, since `1.7`, optional `rateLimit` (see [SQL rate limiting](#sql-rate-limiting)). The executable example in `tests/fixtures/fullstack-consumer/server/runtime.ts` uses real SQLite; the framework does not depend on a SQL library or a particular database engine. `SessionManager.close()` disposes of the store when the host owns the resource.

Every custom persistent `SessionStore` must store `familyId` and guarantee atomic `replace` and `revokeFamily` against concurrent requests. Before upgrading, migrate existing records and the indexes needed to locate the active session by family. Do not deploy the new runtime over an old store: in production, construction deliberately fails when safe family rotation and revocation cannot be guaranteed. Since `1.2`, a store can also implement `rateLimit(key, windowMs)` for [`rateLimit`](#rate-limiting-ratelimit) counters.

**Migrating existing SQL drivers:** add a family column to the table (for example, `family_id`), populate existing rows with `family_id = id` and create a unique index on it. `read` and `write` must transfer `SqlSessionRow.familyId`; `replace` must check the same family and replace the row in a transaction; `revokeFamily(familyId)` must delete the active row by family. Migrate the schema before starting the new version. An old driver without `revokeFamily` fails when constructing `SqlSessionStore`; it is not silently accepted in production.

Without `server/runtime.ts`, Meeko does all this for you with `MEEKO_REDIS_URL` (see the next section). For a custom client, install `redis` in the application, create the client with `createClient({ url: process.env.MEEKO_REDIS_URL })`, call `connect()` before serving traffic and pass it to `RedisSessionStore` with a dedicated prefix. The host must close its client with `quit()` on shutdown; `SessionManager.close()` closes the store but does not take ownership of external clients. The `tests/redis.integration.ts` integration test uses a random namespace and deletes only its own keys. It runs against real Redis with `MEEKO_REDIS_URL=redis://127.0.0.1:6379 pnpm exec tsx --test tests/redis.integration.ts`; CI has a dedicated Redis service. Local testing requires accessible Redis and does not use other applications' databases.

### Sessions without configuration

Since `1.2`, an application does not need `server/runtime.ts` for secure sessions. If the file does not exist, or its factory does not return `sessions`, `createServerApp` creates them:

- **Development** (`meeko dev`) and `meeko build` prerendering: `MemorySessionStore`.
- **Production** on Node, Bun and Deno: with `MEEKO_REDIS_URL` (`redis://` or `rediss://`), Meeko imports the project's `redis` package, connects a client and dedicated subscriber (`client.duplicate()`) **before serving traffic**, creates a `RedisSessionStore` with cross-instance revocation and closes both connections on shutdown, after the application's `close`. Install the package with `npm install redis`: the build includes it only if installed, and without it startup fails with a message requesting it. If the first connection fails, startup fails; if it disconnects later, the client reconnects and, meanwhile, requests reading the session fail immediately instead of waiting (_fail closed_). Messages never include the URL, which contains the password.
- **Production without `MEEKO_REDIS_URL`**: the application does not start, as before. Workers has no TCP, so `MEEKO_REDIS_URL` also stops startup: declare a `SessionManager` with D1 or Upstash (see [Cloudflare Workers](#cloudflare-workers)).

Keys use the prefix from `MEEKO_REDIS_PREFIX` or, by default, `meeko:<name de package.json>:prod:`. `MEEKO_SESSION_TTL` (`30m`, `12h`, `7d`…; 7 days by default) and `MEEKO_SESSION_SAMESITE` (`Lax` by default, or `Strict`) configure these sessions, including during development; an invalid value stops startup. The cookie retains secure values: `__Host-meeko.sid`, `Secure`, `HttpOnly`, `Path=/` and no `Domain` (host-only). With custom `sessions` in `server/runtime.ts`, these variables do not apply and Meeko warns once.

### Session duration

`SessionManager({ ttlMs })` sets the default duration (7 days). Since `1.2`, `context.session.create(data, { ttlMs })` gives a session its own duration, a positive integer in milliseconds; for example, 30 days for owners and 12 hours for staff. An invalid value rejects with `RangeError` without touching the store. This duration sets the cookie's `Max-Age` and store expiration (`expiresAt`, applied by Redis with `PX` and stored by SQL and D1 in `expires_at`), is saved in `SessionRecord.ttlMs` and is retained by `rotate()`: each rotation counts that duration again from the rotation time.

```ts
const ttlMs = user.role === 'staff' ? 12 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000
await context.session.create({ userId: user.id }, { ttlMs })
```

Sessions created without `ttlMs`, and records written before `1.2`, use the manager's duration on rotation too. `SqlSessionStore` needs no new column: it derives each row's duration as `expiresAt - createdAt`, so an earlier row retains its original duration on rotation. A custom `SessionStore` must preserve the record's `ttlMs` field if the duration is to survive rotation; if lost, the session rotates with the manager's duration.

### Origin in anonymous mutations

Since `1.8`, **every mutation checks `Origin` by default**, with or without a session cookie: `defineApiRoute`'s `POST`, `PUT`, `PATCH` and `DELETE`, all `defineRpc` calls (always `POST`) and native forms. Through `1.7`, a mutation without a session only checked it with `origin: "required"`, so any anonymous route accepting JSON sent as `text/plain`, or a form, was exposed to CSRF; an endpoint creating a session, such as login, was exposed to _login CSRF_: another website could log the victim's browser into an attacker account.

The rule matches authenticated mutations:

- The request origin is accepted, which after `createServerApp` is the configured `publicOrigin` (or `MEEKO_PUBLIC_ORIGIN`), along with origins in `SessionManager({ allowedOrigins })`. `MEEKO_TRUST_PROXY` only decides which `X-Forwarded-For` address is the client's: neither `X-Forwarded-Host` nor `X-Forwarded-Proto` changes the application's own origin. Behind a TLS-terminating proxy, configure `MEEKO_PUBLIC_ORIGIN`.
- An absent, `null` or foreign `Origin` (another scheme, host or port) responds with `403 INVALID_ORIGIN` before reading or validating input, `rateLimit` and the handler. `Sec-Fetch-Site` and `Referer` do not replace `Origin`: browsers send `Origin` on every `POST`, `PUT`, `PATCH` and `DELETE` request, including same-origin ones, so `Sec-Fetch-Site: same-origin` without `Origin` is also `403`, as with a session. Conversely, an origin in `allowedOrigins` passes even if the browser marks it `cross-site`.
- `GET`, `HEAD` and `OPTIONS` are not checked, because navigation has no `Origin`, and an OAuth callback or magic link arrives from another site. These flows must validate their own `state` or one-time token.
- Calls from `api.*` and `rpc.*` clients during SSR send the current request's origin, so local dispatch keeps working. `createLocalCalls` does the same since `1.8`: it sends the application's origin instead of the original request's `Origin`, so a local mutation works even if the page was requested with `GET` (without `Origin`); with a session it still needs the original request's CSRF token.
- A call from outside the browser (a script, test, native app or service) must send an allowed `Origin` header, or the route must declare `origin: "none"`.

`origin: "required"` (since `1.2`) matches the default and remains valid for making it explicit, for example in login:

```ts
// server/rpc/auth/login.ts
export default defineRpc({
	input: loginInput,
	output: loginOutput,
	origin: 'required',
	handler: async ({ input, context }) => {
		/* … */
	},
})
```

**`origin: "none"` disables checking on a route.** It is the escape hatch for webhooks, public APIs and clients that do not send `Origin`. It is **unsafe** against CSRF and _login CSRF_: use it only with another proof that the request does not come from another website, such as a webhook signature, an API token in `authorization` or an app secret the browser does not have. With `"none"`:

- a request without a session cookie is served with any `Origin`, or none, and `session.create()` can create the session;
- a request with a session still requires `Origin` and the CSRF token;
- a native form (`form`) without a session also does not need `Origin`, for webhooks sending `application/x-www-form-urlencoded` (Twilio, Slack…); with a session, it still requires `Origin` and `_csrf`.

```ts
// server/api/webhooks/payments.post.ts
export default defineApiRoute({
	origin: 'none',
	contentType: 'response',
	handler: async ({ context }) => {
		const payload = await context.request.text()
		if (!(await verifySignature(payload, context.request.headers.get('x-signature')))) throw new ApiError('INVALID_SIGNATURE', 401)
		return new Response(null, { status: 204 })
	},
})
```

A webhook sending `application/x-www-form-urlencoded` (Twilio, Slack) works the same: without `form`, the handler with `contentType: "response"` reads the body with `context.request.formData()`; with `form` and `origin: "none"`, submission without a session also needs no `Origin` and the body is validated with `body` (add `contentType: "response"` to use the handler's response rather than a `303`).

A public API called from other origins with `fetch` and CORS needs, besides `origin: "none"`, CORS headers in its middleware or proxy; Meeko does not add them. Without a session cookie (a token in `authorization`), the visitor's browser provides no credentials another website could exploit.

**`session.create()` protects login even outside guards.** Since `1.2`, on a `POST`, `PUT`, `PATCH` or `DELETE` request, `context.session.create()` only creates the session if the request's `Origin` was already checked (by the route guard or in an authenticated mutation that passed Origin and CSRF) or is allowed at that moment; otherwise, it rejects with `403 INVALID_ORIGIN` without touching the store or sending the cookie. Since `1.8`, the route guard rejects these requests earlier, so this check mainly covers a custom host calling `SessionManager.load` without passing through `executeApiRoute` or `executeRpc`; during development, its first rejection logs a warning. A `SessionHandle` not loaded by `SessionManager.load` (constructed manually) does not know its request and creates the session as before.

Both are incompatible changes published in a minor release as security fixes, under the [stability policy](stability.md#approved-exceptions): the `1.2` change for `session.create()` and the `1.8` change for all mutations. The [`1.8` guide](migration-1.8.md#origin-in-all-mutations) explains what to do with webhooks, public APIs and cross-origin clients.

### Revocation during a request

Revoking a family also stops work that already passed authentication:

- **In-flight requests.** `SessionHandle.signal` aborts with `SessionRevokedError` when its session family is revoked, and `RequestContext.signal` combines that signal with the request's (`AbortSignal.any`, created on first access). Both signals abort even if the code only retains the signal rather than the handle or context. Pass `context.signal` to `fetch`, queries and other cancelable operations. `SessionRevokedError` is an `ApiError` with code `SESSION_REVOKED` and status `401`; if it escapes the handler, the response is that `401`. The request calling `revoke()` does not abort, because it must send the empty cookie.
- **Open sockets.** Socket connections whose handshake session belongs to the revoked family close immediately with `1008` ("Session revoked"), without waiting for another event.
- **Other instances.** Within the same instance, `revoke()` always aborts. To reach other instances, the store implements `subscribeRevocations(listener)`, returning or promising an `Unsubscribe`. `RedisSessionStore` provides it when given `subscriber` (a dedicated connection, for example `client.duplicate()`). The `revokeFamily` script publishes `familyId` to `<prefix>revoked` in the same atomic operation that deletes the session. `MemorySessionStore` notifies `SessionManager` instances sharing it within the same process. `SqlSessionStore` has no notification: without it, other instances only detect revocation when rereading the store.
- **Subscription startup.** `SessionManager` subscribes on the first call to `load` and waits for confirmation before authenticating. If subscribing fails, `load` rejects that request and the next one retries. `SessionManager.close()` cancels the subscription.

Notification is asynchronous: between deletion in the store and notification arrival, another instance may keep executing code. Before an irreversible effect (a payment, sending something, deletion), call `await context.session.verify()`. It rereads the store and throws `SessionRevokedError` if the session was revoked, replaced by rotation or expired; without a session, it does nothing.

Known notification limitations:

- **Disconnected Redis subscriber.** Redis pub/sub does not store messages: revocations published while an instance's `subscriber` is disconnected are lost for that instance, even if node-redis restores the subscription on reconnection. Store deletion is atomic, so those sessions become invalid as soon as reread: every new request and every Socket event rereads the session, and broadcast delivery rereads it if more than `sessionRefreshMs` has passed since the last read. What remains undetected is work already authenticated on that instance: an in-flight request does not abort and an idle socket stays open until its next event or delivery. Use `verify()` before irreversible effects and monitor Redis client reconnection events.
- **Recent revocation window.** Each instance remembers revoked families for 60 seconds, up to 4096; with more revocations in that window, it forgets the oldest first. A handle whose record was read before the notification and created after its family leaves this memory does not abort on registration, but `verify()` and the next reread detect revocation, because the record no longer exists.
- **Forgeable notifications.** Anyone with Redis `PUBLISH` permission can publish a `familyId` to `<prefix>revoked`. The notification neither deletes data nor grants access, but it aborts in-flight requests and closes that family's sockets across all instances (denial of service). Restrict who can publish to that channel with Redis ACLs.

A storage outage propagates an error and grants no access. Do not use an in-memory store in production. `Secure` requires HTTPS in deployment; configure the proxy and `MEEKO_PUBLIC_ORIGIN` to match the public origin.

## Clean the project

`meeko clean [directorio]` deletes everything Meeko generates to leave the project clean:

| Command                 | Deletes                                                                                                          | Preserves                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `meeko clean`           | `.meeko/` (types, entry points, manifests, builds, generated `tsconfig.*`) and Vite's `node_modules/.vite` cache | The rest of `node_modules` and all application files |
| `meeko clean --all`     | The above and `node_modules`                                                                                     | Lockfiles, `.env`, `package.json` and source code    |
| `meeko clean --dry-run` | Nothing: shows what it would delete, with file count and size                                                    | Everything                                           |

The command only operates on a Meeko project (with `meeko.config.*` or `@meekojs/meeko` in `dependencies`/`devDependencies`) and rejects drive roots and the user's directory. It deletes only that fixed list of paths within the project and **never follows links**: a symlink or junction is removed as a link without entering its target, making it safe with pnpm's `link:`, where `node_modules/@meekojs/meeko` points to another repository. If `node_modules` is a link, Vite's cache is skipped with a warning. A locked file is retried; if the error persists, it is reported, processing continues with the rest and the command exits with code 1. To reinstall from scratch: `meeko clean --all` followed by `pnpm install`.

## Build, deployment and verification

```sh
npm run check   # manifests, types, components and separate TypeScript projects
npm run build   # client, Node server and prerendering under .meeko/output/node/
npm start       # Node 24, with a persistent store configured
```

`meeko build [directorio] [--adapter <nombre>]` takes the adapter from `--adapter` or `server.adapter` in `meeko.config.ts`, defaulting to `node`. `MeekoConfig.server` is a discriminated union; for Node it accepts `{ adapter: "node", host?, port? }`. The Node build writes `.meeko/output/node/` with `index.mjs`, `chunks/`, `client/` and `prerender/`. This folder contains the already resolved route, endpoint and asset manifest: it does not read `app/`, `server/` or `meeko.config.ts`, or load TypeScript or Vite. It only needs `node_modules` dependencies, including `@meekojs/meeko`. `meeko start` and `meeko preview` execute `index.mjs`; you can also run it with `node .meeko/output/node/index.mjs`. For Bun and Deno, `meeko build --adapter bun` or `--adapter deno` (or `server: { adapter: "bun" }` / `{ adapter: "deno" }`) produces the standalone output described under [Bun](#bun) and [Deno](#deno), and `--adapter cloudflare` produces the Worker described under [Cloudflare Workers](#cloudflare-workers). Since `1.3`, `--adapter static` (or `server: { adapter: "static" }`) generates a file-based site for static hosting; see [Static site](#static-site).

The server listens on `127.0.0.1:4173` unless `server.host`/`server.port` or the `MEEKO_HOST` and `MEEKO_PORT` (or `PORT`) variables specify another address; use `MEEKO_HOST=0.0.0.0` to accept remote traffic. `MEEKO_PUBLIC_ORIGIN` sets the public origin for HTTP and Socket Origin checks when a proxy terminates TLS. `SIGINT` and `SIGTERM` close Socket, HTTP, `waitUntil` tasks and the runtime, in that order. Open responses, such as a stream, have `shutdownTimeout` milliseconds (10 000 by default) to finish; then their connections are cut and shutdown continues. If the client disconnects before or during transmission, the response body is canceled, releasing open files and stopping stream producers. A request-target starting with `//` is always interpreted as a path on the application's own origin (or `MEEKO_PUBLIC_ORIGIN`), never as another host.

`meeko start` does not compress responses: in production you need a proxy or CDN that does. The difference is large: `/docs/framework` on this site, with all its resources, goes from 2,220 KB to 419 KB with Brotli, measured with a local proxy. Check the result with `curl -s -o /dev/null -D - -H 'accept-encoding: br, gzip' <url>`, which must return `content-encoding`. `"stream"` pages ask not to be compressed (`no-transform`), because buffered compression would hold back their chunks; see [Streaming SSR](#streaming-ssr-render-stream).

Public files are only served if listed in the asset manifest generated with the client build (including the `public/` copy); any other path goes to the application and is never read from disk. Each asset includes `ETag`, `content-length` and support for `HEAD` and `304`; only files emitted by Vite and listed in its manifest (with a content hash) use `cache-control: public, max-age=31536000, immutable`; the rest, including those in `public/assets/`, use `public, max-age=0, must-revalidate`. Each asset's key is its path serialized by the WHATWG URL, the same one requested by the browser: `public/logo@2x.png` is served at `/logo@2x.png`, `a b.txt` at `/a%20b.txt` and a non-ASCII name in its UTF-8-encoded form. HTML links the client entry point, its CSS and its `modulepreload` entries from Vite's manifest; the client route list is imported as a module rather than inserted into the document.

For a public service, place it behind an HTTPS proxy, configure `MEEKO_PUBLIC_ORIGIN`, persistent sessions and graceful shutdown. OpenAPI export is optional through `generateOpenApi`; a schema that cannot be represented produces an explicit error.

The standalone starter created by `meeko init` coordinates HTTP and Vite shutdown on `SIGINT` and `SIGTERM`. Shutdown is idempotent; if both resources fail it preserves both causes and sets a failing exit code, without leaving unobserved promise rejections. The framework host likewise preserves the original startup error and reports each additional failure when closing Socket, sessions or Vite through the central observer.

The Node adapter delivers multiple `Set-Cookie` headers separately and stops transmitting the body if the client closes the connection. A response already started cannot be replaced with error JSON; the adapter closes that connection and reports the failure to the host's observer.

### Static site

```sh
npx meeko build --adapter static     # .meeko/output/static/
npx meeko preview --adapter static   # serves it as static hosting would
```

Since `1.3`, the `static` adapter writes a site without a server to `.meeko/output/static/`, ready to upload as is to nginx, Netlify, Cloudflare Pages, GitHub Pages or a bucket:

- client assets and `public/`;
- each prerendered page as `<ruta>/index.html` (`/docs/api` → `docs/api/index.html`, with segments decoded as the hosting expects) and its navigation payload `<ruta>/index.meeko.json`;
- `404.html`, the `app/error.meeko` page with status `404` within its layouts (without `app/error.meeko` it is not generated and the build warns);
- `sitemap.xml` and `robots.txt` if enabled, and the `headerFiles` header files.

Static hosting does not negotiate `Accept`, so this build's client does not request pages with `Accept: application/meeko+json`: it reads the `index.meeko.json` file from the page's folder (`/docs/api/index.meeko.json`, without the query string). Client navigation therefore works with any hosting that serves files; other adapters still negotiate `Accept`. `404.html` hydrates at any URL, including one matching a dynamic route whose page was not prerendered (`/docs/[slug]` with an unknown `slug`), and supports client navigation from it; a route whose payload does not exist displays the error page without reloading. Hosting services serve `404.html` for nonexistent URLs (in nginx, `error_page 404 /404.html;`).

All pages must use `render: "prerender"`, with `prerenderEntries` on dynamic routes. Before compiling anything, the build fails with a list of everything needing a server: `"ssr"`, `"stream"` or `"client"` pages, API endpoints, RPC procedures, Socket channels, `server/middleware` middleware and modules' server handlers. Route middleware (`app/middleware`) runs during prerendering and client navigation, but not on a page's first load; the build warns about this. `server/runtime.ts` only runs during prerendering. A `public/` file conflicting with a generated file (`404.html`, `sitemap.xml`, `robots.txt`, `_headers`, `_meeko/headers.conf` or a page's `index.html`) is an error.

With `adapter: "static"`, `server` accepts:

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	site: 'https://example.com',
	sitemap: true,
	robots: true,
	document: { seo: true },
	server: {
		adapter: 'static',
		headerFiles: ['_headers', 'nginx'],
		contentSecurityPolicy: {
			'default-src': ["'self'"],
			// data: for the <link rel="icon" href="data:,"> Meeko adds when the application has no icon.
			'img-src': ["'self'", 'data:'],
			'script-src': ["'self'"],
			'style-src': ["'self'", "'unsafe-inline'"],
			'object-src': ["'none'"],
			'base-uri': ["'none'"],
		},
		headers: { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' },
	},
})
```

- `contentSecurityPolicy`: the `Content-Security-Policy` of all pages, by directive. The build adds inline script hashes; see [CSP with hashes](#csp-with-hashes).
- `headers`: other headers for all responses. `Content-Security-Policy` is not accepted here, because it would lose the hashes.
- `headerFiles`: where these headers are written. By default, nowhere: static hosting does not read them from Meeko configuration, so each format is optional and explicit.
- `img-src` with `data:`: a document without a custom icon has `<link rel="icon" href="data:,">`, so the browser does not request `/favicon.ico`. With `default-src 'self'` and without `data:` in `img-src`, the browser blocks that icon and logs a CSP violation in each page's console; nothing else breaks. Simply add `data:` to `img-src`, as in the example, or declare a custom icon (`document.head.link: [{ rel: 'icon', href: '/favicon.svg' }]`), which replaces Meeko's.
  - `"_headers"` writes `/_headers`, the Netlify and Cloudflare Pages format, with a `/*` block for all routes. Those hosts read it without publishing it.
  - `"nginx"` writes `/_meeko/headers.conf`, one `add_header … always;` line per header, to include in each `location` (an `add_header` inside a `location` overrides those in `server`). The file is within the web root, so the configuration must hide `/_meeko/`:

```nginx
server {
  root /usr/share/nginx/html;   # the contents of .meeko/output/static
  location / {
    include /usr/share/nginx/html/_meeko/headers.conf;
    try_files $uri $uri/index.html =404;
  }
  location ^~ /_meeko/ { internal; }
  error_page 404 /404.html;
}
```

These options are only read when `server.adapter` is `"static"`; using `meeko build --adapter static` with another configuration builds without them. `meeko preview` serves the folder as a host would (the file, the folder's `index.html` or `404.html` with status `404`, without publishing `_headers` or `_meeko/`) and applies CSP and `headers`, at `127.0.0.1:4173` unless `MEEKO_HOST` and `MEEKO_PORT` say otherwise. `meeko start` only serves the Node build. The build still uses Node and Vite, and prerendering uses an intermediate Node server in `.meeko/build/node/`, as in Bun.

### `sitemap.xml` and `robots.txt`

```ts
export default defineMeekoConfig({
	site: 'https://example.com',
	sitemap: { exclude: ['/admin', '/admin/*'] }, // or sitemap: true
	robots: { disallow: ['/admin/'] }, // or robots: true
})
```

Since `1.3`, `sitemap` writes `sitemap.xml` (sitemaps.org 0.9 protocol) with the absolute URL of each prerendered page and each route without parameters, whether `"ssr"`, `"stream"` or `"client"`; dynamic routes without prerendering are unknown at build time unless they declare [`sitemapEntries`](#dynamic-routes-in-the-sitemap-sitemapentries) (since `1.7`). Prerendered pages requesting `<meta name="robots" content="noindex">` (or `none`) and routes in `exclude`, where `*` matches any sequence of characters including `/`, are omitted. `robots` writes `robots.txt` with `User-agent: *`, its `allow` and `disallow` entries (`Allow: /` with neither) and, with `sitemap`, the `Sitemap:` line containing its absolute URL.

URLs need the public origin: `site` or, without it, the build's `MEEKO_PUBLIC_ORIGIN`. With `sitemap` and no origin, the build fails before compilation; `robots` without `sitemap` does not need one. These work with all adapters. In Node, Bun, Deno and Workers they are served like other public files, from the build's asset manifest: because the sitemap lists prerendered pages, the Node adapter renders them with an intermediate server and builds its own afterwards, with the sitemap in its manifest (one additional server compilation, only with `sitemap`). A `public/sitemap.xml` or `public/robots.txt` conflicts with the corresponding option and fails the build.

#### Dynamic routes in the sitemap: `sitemapEntries`

Since `1.7`, a server-rendered page declares its sitemap URLs with `sitemapEntries` in `definePage`: a list of `{ params, lastmod?, changefreq?, priority? }` (type `SitemapEntry`) or a synchronous or asynchronous function returning it. This is the way to handle dynamic routes with `"ssr"` or `"stream"`, whose URLs the build cannot guess:

```ts
// app/pages/docs/[slug].route.ts (or the page's <script server>)
import { definePage } from '@meekojs/meeko/framework'
import { docs } from '../../../server/content/bundle.js'

export const route = definePage({
	sitemapEntries: ({ env }) => docs.filter((doc) => env.DOCS_DRAFTS === '1' || !doc.draft).map((doc) => ({ params: { slug: doc.slug }, lastmod: doc.updatedAt, changefreq: 'weekly' })),
})
```

- **When and with what.** `meeko build` evaluates it once, after prerendering, in the intermediate Node server used for prerendering: the `server/runtime.ts` runtime already exists with `prerendering: true`, but there is no request, session or per-request `services`. The function receives `SitemapEntriesContext`: `env` (the build's `process.env`) and `prerendering` (always `true`). Read data available to the build, such as a content bundle; if you query a database, it must be accessible during the build. It only runs with `sitemap` in `meeko.config.ts`, and Meeko only loads options from routes that name it: write it in the options, not through a spread.
- **What each entry returns.** `params` builds the URL like `href`; a route without parameters omits them and the entry only adds fields to its URL. `lastmod` is a `Date` (written with `toISOString()`) or W3C Datetime text (`"2026-10-01"`, `"2026-10-01T12:00:00Z"`); `changefreq` is `always`, `hourly`, `daily`, `weekly`, `monthly`, `yearly` or `never`, and `priority` is a number from `0` to `1`. Any other value, a duplicate URL, `params` that cannot form the URL or a URL resolving to another route stops the build with the route.
- **With `render: "prerender"`.** Prerendered pages are already in the sitemap; `sitemapEntries` only adds `lastmod`, `changefreq` and `priority` to them. An entry without a prerendered page stops the build: add it to `prerenderEntries` or remove it. This ensures the sitemap never advertises a URL the `static` adapter does not have.
- **`exclude` and `noindex` take precedence.** A declared URL matching `sitemap.exclude`, or a prerendered page with `noindex`, is not listed.
- **`render: "client"`.** Its options reach the browser, so it does not accept `sitemapEntries`: this is a type error and stops `meeko dev`, `meeko build` and `meeko check`. A parameterless `"client"` page is already in the sitemap.

This works the same with all adapters: the sitemap is written into the build's public files and in Node, Bun, Deno and Workers it is served from their asset manifest. The `static` adapter does not support `"ssr"` routes, so there `sitemapEntries` only supplements prerendered pages.

#### Sitemap served from a database

Since `1.8`, `sitemapXml(origin, urls)` from `@meekojs/meeko/framework` is the function `meeko build` uses to write the file. If pages change without a deployment, turn the option off (`sitemap: false`) and serve the sitemap from a server middleware, without writing the XML by hand:

```ts
// server/middleware/sitemap.ts
import { sitemapXml } from '@meekojs/meeko/framework'
import { defineServerMiddleware } from '@meekojs/meeko/server'

export default defineServerMiddleware(async (request, next) => {
	if (new URL(request.url).pathname !== '/sitemap.xml') return next(request)
	const pages = await db.pages.list()
	const xml = sitemapXml(
		'https://example.com',
		pages.map((page) => ({
			pathname: page.path,
			lastmod: page.updatedAt,
			alternates: [
				{ hreflang: 'es', pathname: page.path },
				{ hreflang: 'en', pathname: `/en${page.path}` },
				{ hreflang: 'x-default', pathname: page.path },
			],
		})),
	)
	return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } })
})
```

Each URL is a path or a `SitemapResolvedUrl` (`{ pathname, lastmod?, changefreq?, priority?, alternates? }`). The function escapes the XML, adds the `xhtml` namespace only when a URL has `alternates`, and does not sort the list. An invalid `hreflang` or an `alternates` `pathname` that does not start with `/` throws an error. It uses no Node APIs, so it also works in Workers.

### CSP with hashes

A `Content-Security-Policy` without `'unsafe-inline'` blocks a document's inline scripts, such as one from `document.head.script` or the one added by [`theme`](#lightdark-theme-without-flashing). For pages generated at build time, Meeko allows each through its SHA-256 hash, without a per-request nonce:

- Since `1.3`, the `prerender/manifest.json` index stores in `pages[ruta].scriptHashes` the `'sha256-…'` sources of the inline `<script>` elements executed by each prerendered page: JavaScript, `module`, `importmap` and `speculationrules`. Data blocks (`application/json`, such as Meeko's payload, and `application/ld+json`) and scripts with `src` do not count. Since `1.7`, only those Meeko writes outside the page count (`<head>`, payload, entry point and `document.bodyEnd`): a `<script>` or `<style>` inside `#app` or a teleport, potentially from user content, receives no hash.
- `inlineScriptHashes(html)` from `@meekojs/meeko/build` returns `{ hashes, unhashable }` for any document: hashes and JavaScript a hash cannot allow, `on*` attributes and `javascript:` URLs. It reads HTML like the browser, so the hash matches what the browser checks. It reads the entire document, including inside `#app`: for a Meeko page, use the index's hashes.
- `contentSecurityPolicy(policy, hashes)` from `@meekojs/meeko/server` builds the header value: it adds hashes to `script-src` (since `1.7`, to `script-src-elem` if the policy has it) without repeating sources or, if the policy has no `script-src`, to a copy of the `default-src` sources (with neither, scripts are already allowed and nothing is added). With hashes, the browser ignores `script-src`'s `'unsafe-inline'`.
- Since `1.4`, the same applies to inline `<style>` elements, such as those for [`<MeekoThemeToggle>`](#meekothemetoggle) icons and components: `pages[ruta].styleHashes` in the index, `inlineStyleHashes(html)` from `@meekojs/meeko/build` (`style="…"` attributes do not count, because a hash cannot allow them) and a third argument, `contentSecurityPolicy(policy, scriptHashes, styleHashes)`, which adds them to `style-src-elem` if present in the policy, otherwise to `style-src` or a copy of `default-src`. Unlike scripts, they are not added to a directive already allowing `'unsafe-inline'`: it is unnecessary, and the hash would override `'unsafe-inline'` for `style="…"` attributes.

The `static` adapter does all this with `server.contentSecurityPolicy`: it calculates script hashes and, since `1.4`, `<style>` hashes for every `.html` in its output (including `404.html` and those in `public/`; since `1.7`, in Meeko documents only those outside `#app` and teleports, while custom `.html` files are read in full), adds them to the policy and writes the header to `headerFiles`. If a page has an `on*` attribute or a `javascript:` URL, the build fails with the file list: use a script or the component's `on:`. Changing a script changes its hash on the next build, without touching the policy.

```ts
// A custom host serving the Node build with CSP for its prerendered pages.
import { readFile } from 'node:fs/promises'
import { contentSecurityPolicy } from '@meekojs/meeko/server'
import type { PrerenderIndex } from '@meekojs/meeko/build'

const index = JSON.parse(await readFile('.meeko/output/node/prerender/manifest.json', 'utf8')) as PrerenderIndex
const hashes = [...new Set(Object.values(index.pages).flatMap((page) => page.scriptHashes ?? []))]
const header = contentSecurityPolicy({ 'default-src': ["'self'"], 'img-src': ["'self'", 'data:'], 'object-src': ["'none'"] }, hashes)
```

Since `1.7`, server adapters set the header themselves with `server.contentSecurityPolicy` (see the next section). Without this option, `meeko start` adds no CSP: a custom host uses the `DocumentOptions.nonce` nonce, which Meeko puts on its `<script>` and `<style>` elements, and then a prerendered page is not served from its file, because the nonce changes on every response.

### CSP and headers in server adapters

Since `1.7`, `server.contentSecurityPolicy` and `server.headers` also exist with `adapter: "node"`, `"bun"`, `"deno"` and `"cloudflare"`. They are set at build time (in the application manifest, `AppManifest.contentSecurityPolicy` and `AppManifest.headers`) and the application applies them to each response:

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	server: {
		adapter: 'node',
		contentSecurityPolicy: {
			'default-src': ["'self'"],
			// data: for the <link rel="icon" href="data:,"> Meeko adds when the application has no icon.
			'img-src': ["'self'", 'data:'],
			'script-src': ["'self'"],
			// Shiki and other highlighters write style="…" attributes: this directive stays unchanged.
			'style-src': ["'self'", "'unsafe-inline'"],
			'object-src': ["'none'"],
			'base-uri': ["'none'"],
			'frame-ancestors': ["'none'"],
		},
		headers: {
			'X-Content-Type-Options': 'nosniff',
			'Referrer-Policy': 'strict-origin-when-cross-origin',
			'/admin/*': { 'X-Robots-Tag': 'noindex' },
		},
	},
})
```

**CSP by response.** Meeko completes each response's policy with what its body needs:

| Response                                                             | `Content-Security-Policy`                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prerendered page                                                     | The policy with the hashes of inline scripts and `<style>` elements written by Meeko (`scriptHashes` and `styleHashes` from the prerender index, like the `static` adapter). The page is still served from its file, with its `ETag` and `304`.                 |
| SSR page, `"stream"`, error page and 404                             | The policy with a new nonce per response in `script-src` (in `script-src-elem` if the policy has it, or in a copy of `default-src`), which Meeko puts on its `<script>`, `<style>`, client entry point, theme script and scripts from `useHead` and `document`. |
| SSR page with [`cache`](#ssr-page-caching)                           | The policy with hashes of inline scripts and `<style>` elements written by Meeko, without a nonce: the document is the same for everyone and on every revalidation, and a nonce does not survive a `304`.                                                       |
| API JSON, RPC and navigation payload                                 | `default-src 'none'; frame-ancestors 'none'`: JSON executes or loads nothing. This applies to every `server/api` and RPC response, including an endpoint with `contentType: "response"`.                                                                        |
| Any other (public files, module handlers, 404 without an error page) | The policy as is.                                                                                                                                                                                                                                               |

**What hashes authorize.** Only inline code Meeko writes outside the page: `<head>` (the theme script and style, `<MeekoAwait>` fallback, `useHead`, `document.head` and component `<style>` elements), the payload if it is not a data block, the client entry point and `document.bodyEnd`. A `<script>` or `<style>` inside `#app` or a teleport (from `html="…"`, poorly sanitized user content or written in the template) never receives a hash, so the browser blocks it, as with a nonce. A `<script>` or `<style>` in the template of a cached or prerendered page must go in `useHead` or a file.

Meeko never adds a nonce or hash to a directive with `'unsafe-inline'`: with one, the browser would ignore `'unsafe-inline'` and block what that directive deliberately allowed, such as `style="…"` attributes written by Shiki and other highlighters. The exception is `'strict-dynamic'` (since `1.7`): with it, the browser already ignores `'unsafe-inline'` and host sources, which remain only for older browsers, so `script-src 'strict-dynamic' 'unsafe-inline' https:` receives the nonce or hashes. With `'strict-dynamic'`, the client entry point (`<script src>`) only loads with a nonce: on a cached or prerendered page, which uses hashes, the browser blocks it, so these pages do not hydrate; use `'strict-dynamic'` only if all your pages are SSR without `cache`. If the policy has `script-src-elem` or `style-src-elem`, the nonce and hashes go to that directive, which governs elements. With `style-src 'self' 'unsafe-inline'`, Meeko's `<style>` elements are allowed by `'unsafe-inline'`; with strict `style-src`, by the nonce or hash, like scripts. A response already containing `Content-Security-Policy` (from a handler or middleware) retains it, and a `304` never carries the policy: the browser uses it to update its cached copy's headers, and a policy without that document's hashes would replace its own. Meeko generates the nonce (128 random bits); if the host passes `DocumentOptions.nonce`, its value is used, and `document.bodyEnd` and `document.head` receive it as usual.

With an `on*` attribute or a `javascript:` URL in HTML, the browser blocks them with a nonce just as with hashes; move them to a script or the component's `on:`. Calculating hashes for a cached page reads its HTML with the same parser as the build (`parse5`), once per render; with `cache.memory`, once per page version. CSP only applies in production (`meeko start`, `meeko preview` and each adapter's outputs): in `meeko dev`, Vite injects scripts and styles without a nonce or hash.

**Headers.** Each `headers` key with a header name applies to all responses; a key starting with `/` is a route pattern (`pathname`, without a query) with its own headers, applied after global ones and in written order, so the last one wins. In a pattern, `*` matches any sequence of characters, including `/`: `"/docs/*"` matches `/docs/api` but not `/docs`. A header already on the response (from Meeko, a handler or middleware) is not replaced: a page's or file's `Cache-Control`, for example, takes precedence over `headers`. `Content-Security-Policy` is not accepted in `headers`, and with `adapter: "static"`, pattern keys are an error, because `headerFiles` writes a single block for all routes. Unlike CSP, `headers` also applies in `meeko dev` to responses handled by the application (pages, API and RPC); files served by Vite do not include them.

**Workers.** Cloudflare Workers applies CSP and headers just like Node, Bun and Deno: hashes and the nonce use Web Crypto, and the assets' prerender index includes each page's hashes.

**An endpoint returning HTML.** The JSON policy (`default-src 'none'`) applies to all `/api/` and RPC. An endpoint with `contentType: "response"` returning HTML (a preview, a payment return page) would render without styles or scripts: put its own `Content-Security-Policy` on the `Response`, which Meeko preserves.

**Workers without CSP.** The HTML parser that calculates hashes (`parse5`) only loads when `server.contentSecurityPolicy` exists; without it, the Cloudflare build excludes it from the Worker (about 240 KB less).

**Cookies and shared caches.** Regardless of these options, a response with `Set-Cookie` and a `public` or `s-maxage` `Cache-Control` (from the response or `headers`) is sent as `private, no-store` and without `ETag`, so no shared cache stores the cookie with the page.

### Bun

```sh
npx meeko build --adapter bun
npx meeko preview --adapter bun      # runs the output with `bun`
bun .meeko/output/bun/index.js       # in production
```

The Bun build writes `.meeko/output/bun/` with `index.js`, `chunks/`, `client/` and `prerender/`. Unlike the Node build, `index.js` includes `@meekojs/meeko` and the remaining server dependencies: the folder needs neither `node_modules`, application sources, TypeScript nor Vite. Copy the complete folder to the server. Build and prerendering still run with Node; Meeko builds an intermediate Node server in `.meeko/build/node/` for this purpose, which is not part of the output.

The output listens on `127.0.0.1:4173` unless `MEEKO_HOST` and `MEEKO_PORT` (or `PORT`) specify another address; `MEEKO_PUBLIC_ORIGIN` has the same role as in Node. `server.host` and `server.port` only apply to Node. `SIGINT` and `SIGTERM` stop `Bun.serve`, close active connections and then the application. Since `1.3`, unhandled rejections and uncaught exceptions follow `processErrors` (see [Failures outside a request](#failures-outside-a-request)); a custom host with `createBunServer` achieves this with `handleProcessErrors`. `meeko preview` launches `bun` as a child process, forwards signals to it and adopts its exit code; if `bun` is not in `PATH`, it fails with an explicit message.

To host the application on a custom server, `createBunServer(app, options)` returns `{ fetch, websocket }` for `Bun.serve({ port, ...createBunServer(app) })`, and `createBunAssetReader({ root, assets })` serves manifest files with `Bun.file`. Socket limits:

- `maxPayloadLength`: the largest incoming frame. By default, `socket.maxMessageBytes` from `server/runtime.ts` or 64 KiB. Bun closes larger frames and the hub responds with `1009` to a message exceeding the application limit.
- `backpressureLimit`: pending outgoing bytes per peer, 1 MiB by default. A send exceeding it closes that peer with `1011` without blocking the rest of the room.
- `idleTimeout` (60 s) and `sendPings` (enabled) keep healthy connections alive and close inactive ones. Binary messages close with `1003`. Per-message compression is disabled.

### Deno

```sh
npx meeko build --adapter deno
npx meeko preview --adapter deno                 # ejecuta `deno run -A` sobre la salida
deno run --allow-net --allow-env --allow-read=.meeko/output/deno .meeko/output/deno/main.js
```

The Deno build writes `.meeko/output/deno/` with `main.js`, `chunks/`, `client/` and `prerender/`. As with Bun, `main.js` includes all server dependencies and does not need `node_modules`, sources, TypeScript or Vite. `meeko preview` grants all permissions (`-A`). In production, `--allow-net`, `--allow-env` (the runtime receives `Deno.env.toObject()`) and read access to the output folder suffice. `MEEKO_HOST`, `MEEKO_PORT` (or `PORT`) and `MEEKO_PUBLIC_ORIGIN` work as in Node.

`serveDeno(app, { host, port, publicOrigin, platform, onError, maxMessageBytes, idleTimeout, handleSignals })` serves the application with `Deno.serve` and returns `{ url, finished, close() }`. `close()` closes Socket peers with `1001`, stops HTTP, waits for `waitUntil` tasks and closes the application, in that order. With `handleSignals`, it does so on `SIGINT` and `SIGTERM` (on Windows, `SIGINT` and `SIGBREAK`) and, since `1.3`, applies `processErrors` to unhandled rejections and uncaught exceptions (see [Failures outside a request](#failures-outside-a-request)). `createDenoAssetReader({ root, assets })` serves manifest files. Socket limits:

- `Deno.upgradeWebSocket` offers no frame limit, so the adapter measures each message with `maxMessageBytes` (by default, the application's Socket limit or 64 KiB) and closes larger ones with `1009`. Deno reassembles the frame in memory before this check; limit request size at the proxy if you need an earlier cap.
- The outgoing buffer is controlled by the hub's buffer limit through `bufferedAmount`.
- `idleTimeout` (60 s) closes a peer that does not respond to ping. Binary messages close with `1003`.

### Cloudflare Workers

```sh
npx meeko build --adapter cloudflare
npx meeko preview --adapter cloudflare   # wrangler dev sobre la salida
npx wrangler deploy --config .meeko/output/cloudflare/wrangler.jsonc
```

The Cloudflare build writes `.meeko/output/cloudflare/` with:

- `worker.js`: a single ES module including `@meekojs/meeko` and server dependencies. It only imports `cloudflare:workers` and `node:async_hooks`, provided by the runtime.
- `assets/`: the client build and `public/`, plus prerendered pages under `assets/_meeko/prerender/`. The Worker reads those pages through the assets binding and never serves them as files; `public/_meeko/` is reserved and stops the build.
- `wrangler.jsonc`: generated configuration. Do not edit it; it regenerates on every build.

Wrangler does not rebundle the output (`no_bundle: true`), so the exact code tested is deployed. Wrangler is a deployment tool rather than a runtime dependency: `meeko preview` uses the application's installation or, failing that, Meeko's, and if neither is found it fails with `Wrangler no está instalado; añádelo con pnpm add -D wrangler…` (Wrangler is not installed; add it with the indicated command). `MEEKO_PORT` (or `PORT`) and `MEEKO_HOST` are passed to `wrangler dev` as `--port` and `--ip`. Build and prerendering still run with Node; during prerendering, the `server/runtime.ts` factory runs in Node with `prerendering: true` and no bindings.

Declare the configuration in `meeko.config.ts`:

```ts
export default defineMeekoConfig({
	server: {
		adapter: 'cloudflare',
		name: 'mi-app', // defaults to the name in package.json
		socketClassName: 'MeekoSocketRoom', // Durable Object class for rooms
		compatibilityDate: '2026-10-19', // defaults to the date Meeko is tested against
		wrangler: {
			// additional wrangler.jsonc fields
			d1_databases: [{ binding: 'DB', database_name: 'mi-app', database_id: '<id>' }],
			vars: { MEEKO_PUBLIC_ORIGIN: 'https://mi-app.example' },
		},
	},
})
```

The generated `wrangler.jsonc` contains:

- `main: "./worker.js"`, `no_bundle: true` and `find_additional_modules: false`, to prevent files in `assets/` from also being uploaded as Worker modules.
- `compatibility_flags` with `nodejs_als`, enabling `AsyncLocalStorage` from `node:async_hooks`, combined with flags declared in `server.wrangler.compatibility_flags`. `nodejs_compat` is also valid, because it includes `AsyncLocalStorage`.
- `assets` with `directory: "./assets"`, binding `ASSETS`, `run_worker_first: true` and `html_handling`/`not_found_handling` set to `"none"`. All requests reach the Worker, which only serves files listed in the manifest with the same `ETag` and cache policy as other adapters.
- The `MEEKO_SOCKET` Durable Object binding to the room class, prepended to `server.wrangler.durable_objects` bindings.
- The room class declaration (`MeekoSocketRoom`, or the name in `server.socketClassName`), without ever rewriting existing history. Cloudflare accepts two forms per Worker, the `migrations` array or the declarative `exports` map:
  - Without `server.wrangler.migrations` or Durable Object entries in `exports`, Meeko generates `migrations: [{ "tag": "meeko-socket-v1", "new_sqlite_classes": ["MeekoSocketRoom"] }]`. Do not delete or rename that migration after the first deployment.
  - If you declare `migrations`, the history must create the class itself (`new_sqlite_classes`, `new_classes` or the target of `renamed_classes`/`transferred_classes`). Migrations apply in order and are recorded by `tag`, so prepending Meeko's would change an already deployed history; the build stops with “server.wrangler.migrations does not create the Socket room class …; append { "tag": "meeko-socket-v1", "new_sqlite_classes": ["MeekoSocketRoom"] } at the end of server.wrangler.migrations”. Append that entry to your history; if `meeko-socket-v1` is already another migration's tag, the message suggests `meeko-socket-v1-<n>`, where `<n>` is the number of migrations plus one.
  - If you declare Durable Objects in `exports`, Meeko adds `"MeekoSocketRoom": { "type": "durable-object", "storage": "sqlite" }` when absent and does not generate `migrations`; a custom class entry must be live (without `state` or with `"created"`). Durable Objects in `exports` together with `migrations` stop the build, because Cloudflare only accepts one form.

`main`, `assets`, `no_bundle` and `find_additional_modules` belong to Meeko and cannot be overridden, nor can the `MEEKO_SOCKET` binding. Other `server.wrangler` fields (`routes`, `vars`, `d1_databases`, `observability`…) are copied as is.

In Workers, `env` in `server/runtime.ts` is the Worker's bindings object and `platform` is `"cloudflare"`. The application is created once per isolate, on the first request, and `context.platform.waitUntil` uses `ctx.waitUntil`. The `MEEKO_PUBLIC_ORIGIN` variable sets the public origin; without it, the routed URL's origin is used. An example with D1 for sessions:

```ts
// server/runtime.ts
import { D1SessionDriver, DurableObjectSocketPubSub } from '@meekojs/meeko/cloudflare'
import type { D1DatabaseLike, DurableObjectNamespaceLike } from '@meekojs/meeko/cloudflare'
import { defineServerRuntime, MemorySessionStore, SessionManager, SqlSessionStore } from '@meekojs/meeko/server'

interface Env {
	readonly DB?: D1DatabaseLike
	readonly MEEKO_SOCKET?: DurableObjectNamespaceLike
}

export default defineServerRuntime<Env>(({ env, production, prerendering }) => {
	const store = prerendering || !env.DB ? new MemorySessionStore() : new SqlSessionStore(new D1SessionDriver(env.DB))
	const pubsub = env.MEEKO_SOCKET ? new DurableObjectSocketPubSub(env.MEEKO_SOCKET) : undefined
	return {
		sessions: new SessionManager({ production: production && !prerendering, store }),
		services: { pubsub },
		// Without pubsub, the Worker uses DurableObjectSocketPubSub(env.MEEKO_SOCKET) by default;
		// any other broker is rejected when creating the application.
		socket: { maxMessageBytes: 16 * 1024 },
	}
})
```

#### Sessions in D1

`D1SessionDriver(db, { table? })` implements `SqlSessionDriver` for `SqlSessionStore`. `replace` is a single `UPDATE … WHERE id = ? AND family_id = ? AND expires_at > ?` checking that exactly one row changed; `revokeFamily` is a `DELETE … WHERE family_id = ?`. `UNIQUE(family_id)` prevents a second active ID in the same family. `D1SessionDriver.schema(table?)` returns the reference schema (with default table `meeko_sessions`):

```sql
CREATE TABLE IF NOT EXISTS "meeko_sessions" (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "meeko_sessions_expires_at" ON "meeko_sessions" (expires_at);
```

Apply it as a D1 migration before deploying: `npx wrangler d1 migrations create <base> meeko_sessions`, copy the SQL into the created file and run `npx wrangler d1 migrations apply <base> --remote` (or `--local` for `wrangler dev`). Expired rows are deleted on read; to clean up the rest, call `driver.deleteExpired()` from a Cron Trigger. D1 does not notify other isolates of revocation: an open connection in another isolate detects revocation when rereading the session on its next event (see [Revocation during a request](#revocation-during-a-request)).

Since `1.7`, `D1SessionDriver(db, { rateLimitTable: "meeko_rate_limits" })` also implements `rateLimit`, sharing [`rateLimit`](#rate-limiting-ratelimit) counters across isolates instead of keeping them in each isolate's memory (see [SQL rate limiting](#sql-rate-limiting)). It is optional, because it needs another table: without the option, the driver is unchanged. `D1SessionDriver.rateLimitSchema(table?)` returns its schema; apply it in a migration, as with sessions:

```sql
CREATE TABLE IF NOT EXISTS "meeko_rate_limits" (
  key TEXT PRIMARY KEY NOT NULL,
  window_ends_at INTEGER NOT NULL,
  count INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS "meeko_rate_limits_window_ends_at" ON "meeko_rate_limits" (window_ends_at);
```

The key is the SHA-256 in base64url (43 characters), and each rate-limited request is a single `INSERT … ON CONFLICT(key) DO UPDATE … RETURNING`. With `rateLimitTable`, `deleteExpired()` also deletes counters whose window ended and returns the total number of deleted rows.

#### Redis through the Upstash REST API

Workers does not open Redis TCP connections with the `redis` client. `RedisSessionStore` only needs `get`, `set` with `PX`, `del` and `eval`, so an adapter over Upstash's REST API suffices. Store the URL and token as Worker secrets:

```ts
import { RedisSessionStore } from '@meekojs/meeko/server'
import type { RedisSessionClient } from '@meekojs/meeko/server'

/** Minimal Upstash REST API client for RedisSessionStore. */
function upstashClient(url: string, token: string): RedisSessionClient {
	const command = async (...args: Array<string | number>): Promise<unknown> => {
		const response = await fetch(url, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify(args),
		})
		const body = (await response.json()) as { result?: unknown; error?: string }
		if (!response.ok || body.error) throw new Error(`Upstash ${String(args[0])} failed: ${body.error ?? response.status}`)
		return body.result
	}
	return {
		get: async (key) => (await command('GET', key)) as string | null,
		set: (key, value, { PX }) => command('SET', key, value, 'PX', PX),
		del: (key) => command('DEL', key),
		eval: (script, { keys, arguments: args }) => command('EVAL', script, keys.length, ...keys, ...args),
	}
}

// In the server/runtime.ts factory:
const store = new RedisSessionStore(upstashClient(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN), { prefix: 'mi-app:prod:' })
```

The REST API does not maintain a subscription, so do not pass `subscriber`: revocations are detected on rereading the session, as with D1.

Workers KV is unsuitable as a session store: it offers neither atomic comparison nor family deletion operations and is eventually consistent, so it cannot guarantee `replace` or `revokeFamily`. `SessionManager({ production: true })` rejects stores that do not implement both operations.

#### Socket and Durable Objects

The Worker checks the route, Origin and channel authorization before upgrading, with the same responses as other adapters: HTTP `400`, `403` `INVALID_ORIGIN` and `404`, and session or authorization rejections with close `4401` or `4403` (see [WebSocket](#websocket)), performed by the Worker itself with a `WebSocketPair` without waking the room's Durable Object. If accepted, it forwards the connection to its room's Durable Object: `env.MEEKO_SOCKET.idFromName(canal + "\0" + sala)`. Each channel/room pair is an object that:

- accepts the WebSocket with the hibernation API (`ctx.acceptWebSocket`), so idle connections do not keep the object in memory;
- stores the channel, room, URL, session cookie (only the cookie with `SessionManager`'s name, rather than the rest of the `Cookie` header) and the `origin` and `authorization` headers using `serializeAttachment`. On wakeup it rebuilds each connection from that state and the hub reauthorizes it. Channels see the same headers before and after hibernation. `keepHeaders` adds others (lowercase; `"cookie"` retains the complete header). Cloudflare limits this attachment to 16,384 serialized bytes: Meeko estimates the size before accepting the WebSocket and, if it does not fit, responds with `431` and notifies `onError` instead of opening a connection that would close with `1011`;
- responds `pong` to a `ping` text message without waking (configurable with `autoResponse`, or `false` to disable it). The runtime always responds to protocol pings;
- closes messages larger than `maxMessageBytes` (by default, the application's Socket limit or 64 KiB) with `1009`, and binary messages with `1003`.

`DurableObjectSocketPubSub(env.MEEKO_SOCKET)` is the default broker in Workers: `publish` delivers the message to the room through RPC to the Durable Object (or directly if already running inside it) and resolves when the room accepts it; the room distributes messages to its peers in publication order. Subscriptions only exist inside the room's Durable Object; that is why every upgrade must pass through `createWorker`. A broadcast from an API or another room works the same. `runtime.socket.pubsub` can only be omitted or be a `DurableObjectSocketPubSub`: `LocalSocketPubSub`, `RedisSocketPubSub` or another broker would only deliver to subscribers within one isolate, so the Worker and room reject the application on creation with “Socket channels on Cloudflare Workers require DurableObjectSocketPubSub…”.

Room delivery:

- Each publication is delivered to already subscribed peers. A newly accepted connection still undergoing authorization does not delay others; it receives publications after its authorization, as in other adapters.
- On waking from hibernation, the room rebuilds open connections and publications wait for reauthorization, up to `rebuildTimeoutMs` (5000 ms by default) from the start of each rebuild; a connection that does not finish in time receives only subsequent publications.
- A room accepts at most `maxPendingPublications` undelivered publications (1024 by default). Above that, `publish` (and therefore `broadcast`) rejects with `SOCKET_BACKLOG_EXCEEDED` (503) and the message is not delivered.
- The room name comes from `ctx.id.name`; when the runtime does not provide it (names over 1,024 bytes), the room takes it from its first connection or publication, and publications to itself still avoid RPC.
- Workers WebSockets do not report `bufferedAmount`, so `socket.maxBufferBytes` does not apply in rooms; `maxMessageBytes` and `maxPendingDeliveries` still limit each peer.
- If the application cannot be created on wakeup, the room reports the error and closes the WebSocket that woke it with `1011`.

Performance: a Durable Object runs its code on a single thread, so all messages and broadcasts in a room are processed serially in one place. This provides order and consistency but limits throughput in a very busy room; distribute traffic across multiple rooms (for example, per document or group) instead of a global room. Consult the current Durable Object limits in Cloudflare's documentation.

For a custom Worker, `@meekojs/meeko/cloudflare` exports the pieces used by the build:

- `createWorker(app, { socketBinding?, publicOrigin?, onError? })` returns the module's `{ fetch }` handler. `app` is a `ServerApp` or a `({ env, platform }) => ServerApp | Promise<ServerApp>` factory that runs once per isolate; if it fails, the next event retries it.
- `createSocketRoomClass(app, DurableObject, { maxMessageBytes?, autoResponse?, keepHeaders?, maxPendingPublications?, rebuildTimeoutMs?, onError? })` creates the room class. `DurableObject` is imported from `cloudflare:workers` and passed as an argument so the module can load outside Workers. The Worker generated by `meeko build` uses these options' defaults; changing `keepHeaders`, `maxPendingPublications` or `rebuildTimeoutMs` requires a custom Worker.
- `DurableObjectSocketPubSub`, `socketRoomName(canal, sala)`, `D1SessionDriver`, `createCloudflareAssetReader({ binding, assets })` and `createCloudflarePrerenderSource({ binding, directory? })`.
- `ServerAppOptions.defaultSocketPubSub` sets the broker when `server/runtime.ts` does not declare `socket.pubsub`, and `openSocketSession` from `@meekojs/meeko/server` connects an already accepted peer to the hub.

### Adapter conformance

`packages/meeko/tests/conformance/` builds the same test application (`tests/fixtures/conformance-app/`) with each adapter. Before starting the output in its real runtime, it removes sources; for Bun, Deno and workerd it also removes `node_modules`. The `workerd` variant builds with the `cloudflare` adapter and runs the output with the same local runtime as `wrangler dev` (workerd behind Wrangler's proxy, through `createTestHarness`), with in-memory D1 and Durable Objects. The same assertions cover:

- SSR with loader and platform, API, RPC, CSRF and Origin, including default `Origin` for anonymous mutations (since `1.8`) and `origin: "none"`;
- `404`, `405` with `Allow`, and `HEAD`, including a routeless page's `404` with `app/error.meeko` inside layouts;
- assets with `ETag`/`304` and cache policy, and traversal attempts (`..`, `%2e%2e`, `%2f`, `%5c`) and attempts to read build files;
- prerendered pages with the session's CSRF meta tag;
- middleware order;
- Socket: route, Origin, authentication, size limits, validation and binary messages, message order for a peer and broadcast between two room connections;
- process failures: an unhandled rejection reaches the runtime's `onError` and the output keeps serving, and an uncaught exception reaches `onError` and the output exits with code 1 (except in workerd).

The `workerd` variant adds D1 sessions (also read from a private channel's Durable Object), forced room hibernation (`evictDurableObject` with `webSockets: "hibernate"`) followed by messages in both directions, `ping`/`pong` auto-response and a broadcast from the API, room-to-room publication through RPC without leaking to third-party rooms, a connection with a `Cookie` header exceeding the attachment limit, a room whose name exceeds 1,024 bytes, and output as a single `worker.js` module. The streaming test requests `accept-encoding: identity`: Wrangler's local runtime (Miniflare) emulates Cloudflare compression for `text/html` without respecting `no-transform`, and its gzip encoder only writes when the body closes, so with `wrangler dev` or `meeko preview --adapter cloudflare`, a browser accepting gzip receives complete `"stream"` pages at the end. This is a local environment limitation: in production, Cloudflare compression respects `no-transform`.

```sh
pnpm run conformance          # node, bun, deno and workerd
pnpm run conformance:bun      # or :node / :deno / :workerd
```

Node always runs. Bun and Deno are looked up in `MEEKO_BUN`/`MEEKO_DENO`, then in `PATH` and finally in a version installed with `mise` (`mise where bun`). If not found, the suite is skipped with an explicit message. workerd comes with the `wrangler` devDependency; without it, its suite is also skipped. `MEEKO_CONFORMANCE_REQUIRE=bun,deno,workerd` turns that skip into a failure; CI uses it in its Bun, Deno and workerd jobs.

`pwsh -NoProfile -File packages/meeko/tests/fullstack-consumer.ps1` installs a local tarball in an independent project, generates types, builds production, removes application sources, starts the Node build and tests HTTP, assets, prerendered pages with CSRF, two sessions, RPC/CSRF, real WebSocket and Chrome. It also creates `meeko init-framework` from that package and installs, type-checks and builds the generated starter. The fixture contains `/`, `/users`, `/users/[id]`, `/dashboard`, `/chat` and `/layer-demo` pages; its TypeScript assertions check valid and invalid inputs and outputs for API, RPC, Socket, routes and `ComponentProps` imported from a `.meeko` page of the installed package.

Before preparing a release, run `pnpm install --frozen-lockfile`, `pnpm run verify`, `pnpm run e2e`, `pnpm run pilot:e2e`, `pnpm run package:smoke`, `pnpm run conformance` (with Bun and Deno installed; workerd comes with `pnpm install`), the Redis test above, `pwsh -NoProfile -File packages/meeko/tests/fullstack-consumer.ps1`, `pnpm pack` (in `packages/meeko`) and `git diff --check`. CI runs these families of checks, including Node conformance, on Windows; Redis and Bun, Deno and workerd conformance run on Ubuntu. The workflow's existence does not replace a green CI run. The release workflow repeats the gates and only responds to a version tag; the maintainer decides whether to create it.

### Troubleshoot pnpm and Redis

If pnpm 12 reports `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`, check the effective user and the file's ACL. In a restricted Windows sandbox, `codexsandboxonline` may lack write access to `all-stores.lock`; `--store-dir` and `LOCALAPPDATA` alone do not change that location. Do not delete the store or change global ACLs to work around this case. In a normal Windows terminal with profile access, `pnpm install --frozen-lockfile` works without that adjustment.

A frozen installation with pnpm 12.14.0 passed in a clean copy by isolating the profile only within the PowerShell process launching pnpm, with the exact command `pnpm install --frozen-lockfile`, without dependency links:

```powershell
$isolatedProfile = Join-Path (Get-Location).Path '.meeko/pnpm-profile'
$env:USERPROFILE = $isolatedProfile
$env:LOCALAPPDATA = Join-Path $isolatedProfile 'AppData/Local'
$env:APPDATA = Join-Path $isolatedProfile 'AppData/Roaming'
New-Item -ItemType Directory -Path $env:LOCALAPPDATA, $env:APPDATA -Force | Out-Null
pnpm install --frozen-lockfile
```

Run the block only in a new, restricted PowerShell process so the variables revert on exit. An earlier sandbox version also produced `uv_os_get_passwd returned ENOMEM` in `node:os.userInfo()` before loading `tsx`; that error belongs to the environment. Verification in normal Windows requires no preload or Meeko changes.

The Redis test requires `MEEKO_REDIS_URL` to point to an accessible test server. A connection error or `WRONGTYPE` must fail; the adapter does not grant access to a session when Redis is unavailable. Use a different prefix per project and environment; do not run `FLUSHALL` or `FLUSHDB` on shared Redis.

`pnpm run pilot:e2e` records each engine and environment and bounds its launches. Chromium, Firefox and WebKit passed in development and production on normal Windows without changing browser protections. A restricted sandbox may prevent Firefox from creating a page; diagnose that environment with `DEBUG=pw:browser*` before attributing the failure to the framework.

## Performance and baseline

`pwsh -NoProfile -File packages/meeko/tests/fullstack-consumer.ps1 -Benchmark` reproduces the external consumer, builds the minimal application and writes `packages/meeko/.meeko/benchmarks/stability-baseline.json`. The retained baseline is in `packages/meeko/benchmarks/baseline-2026-10-24.json`. Each timing uses seven samples and two warmups; the JSON contains median, 10th/90th percentiles and extremes. Cold compilation uses a new worker per sample; HMR measures a visible edit in Chrome with a new Vite server per sample. SSR and dispatchers are measured in-process with `app.fetch` on the production Node build, including server middleware; SSR uses `/?benchmark=ssr` to avoid measuring the prerendered copy of `/`. Size measurements include gzip-compressed JS and CSS. These are measurements from this machine, rather than CI thresholds.

The generated client entry point records `meeko-hydration` in the browser. The current benchmark measures navigation from clicking a link until the new route appears; the historical baseline measured a direct call to `mountClientApp.navigate`. Because of this change in method, do not compare navigation figures between the two runs as if they were a runtime regression. The historical JSON remains unchanged.

| Metric                    |          Median or size |        p10–p90 |
| ------------------------- | ----------------------: | -------------: |
| Cold compilation          |                 9.40 ms |   9.08–9.45 ms |
| Compilation after an edit |                 0.87 ms |   0.53–1.14 ms |
| Visible HMR               |                28.63 ms | 27.19–29.11 ms |
| SSR per request           |                0.040 ms | 0.032–0.060 ms |
| Hydration                 |                11.10 ms | 10.70–11.20 ms |
| Client navigation         |                 1.90 ms |   1.80–2.10 ms |
| API dispatcher            |                0.019 ms | 0.017–0.019 ms |
| RPC dispatcher            |                0.049 ms | 0.044–0.054 ms |
| Engine bundle             |  19,134 B; gzip 7,222 B |              — |
| Minimal bundle            |  21,314 B; gzip 6,438 B |              — |
| Full-stack bundle         | 36,063 B; gzip 14,897 B |              — |

After 500 SSR renders, the heap went from 87,276,056 to 87,012,304 bytes after GC; maximum observed RSS: 224,952,320 bytes. This sample does not prove the absence of leaks and should only be compared under equivalent conditions.

## Compatibility and versioning

The current version's supported public entry points are `@meekojs/meeko`, `/framework`, `/server`, `/node`, `/bun`, `/deno`, `/cloudflare`, `/build`, `/vite`, `/devtools-ui`, since `1.1`, `/prettier` and, since `1.2`, `/password` and `/postcss`. `/internal` exists for code generated by Meeko and is not a direct consumption contract. Compilation is offered through the CLI and Vite; the public root exposes reactivity and the SSR and hydration runtime, but no `compile` function. `defineMeekoConfig`, routing, `definePage`, `useState`, `createApiClient`, `createRpcClient`, `defineSocketChannel`, `attachNodeWebSocketServer`, `RedisSessionStore` and `SqlSessionStore` keep their current names. The generated `api`, `rpc`, `socket` and `useSocket` auto-imports depend on each application's manifest.

Meeko follows SemVer since `1.0`: the public contract, what is not public and the deprecation policy are in [stability.md](stability.md). A release requires a reproducible lockfile with the declared pnpm, green CI, an external consumer and tarball review. The version is not bumped automatically.

## Current limits

- The published server adapters are Node 24, Bun, Deno and Cloudflare Workers, and since `1.3` the `static` adapter, which only supports prerendered pages; the conformance suite runs with Bun 1.4.4, Deno 2.9.8 and workerd 1.20261019.1 (wrangler 4.152.0). In Workers, Socket requires Durable Objects, sessions require D1 or Redis through the Upstash REST API (KV is invalid) and D1 does not notify other isolates of revocation.
- Redis has an integration test with a real server configured in CI; local execution depends on an accessible server. The SQL adapter was tested with real SQLite. `RedisSocketPubSub` is tested in the same integration with two processes.
- Socket channels are discovered as files with simple names under `server/socket/`.
- Configuration or auto-import registry changes force a full reload in Vite.
- Production requires a persistent session store: `MEEKO_REDIS_URL` in Node, Bun and Deno, or custom `sessions` in `server/runtime.ts` (in Workers, D1 or Upstash).
- Family revocation invalidates the active ID under concurrent rotations, aborts `RequestContext.signal` for that family's in-flight requests and closes its sockets. On other instances, this requires a store with `subscribeRevocations`. Aborting is cooperative: code not observing `context.signal` keeps running until its next check, and cross-instance notification arrives with broker latency. Call `context.session.verify()` before irreversible effects. If the application requires strict ordering between in-flight operations, it must coordinate them. Meeko prevents an earlier response from restoring an already changed CSRF token.
- Client navigation is transactional. Without shared layouts, the new view hydrates alongside the current one between private markers and the previous one is only removed and disposed after successful hydration. With a retained layout, the outlet restores and rehydrates its previous page if the new one fails. In both cases the visible route, its URL and state remain active and `navigate()` rejects with the original error. Only if that restoration also fails does Meeko request a full load of the last confirmed URL. During hydration of the new view, the previous one remains in the document: an `id` repeated across both pages may resolve to the old element until commit.
- If the browser history API fails after rendering, Meeko requests a reload of the last confirmed URL and propagates the original error. If that recovery also fails, it preserves both causes in `AggregateError`.

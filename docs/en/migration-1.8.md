---
source-hash: cb1ade171f1345698f7b6f0ebca295dc2160fb86912441fea521e13526e85097
---

# Upgrade from 1.7 to 1.8

`1.8` is a minor release. `<MeekoPopover>`, `<MeekoSelect>` and `<MeekoThemeToggle>` are deprecated: they keep working in `1.x` and are removed in `2.0`. UI `1.8.0` provides replacements with the same contract. The new stable public API `useThemeToggle()` lets you build your own selector. Modules are registered by name (`modules: ['@meekojs/i18n']`) with options under their key; importing them and `[módulo, opciones]` are deprecated (`MEEK126`). As a security change, every API and RPC mutation checks `Origin` by default, also without a session (see [Origin on every mutation](#origin-in-all-mutations)). This guide describes planned changes, not yet published; also consult the [CHANGELOG](../../packages/meeko/CHANGELOG.md) and [stability policy](stability.md).

## Recommended order

1. Update core to `1.8` and `@meekojs/ui` to `1.8.0` when published. UI 1.8 requires Meeko `>=1.8 <2`; do not use the new `UIThemeToggle` with core 1.7.
2. Enable the UI module in `meeko.config.ts`.
3. Rename the three tags and update explicit imports of their types.
4. Run `meeko check` and check the controls, their styles and forms in your application.
5. Review webhooks, public APIs and nonbrowser clients calling mutations without a session, and decide for each whether to send `Origin` or declare `origin: "none"`.
6. Register modules by name, with options under their key (see [Modules by name](#modules-by-name)).

## Required UI module

```sh
pnpm add @meekojs/meeko@^1.8.0 @meekojs/ui@^1.8.0
```

```ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	modules: ['@meekojs/ui'],
	theme: true,
})
```

Keep the rest of your configuration. `theme` is only needed for the theme selector. The module registers components and adds its stylesheet before application styles: review any existing visual customizations.

## Rename tags

| Until 1.7            | Since core 1.8 with UI 1.8 |
| -------------------- | -------------------------- |
| `<MeekoPopover>`     | `<UIPopover>`              |
| `<MeekoSelect>`      | `<UICombobox>`             |
| `<MeekoThemeToggle>` | `<UIThemeToggle>`          |

```html
<UIPopover role="menu">
	<snippet name="trigger">Actions</snippet>
	<button role="menuitem">Edit</button>
</UIPopover>
<UICombobox
	model="color"
	bind:options="colors"
	name="color"
/>
<UIThemeToggle mode="select" />
```

`UICombobox` is the same custom list as `<MeekoSelect>`. A select without `multiple`, `searchable`, `filter` or `max` can also move to `UISelect`, a native `<select>` with much less JavaScript and less markup of its own: see [its documentation](ui-api.md#uiselect).

Rename closing tags too. Props, models, snippets, events, keyboard behavior, accessibility and `data-meeko-*` markup keep their contract: existing CSS selectors still find the same attributes. `UICombobox<T, Multiple>` infers its types from `options` and `multiple` as before.

## Type imports

The three prop types change package and prefix:

```ts
// Before
import type { MeekoPopoverProps, MeekoSelectProps, MeekoThemeToggleProps, PopoverPlacement, SelectModel } from '@meekojs/meeko/framework'

// After
import type { UIPopoverProps, UIComboboxProps, UIThemeToggleProps, PopoverPlacement, ComboboxModel } from '@meekojs/ui/runtime'
```

Popover/select helpers (`PopoverMode`, `PopoverRole`, `PopoverTrigger`, `PopoverToggleEvent`, `PopoverSnippets`, `PopoverExposed`, `SelectOptionState`, `ComboboxFilter`, `ComboboxFilterContext`, `SelectSnippets` and `SelectField`) keep their names and are imported from `@meekojs/ui/runtime`. Theme system types (`ThemeChoice`, `ThemeToggleMessages` and `ThemeToggleSnippets`, plus new `ThemeToggleState` and `ThemeToggleSystem`) remain in `@meekojs/meeko/framework`. Old core exports remain available throughout 1.x.

## MEEK121 warning

The compiler emits `MEEK121` when using the three deprecated built-in tags; `meeko check`, the build and language server show the warning. The editor strikes through the tag and explains its replacement on hover. The warning does not change SSR or hydration in 1.x. Your own component replacing a built-in tag keeps its normal resolution.

## Custom selector with useThemeToggle()

If you prefer your own selector, you do not need UI. `useThemeToggle()` and types `ThemeToggleState` and `ThemeToggleSystem` are stable public core API since 1.8. The composable returns `theme`, `choices`, `system`, `known` and `interactive`. Keep a `POST /_meeko/theme` form with `theme` and `return` to change without JavaScript, and render icons with `data-meeko-theme-icon` so the `<head>` rule shows the correct one from the first frame. The [complete example](framework.md#custom-theme-selector) explains hydration and accessible names when the choice is not yet known.

The `theme` configuration, `useTheme()`, cookie, `<head>` script, icon rule and `POST /_meeko/theme` stay in core. Deprecation affects control tags.

## Origin in all mutations

Since `1.8`, `POST`, `PUT`, `PATCH` and `DELETE` from `defineApiRoute` and all `defineRpc` calls return `403 INVALID_ORIGIN` if their `Origin` is missing, is `null` or is neither the application's nor one of `SessionManager({ allowedOrigins })`, **also without a session cookie**. Until `1.7`, anonymous mutations were only checked with `origin: "required"`, and another website could execute any anonymous route accepting a form or JSON sent as `text/plain`. This is a breaking change approved as a security fix ([stability policy](stability.md#approved-exceptions)).

**What stays the same.** Browsers send `Origin` on every mutation, including same-origin ones, and `api.*` and `rpc.*` clients send the current request's origin during SSR, so a web application needs no changes. Mutations with a session already required `Origin` and the CSRF token, and native forms required `Origin`; these stay the same. `GET`, `HEAD` and `OPTIONS` remain unchecked.

**What to review:**

- **Webhooks** (payments, Git, messaging). They arrive from another server without `Origin` and now receive `403`. Declare `origin: "none"` on the route and verify the provider's signature or secret before acting. This also applies to those sending `application/x-www-form-urlencoded` (Twilio, Slack): since `1.8`, `"none"` exempts a native form (`form`) without a session from `Origin`, which until `1.7` was always required. With `contentType: "response"` and no `body`, the handler can read the body using `context.request.formData()`:

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

- **Public APIs** for scripts, native apps or other services, authenticated with an `authorization` token instead of a cookie. Declare `origin: "none"` on those routes, or have the client send an allowed `Origin`. If other websites call them from the browser, also add origins to `allowedOrigins` (to pass without `"none"`) or configure CORS in middleware or the proxy; Meeko does not send CORS headers.
- **Clients from another known origin**, such as a dashboard at `https://admin.example.com`: add it to `SessionManager({ allowedOrigins })`, which now also applies to mutations without a session.
- **Tests and scripts** making `POST` requests with Node `fetch`, `curl` or `executeApiRoute`/`executeRpc` without `Origin`: add `origin` with the application's origin (for example, `headers: { origin: "http://localhost:4173" }`). `createApiClient` and `createRpcClient` accept `headers` to do this once.
- **Behind a TLS-terminating proxy**, the server sees `http://` and the browser sends an `https://` `Origin`: set `MEEKO_PUBLIC_ORIGIN` (or `publicOrigin`). `MEEKO_TRUST_PROXY` does not change the application's own origin; it only determines the client address. Such an application already failed in `1.7` on mutations with a session.
- **`createLocalCalls`** now sends the application's origin as `Origin`, like SSR's `api.*` and `rpc.*` clients, instead of forwarding the original request's. A local mutation from a page requested with `GET` (without `Origin`) works, with or without a session; with a session it still needs the original request's CSRF token. If a test expected a `403` due to the forwarded `Origin`, it no longer receives one.

`origin: "none"` is **unsafe**: it exposes the route to CSRF and _login CSRF_ on requests without a session. A request with a session still requires `Origin` and the CSRF token even if the route declares it, also in a native form (`Origin` and `_csrf`). `origin: "required"` remains valid and equals the default. Details in [framework.md](framework.md#origin-in-anonymous-mutations).

## Modules by name

Since `1.8`, a module is registered only by name in `modules` and its options go under its own key in `meeko.config.ts`, like in Nuxt. Importing the module (`modules: [ui]`) and `[módulo, opciones]` are deprecated: they keep working in `1.x`, with warning `MEEK126`, and are removed in `2.0`.

<!-- no-check -->

```ts
// Before (1.7)
import i18n from '@meekojs/i18n/module'
import { defineMeekoConfig } from '@meekojs/meeko/framework'
import ui from '@meekojs/ui'

export default defineMeekoConfig({
	modules: [ui, [i18n, { defaultLocale: 'es', catalogs: { es: 'app/locales/es.json', en: 'app/locales/en.json' } }]],
	ui: { defaults: { button: { shape: 'pill' } } },
})
```

```ts
// After (1.8)
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	modules: ['@meekojs/ui', '@meekojs/i18n'],
	ui: { defaults: { button: { shape: 'pill' } } },
	i18n: { defaultLocale: 'es', catalogs: { es: 'app/locales/es.json', en: 'app/locales/en.json' } },
})
```

1. Replace each imported module with its name (package name or path) and delete its `import`. `'@meekojs/i18n'` resolves its `./module` subpath: do not write `'@meekojs/i18n/module'`. The earlier built-in module is `'@meekojs/meeko/i18n'`, also using the `i18n` key.
2. Move each `[módulo, opciones]`'s options to the key declared by its `meta.configKey`: `i18n` for `@meekojs/i18n`, `ui` for `@meekojs/ui`. Warning `MEEK126` names it. If a module does not declare `configKey`, the warning says so: keep its tuple until its author adds one.
3. Add `{ "path": "./.meeko/tsconfig.config.json" }` to `references` in the project's `tsconfig.json` (`meeko init` already includes it), so the editor types and completes module keys.
4. Run `meeko check`. Since `1.8`, it always checks `meeko.config.ts` types with those of its modules (previously only when loading failed): a mistyped option is `TS2322` with its line, and a previously unnoticed error, such as `process.env` without `@types/node`, also appears.

A key for an installed module absent from `modules` (`i18n: { … }` without `'@meekojs/i18n'`) produces warning `MEEK127`, naming the missing entry; Meeko ignores it as before. Two modules with the same `meta.configKey` are now an error.

**Module authors.** Declare `meta.configKey` and augment `MeekoConfig` with its type (`declare module '@meekojs/meeko/framework' { interface MeekoConfig { readonly seo?: SeoOptions } }`) in the default export's file; Meeko loads that augmentation automatically in `.meeko/types/config.d.ts`. If the package root is its runtime, export the module at the `./module` subpath. Add `"keywords": ["meeko-module"]` to `package.json` so the editor completes its name. See [Modules](framework.md#modules).

## Destructure defineProps (optional)

`1.8` supports destructuring `defineProps` without losing reactivity (see [Destructure props](api.md#destructure-props)). No changes are needed: `const props = defineProps<Props>()` works as before. To adopt it in a component:

1. Replace `const props = defineProps<Props>({ size: 'md' })` with `const { label, size = 'md', ...rest } = defineProps<Props>()`: defaults move to the pattern (using both is `MEEK124`).
2. Replace each `props.label` with `label` in the script and template. A name already used by a local variable or parameter still refers to that variable: rename the prop (`label: title`) if needed.
3. If you separated props with `const { a, b, ...rest } = props` inside a `computed` to forward the rest through `bind`, use the destructuring's `...rest`, which already follows props.
4. Run `meeko check`: `MEEK101` identifies copies read only once, `MEEK125` identifies assignments and `TS2344` a name that is not a prop.

Defaults can now read top-level literal constants and imports; a setup variable previously producing `TS2304` is now `MEEK123`.

## Component types

`<Name>Props` no longer includes the callbacks of `defineEmits`. If your code reads or writes them on that type, change it to `ComponentProps<"Name">`:

```diff
- const props: BaseButtonProps = { href: '/x', onClick }
+ const props: ComponentProps<'BaseButton'> = { href: '/x', onClick }
```

Only types change, and `meeko check` flags each case with `TS2353` or `TS2339`. `BaseButtonEmits`, new, is the `defineEmits` map. This makes a wrapper possible; see [Wrapping another component](api.md#wrapping-another-component).

A component package published before `1.8` keeps working without republishing it and without you doing anything. Meeko reads what its `.d.meeko.ts` exports: its `<Name>Props` is its `ComponentProps`, with the callbacks, as before; `<Name>Emits` does not exist for it, because its declaration has no event map, and using it gives `TS2304`. Its `Snippets`, `Models` and `Exposed` do not change. Once republished with `1.8` it has both types separated, like the `.meeko` files of your project.

## defineModel also as a prop and an event (optional)

There is nothing to change: `model="signal"` stays the same and `defineModel<T>()` still returns `Signal<T>`. Now a parent can also pass the value with `bind:modelValue`, inside `bind="object"`, and listen to `on:update:modelValue`, as in Vue. Named models use `bind:touched` and `on:update:touched`. See [`defineModel`](reference/macros/definemodel.md#by-prop-and-event).

- `<Name>Props` includes `modelValue?` and `ComponentProps` also `onUpdate:modelValue?`; `<Name>Emits` includes `update:modelValue`, optional.
- A `.meeko` that declares in its script a prop or an event with the name of its model (`defineProps<{ modelValue: string }>()` next to `defineModel<string>()`) gives `MEEK063`: remove it from `defineProps`. Before, the child received it as a separate prop, unrelated to the model.
- `model` next to `on:update:modelValue` is `MEEK066`.
- Reading a prop in the `default` option of `defineModel` no longer gives `MEEK101`.

## Other visible changes

- **A component's `css`.** With Meeko's Vite plugin, the `css` export is PostCSS-processed CSS in the SSR graph and `meeko dev`, and remains the compiler string in the production client bundle (see [stability.md](stability.md#meeko-format-and-generated-module)). A Vitest test reading `Componente.css` or SSR-rendering a component still receives nonempty CSS: without `test.css: true`, Vitest does not process CSS and `css` is the compiler string; with `css: true`, processed CSS.
- **`on:toggle` on a fast popover.** A `<MeekoPopover>` or `UIPopover` `hint` opened and closed very quickly now emits `toggle` `true` followed by `false`; previously the browser merged both events and nothing was emitted. A handler counting openings now sees these too.
- **Component `<style>` order.** SSR and prerendering write them at the end of `<head>`, after `app/styles/main.css`, module stylesheets and `document`'s `head`, as the client does on hydration. Previously they came first, and a global rule with the same specificity as a scoped rule won until JavaScript loaded. If a `main.css` rule was meant to override a component's, increase its specificity: after hydration, the component's already won.
- **`<input>` or another `<select>` inside a `<select>`.** It is now `MEEK008`. It used to compile to an empty `<select>` followed by its loose options, which is what the browser does with that HTML. Move that tag out of the `<select>`.

## ESLint: new package

`@meekojs/eslint-plugin` is published for the first time with `1.8`: `1.7.1` did not include it, so there are no options to migrate. It is optional, and you can keep your ESLint configuration if you already have one. When you adopt it, `defineEslint()` sorts only imports with `perfectionist/sort-imports` and `perfectionist/sort-named-imports`, in ascending natural order (`item2` before `item10`). In Meeko 1.x they are `warn`, and they become `error` in 2.0. `eslint --fix` only moves those imports. If your CI uses `--max-warnings 0`, these warnings also fail its execution.

To also sort exports, objects, interfaces, types, enums, `switch`, `Set`, `Map` and more, use `defineEslint({ perfectionist: true })`. It enables the `recommended-natural` set except `sort-classes` and `sort-modules`, whose `--fix` breaks valid code; if you want either, declare it in `rules`, for example `perfectionist/sort-classes: 'warn'`. With `true`, `--fix` also reorders where the order is observable, such as `Object.keys`, a `Map` or the order in which an `each:of` renders the keys of an object: review the diff before accepting it. To turn off one rule, use `rules: { 'perfectionist/sort-objects': 'off' }`, and to sort nothing, `perfectionist: false`. To require imports as errors, use `defineEslint({ rules: { 'perfectionist/sort-imports': 'error', 'perfectionist/sort-named-imports': 'error' } })`; the severity override preserves natural order. See [Sort with Perfectionist](eslint.md#sort-with-perfectionist).

## Install the new packages

Release preparation, unpublished: wait until npm confirms all six versions. All public packages align at `1.8.0`.

```sh
pnpm add @meekojs/meeko@^1.8.0 @meekojs/ui@^1.8.0 @meekojs/i18n@^1.8.0 @meekojs/icon@^1.8.0
pnpm add -D @meekojs/eslint-plugin@^1.8.0 @meekojs/prettier-plugin@^1.8.0 eslint prettier vite
```

Register only the modules you use in `modules`. `@meekojs/ui/editor` belongs to UI and is registered separately. To use it, also install its optional peers:

```sh
pnpm add @milkdown/crepe@^7.23.0 @milkdown/kit@^7.23.0 @codemirror/lang-css@^6.3.1 @codemirror/lang-html@^6.4.12 @codemirror/lang-javascript@^6.2.5 @codemirror/lang-json@^6.0.2 @codemirror/language@^6.13.1 @codemirror/view@^6.43.15 @lezer/highlight@^1.2.5
```

Install `@iconify-json/*` collections explicitly in the consumer; review each collection's license before distributing its icons. See [Publish the Meeko packages](releasing.md#publish-the-meeko-packages).

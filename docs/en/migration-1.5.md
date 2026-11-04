---
source-hash: 92b43efb2b999d8ac97b89914cca7135c6b106f90789cdd81380669a1271655e
---

# Upgrade from 1.4 to 1.5

`1.5` is a minor release: new features (named layouts with `+group.ts`, `layoutProps` and `useLayout()`; `useForm` with `field`, `trySubmit`, `commit`, `onSuccess` and `focusInvalid`; `useId()`; `ApiError` with `issues`; HTML tags and `bind="obj"` on `<component is>`; `<MeekoTeleport>`, `<MeekoAwait>`, `<MeekoPopover>` and `<MeekoSelect>`; `match` on `<MeekoLink>` and `useRoute().isActive()`; `refreshing` and `keepPrevious` in `useApi` and `useRpcQuery`, and path aliases `~/`, `@/`, `#shared/` and `#server/`) are optional. Two changes are released as [approved exceptions](stability.md#approved-exceptions) to the stability policy: unnamed `bind="…"` is no longer a literal attribute, and `alias` becomes a `MeekoConfig` key. Other changes are noticeable when updating: project `paths` in generated `tsconfig` files, `MEEK108` for layers' `server/`, interfaces gaining members, compiled modules for built-in tags, new auto-imported names and codes `MEEK112` through `MEEK118`. This guide collects them and what you should review for each, and explains how to adopt each feature. The full list, including additions and fixes, is in the [CHANGELOG](../../packages/meeko/CHANGELOG.md); compatibility commitments are in the [stability policy](stability.md).

## Recommended order

1. Update `@meekojs/meeko` to the exact version `1.5.0` and recompile or rebuild, including prerendered pages: generated code and runtime must have the same version, and in `1.5` generated code also imports built-in tag modules (see [Built-in tag modules](#built-in-tag-modules)). If you use the VS Code extension, update it to `1.5.0`; Meeko DevTools is unchanged (still `1.0.0`).
2. If a module in `modules` declares `meta.configKey: "alias"`, change it before starting: configuration does not load (see [A module with `configKey: "alias"`](#a-module-with-configkey-alias)).
3. Search for unnamed `bind="` in templates and convert it to `bind:bind="…"` wherever you intended the literal attribute or prop (see [Unnamed `bind="…"`](#unnamed-bind)).
4. Run `meeko check`. Review `paths` errors (see [Project `paths` in generated `tsconfig` files](#project-paths-in-generated-tsconfig-files)), new `MEEK108` errors with layers, `MEEK106` warnings for your own component named after a new tag, and `MEEK117` hints, which do not fail the check.
5. If you manually implement an interface returned by Meeko (`RouteState`, `DataResource`, `LoadedResource`, `Form`), for example in a test, convert it to a partial test double (see [Interfaces gaining members](#interfaces-gaining-members)).

## Approved exceptions

### Unnamed `bind="…"`

Since `1.5`, unnamed `bind="…"` on a standard HTML element, `<component is>` or a component tag is the [bulk attributes](api.md#bulk-attributes-with-bind) directive: the value is an expression yielding an object, and its keys are written as attributes or, on a component, props. Until `1.4`, `bind="texto"` was a literal HTML attribute `bind` or, on a component, the static prop `bind` with that text.

`bind` is not an attribute of any standard HTML element, so the browser ignored it. What to change:

- **A literal `bind` attribute** read by a script or stylesheet: write it as `bind:bind="'texto'"`, or preferably use a `data-*` name.
- **A prop named `bind`** on your own component: pass it with `bind:bind="'texto'"`, or rename it.
- **Custom elements** (hyphenated, such as `<x-widget bind="a">`) are unchanged: `bind` remains a literal attribute.

`meeko check` and the editor flag a nonobject value (`MEEK113`).

### A module with `configKey: "alias"`

Since `1.5`, `alias` is the [path aliases](framework.md#path-aliases) option. A module whose `meta.configKey` is `"alias"` fails configuration loading in `meeko dev`, `meeko build` and `meeko check`, with a message requesting another key, like `theme` since `1.4`: its options would be read as aliases and its `MeekoConfig.alias` augmentation would conflict with Meeko's type.

Give the module another key in `meta.configKey` and its `MeekoConfig` augmentation, and move its options to that key in `meeko.config.ts`, as in [Update from 1.3 to 1.4](migration-1.4.md#a-module-with-configkey-theme). A module without `configKey`, or with a non-Meeko key, is unchanged.

## Changes you will notice when upgrading

### Project `paths` in generated `tsconfig` files

`.meeko/tsconfig.app.json`, `.meeko/tsconfig.server.json` and `.meeko/tsconfig.shared.json` now copy `paths` from the project's `tsconfig.json`. Until `1.4`, only the editor and component checking used them; now `meeko check` also resolves `.ts` files with them. A `paths` entry pointing to a nonexistent directory, or working only by accident, may produce new module-not-found errors: fix or remove it.

A pattern in those `paths` with a Meeko alias prefix and another directory (`"@/*": ["./src/*"]`) takes precedence and disables that Meeko alias throughout the project, including scope checks, with one warning per process (see [Path aliases](#path-aliases)).

### `MEEK108` with layers' `server/`

A component value import reaching a layer's `server/` already failed in the build. Since `1.5`, `meeko check` and the editor also flag it with `MEEK108`, like the project's `server/`. Request that data from the server with `useApi` or `useRpcQuery`, or move shared code to `shared/`.

### Interfaces gaining members

Some interfaces for objects Meeko delivers to the application have new required members:

| Interface                                                                        | New members                        |
| -------------------------------------------------------------------------------- | ---------------------------------- |
| `RouteState` (de `useRoute()`)                                                   | `isActive(to, { params, prefix })` |
| `DataResource` and `LoadedResource` (from `useApi`, `useRpcQuery` and resources) | `refreshing`                       |
| `Form` (from `useForm`)                                                          | `trySubmit`, `commit` and `field`  |

Since `1.5`, [stability.md](stability.md#package-entry-points) records the rule: an interface Meeko **delivers** can gain members in a minor release, just as a union Meeko delivers can gain members. Reading and destructuring them is unchanged. Manually implementing them stops compiling, for example in a test:

```ts
// Before: missing isActive since 1.5
const route: RouteState = { url, path, id, params, search };

// After: a partial test double that still compiles as the interface grows
const route = { url, path, id, params, search } as Partial<RouteState> as RouteState;
```

### Built-in tag modules

`<MeekoThemeToggle>`, `<MeekoAwait>`, `<MeekoPopover>` and `<MeekoSelect>` are separate modules, `@meekojs/meeko/builtins/theme-toggle`, `/await`, `/popover` and `/select`, imported by the compiler only in components using the tag: the rest of the application does not load their code. In `1.4`, `<MeekoThemeToggle>` came from `@meekojs/meeko/internal`, which no longer exports it. Therefore a component compiled with `1.4` using `<MeekoThemeToggle>` does not work with the `1.5` runtime: recompile, as with every update. `@meekojs/meeko/builtins/*`, like `/internal`, is a contract between the compiler and runtime of the exact same version: do not import it manually (see [stability.md](stability.md)).

If your Vite configuration lists `@meekojs/meeko` modules (in `optimizeDeps` or `manualChunks`), also account for `@meekojs/meeko/builtins/*`. `meeko dev` already optimizes those modules in advance when Vite optimizes Meeko, so the first visit to a page with `<MeekoAwait>` does not reload.

### New built-in tags and `MEEK106`

`<MeekoTeleport>`, `<MeekoAwait>`, `<MeekoPopover>` and `<MeekoSelect>` are Meeko built-in tags, without imports. A project component with one of those names (in `app/components`, from a module, imported or declared in `<script>`) remains that tag, with its props, rather than Meeko's; `meeko check`, `meeko build` and the editor warn with `MEEK106`, which does not fail the check. Rename it if you want the built-in tag.

### New auto-imported names

`useId`, `useLayout`, `defineGroup`, `ClientError`, `isClientError` and types `LayoutProps`, `MeekoAwaitProps`, `MeekoTeleportProps`, `MeekoPopoverProps`, `MeekoSelectProps` and their parts' types are auto-imported where applicable (`ClientError` and `isClientError` in components and `app/` modules, not `server/`, `*.server.ts` or route files). Your own export with the same name from auto-import directories, or a file import or declaration, takes precedence, so existing code is unchanged.

### `<component is>` with content

Until `1.4`, `<component is>` with content produced `MEEK031`. Its content now becomes the component's snippets, as with its tag, or the HTML tag's children (see [`<component is>` with HTML tags](#component-is-with-html-tags)). `MEEK031` remains for a void tag (`img`, `input`…) with content. In a `<component is>` whose expression can yield a tag, hyphenated attributes, previously `MEEK032`, belong to the element. A `<component is>` yielding only components compiles as before.

### `useForm` revalidates fields with errors

Every field change also revalidates other fields with a schema error (and the form message from the schema): a password confirmation stops showing “Las contraseñas no coinciden” as soon as the password is corrected. Server messages on other fields are preserved. If a test expected another field's error to remain visible after a change, update it.

### Signals with `undefined` in SSR

`const id = signal<string | undefined>(undefined)` used to make the entire page return `500`. State now carries those signals separately and the browser hydrates them as `undefined`. A value JSON still cannot represent (a date, `Map` or instance) fails with the component, signal and a hint; store a date as ISO text and a `Map` as an object.

## Adopt the new features

### Named layouts and `+group.ts`

Each `app/layouts/<nombre>.meeko` is a named layout chosen by the page in its route options; without `layout`, its `+group.ts` layout or `default` is used, as before:

```ts
// app/pages/connections.route.ts (or export const route in <script server>)
export const route = definePage({ layout: "dashboard" });
```

```ts
// app/pages/(dashboard)/+group.ts
export default defineGroup({ layout: "dashboard", layoutProps: { showAlert: false } });
```

`layout: false` leaves only `app/app.meeko` and `+layout.meeko` files. `layout` and `+group.ts` content are literals: Meeko reads them without executing the file, like `render`. To migrate a group with its own layout, such as `app/pages/(dashboard)/+layout.meeko`, move the file to `app/layouts/dashboard.meeko` and add the `+group.ts` above: the layout replaces `default` instead of nesting inside it. When navigating between two pages with the same layout, it remains mounted with its state. A `+group.ts` outside `app/pages` is `MEEK115`. See [Named layouts](framework.md#named-layouts).

### Layout props: `layoutProps` and `useLayout`

The page passes props typed against the selected layout through `layoutProps` (an object or context function, like `head`), which reach server HTML from the first byte, or changes them from its `<script>` with `useLayout()`, without remounting the layout:

```ts
export const route = definePage({ layout: "dashboard", layoutProps: ({ data }) => ({ title: data.user.name }) });
```

```html
<script lang="ts">
const layout = useLayout();
const failing = signal(false);
effect(() => layout.set({ showAlert: failing.value }));
</script>
```

They travel in the payload: a prop with `undefined` leaves it at the layout's default, and a prop JSON cannot represent fails the page with an error naming the page, layout and prop. A named layout's props must be optional or have defaults. When navigating, the layout receives the new page's props: nothing remains from the previous one. A layout using `<MeekoOutlet />` no longer needs to declare `outlet` in its props. To put page markup in a layout region, use `<MeekoTeleport>`. See [Layout props from the page](framework.md#layout-props-from-the-page).

### `useForm`: `field`, `trySubmit`, `commit` and `focusInvalid`

- **`form.field(name)`** returns a typed `FormField` (signal, name, `useId` IDs, message, `invalid` and `describedBy`) for your own field component: `<AppField bind:field="form.field('email')" label="Correo" />`. A field component working inside and outside a form declares optional `field` and its default model with unnamed options, `defineModel<string>({ default: "" })`, making it optional too, and reads `computed(() => props.field?.value ?? model)`. See [Field components: `FormField`](framework.md#field-components-formfield).
- **`form.trySubmit(event)`** submits like `submit`, but resolves with a `FormSubmission` (`{ ok: true, result }` or `{ ok: false, reason: "invalid" | "error" | "skipped" }`) and never rejects. `submit` is unchanged.
- **`form.commit(values?)`** took values as new initial values for `dirty` and `reset()` in 1.5, without clearing `submitted`; the `onSuccess(result, form)` option runs after successful submission, for example to call `commit`. In the current API, `reset()` always returns to the declared `initial`; `commit` only updates the `dirty` reference.
- **`focusInvalid: true`** moves focus to the first invalid control after a submission with field errors from the schema or server `issues`.

See [Forms: `useForm`](framework.md#forms-useform).

### `useId`

`useId()` (auto-imported in `.meeko` files) returns an ID for `id`, `for` or `aria-describedby` that matches between server HTML and hydration and does not repeat across instances, including `each:` rows and regions appearing later. Call it in the component script before any `await`; `document.idPrefix` in `meeko.config.ts` changes its prefix (`m` by default). It replaces custom counters, which produced different IDs on server and browser. See [Stable IDs: `useId`](api.md#stable-ids-useid).

### `ApiError` with `issues`

An error belonging to a field, such as an email already registered, carries `issues` through `ApiError`'s third argument:

```ts
throw new ApiError("EMAIL_TAKEN", 409, { issues: [{ path: "email", message: "That email already has an account." }] });
```

They are sent in the same shape as those from a `400` (at most 20, only with a `4xx` status), arrive in `ClientError.issues` and are placed in the field by `useForm`. A string third argument remains the internal message. Only `issues` from a Meeko `ApiError` are transferred: those from another error with the same shape (an SDK's `ApiError`, a `ClientError` from another service escaping the handler) are not exposed. See [Field errors](framework.md#field-errors-apierror-with-issues).

### `<component is>` with HTML tags

`is` also accepts an HTML tag (a literal, a union of tags such as `props.href ? 'a' : 'button'` or a union of tags and components), with its attributes, events, `ref:` and content. A button turning into a link uses a single template, and nonglobal attributes are only written while the current tag accepts them:

```html
<component is="props.href ? 'a' : 'button'" class="button" bind="state.value" on:click="onClick"
  bind:href="props.href" bind:target="props.target" bind:type="props.type" bind:disabled="props.disabled">
  <render snippet="snippets.default" />
</component>
```

`bind="obj"` reactively writes an object's keys as attributes (or props); explicit ones take precedence, `on*` and `data-meeko*` keys are rejected and names are compared case-insensitively. See [HTML tags in `<component is>`](api.md#html-tags-in-component-is) and [Bulk attributes with `bind`](api.md#bulk-attributes-with-bind).

### `<MeekoTeleport>`

`<MeekoTeleport to="#toolbar">…</MeekoTeleport>` renders its content inside the element with that `id` (or at the end of `<body>` with `to="body"`) without removing it from the component: its signals, events, `provide`/`inject` and `<style scoped>` keep working and it is disposed of with the component. Server HTML already contains it at its destination. It replaces manually moving nodes in `onMounted`. See [`<MeekoTeleport>`](framework.md#meekoteleport), which also explains when `<dialog>` or `popover` is enough.

### `<MeekoAwait>`, `refreshing` and `keepPrevious`

For data from a `useApi` or `useRpcQuery` without `await`, `<MeekoAwait>` renders loading state, an error with retry, and content, and with `reserve` keeps the region's previous height to prevent shifts on the next visit:

```html
<MeekoAwait for="items" reserve>
  <snippet name="pending"><p class="skeleton">Loading…</p></snippet>
  <ul><li each:of="items.data.value" each:as="item">{item.name}</li></ul>
</MeekoAwait>
```

Inside, `meeko check` reads `items.data.value` as loaded, without `!`. It replaces `if:when="items.pending.value"` and fixed `min-height` values. `refreshing` is `true` while `refresh()` or input changes reload with data; with `{ keepPrevious: false }`, an input change becomes an initial load again. See [`<MeekoAwait>`](framework.md#meekoawait) and [Avoid height shifts (CLS)](framework.md#prevent-layout-shifts-cls).

### `<MeekoLink match>` and `useRoute().isActive()`

To mark a navigation section, `<MeekoLink to="/dashboard" match="prefix">` carries `aria-current="page"` on its route and `aria-current="true"` on routes below it (`/dashboard/stats`, not `/dashboards`); `match="exact"` is the default and previous behavior. For your own link or component, `useRoute().isActive(to, { params, prefix })` applies the same rule and returns `"page"`, `"true"` or `false`, ready for `bind:aria-current`. It replaces manually comparing `useRoute().path`. See [Current route](framework.md#current-route).

### `<MeekoPopover>` and `<MeekoSelect>`

`<MeekoPopover>` is an accessible popover based on the native `popover` API and _CSS anchor positioning_ (menus, nonmodal dialogs and tooltips with `mode="hint"`), and `<MeekoSelect>` is an accessible select built on it, whose `model` takes the type of `options`, with search, groups, multiple selection and `useForm`'s `bind:field`. Neither ships visual styles and both work with CSP without `'unsafe-inline'`. `<MeekoPopover>`'s `anchor` snippet accepts your own trigger with `bind="trigger"`. See [Popover](api.md#popover-meekopopover) and [Select](api.md#select-meekoselect).

### Path aliases

Without configuration, `~/` is the project root, `@/` is `app/` (intentionally the reverse of Nuxt), `#shared/` is `shared/` and `#server/` is `server/`, in `meeko dev`, `meeko build`, `meeko check` and the editor:

```ts
import { formatDate } from "#shared/dates";
import * as Card from "@/components/Card.meeko";
```

- **Scopes.** Each alias has its directory's scope: `#server/` outside server code is `MEEK108`, and `@/` in `shared/` is `MEEK118`.
- **`alias` in `meeko.config.ts`** adds aliases, changes Meeko's or removes them: `alias: { "ui/": "app/components/ui/", "#server/": false }`.
- **Contracts.** API, RPC and Socket schemas can also be imported with an alias (`#shared/schemas/auth`), and generated clients resolve them.
- **If you already had custom aliases.** A pattern in `tsconfig.json`'s `paths` with the same prefix and another directory, a Vite `resolve.alias` covering that prefix (from the project or a module), or an entry in `package.json`'s `"imports"` with `#shared/` or `#server/` takes precedence and disables that Meeko alias everywhere, including scope checks, with a warning. If yours points to the same directory as Meeko's, it is not treated as a redefinition. To remove the warning, disable Meeko's alias with `alias: { "@/": false }`.

See [Path aliases](framework.md#path-aliases).

## New codes

| Code      | Where                                          | What it identifies                                                                                                                                                                                               |
| --------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MEEK112` | Compiler, `meeko check`, editor and runtime    | A tag `<component is>` cannot render (`script`, `style`, `iframe`…: compilation error with a literal, type error with an expression and runtime `TypeError`), or an attribute none of its possible tags accepts. |
| `MEEK113` | `meeko check`, editor and runtime              | A nonobject `bind="…"` value, an `on*` or `data-meeko*` key, or a key that is not a component prop.                                                                                                              |
| `MEEK114` | Compiler                                       | A static `<MeekoTeleport>` `to` that is neither `"body"` nor `"#id"`.                                                                                                                                            |
| `MEEK115` | `meeko check`                                  | A `+group.ts` outside `app/pages`.                                                                                                                                                                               |
| `MEEK116` | Compiler                                       | `<MeekoAwait>` without `for`.                                                                                                                                                                                    |
| `MEEK117` | `meeko check`, `meeko build` and editor (hint) | A page or layout rendering data in an `each:of` from a `useApi` or `useRpcQuery` without `await` without handling its loading state. Does not fail the check.                                                    |
| `MEEK118` | `meeko check`, `meeko dev` and build           | `@/` (or an `app/` alias) in `shared/`, which cannot see `app/`.                                                                                                                                                 |

## Editor

VS Code extension `1.5.0` colors `<MeekoAwait>`, `<MeekoTeleport>`, `<MeekoPopover>`, `<MeekoSelect>` and unnamed `bind="…"`, and includes Meeko `1.5`'s language server: completion and hover for new tags, `layout:` and `layoutProps`, `match` and aliases (directories and files after the alias, and “Go to definition”), `<MeekoSelect>` types inferred from `options` and new diagnostics. With `meeko.languageServer.preferWorkspace` (enabled by default), it uses the project's `@meekojs/meeko` server, so new features arrive when updating the package to `1.5`. See [Editors](editors.md).

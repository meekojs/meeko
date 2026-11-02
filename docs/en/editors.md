---
source-hash: 518e99abfeda5cda1279906cf3f233856f3383f78fc1b3a4d4c19215da6052b0
---

# Editors

Meeko includes a language server ([Language Server Protocol](https://microsoft.github.io/language-server-protocol/)) that gives any compatible editor the same features as the [VS Code extension](../../packages/vscode/README.md): `meeko check` diagnostics, completion (including HTML in the template and CSS in `<style>`), hover, go to definition, references, renaming across `.meeko` and `.ts` files, signature help, document symbols, folding, formatting, semantic tokens, CodeLens, linked tag editing, `<style>` colors and quick fixes (adding imports, resolving an ambiguous auto-import with an explicit import, removing `params` from a static `href`, adding `each:key` and moving a sidecar to `<script server>`).

A page's `<script server lang="ts">` block is analyzed as its own TypeScript module, with server auto-imports (or client auto-imports if its static `render` is `"client"`) and `.meeko` positions: type diagnostics, completion, hover, navigation, references, symbols and formatting. A block outside `app/pages` in any configured root, or in a `+layout` or `+error`, produces `MEEK044` on its opening tag. The `export const` declarations of a block with top-level code have their types in the page's `<script>` and template, and going to definition on one leads to its `export`.

## Code snippets

Type a prefix and choose the snippet in completion, or use **Insert Snippet**. `Tab` moves through editable fields and keeps repeated names synchronized. Skeletons use the filename as the initial title.

| Prefix           | Where                        | Content                                                              |
| ---------------- | ---------------------------- | -------------------------------------------------------------------- |
| `meeko`, `mcomp` | Empty `.meeko` file          | Component with `<script lang="ts">` and `<template>`                 |
| `mpage`          | Empty `.meeko` page          | `definePage` in `<script server>` and template                       |
| `mlayout`        | Empty `.meeko` layout        | Layout with `<MeekoOutlet />`                                        |
| `mprops`         | `<script>`                   | `Props` interface and `defineProps<Props>()`                         |
| `mpropsd`        | `<script>`                   | Destructured props with reactive defaults, since Meeko 1.8           |
| `memits`         | `<script>`                   | `defineEmits` with typed arguments                                   |
| `mmodel`         | `<script>`                   | `defineModel` with a default value                                   |
| `msnippets`      | `<script>`                   | `defineSnippets` contract                                            |
| `mexpose`        | `<script>`                   | `defineExpose` of a setup value                                      |
| `msignal`        | `<script>`                   | Signal with `signal`                                                 |
| `mcomputed`      | `<script>`                   | Computed value with `computed`                                       |
| `meffect`        | `<script>`                   | Reactive effect with `effect`                                        |
| `mmounted`       | `<script>`                   | Browser timer with `onCleanup` inside `onMounted`                    |
| `mref`           | `<script>`                   | `useElementRef` and a comment with the `ref:` to add to the template |
| `mif`            | `<template>`                 | Element with `if:when`                                               |
| `meach`          | `<template>`                 | List with `each:of`, `each:as` and `each:key`                        |
| `mrender`        | `<template>`                 | `<render>` with `snippet` and `args`                                 |
| `msnippet`       | Inside a component tag       | `<snippet>` with `name` and `params`                                 |
| `mis`            | `<template>`                 | Dynamic `<component is>`                                             |
| `mform`          | Empty `.meeko` file          | Component with `useForm` and a bound form                            |
| `mapi`           | `server/api/*.get.ts`        | `defineApiRoute` with a JSON response                                |
| `mrpc`           | `server/rpc/*.ts`            | `defineRpc` with schema imports from `shared/`                       |
| `mmiddleware`    | `app/middleware/*.server.ts` | Named `defineServerRouteMiddleware`                                  |
| `mcomposable`    | `.ts` composable             | `AbortController` with disposal through `onCleanup`                  |

Script and template snippets are inserted into the indicated block: adapt names to the component's values and consolidate imports if they already exist. `mmounted` registers cleanup inside the callback to respect `MEEK128`. Call the `mcomposable` composable during component setup. In `mrpc`, create or reuse real schemas in `shared/`, adjust the relative path to the file's depth and adapt the handler to the output schema. `mmiddleware` creates named middleware (`global: false`): declare it in the page or group's `middleware` to execute it.

The declarative [`contributes.snippets`](https://code.visualstudio.com/api/references/contribution-points#contributes.snippets) contribution only selects the language and snippet file; it does not support a per-project condition. That is why the four TypeScript snippets also appear outside Meeko projects while the extension is enabled. Their specific prefixes (`mapi`, `mrpc`, `mmiddleware`, `mcomposable`) reduce accidental matches.

## Meeko-specific features

Besides TypeScript features, the server understands reactivity, components (including [generic ones](#generic-components)) and application structure. All are computed statically, without the application running; their displayed text is not part of the contract. The `meeko/executionZones` request and custom token modifiers (`signal`, `computed`, `resource` and `reactive`) are internal to the VS Code extension and can change in a minor release (see [stability.md](stability.md#outside-the-contract)).

### Reactivity semantic tokens

Token types are TypeScript's. The server adds modifiers on top of them:

| Modifier       | Marks                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `signal`       | A signal (`signal`, `useState`, `defineModel`, `useElementRef`) declared at the top level of `<script>`, and every use. |
| `computed`     | A `computed` value or read-only signal, and every use.                                                                  |
| `resource`     | A data resource (`useApi`, `useRpcQuery`, `useRpcMutation`), and every use.                                             |
| `reactive`     | Tokens in a template expression reading a reactive value.                                                               |
| `modification` | A `.value` write, or a call reloading a resource (`refresh`, `mutate`). This is the standard LSP modifier.              |

The type decides whether a `.value` is reactive, not its name: only the `value` of a Meeko `Signal` or `ReadonlySignal` counts (including those returned by `useElementRef` and composables). `props.value`, `input.value` or `event.currentTarget.value` are ordinary reads and are not marked.

A theme or client can color them with semantic token rules (for example, `variable.signal` or `*.modification`). The VS Code extension provides default colors through TextMate scopes. Since extension `1.2`, `reactive` does not change the default style (it previously italicized reads of reactive values); to mark it, add `"*.reactive": { "italic": true }` to `rules` in `editor.semanticTokenColorCustomizations`.

### Hover

In addition to the TypeScript type, hover adds:

- **Signals, `computed` and resources.** Their type, a list of reads and writes in the script and template with links to each, and how their value reaches the browser: whether it is serialized in component state, travels in the payload, is recomputed in the browser or exists only in the browser.
- **Components.** Since `1.4`, the card is the tag signature in a TypeScript block, with one line per prop and its declared type (`variant?: CardVariant`), event (`on:save(id: number)`) and model (`model:open?: boolean`), and snippets as content (`header?()`, `default()`); this is followed by a link opening the `.meeko` and the JSDoc of every prop, event, model and snippet that has it. Empty sections are omitted. On a component tag or its import identifier: the `.meeko` file and its props, events, models, snippets and exposed value. On a [generic component](api.md#generic-components-generic) tag, hover shows the type parameters inferred from its props (`T = User`) and the props, events, models, snippets and exposed value resolved with them. Since `1.8`, a prop with a default value shows it after its type (`size?: "sm" | "md" = "md"`) in the card, prop hover on the tag and completion detail, whether the default is in the `defineProps` argument or destructuring.
- **Snippets.** On the `name` of a `<snippet>`: the child's snippet signature, with parameter types and optionality, and since `1.4` its JSDoc.
- **Meeko built-in tags.** Since `1.4`, `<MeekoLink>`, `<MeekoOutlet />` and `<MeekoThemeToggle>` have the same card as a component: props with the types of `MeekoLinkProps`, `MeekoOutletProps` and `MeekoThemeToggleProps` from `@meekojs/meeko/framework` (in `<MeekoLink to="/users/[id]">`, `to` is that route and `bind:params` its parameters), their content (`default`), rendered element, documentation and a link to the guide. Going to definition on the tag opens that type, and on the `to` value, the page. Hover and completion for `to`, `bind:params` and `bind:search` use the types and JSDoc of `MeekoLinkProps`; `on:click` and other attributes are those of an `<a>`, and completion offers `<a>` attributes except `href`. With an `@meekojs/meeko` earlier than `1.4`, which does not declare these types, the card uses the description included in the server. A project component with one of those names keeps its own card (`MEEK106`). Since `1.5`, `<MeekoAwait>` has the same card (`MeekoAwaitProps`, with its `default(refreshing)`, `pending` and `error(error, retry)` snippets), its `for` is an expression with hover and definition, and inside its content the `for` data is read as loaded, without `!`. Also since `1.5`, `<MeekoTeleport>` (`MeekoTeleportProps`, with `to` and `disabled`; completion of `to="…"` offers `body` and the `#id` values from the component, `app/app.meeko` and layouts), `<MeekoPopover>` (`MeekoPopoverProps`) and `<MeekoSelect>` (`MeekoSelectProps`, with its option type) have hover, completion and prop checking, and the grammar colors them as built-in tags.

Since core `1.8`, `<MeekoPopover>`, `<MeekoSelect>` and `<MeekoThemeToggle>` are deprecated: the compiler emits `MEEK121` and the editor strikes through the tag and explains the replacement on hover. They keep working in `1.x` and are removed in `2.0`. Use `UIPopover`, `UISelect` and `UIThemeToggle` from the `@meekojs/ui` 0.2 module; the theme system remains in core. See [Migration to 1.8](migration-1.8.md).

- **Routes, API and RPC.** On the ID in `href("/users/[id]")`: the page, its `params`, rendering mode and layouts. On `useApi("/api/notes")` or `api.notes.get`: the method, route and handler, with its contract schemas. On `useRpcQuery("users.get")`, `useRpcMutation(...)` or `rpc.users.get`: the procedure, its URL and handler with schemas. Since `1.6`, on a `middleware: ["auth"]` name in `definePage`: the named middleware's `app/middleware` file and its pages (or whether it is global or missing), and going to definition opens it. Server route middleware (`*.server.ts`) is marked as server-only.

### Go to definition in routes, API and RPC

Going to definition on a `href` route ID opens the page, and on an endpoint or procedure opens its handler at the contract line (`defineApiRoute` or `defineRpc`). A component tag leads to its `.meeko`. The server discovers routes, endpoints and procedures without executing their modules, like `meeko routes`; if discovery fails, it uses `.meeko/manifests/routes.json`.

Since `1.2`, strings in `href("…")`, `useApi("…")`, `useApiMutation("…")`, `useRpcQuery("…")` and `useRpcMutation("…")` are also links (Ctrl+click) to their page or handler, and a nonexistent route has no link. Workspace symbol search (Ctrl+T in VS Code) finds components, pages (by route, such as `/users/[id]`), endpoints (`GET /api/users`) and procedures (`rpc.users.get`); it accepts nonconsecutive letters (`usid` finds `/users/[id]`).

### Inlay hints

The template does not write the types of its declarations: the server shows them as inline hints after `each:as` (`each:as="user: User"`) and each `<snippet params>` parameter, including generic components. Long hints are shortened to 60 characters.

### “Meeko: new…” commands (VS Code)

- **New component:** `AppCard` creates `app/components/App/Card.meeko` if the `App` folder exists (otherwise, `AppCard.meeko`); `App/Card` is an explicit path.
- **New page:** `/users` creates `app/pages/users/index.meeko` and `/users/[id]` creates `app/pages/users/[id].meeko`, with its `useHead`.
- **New API endpoint:** asks for the method and route (`/users/[id]`, with or without `/api`) and creates `server/api/users/[id].get.ts` with its public schemas (`params`, `body` in `POST`/`PUT`/`PATCH` and `response`) in `shared/schemas/users.ts`, adding them to the file if it already exists. It uses valibot, the default validator, or zod if the project's `package.json` declares it.

They use the active file's project and `.meeko` indentation, and never overwrite a file.

### CodeLens

- **Reactive values.** Above each signal, `computed` or resource declared at the top level of `<script>`: its number of reads and writes and whether the template uses it. Clicking lists those positions.
- **Pages.** On a page's first line: its route, rendering mode and layouts. If its `<script server>` exports data from top-level code or declares `load`, another lens shows the type of data it sends to the browser (with top-level code, a field for each `export const` or `export let`, excluding `head`), and warns if it contains values JSON serialization rejects (functions, `bigint`, `Date`, `Map`…) or if the type is very large. On a `render: "client"` page it indicates that the loader runs in the browser.

Request the lens with `textDocument/codeLens`. Reactive value lenses use the `editor.action.showReferences` command with `[uri, posición, ubicaciones]` arguments in LSP format; a client without that command can ignore it or map it to its own reference list. Page lenses have no command.

### Execution zones

The server indicates, in whole lines, where a `.meeko` file's code executes:

| Zone (`kind`) | Reason (`reason`)    | Lines                                                                     |
| ------------- | -------------------- | ------------------------------------------------------------------------- |
| `server`      | `server-block`       | A page's `<script server>`.                                               |
| `browser`     | `client-route-block` | A `render: "client"` page's `<script server>`, which runs in the browser. |
| `shared`      | `setup`              | The `<script>` setup, which runs in SSR and during hydration.             |
| `browser`     | `client-page`        | A `render: "client"` page's setup.                                        |
| `browser`     | `continuation`       | Setup from the first browser `await` onward.                              |
| `browser`     | `onMounted`          | The body of each `onMounted` callback.                                    |
| `browser`     | `browser-function`   | A setup function used only from browser code.                             |
| `browser`     | `inline-handler`     | A function written in a template `on:*` occupying its own lines.          |

**Browser functions.** A function declared at the top level of setup (`function guardar() {}` or `const guardar = () => {}`) appears as browser-only when all its uses execute in the browser: as a template `on:*` handler (including on a component), inside `onMounted`, in the continuation after the first browser `await` or from another browser function. Zone hover explains why (for example, only used as an `on:click` handler and in `onMounted`). The function remains shared if it is also called at setup's top level, inside `effect` or `computed`, from a rendered template expression, passed as a child's prop or model, published with `defineExpose` or has a use the analysis does not classify. A handler called during binding (`on:click="crear(guardar)"`) counts as shared use, because on a component it is evaluated during SSR.

**Template handlers.** A function written in an `on:*` whose attribute occupies its own lines, such as a multiline arrow starting at `on:click="() => {` and ending at `}"` (with at most `>` or `/>` after it), also forms a browser zone with the event name in its hover. A function sharing a line with other attributes or template content is not marked.

The template (except those handlers) and styles do not form zones, and zones do not overlap: a more specific zone (a browser function, `onMounted`, a handler) replaces setup's zone on its lines. Analysis is syntactic and works on whole lines; if it cannot classify setup, functions stay in the shared zone. Other clients request them with the custom `meeko/executionZones` request:

```json
// Petición
{ "textDocument": { "uri": "file:///app/pages/index.meeko" } }
// Respuesta
{ "zones": [{ "kind": "server", "reason": "server-block", "label": "…", "detail": "…",
  "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 6, "character": 9 } } }] }
```

`label` is a short title and `detail` a paragraph explanation for a hover. The response is `null` for a document the server does not model.

### Quick fixes

Besides import and `href` actions:

- **Props read only once (`MEEK101`).** “Convert to computed” changes `const upper = props.label.toUpperCase()` to `computed(() => props.label.toUpperCase())` and adds `.value` to each use in the script and template (a shorthand property retains its key: `{ upper }` becomes `{ upper: upper.value }`). Destructuring `const { label, title: heading } = props` becomes one `computed` per name. If you only need the first value, “Read … only once with untrack” declares it with `untrack(() => props.x)`.
- **Add `each:as` (`MEEK022`).** In a list without `each:as`, adds it with the list's singular name (`variants.value` → `variant`) or `item`. It works even if the component does not compile, which is what causes that error.
- **Create a component.** On a tag such as `<AppNuevo bind:title="name.value" />` whose component does not exist, creates `app/components/App/Nuevo.meeko` (inside the longest `app/components` folder matching the name's start, following auto-import naming), with one prop per `bind:`, typed from the value passed by the tag. Offered only if the client supports creating files in a workspace edit (`resourceOperations` with `create`).
- **Double braces (`MEEK020`).** Following Vue habits, `{{ props.label }}` or `{ {props.label} }` in template text reads the inner braces as an object literal. The compiler, `meeko check` and editor report “Meeko interpola con una sola llave: {expr}, no {{expr}}” (Meeko interpolates with single braces) on the entire interpolation. “Convert to {props.label}” fixes it; “Show braces as text” converts it to `{"{ props.label }"}`, as in [an unclosed brace](reference/syntax/interpolation.md#an-unclosed-brace), and is the only option when the inside is not an expression (`{{hola mundo}}`). “Fix all in the file” applies the appropriate action to each. An object literal with keys (`{{ a: 1 }}`) is a valid expression and produces no warning. In VS Code, typing a second `{` before an automatically closed `}` does not open another pair.
- **Add `each:key`.** In a list without a key, suggests `each:key="item.id"` (or another identifying property) or the item itself if it is a string or number.
- **Move the sidecar to `<script server>`.** On the first lines of a page with an adjacent `x.route.ts`, moves its content to a `<script server lang="ts">` block and deletes the sidecar in a single edit. Relative imports keep working because both files share a folder. Offered only if the client supports deleting files in a workspace edit (`workspace.workspaceEdit.documentChanges` and `resourceOperations` with `delete`).

### Attribute, directive, model and snippet completion

In a template attribute name, completion offers the Meeko directives the tag supports: `if:when`, `each:of`, `each:as`, `each:key`, `each:index`, `bind:`, `on:`, `ref:` and `bind` on any tag, including component tags; `html` on elements, `model` on `input`, `textarea` and `select`, and `model:` on components. It does not repeat directives already present on the tag, and after a prefix (`on:`, `model:`) it reopens completion with the child's names.

Like the VS Code HTML and Vue extensions, each attribute is inserted with its value and the cursor inside the quotes (`title="|"`), unless the name already has an `=` after it. On a project component tag (`<AppCard>`, including auto-imported or module components such as `UICard`), completion offers the child's declarations first, with type and JSDoc, followed by directives:

| Child declaration                            | Offered                                            |
| -------------------------------------------- | -------------------------------------------------- |
| `title: string`, `variant?: "a" \| "b"`      | `title="…"`, `variant="…"` (opens its values)      |
| `label?: string \| number`, `unknown`        | `label="…"` and `bind:label="…"`                   |
| `disabled?: boolean`                         | `disabled` (passes `true`) and `bind:disabled="…"` |
| `item: Item` and any other type              | `bind:item="…"`                                    |
| `defineEmits<{ save: […] }>`, `onSelect?: …` | `on:save="…"`, `on:select="…"`                     |
| `defineModel()`, `defineModel("open")`       | `model="…"`, `model:open="…"`                      |

Required props precede optional ones, and props already passed by the tag (as text or with `bind:`) are not repeated. After `bind:`, all props are offered, including text props (`bind:title="todo.title"`); after `on:`, only events, and after `model:`, only named models. Meeko has no JSX-style `prop={expr}` props: the editor never inserts them. Inside the quotes of an empty `bind:`, `on:`, `model`, `if:when` or `each:`, TypeScript expressions are completed, including immediately after typing the opening quote; in a text prop with literal values, those values are offered.

Hover on `html` warns that it inserts unescaped HTML. Since `1.3`, when its value is a `string` (or `any`) without the `TrustedHtml` brand, the editor underlines the entire expression with the `MEEK107` warning, the same as `meeko check`; it disappears when you mark the HTML with `trustHtml(…)` where it is produced (see [Trusted HTML](api.md#trusted-html-trustedhtml-and-trusthtml)).

Completion offers child models after `model:` on a component tag, child snippet names in `<snippet name="…">` and their parameters in `params`.

#### `bind:` on an element

Since `1.8`, when typing `bind` on an HTML element, besides `bind` (an attribute object) and generic `bind:`, each attribute of that tag is offered with `bind:`: `bind:type`, `bind:disabled` and `bind:formaction` on a `<button>`, `bind:href` on an `<a>`, `bind:closedby` on a `<dialog>`, followed by globals (`bind:class`, `bind:style`, `bind:id`…), the remaining globals, `aria-*` and `bind:data-…`. Each inserts `bind:atributo="…"` with the cursor inside, replaces what was typed (`bind:cl`) and shows the expression's expected type in `detail`: `bind:type: 'submit' | 'reset' | 'button'`, `bind:disabled: boolean` or `bind:hidden: boolean | 'until-found' | 'hidden'`, because `true` writes the empty value. Deprecated attributes are struck through. Names, values and documentation come from [Meeko HTML data](#meeko-html-data), with the same attribute table as the compiler. Inside static attribute quotes (`type="…"`, `role="…"`, `aria-pressed="…"`), their values are offered; in a space-separated list such as `role`, only the value being typed is replaced.

#### What the script declares, by directive

Since `1.8`, inside a directive value, TypeScript completion is ordered by what that directive expects. Matching values come first, with their type in `detail` and the path to the value: `name.value` for a signal or `computed`, `props.title` from `defineProps`, `snippets.icon` from `defineSnippets` or `item.id` from a list item. The remaining script and template names follow, and imports and globals come last.

| Where                           | First                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `ref:`                          | Script `useElementRef("…")` names; those without a tag first                                                                          |
| `on:click="…"`, `on:save="…"`   | Functions whose signature accepts the event (`MouseEvent`, `SubmitEvent`, `defineEmits` arguments); parameterless functions afterward |
| `model="…"`, `model:open="…"`   | Writable signals of the control's type (`string` for text, `boolean` for a checkbox) or model type; never a `computed`                |
| `bind:type="…"` on an element   | Attribute values (`'submit'`), then values of its type                                                                                |
| `bind:title="…"` on a component | Values assignable to the prop type                                                                                                    |
| `if:when="…"`                   | Booleans, then optional values (`snippets.icon`)                                                                                      |
| `each:of="…"`, `each:key="…"`   | Lists and iterables (`props.items`, `rows.value`); item fields (`item.id`)                                                            |
| `<render snippet="…">`          | `defineSnippets` snippets; dynamic ones such as `snippets['cell-…']`, with the cursor in the name                                     |
| `{…}`                           | Template and script declarations before imports and globals                                                                           |

An empty value (`model=""`, `{}`, `snippet=""`) is also completed. Refs that do not yet have a tag (of type `never`) are not suggested as values.

#### While typing

An incomplete attribute does not compile, and the diagnostic states what is missing at each step: `bind` without a value indicates both forms (`bind:atributo="expresión"` or `bind="obj"`), `bind:` is marked on itself (not the tag) and asks for the attribute name, and `bind:class` without `=` asks for its value. Each edit rechecks the document; once `bind:class="props.class"` is complete, the diagnostic disappears. A result arriving from an earlier document version is discarded.

### HTML and CSS in the template and in `<style>`

Since `1.2`, the server also understands markup and styles. It reads text without compiling the component, so it works while a tag or rule is incomplete:

- **Template:** tag, HTML attribute (after Meeko directives and excluding `onclick`… handlers, written as `on:click` in Meeko) and attribute value completion (`type="checkbox"`), with MDN documentation on hover. After `on:` on an element, DOM events with descriptions. Component tag attributes come from the child (see [Attribute completion](#attribute-directive-model-and-snippet-completion)), and expression values (`bind:`, `on:`, `if:when`, `each:`…, `{…}`) remain handled by TypeScript.
- **Tags:** opening and closing tags rename together (linked editing, enabled by the VS Code extension with `editor.linkedEditing` in `.meeko`), and the extension closes the tag when you type `>` or `</` (`meeko.autoClosingTags` setting). Other clients request this with `meeko/tagComplete`, which returns a snippet such as `$0</div>`.
- **`<style>`:** property and value completion and hover, CSS diagnostics (`:global(…)` and unknown at-rules are not errors) and the color picker.
- **Classes:** `class="…"` completes project classes (see [CSS class completion](#css-class-completion)), and going to definition leads from a class to its selectors. In `<style scoped>`, a class mentioned by neither the template nor script is marked unused (dimmed, with code `MEEK_UNUSED_CLASS`). Any occurrence of the name counts, including in a `computed` or `classList.add("open")`, and a prefix before interpolation (`` `badge--${tone}` ``) covers all classes starting with it. Classes in `:global(…)` are never marked, because they can reach other components.

### Meeko HTML data

Since `1.8`, tags, attributes and values come from specifications, not a handwritten list. `packages/meeko/scripts/html-data.ts` generates the versioned modules in `packages/meeko/src/shared/html-data/`:

- `tags.ts` and `attribute-names.ts`: names the runtime needs (`<component is>` tags, void elements, per-element attributes for `bind="obj"` and boolean attributes), as short strings.
- `attributes.ts`, `aria.ts` and `events.ts`: details for the compiler and editor, excluded from the browser bundle. Each attribute carries its description, enumerated values (`closedby`: `any`, `closerequest` and `none`), whether it is boolean and whether it is experimental or deprecated; also ARIA states, properties and roles, and `on:` events.

Sources are WHATWG's [HTML Living Standard](https://html.spec.whatwg.org/) (element, attribute and handler indexes, and value definitions), [WAI-ARIA 1.3](https://w3c.github.io/aria/) with DPUB-ARIA and Graphics ARIA, [Referrer Policy](https://w3c.github.io/webappsec-referrer-policy/) and `@mdn/browser-compat-data`, which identifies experimental or deprecated features and adds standard attributes from other specifications (`part`, `exportparts`…). Anything Meeko 1.7 accepted that no longer appears in any specification remains accepted, marked deprecated, to avoid breaking existing code.

To update them:

```sh
pnpm -F @meekojs/meeko html-data            # descarga las especificaciones y regenera
pnpm -F @meekojs/meeko html-data --offline  # sólo regenera desde las instantáneas
```

The download saves extracted data in `packages/meeko/scripts/html-data/*.json`, with the date and commit of each specification, so generation is reproducible without network access. For a new `@mdn/browser-compat-data`, just update the dependency and regenerate. `tests/html-data.test.ts`, included in `pnpm -F @meekojs/meeko test`, fails if a module differs from what the snapshots generate.

### CSS class completion

The server completes class names without depending on another extension (such as “HTML CSS Support”). They are offered in `class="…"`, word by word, and inside `bind:class` string literals (`bind:class="open.value ? 'is-open' : ''"` or template literal text outside `${…}`); TypeScript still handles the rest of the expression. Each class appears once, without repeating ones already in the value, with its source as detail (`este componente`, `Card.meeko`, `main.css (global)`) and, when selected, its defining rule as documentation. Sources, in priority order:

1. **The component's `<style>`**, with or without `scoped`, using editor text even if unsaved. While its CSS cannot be read, the last classes are retained.
2. **Unscoped `<style>` blocks in other project `.meeko` files**, which are global. From another component's `<style scoped>`, only classes inside `:global(…)` count, since they are also global; others are not suggested.
3. **The global stylesheet.** While running, `meeko dev` writes `app/styles/main.css`, already processed by Vite and PostCSS, to `.meeko/styles/main.css`: with `@import` resolved, `@utilities` expanded and whatever plugins such as Tailwind generate. If that file exists, its classes are offered as `main.css (global, procesada)`. `app/styles/main.css` is also always read as-is, with local file `@import` statements (`./tokens.css`, `url(./base.css)`; packages such as `"tailwindcss"` are ignored) and Tailwind 4 `@utility nombre` declarations, without executing PostCSS. Without the processed stylesheet, classes generated only by `@utilities` or Tailwind do not appear until the next `meeko dev` run, and an old processed stylesheet may offer classes that no longer exist until `meeko dev` rewrites it.

Classes are read from nested rules (`&.open`, `.a .b`), `@media` and `@layer`, and arguments of `:is()`, `:where()`, `:not()` and `:global()`. Hover on a class shows its source and rule, and going to definition leads to its selectors in the component, other components' `<style>` blocks and project stylesheets. A class existing only in the processed stylesheet leads to its rule in `.meeko/styles/main.css`: there is no cheap way to know which `@utilities` generated it, and that rule is what reaches the browser.

The index is cached per file: a component is reread when its text changes and a stylesheet when its date or size changes, or when the file watcher (`**/*.css`, including under `.meeko/`) reports a change. While typing, only the edited component's `<style>` is reread; with 300 components and 3000 generated classes, completion responds in a few milliseconds. Since it only reads CSS and never executes project code, it works the same in an untrusted workspace.

### Generic components

In the parent, each tag of a component with `generic` is checked as in `meeko check`: type parameters are inferred from props, and hover, completion and diagnostics for its `on:` handlers, models, snippets and refs use that type (`T = User`). Inside the generic component's script, hover and completion treat each parameter as its constraint, and going to definition on `T` leads to the `generic` attribute; diagnostics are those of `meeko check`, which compiles the component with the actual parameters. The VS Code grammar highlights the `generic` value as a TypeScript type parameter list, including `>` inside a constraint.

### Live values

Live signal values do not pass through the language server: `meeko dev` publishes them through the [editor bridge](devtools.md#editor-bridge), consumed by the VS Code extension (see its [README](../../packages/vscode/README.md#valores-en-vivo)). Each `meeko dev` writes its own descriptor, `.meeko/dev/editor-bridge-<puerto>.json`, and the extension connects to all it finds, so multiple development servers work simultaneously. A signal that is the same as another, such as a model a child receives with `defineModel`, carries the `alias` field with the primary signal: the extension displays it as `open = true (= dialogOpen)`, its hover says “alias de `dialogOpen`” (alias of `dialogOpen`) and editing it edits the primary. Another editor can read the same bridge, bearing in mind that its protocol is development-only and outside the public contract.

A `meeko dev` started with `MEEKO_EDITOR_BRIDGE=0` (in the shell or project `.env`), or listening on a specific non-loopback address, writes no descriptor. Since `1.7.1`, it says so after the URL (`Valores en vivo del editor desactivados (MEEKO_EDITOR_BRIDGE=0)`) and records it in `.meeko/dev/server.json`, with `editorBridge: false` and the reason in `editorBridgeReason`. While that process remains running, the extension shows “Meeko live: desactivado en meeko dev” (disabled in meeko dev) in the status bar, with the reason and activation instructions in the tooltip, instead of “disconnected”. To restore live values, remove `MEEKO_EDITOR_BRIDGE=0` and restart `meeko dev`.

## Start the server

The server comes in the `@meekojs/meeko` package. Install it as a project dependency so the editor uses the same version as the compiler:

```powershell
pnpm add -D @meekojs/meeko
```

There are two equivalent ways to start it; both speak JSON-RPC over standard input and output:

```powershell
meeko lsp --stdio
meeko-language-server --stdio
```

From the project root, `npx meeko-language-server --stdio` (or `pnpm exec meeko-language-server --stdio`) uses the binary in `node_modules/.bin`. Besides `--stdio`, the server accepts `--node-ipc`, `--socket=<puerto>` and `--pipe=<nombre>`. Without a transport it exits with code 1 and displays usage. It requires Node.js 24 or later.

The server recognizes components by the `.meeko` extension in their path; the editor's `languageId` does not matter. Simply associate `.meeko` files with a custom file type (or HTML) and launch the server for that type.

### Initialization options

Sent in `initializationOptions` of the `initialize` request. All are optional.

| Option             | Default | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trusted`          | `true`  | With `true`, the server runs the project's `meeko.config.*` with Node, including its [modules'](framework.md#modules) `setup`, to discover auto-imports, components and layers, and checks page and layout contracts on save. With `false`, it executes no project code: configuration is read statically (only literal lists; from `modules`, only layer folders), so module auto-imports and components do not exist for the editor, and contracts are skipped. |
| `projectContracts` | `true`  | `false` disables page contract checking (`MEEK_PAGE_PROPS`, `MEEK_LAYOUT_PROPS`, `MEEK_ERROR_PROPS`) on save.                                                                                                                                                                                                                                                                                                                                                     |
| `diagnosticsDelay` | `300`   | Milliseconds to wait after an edit before checking the component.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `format`           | `{}`    | Formatting settings for clients without `workspace/configuration`, for example `{ "indentSections": true }`. If the client supports that request, its `meeko.format` section takes precedence.                                                                                                                                                                                                                                                                    |

Outside VS Code, `trusted` is `true` because the user configures the server for their project, just as `meeko check` executes configuration. Use `trusted: false` when opening third-party code. The VS Code extension sends the workspace trust state.

### Formatting with Prettier

The server formats `.meeko` with [Prettier](https://prettier.io) and the Meeko plugin (`@meekojs/meeko/prettier`), so the editor, Prettier CLI and CI give the same result:

- **Script, style and template.** `<script>` and `<script server>` are formatted as TypeScript and `<style>` as CSS (or SCSS/Less according to `lang`). The template is formatted as HTML: long attributes go one per line, PascalCase tags and self-closing syntax are respected, and the values of `bind:`, `bind` (since 1.5), `on:`, `if:when`, `each:of`, `each:key`, `model`, `<component is>` and `<render>`, and `{expr}` text are formatted as TypeScript expressions. An expression Prettier does not understand stays unchanged. `<!-- prettier-ignore -->` excludes the next node.
- **Arrays like objects.** With `meekoPreserveArrayBreaks` (default `true`), an array, destructuring pattern (`const [a, b] = …`) or TypeScript tuple with a line break between `[` and its first element in the code is printed expanded, one element per line (number arrays are distributed over lines, as Prettier does when breaking them). Without a break there, Prettier decides, keeping it on one line if it fits `printWidth`. This is the `objectWrap: "preserve"` rule for objects: to collapse an array, just join `[` and the first element and format again. Comments and holes (`[, a]`) between `[` and the first element count toward the break, and an empty array is not forced. With `"meekoPreserveArrayBreaks": false`, output is exactly Prettier's.
- **Normalized `class` attribute.** Since 1.3, each static `class="…"` value on an element is always normalized, without an option, as Prettier does with standalone HTML: leading and trailing whitespace is removed, any sequence of spaces, tabs or line breaks becomes one space, and duplicate classes are removed (keeping the first). Only ASCII whitespace separating HTML classes counts as a separator; a nonbreaking space is part of the class. `class="  "` becomes `class=""` and `<p class>` is unchanged. `bind:class` and other directives, other attributes, `class` on a component tag (`<Card class="…">` or `<component is>`, where it is a [static prop](api.md#static-props)), and values with character references (`&amp;`) are untouched. Meeko static attributes do not interpolate `{expr}`: their value is literal text, so the change does not alter the element's classes.
- **Class ordering.** `meekoSortClasses` orders these same classes: `"off"` (default) retains their order, `"alphabetical"` orders by character code (`B` before `a`, independent of language) and `"stylesheet"` follows the project's global stylesheet, as `prettier-plugin-tailwindcss` follows Tailwind's. See [Ordering by the global stylesheet](#ordering-by-the-global-stylesheet). Since `1.8`, with an order chosen it also applies to the `class` of a component tag and to the strings of `bind:class`, and `meekoClassFunctions` names the functions whose strings are classes (`["tv", "clsx", "cn"]`). Saving in the editor gives the same as `@meekojs/prettier-plugin` on the CLI, so `prettier --check` passes after saving.
- **Which Prettier is used.** In a trusted workspace, if the project has `prettier`, that Prettier is used with its configuration (`.prettierrc`, `.editorconfig`, plugins). Otherwise, Meeko's bundled Prettier is used with editor options (`tabSize`, `insertSpaces`) and `meeko.format.indentSections`; project configuration takes precedence over both. In an untrusted workspace, the bundled version is always used without reading project configuration, because loading it executes code.
- **`.prettierignore` and `.gitignore`.** Since 1.8, files they exclude are not formatted, either on save with `editor.formatOnSave` or with Format Document: the server returns no edits, like the Prettier CLI. It searches for these files in the `.meeko` folder and its ancestors up to the repository root (the folder with `.git`), so both root and subproject files apply, and each pattern is relative to its file's folder. They are also respected in an untrusted workspace, since only their patterns are read. This is how you preserve a single-line template where spaces between tags are text: add the file to `.prettierignore`.
- **Limits.** Only the whole document is formatted, not a range. A file that does not compile is not formatted.

To format from the CLI or in CI, add the plugin to the project's Prettier configuration:

```json
{ "plugins": ["@meekojs/meeko/prettier"], "meekoIndentSections": false }
```

```sh
npx prettier --check "app/**/*.meeko"
```

`meekoPreserveArrayBreaks` is not limited to `.meeko`: the plugin replaces Prettier's `estree` printer, so with the plugin in project configuration, the rule applies to all JavaScript and TypeScript Prettier formats (`.ts`, `.js`, `.tsx`, `.mjs`…), `.meeko` scripts and template expressions (`bind:`, `each:of`, `{expr}`…), with the `typescript`, `babel` and `babel-ts` parsers. During formatting, that printer delegates everything to the `estree` printer of the Prettier running it (the project's CLI and Prettier extension, or the Prettier bundled with the Meeko extension if the project has none): the rest of formatting belongs to that version even if it differs from the one `@meekojs/meeko` installs, and with `false` the output is exactly that Prettier's. If another configured plugin also replaces `estree`, Prettier only uses the last in `plugins`: if that is the other plugin, `meekoPreserveArrayBreaks` has no effect; if it is Meeko's, it wraps the other plugin's printer, which keeps printing everything else. The language server has no separate setting for this option: disable it in the project's Prettier configuration, which the Prettier extension also reads for `.ts` files.

#### Ordering by the global stylesheet

With `"meekoSortClasses": "stylesheet"` (on the CLI, `--plugin @meekojs/meeko/prettier --meeko-sort-classes stylesheet`; the CLI only recognizes the option if the plugin is passed with `--plugin`), each class takes the position of its first appearance in a global stylesheet selector, then in the component's `<style>` (with or without `scoped`), in order: component classes count as defined after global ones. Classes absent from both come first in their original order, followed by known classes by position. With `.stack` before `.card` in the stylesheet, `class="extra card stack"` becomes `class="extra stack card"`.

- **Which stylesheet.** `app/styles/main.css` from the project root: the first folder, moving up from the file, with `meeko.config.*` or a `package.json` having `@meekojs/meeko` in `dependencies` or `devDependencies` (the same criterion as `meeko clean`). It is processed with the Vite API (`resolveConfig` and `preprocessCSS`, with the Vite resolved by the project), as in `meeko dev`: using the project's `postcss.config.*`, resolving `@import` and expanding `meekoUtilities()` `@utilities`. Vite configuration added by `meeko.config.ts` modules is not applied.
- **Determinism.** The result does not depend on `meeko dev` running: the plugin processes the stylesheet itself, so editor, CLI and CI order identically with the same files.
- **Cache.** The processed stylesheet is reused throughout the process (one CLI run, the language server) while modification dates and sizes of `main.css`, its imports, `@utilities` modules and their imports, and root PostCSS configuration files remain unchanged. When any changes, the next format processes it again. Prettier's own cache (`prettier --cache`, disabled by default) does not know about the stylesheet: after changing it, run the CLI without `--cache` or delete that cache.
- **Without a stylesheet.** If the project cannot be found, `app/styles/main.css` is missing or processing fails, classes are not ordered (only normalized) and formatting continues. A warning appears once per project on stderr (`[meeko] Aviso: meekoSortClasses "stylesheet" no ordena las clases: …`), never on stdout where the CLI writes code. A failed stylesheet is retried when one of its files changes or, at most, two seconds later.
- **Untrusted workspaces.** Processing the stylesheet executes project code (PostCSS configuration and `@utilities` modules). The Prettier CLI already executes project code when loading configuration; in VS Code, in an untrusted workspace the server does not read that configuration and forces `"off"`: normalization only.
- **Performance.** In a real project with two `@utilities` modules and eight `@import` statements, the first stylesheet processing takes about 220–260 ms (loading Vite and included modules); each subsequent format only checks file dates, around 1.5–2 ms.

### Editor settings

The server requests the `meeko.format` section with `workspace/configuration` on every format, so changes apply without restarting. Clients without that request can send `format` in initialization options or `{ "meeko": { "format": { ... } } }` with `workspace/didChangeConfiguration`.

| Setting                       | Default | Effect                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meeko.format.indentSections` | `false` | Indents each section's content (`<script>`, `<script server>`, `<template>` and `<style>`) by one level, like Prettier's `vueIndentScriptAndStyle` plus the template. With `false`, formatting removes that base indentation. The level uses `tabSize` or a tab according to `insertSpaces`. Equivalent to the plugin's `meekoIndentSections` option; if set in the project's Prettier configuration, it takes precedence. |

In each editor, place the setting in the server's settings object as `settings.meeko.format.indentSections`; each section's examples show this.

### What the server reads

- The package root's `tsconfig.json` (the nearest folder with `package.json`) defines hover, completion and navigation options, such as `paths` aliases. `meeko check`, and therefore editor diagnostics, use the same resolution options (`paths`, `baseUrl`, `types`, `typeRoots`, `customConditions`, `resolveJsonModule`, `allowImportingTsExtensions`) and retain its strict type flags.
- An import of a project `.meeko` resolves to the component as it is in the editor, including unsaved changes, even if its generated `.d.meeko.ts` declaration exists (beside it or in `.meeko/types`), which TypeScript would choose first with `NodeNext` resolution.
- Uses of a symbol marked `@deprecated` in its JSDoc, such as the `useSocket` alias from `@meekojs/meeko/framework`, are published as struck-through hints (`DiagnosticTag.Deprecated`, codes `TS6385` and `TS6387`) with the tag's reason. Hovers display `{@link X}` as the code name, its text or a link.
- To detect saved changes to `.ts`, `.css`, `tsconfig*.json` and `meeko.config.*` files, the server registers watchers with `workspace/didChangeWatchedFiles` when the client supports dynamic registration. If your editor does not, reopen the component or restart the server after changing an imported module. Since `1.4`, it also watches folder creation and deletion under `app/`, `server/` and `shared/`, because when creating, moving or renaming a folder the editor may report only the folder, not each `.meeko` inside.
- `<script>` completion does not offer virtual code helper types (`__MeekoEmit`, `__MeekoDeclaredProps`…), which also stay out of hover and go to definition. From `@meekojs/meeko`, it only suggests public `exports` entries (except `internal`): a name exported by an entry is imported from it (`import { MeekoModule } from "@meekojs/meeko/framework"`), including when linked with `link:`, which TypeScript resolves outside `node_modules` and would otherwise suggest relative paths to its files; a name exported by no entry is not suggested. Package exports are ordered after local names and project auto-imports. A project auto-import (an export of `app/utils`, `shared/types`…) completes without an import, with its file as detail, as in the build: even if its file is not in the TypeScript program or a DOM global has the same name (`navigation`). Relative imports written by the editor (completion, Add import, ambiguous auto-import) have no extension (`./settings/context`), unless `tsconfig.json` uses `moduleResolution` `node16` or `nodenext`, which requires one (`./settings/context.js`).

### Project checking

In a trusted workspace, unless `projectContracts: false`, the server generates component declarations and checks page, layout and error page contracts (`MEEK_PAGE_PROPS`, `MEEK_LAYOUT_PROPS`, `MEEK_ERROR_PROPS`), like `meeko check`. Since `1.4`:

- **When.** Repeated with a 450 ms delay when opening a page or layout and on saving, creating, deleting or renaming any `.meeko`, TypeScript module, configuration or application folder (including a new folder such as `app/components/Layout`), and when closing an edited component without saving. Changes in `.meeko/` and `node_modules` do not trigger it.
- **Which text.** Open components use their unsaved text, like their own diagnostics; others use saved text.
- **Incomplete components.** A component that does not compile does not stop checking the rest: it keeps its last declaration and its error appears in that file (if open, in its own diagnostics, without duplication). An empty `.meeko`, such as one created when adding a file, is treated as being edited and produces no checking error.
- **Failures.** If checking fails for another reason, `MEEK_PROJECT_CHECK` appears in only one file: the one that does not compile, the one triggering it or, otherwise, an open project component. Each check replaces all diagnostics from the previous one, including that failure, so a fixed error disappears in the next check.

## Neovim

With Neovim 0.11 or later and [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig), declare the file type and server in your `init.lua`:

```lua
vim.filetype.add({ extension = { meeko = "meeko" } })

vim.lsp.config("meeko", {
  cmd = { "npx", "meeko-language-server", "--stdio" },
  filetypes = { "meeko" },
  root_markers = { "package.json", "tsconfig.json" },
  init_options = { trusted = true },
  settings = { meeko = { format = { indentSections = true } } },
})
vim.lsp.enable("meeko")
```

`npx` resolves the project binary when Neovim is opened inside it. For syntax highlighting without a dedicated tree-sitter grammar, you can reuse HTML with `vim.treesitter.language.register("html", "meeko")`; the server's semantic tokens color TypeScript expressions in the script and template.

## Helix

In `languages.toml` (global or the project's `.helix/languages.toml`):

```toml
[language-server.meeko]
command = "npx"
args = ["meeko-language-server", "--stdio"]
config = { trusted = true }

[[language]]
name = "meeko"
scope = "source.meeko"
file-types = ["meeko"]
roots = ["package.json", "tsconfig.json"]
grammar = "html"
block-comment-tokens = { start = "<!--", end = "-->" }
language-servers = ["meeko"]
```

Helix sends the `config` table as `initializationOptions` and uses it to answer `workspace/configuration`. For editor settings, add the `meeko` table to `config`:

```toml
[language-server.meeko]
command = "npx"
args = ["meeko-language-server", "--stdio"]
config = { trusted = true, meeko = { format = { indentSections = true } } }
```

`hx --health meeko` confirms it finds the server.

## Zed

Zed only associates language servers with languages declared by an extension, and there is no published Meeko extension yet. You can install a local extension with **zed: install dev extension** containing:

- `extension.toml` with `[language_servers.meeko-language-server]`, `name = "Meeko Language Server"` and `languages = ["Meeko"]`, plus the `html` grammar in `[grammars.html]`;
- `languages/meeko/config.toml` with `name = "Meeko"`, `grammar = "html"`, `path_suffixes = ["meeko"]` and `block_comment = ["<!-- ", " -->"]`, with `highlights.scm` queries copied from the HTML language;
- `src/lib.rs` returning the server command:

```rust
use zed_extension_api as zed;

struct Meeko;

impl zed::Extension for Meeko {
    fn new() -> Self {
        Meeko
    }

    fn language_server_command(&mut self, _id: &zed::LanguageServerId, worktree: &zed::Worktree) -> zed::Result<zed::Command> {
        let command = worktree
            .which("meeko-language-server")
            .ok_or("meeko-language-server is not on PATH; install @meekojs/meeko")?;
        Ok(zed::Command { command, args: vec!["--stdio".into()], env: Default::default() })
    }
}

zed::register_extension!(Meeko);
```

You can set initialization options in `settings.json` without recompiling:

```json
{
	"lsp": {
		"meeko-language-server": {
			"initialization_options": { "trusted": true },
			"settings": { "meeko": { "format": { "indentSections": true } } }
		}
	}
}
```

Zed only answers `workspace/configuration` with `settings` if the extension implements `language_server_workspace_configuration` (for example, returning `LspSettings::for_worktree("meeko-language-server", worktree)?.settings`). Without that method, use `"initialization_options": { "trusted": true, "format": { "indentSections": true } }`.

## JetBrains (LSP4IJ)

JetBrains IDEs connect through the [LSP4IJ](https://plugins.jetbrains.com/plugin/23257-lsp4ij) plugin:

1. Install LSP4IJ and open **Settings → Languages & Frameworks → Language Servers**; click **+** to create a server.
2. In **Server**, use name `Meeko` and command `npx meeko-language-server --stdio` (on Windows, `npx.cmd meeko-language-server --stdio`).
3. In **Mappings → File name patterns**, add `*.meeko` with language identifier `meeko`.
4. In **Configuration → Initialization Options**, enter `{ "trusted": true }`, and in **Configuration → Server / Configuration** enter editor settings, for example `{ "meeko": { "format": { "indentSections": true } } }`.

For syntax highlighting, register the VS Code extension's TextMate grammar in **Settings → Editor → TextMate Bundles**, pointing to the repository's `packages/vscode` folder or an unpacked VSIX extension.

## Sublime Text

With the [LSP](https://lsp.sublimetext.io/) package and Sublime Text 4, first create a syntax inheriting HTML in `Packages/User/Meeko.sublime-syntax`:

```yaml
%YAML 1.2
---
name: Meeko
scope: text.html.meeko
version: 2
extends: Packages/HTML/HTML.sublime-syntax
file_extensions:
  - meeko
contexts: {}
```

Then add the client in **Preferences → Package Settings → LSP → Settings**:

```json
{
	"clients": {
		"meeko": {
			"enabled": true,
			"command": ["npx", "meeko-language-server", "--stdio"],
			"selector": "text.html.meeko",
			"initializationOptions": { "trusted": true },
			"settings": { "meeko.format.indentSections": true }
		}
	}
}
```

## Limitations

- Only the package root's `tsconfig.json` is considered; nested tsconfigs or those referenced through `references` do not change analysis.
- Renaming and references spanning `.meeko` files start from a `.meeko`. From a `.ts`, the editor's TypeScript server responds, which does not know about components.
- The semantic model needs syntactically closed sections. While typing an incomplete file, diagnostics continue arriving, but completion and navigation may pause until it becomes valid again.
- A project with more than 2000 `.meeko` components only loads the first 2000 for cross-file references and renaming.

## Tailwind CSS

Install the official **Tailwind CSS IntelliSense** extension (`bradlc.vscode-tailwindcss`) and configure Tailwind in the project. That extension provides Tailwind utilities, variants, values and documentation; Meeko provides component analysis and CSS classes written in their `<style>` blocks and `app/styles/main.css`, including local imports.

Meeko Language automatically registers `tailwindCSS.includeLanguages: { "meeko": "html" }` and enables `editor.quickSuggestions.strings` for `[meeko]`. These are VS Code defaults: they respect your explicit settings and do not write to `settings.json`. [VS Code documents `configurationDefaults` for other registered settings](https://code.visualstudio.com/api/references/contribution-points#contributes.configurationDefaults).

`meeko.classes.completion` controls Meeko class completion and hover:

- `auto` (default): if Tailwind IntelliSense is active and the project declares `tailwindcss` as a dependency or imports it from source stylesheets, delegates classes from the processed `.meeko/styles/main.css` stylesheet to Tailwind. Retains classes written in components and source stylesheets.
- `on`: also includes classes from the processed stylesheet.
- `off`: disables Meeko class completion and hover. Definition navigation and CSS variables remain available.

Strings in `bind:class="active.value ? 'bg-blue-500' : 'bg-gray-500'"` receive class suggestions; you do not need to add `bind:class` to `tailwindCSS.classAttributes`, because the default `class` attribute recognizes the `:` prefix. Meeko also retains TypeScript analysis of the expression.

For functions such as `clsx` and `cn` inside `<script>`, configure the functions your project actually uses:

```json
{
	"tailwindCSS.classFunctions": ["clsx", "cn"]
}
```

Meeko detection reads the component's package manifest and indexed source stylesheets, without executing CSS plugins. It does not classify the processed stylesheet individually: in `auto`, it also delegates its third-party classes without an indexed source definition. In other LSP clients, communicate `meeko.classes` through `workspace/configuration` (or `initializationOptions.classes`), including `tailwindActive: true` if the client has an active Tailwind provider.

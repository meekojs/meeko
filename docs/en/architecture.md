---
source-hash: c4b4eed364adaceff064ef4a8ff6b644f7e73065ca42f911a2c5f82e5f9b8edc
---

# Meeko architecture

**Scope:** architecture of this checkout (`1.8.0`); npm publishes `1.9.0` as of November 5, 2026. Check later implementation details against the corresponding version's source code.

## Goal

Meeko compiles `.meeko` files to TypeScript code with `renderWithState(props)` or `renderToString(props)` for SSR and `hydrate(root, props, state?)` to connect events and signals to the existing DOM. The browser runtime avoids a virtual tree and updates the nodes affected by each signal.

## Current contract

1. `<script lang="ts">` declares types, imports and state. `defineProps<Props>()` is a compile-time macro. In a page, `<script server lang="ts">` declares route options; the compiler excludes it from the component and Vite serves it as a separate module (`<página>.meeko?meeko-route&lang.ts`), only on the server except for `render: "client"` routes.
2. `<template>` defines HTML, text expressions `{expression}`, events `on:event="handler"`, dynamic attributes `bind:name="expression"`, `if:when` conditions and `each:of` lists with mandatory keys.
3. `<style>` is optional. `scoped` adds a stable attribute to elements and CSS selectors; with `css.scopeAttribute: "matched"`, only to elements those selectors can match (see [Scoped styles](api.md#scoped-styles-and-global)).
4. The server escapes dynamic text and inserts markers for reactive expressions.
5. The application transfers props and state from `renderWithState` to the browser as escaped JSON. Each nested child carries its state inside its opening marker. During `hydrate`, Meeko restores signals, finds markers, checks existing text, connects events and creates observers. The returned function disposes of these resources.

The `examples/counter` example exercises the contract in an HTTP server. Each call to `hydrate` claims a component root; multiple calls on independent roots keep their signals and events isolated. Imported children use `hydrateScope` on comment ranges: this allows nesting without wrapper elements and prevents their markers from being confused with the parent's.

## Responsibility boundaries

| Part                | Responsibility                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Parser              | Parse sections, templates and expressions while preserving original positions.                                                |
| Compiler            | Validate syntax and produce typed modules for SSR and hydration.                                                              |
| Reactive runtime    | Track dependencies, batch updates and dispose of observers per instance.                                                      |
| Browser runtime     | Claim existing nodes, connect events and apply precise changes.                                                               |
| Tooling integration | Display diagnostics in `.meeko`, transform files in Vite and maintain HMR.                                                    |
| Framework           | Routes, pages, rendering modes, navigation and API/RPC/Socket clients (`src/framework`).                                      |
| Server core         | Portable application on Web APIs: runtime, contracts, sessions, middleware and Socket (`src/framework-server`).               |
| Adapters            | Connect the core to Node, Bun, Deno and Cloudflare Workers (`src/node.ts`, `src/bun.ts`, `src/deno.ts`, `src/cloudflare.ts`). |

The [framework guide](framework.md) describes the framework, server and adapters.

The section parser lives in `src/compiler/parser/sfc.ts`; `src/compiler/parser/template.ts` builds its own HTML AST. Both preserve start and end boundaries in the original file. The generator in `src/compiler.ts` uses these positions for syntax errors and returns mapping segments for the script and expressions. `src/check.ts` checks the module using TypeScript 7 and presents errors in the original `.meeko`. An error in generated helper code without a segment is identified as such and placed at the beginning of the file to avoid assigning it a false location.

### Compiler: expressions, CSS and generation

`src/compiler.ts` retains SSR and hydration orchestration and the public `compile` contract. Two steps have their own internal modules:

- `compiler/expressions.ts`: expression validation, free names, narrowing conditions and local rewriting. When replacing a snippet parameter or a list row, it preserves the original segments with `markSource`; extracting it does not change the source a diagnostic receives.
- `compiler/transforms/scoped-css.ts`: selector transformation, `:global(...)`, keyframe exclusion and calculation of the elements to which the scope attribute applies. It retains PostCSS locations so the orchestrator can map them to the `.meeko`.

These modules are not new public package entry points. Snippet, narrowing, style and mapping tests check the same observable behavior across the three steps.

### Browser: payload, streaming and confirmation

`app/runtime/client.ts` coordinates the application, layouts and route commit. `client-payload.ts` validates the hydration payload and its version before modifying the tree. `client-deferred.ts` groups deferred chunk validation, queuing until the page has mounted, ndjson reading, timeouts and browser loader cancellation.

Committing the DOM, head, shared state, layouts and CSRF token remains an orchestrator operation. Transport helpers cannot commit a route or touch history. View Transitions wraps that commit after preparing modules and data; it does not wrap page loading. Streaming and navigation tests verify that an aborted route does not overwrite the new one and that a failure preserves the previous view.

Performance limits and the reproducible scenario are described in [Performance](performance.md).

The runtime in `src/dom.ts` uses comments as boundaries for conditions, lists and child components. A list checks keys during SSR and hydration; when it changes, it moves the node ranges of existing keys. Each list item keeps signals for its data and index, so reactive expressions and strict comparisons read current values. Removing a region disconnects its events and observers.

`<MeekoTeleport>` (since `1.5`, `src/teleport.ts`) compiles its content into the component template, like a condition's content, and encloses it between `<!--meeko:portal…-->` and `<!--/meeko:portal…-->`. In a server document, `renderTeleport` passes the content to a collector and leaves a reference in its place (`<!--meeko:portal-ref:clave-->`); `src/framework/teleports.ts` then places it in the final HTML, inside the element with that `id` or after the application, so the target can render before or after it. During hydration, `bindTeleport` follows the reference to the content, hydrates it in the declaring component and moves those same nodes when `to` or `disabled` changes. Marker searches skip `meeko:portal` ranges, so teleported content is never confused with the markers of the component containing its target. Without a collector (a browser render or outside the framework), content renders in place and the browser moves it after mounting.

`<component is>` with an HTML tag (since `1.5`) is compiled according to the possible results of `is`, which the compiler reads from syntax (`src/compiler/transforms/dynamic-tag.ts`): if all are literals, it is an element without markers whose children belong to the surrounding template; if any can be a component, the element sits between the component range comments and its content is the `default` snippet. `src/dynamic-tag.ts` checks the tag before writing HTML, in SSR and the browser, and types the tag union, its attributes and `bind="obj"`; `src/html-attributes.ts` copies HTML data from `vscode-html-languageservice`, from which the compiler writes the list of tags that support each non-global attribute beside that attribute. When the tag changes, `bindElementTag` and `bindDynamic` create the new element, move its children with their nodes and rebind only the element's own bindings; child bindings remain alive. `bindSpread` writes and removes `bind="obj"` attributes.

The `src/vite.ts` plugin uses the same compiler for the client and SSR and exposes CSS as a virtual module. In development, each component accepts its own HMR updates: `src/hmr.ts` captures writable signals per instance, renders the new version, hydrates its existing root or range and updates styles. A runtime update reloads the page.

Generated modules import the runtime from `@meekojs/meeko/internal`. This path groups the DOM, SSR, HMR and DevTools functions the compiler needs and is versioned alongside it. Since `1.5`, a component using `<MeekoThemeToggle>`, `<MeekoAwait>`, `<MeekoPopover>` or `<MeekoSelect>` also imports its compiled module (`@meekojs/meeko/builtins/theme-toggle`, `/await`, `/popover` or `/select`), and only that component does so: the compiler's `builtinComponentModules` table maps each tag to its module, and `scripts/builtin-components.ts` compiles its `.meeko` inside the package. A new built-in tag follows this pattern to avoid growing the runtime of every application. In development, `src/devtools.ts` registers hydrated instances and exposes a read hook shared by the integrated panel and the Chrome extension. Neither SSR nor the production build registers instances in that hook.

Since core `1.8`, `<MeekoPopover>`, `<MeekoSelect>` and `<MeekoThemeToggle>` are deprecated: the compiler emits `MEEK121` and the editor strikes through the tag and explains its replacement on hover. They keep working in `1.x` and are removed in `2.0`. Use `UIPopover`, `UISelect` and `UIThemeToggle` from the `@meekojs/ui` 1.8 module; the theme system remains in core. See [Migration to 1.8](migration-1.8.md).

## SSR rules

- Each request must create its own state. Signals containing user data are not shared between requests.
- Dynamic HTML is escaped before insertion. Initial JSON is escaped so it cannot close its `<script>` tag.
- Expressions affecting the initial HTML must produce the same value on the server and in the browser; `renderWithState` transfers writable signals when their initial value is nondeterministic. A difference is a hydration error.
- Marker IDs are local to each component and searched only inside its root or comment range.
- Lists require stable keys to preserve nodes and state when reordering.

## TypeScript

The project uses stable TypeScript 7.0.2 for compilation and type checking. The script parser temporarily uses `@typescript/typescript6`, isolated as a compiler dependency, because TypeScript 7.0 does not expose a stable programmatic API. The generated module is checked with TypeScript 7. `meeko types` emits `.d.meeko.ts` declarations so a consumer with `allowArbitraryExtensions` can check imports and props. The language server in `src/language-server` uses source mappings and a virtual TypeScript document to provide diagnostics and semantic operations on `.meeko`. It is used by the VS Code extension and [other editors](editors.md).

## Boundary between runtime and tools

The browser bundle only includes modules used by the application; [measurements](benchmarks.md) record its compressed size separately. Installing `@meekojs/meeko` does include the compiler, TypeScript 7, the TypeScript 6 parser, parse5 and PostCSS because the CLI and Vite plugin belong to the same package. Installation cost and served JS size are distinct metrics.

In the 1.x series, Meeko is published as a single package. Generated code and `@meekojs/meeko/internal` must have exactly the same version, and `meeko init` pins that exact version in the projects it creates. Separating compiler and runtime would add a second version to coordinate in every build, without a measured benefit to justify it. The [stability policy](stability.md#a-single-package) records this decision. If installation cost makes splitting the package advisable in the future, the split would retain a compatibility path for already compiled `.meeko` modules and include consumer tests against published packages.

---
source-hash: 7f3548bb5d3bc51b74408deea03bcbf9c8fa782154304657aa3bdd0be82b5d3b
---

# Meeko

<p align="center">
  <img src="https://raw.githubusercontent.com/meekojs/meeko/main/assets/brand/meeko-logo.png" alt="Meeko's face: a blue-eyed kitten with dark ears and cream fur" width="200" />
</p>

This project is dedicated to my kitten Meeko. Her face inspires the logo that accompanies it.

**Meeko** is a component engine for TypeScript and a full-stack framework. `.meeko` files combine typed logic, template and styles. The compiler produces HTML for SSR and, during hydration, connects reactivity to the existing HTML.

The code is distributed under the [MIT license](https://github.com/meekojs/meeko/blob/main/LICENSE). The public package is called `@meekojs/meeko`; the CLI is invoked as `meeko` and the Vite plugin is imported from `@meekojs/meeko/vite`.

Since 1.0, Meeko follows SemVer. The [stability policy](https://github.com/meekojs/meeko/blob/main/docs/en/stability.md) defines what public API is: subpaths, CLI, file conventions and network formats. It also sets how an API is deprecated and which environments are supported. The [migration guide](https://github.com/meekojs/meeko/blob/main/docs/en/migration-1.0.md) explains how to upgrade from `0.1.0`, and [Upgrade from 1.0 to 1.1](https://github.com/meekojs/meeko/blob/main/docs/en/migration-1.1.md) covers the behavior changes in `1.1`; [Upgrade from 1.1 to 1.2](https://github.com/meekojs/meeko/blob/main/docs/en/migration-1.2.md), those in `1.2`; [Upgrade from 1.2 to 1.3](https://github.com/meekojs/meeko/blob/main/docs/en/migration-1.3.md), those in `1.3`; [Upgrade from 1.3 to 1.4](https://github.com/meekojs/meeko/blob/main/docs/en/migration-1.4.md), those in `1.4`, and [Upgrade from 1.4 to 1.5](https://github.com/meekojs/meeko/blob/main/docs/en/migration-1.5.md), those in `1.5`.

- [Architecture and contracts](https://github.com/meekojs/meeko/blob/main/docs/en/architecture.md)
- [Component engine API](https://github.com/meekojs/meeko/blob/main/docs/en/api.md)
- [Full-stack applications with Meeko](https://github.com/meekojs/meeko/blob/main/docs/en/framework.md)
- [Typed registry and lazy loading of components](https://github.com/meekojs/meeko/blob/main/docs/en/reference/components/componentregistry.md)
- [i18n module](https://github.com/meekojs/meeko/blob/main/docs/en/i18n.md)
- [1.x stability policy](https://github.com/meekojs/meeko/blob/main/docs/en/stability.md)
- [Migrate from 0.1.0 to 1.0](https://github.com/meekojs/meeko/blob/main/docs/en/migration-1.0.md)
- [Upgrade from 1.0 to 1.1](https://github.com/meekojs/meeko/blob/main/docs/en/migration-1.1.md)
- [Upgrade from 1.1 to 1.2](https://github.com/meekojs/meeko/blob/main/docs/en/migration-1.2.md)
- [Upgrade from 1.2 to 1.3](https://github.com/meekojs/meeko/blob/main/docs/en/migration-1.3.md)
- [Upgrade from 1.3 to 1.4](https://github.com/meekojs/meeko/blob/main/docs/en/migration-1.4.md)
- [Upgrade from 1.4 to 1.5](https://github.com/meekojs/meeko/blob/main/docs/en/migration-1.5.md)
- [Upgrade from 1.5 to 1.6](https://github.com/meekojs/meeko/blob/main/docs/en/migration-1.6.md)
- [Upgrade from 1.6 to 1.7](https://github.com/meekojs/meeko/blob/main/docs/en/migration-1.7.md)
- [Editors and language server](https://github.com/meekojs/meeko/blob/main/docs/en/editors.md)
- [Roadmap](https://github.com/meekojs/meeko/blob/main/docs/en/roadmap.md)
- [Reproducible comparison with Vue](https://github.com/meekojs/meeko/blob/main/docs/en/benchmarks.md)
- [DevTools for debugging components](https://github.com/meekojs/meeko/blob/main/docs/en/devtools.md)
- [SSR pilot application](https://github.com/meekojs/meeko/blob/main/packages/meeko/examples/pilot/README.md)
- [Publishing and checks](https://github.com/meekojs/meeko/blob/main/docs/en/releasing.md)
- [Changelog](https://github.com/meekojs/meeko/blob/main/packages/meeko/CHANGELOG.md)
- [Contributing guide](https://github.com/meekojs/meeko/blob/main/CONTRIBUTING.md)

## Requirements

- Node.js 24 or later for the CLI, the build, Vite and the language server. In this repository it is managed with `mise`.
- `pnpm` to develop this repository.
- TypeScript **7.0.2 stable** to compile and type-check. `@typescript/typescript6` is used only as a syntax parser for the `.meeko` format, because TypeScript 7.0 does not yet offer a stable programmatic API for embedded languages.

## Installing in an application

```powershell
pnpm add @meekojs/meeko
pnpm add -D vite
```

If you use Vite, add the plugin to `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { meeko } from "@meekojs/meeko/vite";

export default defineConfig({ plugins: [meeko()] });
```

Built applications run on Node 24, Bun, Deno or Cloudflare Workers; the [stability policy](https://github.com/meekojs/meeko/blob/main/docs/en/stability.md#supported-environments) lists the tested versions.

The package includes TypeScript 7 and the `meeko` CLI. You can check a component with `pnpm exec meeko check ruta/Componente.meeko`. Vite is optional if you only use the compiler and SSR.

### Create an SSR application

With the package installed, `meeko init` creates a standalone project. The server renders the `.meeko` component and transfers props and signals so the browser hydrates the existing HTML.

```powershell
pnpm exec meeko init mi-app
cd mi-app
npm install
npm run dev
```

Open `http://localhost:4173`. `npm run check` generates the component types and runs TypeScript 7. `npm run build` compiles client and server; `npm start` serves the compiled version with SSR. The CLI does not overwrite existing application files.

If you already ran `pnpm add @meekojs/meeko` in a folder without code, you can initialize it directly with `pnpm exec meeko init .`. The manifest, lockfiles, workspace and `node_modules` are kept; the CLI rejects application files or scripts that would conflict. Then run `pnpm install` and `pnpm run dev`. The generated project pins the exact version of `@meekojs/meeko`, because the compiled code and its runtime must match.

### Create a full-stack application

Meeko Engine lets you use `.meeko` components on their own. Meeko Framework adds, with the same compiler and runtime:

- file-based routing, layouts and middleware in `app/` and `server/`;
- SSR, streaming SSR with `defer` values, prerendering and `render: "client"` pages;
- per-request state;
- typed API and RPC;
- sessions with revocation;
- WebSocket, with cross-instance broadcast through Redis or Durable Objects.

Create an application with:

```powershell
pnpm exec meeko init-framework my-app
cd my-app
npm install
npm run dev
npm run check
npm run build
npm start
```

Each script has its job:

- `check` generates the contracts and type-checks.
- `build` produces in `.meeko/output/node/` the client, the Node server and the prerendered pages, which run without the application sources.
- `meeko build --adapter bun`, `--adapter deno` or `--adapter cloudflare` instead generate a self-contained output for Bun, Deno or Cloudflare Workers, and `--adapter static` (since `1.3`) a site of prerendered files for static hosting.
- `start` serves production SSR with Node 24 and requires configuring persistent sessions in `server/runtime.ts`.
- `meeko clean` deletes everything Meeko generates (`.meeko/` and the Vite cache); `meeko clean --all` also deletes `node_modules`. `--dry-run` shows what it would delete without touching anything.

The [framework guide](https://github.com/meekojs/meeko/blob/main/docs/en/framework.md) covers configuration, auto-imports, routes, middleware, deployment and security.

## Structure

The package lives in `packages/meeko` of the [repository](https://github.com/meekojs/meeko), a pnpm workspace. The paths in this table are relative to that folder, except the last three, which belong to the repository.

| Path                                                             | Responsibility                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/core/reactivity.ts`                                         | `signal`, `computed`, `effect`, `batch` and per-instance disposal of effects.                                                                                                                                                                                                  |
| `src/compiler/parser/sfc.ts`                                     | Parses `.meeko` sections and keeps positions for diagnostics.                                                                                                                                                                                                                  |
| `src/compiler.ts`                                                | Generates a TypeScript module with SSR, hydration and mappings to the source file.                                                                                                                                                                                             |
| `src/check.ts`                                                   | Type-checks with TypeScript 7 and locates diagnostics in `.meeko`.                                                                                                                                                                                                             |
| `src/types.ts`                                                   | Generates declarations for `.meeko` imports in TypeScript projects.                                                                                                                                                                                                            |
| `src/core/server.ts`, `src/core/html-content.ts`                 | Escaping and normalization of dynamic content for HTML and `serializeJson`.                                                                                                                                                                                                    |
| `src/dom.ts`, `src/hmr.ts`                                       | Hydration runtime, regions, lists and HMR.                                                                                                                                                                                                                                     |
| `src/internal.ts`                                                | The `@meekojs/meeko/internal` entry point that generated code imports.                                                                                                                                                                                                         |
| `src/cli.ts`                                                     | `meeko` CLI: project commands (`dev`, `check`, `build --adapter`, `start`, `preview`), component commands (`compile`, `types`), generation (`routes`, `prerender`), cleanup (`clean`), starters (`init`, `init-framework`), language server (`lsp`), `--help` and `--version`. |
| `src/framework.ts`, `src/framework`                              | Framework: configuration, routes, pages, streaming, navigation, API/RPC/Socket clients and build generation.                                                                                                                                                                   |
| `src/framework-server.ts`, `src/framework-server`                | Portable server core (`@meekojs/meeko/server`): application, runtime, contracts, sessions, middleware and Socket.                                                                                                                                                              |
| `src/node.ts`, `src/bun.ts`, `src/deno.ts`, `src/cloudflare.ts`  | Node, Bun, Deno and Cloudflare Workers adapters.                                                                                                                                                                                                                               |
| `src/build.ts`                                                   | Build tools for Node (`@meekojs/meeko/build`).                                                                                                                                                                                                                                 |
| `src/language-server`                                            | Language server (`meeko lsp --stdio`, bin `meeko-language-server`) for VS Code and any LSP editor.                                                                                                                                                                             |
| `src/vite.ts`                                                    | Vite plugin that transforms `.meeko` on the client and in SSR.                                                                                                                                                                                                                 |
| `src/devtools.ts`, `src/core/devtools-protocol.ts`               | Development instrumentation and DevTools 1 protocol types.                                                                                                                                                                                                                     |
| `src/devtools-ui`                                                | In-page inspection panel.                                                                                                                                                                                                                                                      |
| `examples/counter`                                               | Typed reference component.                                                                                                                                                                                                                                                     |
| `examples/attributes`, `examples/regions`, `examples/primitives` | Dynamic attributes, conditions and nested lists, and lists of primitive values.                                                                                                                                                                                                |
| `examples/vite`                                                  | Vite application without manual component generation.                                                                                                                                                                                                                          |
| `examples/nested`                                                | Component composition with hydration ranges and typed props.                                                                                                                                                                                                                   |
| `examples/pilot`                                                 | SSR pilot application.                                                                                                                                                                                                                                                         |
| `benchmarks`                                                     | Repeatable comparison of Meeko and Vue in SSR and Chrome.                                                                                                                                                                                                                      |
| `tests`                                                          | Unit, E2E and external consumer tests, and the adapter conformance suite (`tests/conformance`).                                                                                                                                                                                |
| `packages/vscode`                                                | VS Code extension: highlighting and language server client.                                                                                                                                                                                                                    |
| `packages/devtools`                                              | Meeko DevTools extension for Chrome.                                                                                                                                                                                                                                           |
| `apps/meeko`                                                     | Documentation site, built with Meeko from these Markdown files.                                                                                                                                                                                                                |

## Development

From the repository root, which forwards the commands to the package (`pnpm -F @meekojs/meeko run <orden>`):

```powershell
pnpm install
pnpm run verify
pnpm run e2e
pnpm run pilot:e2e
pnpm run package:smoke
pnpm run example:serve
```

`e2e` uses a locally installed Chrome; `MEEKO_CHROME_PATH` lets you point to another compatible executable. It tests Vite in development and production, plus an SSR page with navigation. `pilot:e2e` tests the pilot application in Chromium, Firefox and WebKit installed by Playwright, both in development and in production. `package:smoke` installs the tarball in an external temporary project and tests the CLI, SSR, types, Vite and `meeko init`. The last command serves the counter at `http://localhost:4173`.

The other commands in this section run inside `packages/meeko`.

To try automatic compilation with Vite:

```powershell
pnpm run build
pnpm run vite:dev
pnpm run vite:types
pnpm run vite:build
```

The `@meekojs/meeko/vite` plugin transforms `.meeko` imports on the client and in SSR and processes the component's CSS. In development, HMR replaces hydrated instances without reloading the page, keeps editable signals that retain their name and applies CSS changes. A change in the engine runtime triggers a full reload.

The Vite example shows [Meeko DevTools](https://github.com/meekojs/meeko/blob/main/docs/en/devtools.md) during development. With it you can:

- select each instance and review its props and signals;
- edit a signal;
- follow on the timeline where each signal is read and written;
- enable a breakpoint when a signal changes.

The Meeko DevTools extension for Chrome offers the same panel inside Chrome DevTools.

`vite:types` generates `.d.meeko.ts` declarations for the application's imports and checks the consumer with TypeScript 7 and `allowArbitraryExtensions`. The example's declarations are regenerated; they are not versioned.

To compile another component:

```powershell
pnpm run build
node dist/cli.js check ruta/Componente.meeko
node dist/cli.js check ruta/Componente.meeko --json
node dist/cli.js compile ruta/Componente.meeko ruta/Componente.generated.ts
node dist/cli.js types ruta/Componente.meeko
```

`check` returns syntax and type errors with the line and column of the `.meeko`; `--json` delivers structured diagnostics for editors. `compile` runs the same check and does not write the module if it finds errors. `types` generates declarations for the component and its `.meeko` imports so that TypeScript checks the consumer's props. The check uses TypeScript 7 and resolves imports from the component's directory, including the `paths` and `baseUrl` aliases of the `tsconfig.json` at the package root, like the editor.

The application must pass **the same props** to the render and to `hydrate`. `renderWithState(props)` returns HTML and serializable editable signals; the SSR example transfers both along with the props through `serializeJson` and calls `hydrate(root, props, state)`. Meeko checks that the existing text matches during hydration and returns a function that disconnects events and observers. Dynamic HTML is escaped on the server.

## Pilot application

[`examples/pilot`](https://github.com/meekojs/meeko/blob/main/packages/meeko/examples/pilot/README.md) brings together SSR, hydration, nested components, lists, forms, routes and an asynchronous API. Run it with `pnpm run pilot:dev`; `pnpm run pilot:build` and `pnpm run pilot:serve` test the production artifacts without Vite middleware. The `pnpm run pilot:e2e` test runs both modes in Chromium, Firefox and WebKit. Playwright's WebKit is not equivalent to a test in real Safari.

## Initial syntax

A file has `<script lang="ts">`, `<template>` and an optional `<style>`; `scoped` limits the CSS rules to the component. `defineProps<Props>()` declares the props. The template accepts text expressions `{expression}`, events `on:click="handler"` and dynamic attributes `bind:title="expression"`. Boolean attributes, such as `bind:disabled`, are added or removed according to the value.

`defineProps<Props>({ count: 0 })` declares defaults without another macro: `count` will be optional when using the component and defined inside it. See the rules and limits in the [API guide](https://github.com/meekojs/meeko/blob/main/docs/en/api.md#default-values-in-defineprops).

`if:when="expression"` shows or hides an element. A list uses `each:of="items"`, `each:as="item"` and, optionally since `1.1`, `each:key="item.id"`; `each:index="position"` lets you name the index, which is called `index` by default. Keys must be strings or finite numbers and cannot repeat. With a key, Meeko keeps the nodes of existing keys when the list is reordered; without one, the key is the index. [Regions.meeko](https://github.com/meekojs/meeko/blob/main/packages/meeko/examples/regions/Regions.meeko) shows conditions, nested lists, events and dynamic attributes.

A component imported in the script is inserted with `<component is="Child" bind:label="expression"></component>`. Props are checked with TypeScript and each child hydrates inside a range of comments, without a wrapper element. `is` also accepts a component received as a typed `Component<Props>` prop; this lets you insert reusable content and change it reactively. Communication toward the parent uses typed callbacks in the props, and `createContext<T>()` lets you share values with descendants. The explicit closing tag is required; HTML self-closing syntax is not supported for `<component>`. [Parent.meeko](https://github.com/meekojs/meeko/blob/main/packages/meeko/examples/nested/Parent.meeko) shows children and grandchildren inside conditions and lists.

Since `1.1`, a fixed component is written as a tag (`<AppButton variant="primary" bind:label="x" />`), with static props and `bind:`, events with `defineEmits` and `on:`, models with `defineModel` and `model`, content with `defineSnippets`, `<snippet>` and `<render>`, and a public value with `defineExpose` that the parent reads with `ref:` and `useElementRef`. Components can be generic (`<script lang="ts" generic="T">`), `<script lang="ts">` is optional, `onMounted` runs code after mounting, `model` binds form controls and `html` inserts unescaped HTML. The [API guide](https://github.com/meekojs/meeko/blob/main/docs/en/api.md) describes them, and the `@meekojs/meeko/prettier` plugin formats `.meeko` files in the CLI and the editor.

Syntax errors in script, template and CSS, as well as type errors in declarations and expressions, have a location in the `.meeko`. Errors attributable only to the generated helper code are explicitly identified.

Code names and identifiers are written in English. The public API and its contracts carry JSDoc in Spanish.

The Meeko language server (`meeko lsp --stdio` or `meeko-language-server --stdio`) shares the CLI's diagnostics and offers completion, navigation, references, hover, cross-file renaming, signature help, symbols, folding, formatting and quick actions in script and template. The [VS Code extension](https://github.com/meekojs/meeko/blob/main/packages/vscode/README.md) is a client of that server and uses the project's own when it is installed; [docs/en/editors.md](https://github.com/meekojs/meeko/blob/main/docs/en/editors.md) explains how to configure it in Neovim, Helix, Zed, JetBrains and Sublime Text. The VSIX was validated in an isolated VS Code host with an external consumer project; its README explains how to repeat the test and the current limitations.

## Scope of 1.0

- **Rendering.** Pages can render with `render: "ssr"`, `"stream"` (streaming SSR with `defer` values), `"prerender"` or `"client"`.
- **Deployment.** The targets are Node, Bun, Deno and Cloudflare Workers. A common conformance suite checks all four.
- **Socket.** Broadcasts are distributed across instances with Redis or, on Workers, with Durable Objects.
- **Sessions.** Revoking a session aborts in-flight requests and closes its sockets.

[docs/en/framework.md](https://github.com/meekojs/meeko/blob/main/docs/en/framework.md) explains it. The compiler rejects unsupported constructs with diagnostics. The extensions planned after 1.0 are in the [roadmap](https://github.com/meekojs/meeko/blob/main/docs/en/roadmap.md).

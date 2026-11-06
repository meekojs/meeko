---
source-hash: 615643ab64da1dead6494e3caaace66319c429af2d1405aea51a34b11d47f2a1
---

# Contributing to Meeko: tests, tooling and performance

This page collects monorepo commands. Installed applications use the [testing](testing.md), [tooling](tooling.md) and [performance](performance.md) guides.

## Monorepo tests

### Preparation and types

Run from the root with Node.js 24+ and pnpm 12.14.0:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm check
pnpm check:apps
```

The build prepares the six public packages, the private documentation base and their `dist/` entry points, including those imported by `eslint.config.ts`. This is why it precedes linting in a clean checkout. `check` checks the packages and `check:apps` checks the public framework, UI and i18n websites.

### Tests by category

| Category              | Command                                                             | Scope                                                              |
| --------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Core                  | `pnpm test`                                                         | Compiler, SSR, hydration, framework and runtime.                   |
| Packages              | `pnpm test:packages`                                                | UI, i18n and ESLint/Prettier plugins, using the previous build.    |
| Extended verification | `pnpm verify`                                                       | Core, examples, test types, Vite and DevTools.                     |
| Core browser          | `pnpm e2e`                                                          | Engine interactions and hydration.                                 |
| UI browser            | `pnpm -F @meekojs/ui test:e2e`                                      | UI website, Container, cards, tables, modals and View Transitions. |
| i18n website          | `pnpm -F meeko-i18n-site build && pnpm -F meeko-i18n-site test:e2e` | Production build, real catalogs, language switching and RTL.       |
| Public website        | `pnpm -F meeko-site test`                                           | Site reference and content.                                        |
| Distribution          | `pnpm package:workspace-smoke`                                      | All packages installed from tarballs.                              |

UI tests use installed Chrome by default. CI uses Playwright's Chromium through `MEEKO_CHROME_PATH`; you can set this variable to choose another compatible executable. UI scenarios run sequentially because some test HMR by modifying and restoring artifacts.

### Declarations and installed consumer

The UI build generates declarations alongside each `.meeko` file. When moving them from `.meeko/types`, it adjusts their relative imports and adds ESM extensions for NodeNext; component references keep their `.meeko` extension.

Regression tests check all distributed declarations without `skipLibCheck`. The smoke test creates the consumer in the system temporary directory, outside the workspace, to prevent it from resolving undeclared dependencies from the repository's `node_modules`. It checks exports, types, ESLint/Prettier, components and CSS processed by the consumer's PostCSS. It does not publish packages and keeps its temporary folder for diagnostics.

The consumer installation uses `--prefer-offline --ignore-scripts`: it reuses the store and downloads anything missing from the registry, without running third-party installation scripts. An incomplete local cache must not be confused with a dependency available through the workspace.

### CI

The main verification builds before linting, checks packages and applications, runs ecosystem and core tests and validates installed consumers. The existing Redis, Node/Bun/Deno/workerd and VS Code jobs keep their specific scenarios. Failure logs are kept as artifacts; local tests are not equivalent to a remote Actions run.

## Workspace tooling

### Workspace development

Install dependencies with `pnpm install`, then run `pnpm build`. The root configuration uses the workspace's own `@meekojs/eslint-plugin` and `@meekojs/prettier-plugin`, so those packages must be built before linting or formatting a fresh checkout. `pnpm tooling:build` builds only the core and tooling packages.

### Package builds

The core, UI, i18n, icon, ESLint and Prettier packages use `scripts/build-package.mjs`. esbuild emits ESM JavaScript and source maps. TypeScript checks the source and emits declarations. The ESLint plugin uses TypeScript 6 for its compiler API compatibility; the other packages keep TypeScript 7.

Use extensionless relative imports in TypeScript source:

```ts
import { signal } from './core/reactivity'
```

The build preserves the source module layout and writes `.js` extensions in both runtime imports and declaration imports. This keeps `import.meta.url` resources, browser/server boundaries, and shared runtime state stable across public exports. npm dependencies remain external. Published types also support consumers using `NodeNext` resolution.

Runtime resource URLs, imports of actual JavaScript files, generated code and imports from `dist` still need their real extensions. TypeScript configuration files loaded directly by Node use `.ts` when importing another configuration file.

`pnpm test:build` checks shared module identity, relative resources, CLI headers and published declaration compatibility.

`pnpm package:workspace-smoke` packs all six packages, installs them into a fresh consumer, loads every public entry point and checks a TypeScript 7 `NodeNext` consumer. That consumer uses `skipLibCheck`, as generated Meeko apps do, because TypeScript-ESLint's upstream declarations reference the TypeScript 6 compiler API. The build regression test separately checks the emitted local declaration imports.

### Lint and format

- `pnpm lint`: lint JavaScript, TypeScript and Meeko files throughout the workspace.
- `pnpm lint:fix`: apply ESLint fixes, including import sorting and unused import removal.
- `pnpm format:check`: check formatting throughout the workspace.
- `pnpm format`: format the workspace with Prettier.

The root `eslint.config.ts` uses [`defineEslint`](eslint.md): Perfectionist sorts only imports, and unused-imports removes the unused ones. Runtime globals and test exceptions remain scoped to their corresponding files. Test fixtures, generated sources, build output and local tooling state are excluded.

The root `prettier.config.ts` loads the Meeko, CSS order and package.json plugins. The site inherits it; UI adds stylesheet-based class sorting. Existing files are not reformatted automatically when adding or changing the shared configuration.

VS Code workspace settings enable ESLint fixes and formatting on explicit save. Install the recommended ESLint, Prettier and Meeko Language extensions. Meeko Language formats `.meeko` files with the project's Prettier configuration.

## Repository performance budget

### Reproducible measurement

From the monorepo root, with Node.js 24+ and Chrome installed:

```powershell
pnpm -F @meekojs/meeko benchmark:measure
pnpm -F @meekojs/meeko benchmark:compare --fail-on-regression
```

`benchmark:measure` builds the core and generates `packages/meeko/.meeko/performance/current.json`. `benchmark:compare` writes `comparison.json` in the same folder. `benchmark:budget` runs both steps and returns a nonzero code if it detects a comparable regression. No command updates the baseline automatically.

The scenario uses a fixed component with a counter and 30 rows, checks SSR and verifies a click after hydration in Chromium. It does not represent the size or latency of a complete user application. Reports record Node, browser and esbuild versions, platform, architecture, CPU, Git revision, dirty state and scenario hash.

### Metric categories

| Metric                      | What it measures                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `compile.cold`              | First compilation in a new worker; excludes starting the worker and importing the compiler.     |
| `compile.warm`              | Full compilations of the modified component after warmup; does not assume an incremental cache. |
| `ssr.render`                | Complete `renderWithState` of a new instance.                                                   |
| `client.hydration`          | Time inside `hydrate` in a real browser; the button event is checked afterward.                 |
| `bundle.raw`, `bundle.gzip` | Scenario client bytes, compiled and minified with esbuild, without a sourcemap.                 |
| `lsp.completion.cold`       | First completion in a newly created LSP project; excludes initial discovery.                    |
| `lsp.completion.warm`       | Repeated completions in that document, with the TypeScript program prepared.                    |

The LSP works with a small temporary application and `dist` types, not the complexity of a real consumer. Filesystems and operating system caches may be warm even when creating a new worker or service. The median and p95 are calculated over all samples, without removing outliers. There are seven rounds and two warmups; cold measurements use three new instances. You can change these with `--rounds`, `--warmups` and `--cold-rounds`.

To use Chromium downloaded by Playwright, set `MEEKO_BROWSER_CHANNEL=chromium`. For your own executable, use `MEEKO_CHROME_PATH`. The runner releases its browser, server and temporary folder when finished. It does not run the editor or modify consumer projects.

### Budgets and comparison

`packages/meeko/benchmarks/performance-budgets.json` defines the allowed relative increase and a minimum absolute increase per unit or metric. Initial values are 35% and 0.05 ms for timings, 5% and 256 bytes for sizes. Cold compilation and completion have specific minimums to avoid blocking on small variations.

A regression must exceed both limits in **median and p95**. A single slow sample is not enough. Timings only block when Node, platform, architecture, CPU and browser version match; another environment appears as `different-environment`. Sizes are always compared because they do not depend on the clock. A different scenario, a missing metric or a changed unit rejects the comparison instead of declaring success.

CI runs `benchmark:budget` and preserves reports even on failure. On a runner different from the machine that captured the baseline, timings remain informational and sizes still count against the budget. To evaluate a timing regression between revisions, measure both on the same runner with the same tool; avoid imposing universal absolute numbers.

### Updating a baseline

The versioned baseline is `packages/meeko/benchmarks/performance-baseline.json`. After reviewing a scenario change, tool version change or deliberate cost:

```powershell
pnpm -F @meekojs/meeko benchmark:measure
Copy-Item packages/meeko/.meeko/performance/current.json packages/meeko/benchmarks/performance-baseline.json
```

Review the report's differences alongside the change that justifies the new cost. The comparator accepts `--baseline`, `--current`, `--budgets` and `--output` to compare other captures without replacing the reference. If the measured work changes, update the scenario version as well as its source so the hash prevents comparing different workloads.

The historical benchmarks `benchmark`, `benchmark:scenarios` and `benchmarks/stability-baseline.mjs` remain available for broader comparisons, memory, HMR and external consumers. This small budget is an additional signal; it does not replace functional tests or a representative consumer measurement.

---
source-hash: 67d6b14701f41fcc8abf676310a4b2e370d5381166c892570562ea7a388c891d
---

# Testing and distribution

## Preparation and types

Run from the root with Node.js 24+ and pnpm 12.14.0:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm check
pnpm check:apps
```

The build prepares the five public packages, the private documentation base and their `dist/` entry points, including those imported by `eslint.config.ts`. This is why it precedes linting in a clean checkout. `check` checks the packages and `check:apps` checks the public framework, UI and i18n websites.

## Tests by category

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

## Declarations and installed consumer

The UI build generates declarations alongside each `.meeko` file. When moving them from `.meeko/types`, it adjusts their relative imports and adds ESM extensions for NodeNext; component references keep their `.meeko` extension.

Regression tests check all distributed declarations without `skipLibCheck`. The smoke test creates the consumer in the system temporary directory, outside the workspace, to prevent it from resolving undeclared dependencies from the repository's `node_modules`. It checks exports, types, ESLint/Prettier, components and CSS processed by the consumer's PostCSS. It does not publish packages and keeps its temporary folder for diagnostics.

The consumer installation uses `--prefer-offline --ignore-scripts`: it reuses the store and downloads anything missing from the registry, without running third-party installation scripts. An incomplete local cache must not be confused with a dependency available through the workspace.

## CI

The main verification builds before linting, checks packages and applications, runs ecosystem and core tests and validates installed consumers. The existing Redis, Node/Bun/Deno/workerd and VS Code jobs keep their specific scenarios. Failure logs are kept as artifacts; local tests are not equivalent to a remote Actions run.

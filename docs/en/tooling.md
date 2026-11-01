---
source-hash: a66e59b4d2b69f8e8d4787789d5733713f54b94d7bf5b775c21bf475c2970db5
---

# Workspace tooling

Install dependencies with `pnpm install`, then run `pnpm build`. The root configuration uses the workspace's own `@meekojs/eslint-plugin` and `@meekojs/prettier-plugin`, so those packages must be built before linting or formatting a fresh checkout. `pnpm tooling:build` builds only the core and tooling packages.

## Package builds

The core, UI, i18n, ESLint and Prettier packages use `scripts/build-package.mjs`. esbuild emits ESM JavaScript and source maps. TypeScript checks the source and emits declarations. The ESLint plugin uses TypeScript 6 for its compiler API compatibility; the other packages keep TypeScript 7.

Use extensionless relative imports in TypeScript source:

```ts
import { signal } from './core/reactivity'
```

The build preserves the source module layout and writes `.js` extensions in both runtime imports and declaration imports. This keeps `import.meta.url` resources, browser/server boundaries, and shared runtime state stable across public exports. npm dependencies remain external. Published types also support consumers using `NodeNext` resolution.

Runtime resource URLs, imports of actual JavaScript files, generated code and imports from `dist` still need their real extensions. TypeScript configuration files loaded directly by Node use `.ts` when importing another configuration file.

`pnpm test:build` checks shared module identity, relative resources, CLI headers and published declaration compatibility.

`pnpm package:workspace-smoke` packs all five packages, installs them into a fresh consumer, loads every public entry point and checks a TypeScript 7 `NodeNext` consumer. That consumer uses `skipLibCheck`, as generated Meeko apps do, because TypeScript-ESLint's upstream declarations reference the TypeScript 6 compiler API. The build regression test separately checks the emitted local declaration imports.

## Lint and format

- `pnpm lint`: lint JavaScript, TypeScript and Meeko files throughout the workspace.
- `pnpm lint:fix`: apply ESLint fixes, including import sorting and unused import removal.
- `pnpm format:check`: check formatting throughout the workspace.
- `pnpm format`: format the workspace with Prettier.

The root `eslint.config.ts` uses `defineEslint`, including Perfectionist and unused-imports. Runtime globals and test exceptions remain scoped to their corresponding files. Test fixtures, generated sources, build output and local tooling state are excluded.

The root `prettier.config.ts` loads the Meeko, CSS order and package.json plugins. The site inherits it; UI adds stylesheet-based class sorting. Existing files are not reformatted automatically when adding or changing the shared configuration.

VS Code workspace settings enable ESLint fixes and formatting on explicit save. Install the recommended ESLint, Prettier and Meeko Language extensions. Meeko Language formats `.meeko` files with the project's Prettier configuration.

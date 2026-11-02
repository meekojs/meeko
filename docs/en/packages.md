---
source-hash: 77e33043d6f9a6d2fbef5f5a7674bf6463284f03f4aabc1a56d940519fc544cc
---

# Workspace packages

`@meekojs/meeko` contains the compiler, signals, SSR, hydration, framework, routing and adapters. Optional features and tools have their own packages, each depending on the core:

- `packages/ui`: `@meekojs/ui`, visual controls and a styles module.
- `packages/i18n`: `@meekojs/i18n`, catalogs, runtime and a translation module.
- `packages/icon`: `@meekojs/icon`, typed Iconify icons and custom SVGs with `<UIIcon>`, resolved at compile time. Collections (`@iconify-json/<colección>`) are dependencies of the project that uses it.
- `packages/eslint-plugin`: `@meekojs/eslint-plugin`, component parser and rules.
- `packages/prettier-plugin`: `@meekojs/prettier-plugin`, component formatting.

From the root, `pnpm build` builds the packages in dependency order and `pnpm check` checks their types. The new packages' `0.1.0` versions are local to the workspace; their publication and the minimum core version with the new APIs must be established before publishing.

## Meeko 1.x compatibility

The `@meekojs/meeko/i18n`, `/i18n/module` and `/prettier` entry points retain their previous implementations for existing applications. New features belong in the new packages. This transitional compatibility avoids a runtime dependency from the core to optional packages; it will be removed with an explicit migration in a major version.

Since core 1.8, `MeekoSelect`, `MeekoPopover` and `MeekoThemeToggle` are deprecated (`MEEK121` warning) and will be removed in 2.0. UI 0.2 provides `UISelect`, `UIPopover` and `UIThemeToggle` with the same contract and markup. Enable the `@meekojs/ui` module; the theme system and `useThemeToggle()` remain in core. See [Migration to 1.8](migration-1.8.md).

## Tooling API and module types

Tools consume `@meekojs/meeko/parse` and `/compiler`, without importing private `dist` paths. The public parser exposes the SFC sections and template structure shared by the compiler and tools.

A module can call `meeko.addTypeTemplate('messages.d.ts', contents)`. Meeko writes the declaration to its own directory under `.meeko/types/modules`, includes it in its checks (including the `meeko.config.ts` check since 1.8) and removes it when you disable the module. It does not overwrite other files or follow links outside the project.

The language server and extension keep their current organization. Their separation is deferred to a later release, after these shared APIs stabilize.

## Consumer ESLint configuration

The consumer uses `eslint.config.ts` and the plugin's typed helper:

```ts
import { defineEslint } from '@meekojs/eslint-plugin'

export default defineEslint({
	perfectionist: true,
	unusedImports: true,
	rules: {
		'meeko/button-has-type': 'error',
		'unused-imports/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
	},
})
```

The helper includes the JavaScript, TypeScript and Meeko base configurations. Install `eslint`, `jiti` and `@meekojs/eslint-plugin` as development dependencies; `jiti` lets ESLint load the TypeScript configuration. The plugin includes `@eslint/js` and the TypeScript 6 API required by TypeScript-ESLint. The application can continue to be checked with TypeScript 7.

`perfectionist` is enabled by default and sorts imports, objects, classes, types and more in natural order, with warnings; `unusedImports` is optional and disabled by default. The demo declares them to sort and detect unused imports. Their dependencies are included in the plugin; consumers do not need to import them in their configuration.

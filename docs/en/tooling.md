---
source-hash: 28c9c9d88d23dd554520e5ef9afad638c6005d9c0d940b9ac08c147dc182d589
---

# ESLint and Prettier

## In an installed application

Install the packages you intend to configure alongside Meeko:

```sh
pnpm add @meekojs/meeko
pnpm add -D @meekojs/eslint-plugin @meekojs/prettier-plugin eslint prettier jiti
```

See [ESLint](eslint.md) for `defineEslint` and the recommended configuration. `jiti` lets ESLint load `eslint.config.ts`. To format `.meeko` files, create `prettier.config.mjs`:

```js
export default { plugins: ['@meekojs/prettier-plugin'] }
```

Workspace commands are documented in [Contributing to Meeko](contributing.md#workspace-tooling). [Editors](editors.md) explains the VS Code integration.

To check your files, run `pnpm exec eslint .` and `pnpm exec prettier . --check` from your application. Define corresponding scripts in your own `package.json` if you want to use them in CI.

## Workspace tooling

See [monorepo builds, lint and formatting](contributing.md#workspace-tooling).

# ESLint y Prettier

## En una aplicación instalada

Instala los paquetes que vayas a configurar junto con Meeko:

```sh
pnpm add @meekojs/meeko
pnpm add -D @meekojs/eslint-plugin @meekojs/prettier-plugin eslint prettier jiti
```

Consulta [ESLint](eslint.md) para `defineEslint` y la configuración recomendada. `jiti` permite a ESLint cargar `eslint.config.ts`. Para formatear `.meeko`, crea `prettier.config.mjs`:

```js
export default { plugins: ['@meekojs/prettier-plugin'] }
```

Los comandos del workspace se documentan en [Contribuir a Meeko](contributing.md#herramientas-del-workspace). [Editores](editors.md) explica la integración con VS Code.

Para comprobar tus archivos, ejecuta `pnpm exec eslint .` y `pnpm exec prettier . --check` desde tu aplicación. Define los scripts correspondientes en tu propio `package.json` si quieres usarlos en CI.

## Herramientas del workspace

Consulta [builds, lint y formato del monorepo](contributing.md#herramientas-del-workspace).

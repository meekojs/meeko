# ESLint para Meeko

`@meekojs/eslint-plugin` analiza componentes `.meeko` completos con ESLint 10 y Flat Config: scripts, `<script server>`, plantilla y expresiones. Incluye `defineEslint`, un helper tipado con las bases de JavaScript, TypeScript y Meeko, y reglas propias para los componentes.

## Instalación

```sh
pnpm add -D eslint jiti @meekojs/eslint-plugin
```

`jiti` permite que ESLint cargue `eslint.config.ts`. El plugin requiere Node.js 24 o superior y `@meekojs/meeko` `>=1.8 <2`.

## Ejemplo mínimo

```ts
// eslint.config.ts
import { defineEslint } from '@meekojs/eslint-plugin'

export default defineEslint({
	unusedImports: true,
	rules: {
		'meeko/button-has-type': 'error',
	},
})
```

```sh
pnpm exec eslint . --fix
```

## Ordenar con Perfectionist

| `perfectionist` | Qué ordena, en orden natural y con nivel `warn`                         |
| --------------- | ----------------------------------------------------------------------- |
| Sin la opción   | Sólo los imports.                                                       |
| `true`          | Casi todo: objetos, tipos, enums, `switch` y más; ni clases ni módulos. |
| `false`         | Nada.                                                                   |

`--fix` con `true` puede cambiar el comportamiento del código que depende del orden de las claves: revisa el diff.

## Documentación

- [Guía completa de ESLint](https://meekojs.com/docs/eslint): opciones, Perfectionist, reglas propias, parser y límites.
- [Guide in English](https://meekojs.com/en/docs/eslint).
- [Cambios del plugin](CHANGELOG.md).

## Licencia

MIT.

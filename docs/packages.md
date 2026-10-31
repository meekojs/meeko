# Paquetes del workspace

`@meekojs/meeko` conserva compilador, señales, SSR, hidratación, framework, routing y adaptadores. Las funciones opcionales y herramientas tienen paquetes propios, con una dependencia hacia el núcleo:

- `packages/ui`: `@meekojs/ui`, controles visuales y módulo de estilos.
- `packages/i18n`: `@meekojs/i18n`, catálogos, runtime y módulo de traducción.
- `packages/eslint-plugin`: `@meekojs/eslint-plugin`, parser y reglas de componentes.
- `packages/prettier-plugin`: `@meekojs/prettier-plugin`, formato de componentes.

Desde la raíz, `pnpm build` construye los cinco paquetes en orden de dependencias y `pnpm check` comprueba sus tipos. Las versiones `0.1.0` de los nuevos paquetes son locales del workspace; su publicación y la versión mínima del núcleo con las nuevas APIs se deben fijar antes de publicar.

## Compatibilidad de Meeko 1.x

Las entradas `@meekojs/meeko/i18n`, `/i18n/module` y `/prettier` conservan sus implementaciones anteriores para aplicaciones existentes. Los nuevos paquetes son la ubicación para nuevas funciones. Esta compatibilidad transitoria evita una dependencia de runtime del núcleo hacia los paquetes opcionales; se retirará con una migración explícita en una versión major.

`MeekoSelect`, `MeekoPopover` y `MeekoThemeToggle` conservan sus primitivas sin estilos en el núcleo porque el compilador y el framework las integran. El paquete UI proporciona su apariencia y los nuevos controles visuales.

## API de herramientas y tipos de módulos

Las herramientas consumen `@meekojs/meeko/parse` y `/compiler`, sin importar rutas privadas de `dist`. El parser público expone las secciones SFC y la estructura de plantilla que comparten compilador y herramientas.

Un módulo puede llamar `meeko.addTypeTemplate('messages.d.ts', contents)`. Meeko escribe la declaración en un directorio propio bajo `.meeko/types/modules`, la incluye en sus comprobaciones y la elimina al desactivar el módulo. No sustituye archivos ajenos ni sigue enlaces fuera del proyecto.

El servidor de lenguaje y la extensión continúan con su organización actual. Su separación se deja para una entrega posterior, después de estabilizar estas APIs compartidas.

## Configuración ESLint del consumidor

El consumidor usa `eslint.config.ts` y el helper tipado del plugin:

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

El helper incluye las bases de JavaScript, TypeScript y Meeko. Instala `eslint`, `jiti` y `@meekojs/eslint-plugin` como dependencias de desarrollo; `jiti` permite que ESLint cargue la configuración TypeScript. El plugin incluye `@eslint/js` y la API TypeScript 6 que necesita TypeScript-ESLint. La aplicación puede seguir comprobándose con TypeScript 7.

`perfectionist` y `unusedImports` son opciones adicionales, desactivadas por defecto. La demo las activa para ordenar imports y detectar imports sin usar. Sus dependencias se incluyen en el plugin; el consumidor no necesita importarlas en su configuración.

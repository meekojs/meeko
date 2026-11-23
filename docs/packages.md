# Paquetes del workspace

`@meekojs/meeko` conserva compilador, señales, SSR, hidratación, framework, routing y adaptadores. Las funciones opcionales y herramientas tienen paquetes propios, con una dependencia hacia el núcleo:

- `packages/ui`: `@meekojs/ui`, controles visuales y módulo de estilos.
- `packages/i18n`: `@meekojs/i18n`, catálogos, runtime y módulo de traducción.
- `packages/icon`: `@meekojs/icon`, iconos de Iconify y SVG propios con `<UIIcon>`, resueltos al compilar y tipados. Las colecciones (`@iconify-json/<colección>`) son dependencias del proyecto que lo usa.
- `packages/eslint-plugin`: `@meekojs/eslint-plugin`, parser y reglas de componentes.
- `packages/prettier-plugin`: `@meekojs/prettier-plugin`, formato de componentes.

Desde la raíz, `pnpm build` construye los paquetes en orden de dependencias y `pnpm check` comprueba sus tipos. Los cinco paquetes se publican en npm junto con el núcleo y comparten su número de versión desde `1.8.0`, la primera publicada; la actual es `1.9.0`. Todos declaran `@meekojs/meeko` `>=1.8 <2` en `peerDependencies`.

## Compatibilidad de Meeko 1.x

Las entradas `@meekojs/meeko/i18n`, `/i18n/module` y `/prettier` conservan sus implementaciones anteriores para aplicaciones existentes. Los nuevos paquetes son la ubicación para nuevas funciones. Esta compatibilidad transitoria evita una dependencia de runtime del núcleo hacia los paquetes opcionales; se retirará con una migración explícita en una versión major.

Desde core 1.8, `MeekoSelect`, `MeekoPopover` y `MeekoThemeToggle` están obsoletos (aviso `MEEK121`) y se retiran en 2.0. UI 1.8 proporciona `UICombobox`, `UIPopover` y `UIThemeToggle` con el mismo contrato y marcado. `UISelect` es otro componente, un `<select>` nativo, al que sólo puede pasar un `<MeekoSelect>` sin `multiple`, `searchable`, `filter` ni `max`. Activa el módulo `@meekojs/ui`; el sistema de temas y `useThemeToggle()` permanecen en core. Véase [Migración a 1.8](migration-1.8.md).

## API de herramientas y tipos de módulos

Las herramientas consumen `@meekojs/meeko/parse` y `/compiler`, sin importar rutas privadas de `dist`. El parser público expone las secciones SFC y la estructura de plantilla que comparten compilador y herramientas.

Un módulo puede llamar `meeko.addTypeTemplate('messages.d.ts', contents)`. Meeko escribe la declaración en un directorio propio bajo `.meeko/types/modules`, la incluye en sus comprobaciones (también en la de `meeko.config.ts`, desde 1.8) y la elimina al desactivar el módulo. No sustituye archivos ajenos ni sigue enlaces fuera del proyecto.

El servidor de lenguaje y la extensión continúan con su organización actual. Su separación se deja para una entrega posterior, después de estabilizar estas APIs compartidas.

## Configuración ESLint del consumidor

El consumidor usa `eslint.config.ts` y el helper tipado del plugin:

```ts
import { defineEslint } from '@meekojs/eslint-plugin'

export default defineEslint({
	unusedImports: true,
	rules: {
		'meeko/button-has-type': 'error',
		'unused-imports/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
	},
})
```

El helper incluye las bases de JavaScript, TypeScript y Meeko. Instala `eslint`, `jiti` y `@meekojs/eslint-plugin` como dependencias de desarrollo; `jiti` permite que ESLint cargue la configuración TypeScript. El plugin incluye `@eslint/js` y la API TypeScript 6 que necesita TypeScript-ESLint. La aplicación puede seguir comprobándose con TypeScript 7.

Sin la opción `perfectionist`, el helper ordena sólo los imports, en orden natural y con avisos; `true` ordena también objetos, tipos y demás, y `false` no ordena nada. `unusedImports` es opcional y está desactivada por defecto; la demo la declara para detectar imports sin usar. Sus dependencias se incluyen en el plugin; el consumidor no necesita importarlas en su configuración. Consulta la [guía de ESLint](eslint.md).

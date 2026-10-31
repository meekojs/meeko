# @meekojs/i18n

Traducciones tipadas, catálogos por idioma y módulo de integración para Meeko. La guía completa está en [docs/i18n.md](../../docs/i18n.md).

La [web pública de i18n](../../apps/i18n) incluye instalación, API y guías por categoría, con un laboratorio real en español, inglés y árabe. En el monorepo se inicia con `pnpm i18n:dev`; `pnpm i18n:build` genera su build de producción.

Los tipos generados comprueban también los parámetros: `t('welcome', { name: 'Diego' })` requiere `name` si el catálogo contiene `{name}`, y los selectores de plural requieren un número. Los idiomas deben compartir claves y contratos de parámetros. Los registros antiguos declarados como `true` siguen admitiéndose.

```ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
  modules: [['@meekojs/i18n/module', {
    defaultLocale: 'es',
    catalogs: { es: 'app/locales/es.json', en: 'app/locales/en.json' },
  }]],
})
```

`useI18n` se autoimporta en los componentes. Para un import explícito: `import { useI18n } from '@meekojs/i18n'`. Los proyectos nuevos usan este paquete; las entradas integradas anteriores quedan como compatibilidad de Meeko 1.x.

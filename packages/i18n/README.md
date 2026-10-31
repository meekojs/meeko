# @meekojs/i18n

Traducciones tipadas, catálogos por idioma y módulo de integración para Meeko. La guía completa está en [docs/i18n.md](../../docs/i18n.md).

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

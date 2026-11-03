# @meekojs/i18n

Traducciones tipadas, catálogos por idioma y namespace, rutas localizadas, `hreflang` y sitemap para [Meeko](https://meekojs.com).

**Documentación y laboratorio: [i18n.meekojs.com](https://i18n.meekojs.com).** Guía de integración y API completas: [meekojs.com/docs/i18n](https://meekojs.com/docs/i18n).

## Instalación

Necesitas Node.js 24 o superior y `@meekojs/meeko` `>=1.8 <2`.

```sh
pnpm add @meekojs/i18n
```

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	modules: ['@meekojs/i18n'],
	i18n: {
		defaultLocale: 'es',
		catalogs: {
			es: { common: 'app/locales/es/common.json' },
			en: { common: 'app/locales/en/common.json' },
		},
	},
})
```

Con esta configuración, `app/pages/guide.meeko` sirve `/guide` en español y `/en/guide` en inglés, sin duplicar archivos.

## Ejemplo mínimo

```json
{ "greeting": "Hola {name}" }
```

```json
{ "greeting": "Hello {name}" }
```

El primer catálogo es `app/locales/es/common.json` y el segundo, `app/locales/en/common.json`. Todos los idiomas declaran las mismas claves y los mismos parámetros, y `meeko check` comprueba cada llamada a `t()`.

```html
<script lang="ts">
	const { t } = useI18n()
</script>

<template>
	<p>{t('greeting', { name: 'Meeko' })}</p>
</template>
```

## Más información

- [Instalación](https://i18n.meekojs.com/installation) y [mensajes](https://i18n.meekojs.com/messages)
- [Idiomas y rutas](https://i18n.meekojs.com/routing)
- [API pública](https://i18n.meekojs.com/api)

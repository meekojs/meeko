/** Código copiable de las guías; los ejemplos interactivos usan el módulo instalado. */
export const examples = {
	install: 'pnpm add @meekojs/i18n',
	config: `import { defineMeekoConfig } from '@meekojs/meeko/framework'
import i18n from '@meekojs/i18n/module'

export default defineMeekoConfig({
  modules: [[i18n, {
    defaultLocale: 'es',
    catalogs: {
      es: 'app/locales/es.json',
      en: 'app/locales/en.json',
    },
  }]],
})`,
	catalog: `{
  "greeting": "Hola {name}",
  "ready": "Listo para traducir",
  "cart": {
    "items": {
      "plural": "total",
      "forms": {
        "=0": "Tu cesta está vacía",
        "one": "{count} elemento en tu cesta",
        "other": "{count} elementos en tu cesta"
      }
    }
  }
}`,
	englishCatalog: `{
  "greeting": "Hello {name}",
  "ready": "Ready to translate",
  "cart": {
    "items": {
      "plural": "total",
      "forms": {
        "=0": "Your cart is empty",
        "one": "{count} item in your cart",
        "other": "{count} items in your cart"
      }
    }
  }
}`,
	usage: `<script lang="ts">
  const { t } = useI18n()
  const name = signal('Meeko')
</script>

<template>
  <p>{t('greeting', { name: name.value })}</p>
  <p>{t('cart.items', { total: 3 })}</p>
</template>`,
	types: `const { t } = useI18n()
t('greeting', { name: 'Meeko' })
t('ready')
t('cart.items', { total: 3 })

// Diagnósticos esperados de TypeScript:
t('greeting')                        // falta name
t('cart.items', { total: 'tres' })    // requiere number
t('unknown')                        // clave inexistente`,
	plural: `{
  "cart": {
    "items": {
      "plural": "total",
      "forms": {
        "=0": "Tu cesta está vacía",
        "one": "{count} elemento en tu cesta",
        "other": "{count} elementos en tu cesta"
      }
    }
  }
}`,
	select: `{
  "invitation": {
    "select": "role",
    "forms": {
      "owner": "{name}, puedes administrar el proyecto.",
      "other": "{name}, puedes consultar el proyecto."
    }
  }
}

// En tu componente:
t('invitation', { role: 'owner', name: 'Meeko' })`,
	format: `const { number, date } = useI18n()

number(12345.67, { style: 'currency', currency: 'USD' })
number(0.42, { style: 'percent' })

date(Date.UTC(2026, 0, 15, 12), {
  dateStyle: 'long',
  timeZone: 'UTC',
})`,
	routing: `<script lang="ts">
  const i18n = useI18n()
</script>

<template>
  <button type="button" on:click="() => i18n.switchLocale('en')">
    English
  </button>
</template>

// /playground?tab=demo#messages -> /en/playground?tab=demo#messages`,
	paths: `import { localeOf, localizedPath } from '@meekojs/i18n'

const locales = ['es', 'en', 'ar']
localeOf('/en/playground', locales, 'es') // 'en'
localeOf('/playground', locales, 'es')    // 'es'
localizedPath('/es/playground?q=1#form', 'en', locales)
// '/en/playground?q=1#form'`,
	namespaces: `import { defineMeekoConfig } from '@meekojs/meeko/framework'
import i18n from '@meekojs/i18n/module'

export default defineMeekoConfig({
  modules: [[i18n, {
    defaultLocale: 'es',
    catalogs: {
      es: {
        common: 'app/locales/es/common.json',
        checkout: 'app/locales/es/checkout.json',
      },
      en: {
        common: 'app/locales/en/common.json',
        checkout: 'app/locales/en/checkout.json',
      },
    },
    routes: { '/checkout': ['checkout'] },
  }]],
})`,
	checkout: `{
  "checkout": {
    "title": "Confirmar pedido",
    "summary": "Tu pedido tiene {total} productos."
  }
}`,
	rtl: `// Dentro de las opciones del módulo:
directions: { ar: 'rtl' }

// Dentro de un componente:
const i18n = useI18n()
i18n.switchLocale('ar')

/* CSS con propiedades lógicas */
.content {
  padding-inline: 1.5rem;
  margin-inline: auto;
  text-align: start;
}`,
	manual: `import { createI18n } from '@meekojs/i18n'

// Catálogo compilado: fragmentos de texto y argumentos.
const translator = createI18n(
  'es',
  { greeting: ['Hola ', { arg: 'name' }] },
  ['es'],
  path => window.location.assign(path),
  () => window.location.pathname + window.location.search + window.location.hash,
)
translator.t('greeting', { name: 'Meeko' })`,
	check: 'pnpm exec meeko check .\npnpm exec meeko build .',
} as const

/** Código copiable de las guías; los ejemplos interactivos usan el módulo instalado. */
export const examples = {
	install: 'pnpm add @meekojs/i18n',
	config: `import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
  site: 'https://example.com',
  modules: ['@meekojs/i18n'],
  i18n: {
    defaultLocale: 'es',
    catalogs: {
      es: 'app/locales/es.json',
      en: 'app/locales/en.json',
    },
  },
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
	strategy: `i18n: {
  defaultLocale: 'es',
  catalogs: { es: { common: 'app/locales/es/common.json' }, en: { common: 'app/locales/en/common.json' } },
  // Por defecto: es sin prefijo y en con /en/…
  strategy: 'prefix_except_default',
  // Sin versiones /en/… ni hreflang:
  exclude: ['/admin/*'],
  // Un idioma con traducción parcial sólo tiene estas rutas:
  partial: { ar: ['/playground'] },
}

// app/pages/guide.meeko        -> /guide y /en/guide
// app/pages/docs/[...slug].meeko -> /docs/… y /en/docs/…
// app/pages/en/legal.meeko     -> sustituye a la /en/legal generada`,
	links: `<script lang="ts">
  const i18n = useI18n()
</script>

<template>
  <!-- /guide en español, /en/guide en inglés -->
  <a bind:href="i18n.localePath('/guide')">{i18n.t('nav.guide')}</a>
  <UILink bind:href="i18n.localePath('/docs/intro#setup')">Intro</UILink>
</template>`,
	routing: `<script lang="ts">
  const i18n = useI18n()
</script>

<template>
  <nav aria-label="Idioma">
    <a
      each:of="i18n.pageLocales()"
      each:as="code"
      each:key="code"
      bind:href="i18n.switchLocalePath(code)"
      bind:hreflang="code"
      bind:lang="code"
      bind:aria-current="code === i18n.locale ? 'page' : undefined"
    >
      {i18n.localeName(code)}
    </a>
  </nav>
</template>

<!-- /playground?tab=demo#messages -> /en/playground?tab=demo#messages -->`,
	suggestion: `<script lang="ts">
  const i18n = useI18n()
  const suggestion = signal<string | undefined>(undefined)
  // Sólo en el navegador, después de hidratar: nunca redirige.
  onMounted(() => { suggestion.value = i18n.suggestedLocale() })
</script>

<template>
  <p if:when="suggestion.value" role="status">
    <a bind:href="i18n.switchLocalePath(suggestion.value!)">
      {i18n.localeName(suggestion.value!)}
    </a>
    <button type="button" on:click="() => { i18n.rememberLocale(i18n.locale); suggestion.value = undefined }">
      {i18n.localeName(i18n.locale)}
    </button>
  </p>
</template>`,
	head: `<!-- /en/guide, con site: 'https://example.com' -->
<html lang="en" dir="ltr">
<link rel="alternate" href="https://example.com/guide" hreflang="es">
<link rel="alternate" href="https://example.com/en/guide" hreflang="en">
<link rel="alternate" href="https://example.com/guide" hreflang="x-default">

<!-- sitemap.xml (sitemap: true) -->
<url>
  <loc>https://example.com/en/guide</loc>
  <xhtml:link rel="alternate" hreflang="es" href="https://example.com/guide"/>
  <xhtml:link rel="alternate" hreflang="en" href="https://example.com/en/guide"/>
  <xhtml:link rel="alternate" hreflang="x-default" href="https://example.com/guide"/>
</url>`,
	paths: `import { localeOf, localizedPath, negotiateLocale, stripLocale } from '@meekojs/i18n'

const locales = ['es', 'en', 'ar']
localeOf('/en/playground', locales, 'es') // 'en'
localeOf('/playground', locales, 'es')    // 'es'
localizedPath('/playground?q=1#form', 'en', locales, 'es')
// '/en/playground?q=1#form'
localizedPath('/en/playground', 'es', locales, 'es') // '/playground'
stripLocale('/en/playground', locales)               // '/playground'
negotiateLocale('en-US,en;q=0.9,es;q=0.8', locales)  // 'en'`,
	namespaces: `import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
  modules: ['@meekojs/i18n'],
  i18n: {
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
  },
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
const translator = createI18n({
  locale: 'es',
  catalog: { greeting: ['Hola ', { arg: 'name' }] },
  locales: ['es', 'en'],
  defaultLocale: 'es',
  path: () => window.location.pathname + window.location.search + window.location.hash,
  navigate: path => window.location.assign(path),
})
translator.t('greeting', { name: 'Meeko' })
translator.switchLocalePath('en') // '/en/…'`,
	check: 'pnpm exec meeko check .\npnpm exec meeko build .',
} as const

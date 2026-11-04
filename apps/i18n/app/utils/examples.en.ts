import { examples as spanish } from './examples'

/**
 * Copiable examples of the English pages: the same keys, with their comments and texts in English.
 * What has none is shared, and so are the catalogs that teach the source language (`"Hola {name}"`):
 * they are the example.
 */
export const englishExamples = {
	...spanish,
	types: `const { t } = useI18n()
t('greeting', { name: 'Meeko' })
t('ready')
t('cart.items', { total: 3 })

// Expected TypeScript diagnostics:
t('greeting')                        // missing name
t('cart.items', { total: 'three' })  // requires a number
t('unknown')                         // nonexistent key`,
	select: `{
  "invitation": {
    "select": "role",
    "forms": {
      "owner": "{name}, puedes administrar el proyecto.",
      "other": "{name}, puedes consultar el proyecto."
    }
  }
}

// In your component:
t('invitation', { role: 'owner', name: 'Meeko' })`,
	strategy: `i18n: {
  defaultLocale: 'es',
  catalogs: { es: { common: 'app/locales/es/common.json' }, en: { common: 'app/locales/en/common.json' } },
  // By default: es without a prefix and en under /en/…
  strategy: 'prefix_except_default',
  // No /en/… versions and no hreflang:
  exclude: ['/admin/*'],
  // A language with a partial translation only has these routes:
  partial: { ar: ['/playground'] },
}

// app/pages/guide.meeko          -> /guide and /en/guide
// app/pages/docs/[...slug].meeko -> /docs/… and /en/docs/…
// app/pages/en/legal.meeko       -> replaces the generated /en/legal`,
	links: `<script lang="ts">
  const i18n = useI18n()
</script>

<template>
  <!-- /guide in Spanish, /en/guide in English -->
  <a bind:href="i18n.localePath('/guide')">{i18n.t('nav.guide')}</a>
  <UILink bind:href="i18n.localePath('/docs/intro#setup')">Intro</UILink>
</template>`,
	routing: `<script lang="ts">
  const i18n = useI18n()
</script>

<template>
  <nav aria-label="Language">
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
  // Only in the browser, after hydrating: it never redirects.
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
	head: `<!-- /en/guide, with site: 'https://example.com' -->
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
	rtl: `// Inside the options of the module:
directions: { ar: 'rtl' }

// Inside a component:
const i18n = useI18n()
i18n.switchLocale('ar')

/* CSS with logical properties */
.content {
  padding-inline: 1.5rem;
  margin-inline: auto;
  text-align: start;
}`,
	manual: `import { createI18n } from '@meekojs/i18n'

// Compiled catalog: text fragments and arguments.
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
} as const satisfies Record<keyof typeof spanish, string>

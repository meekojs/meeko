import { defineMeekoConfig } from '@meekojs/meeko/framework'
import { docsTheme } from 'meeko-docs/theme'

export default defineMeekoConfig({
	theme: { default: 'dark' },
	viewTransitions: true,
	modules: ['@meekojs/ui', 'meeko-docs', '@meekojs/i18n'],
	ui: docsTheme,
	// site: la moderación y los avisos del dashboard (DATABASE_URL, opcional).
	docs: { site: 'i18n' },
	i18n: {
		defaultLocale: 'es',
		catalogs: {
			es: { common: 'app/locales/es/common.json', checkout: 'app/locales/es/checkout.json' },
			en: { common: 'app/locales/en/common.json', checkout: 'app/locales/en/checkout.json' },
			ar: { common: 'app/locales/ar/common.json', checkout: 'app/locales/ar/checkout.json' },
		},
		routes: { '/namespaces': ['checkout'] },
		directions: { ar: 'rtl' },
	},
	document: {
		lang: 'es',
		head: {
			title: 'Meeko i18n',
			meta: [{ name: 'description', content: 'Traducciones tipadas, catálogos, plurales y formatos para aplicaciones Meeko.' }],
			link: [{ rel: 'icon', type: 'image/png', href: '/brand/meeko-logo.png' }],
		},
	},
})

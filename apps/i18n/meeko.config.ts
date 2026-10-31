import i18n from '@meekojs/i18n/module'
import { defineMeekoConfig } from '@meekojs/meeko/framework'
import ui from '@meekojs/ui'
import docs from 'meeko-docs'
import { docsTheme } from 'meeko-docs/theme'

export default defineMeekoConfig({
	theme: { default: 'dark' },
	viewTransitions: true,
	modules: [
		ui,
		docs,
		[
			i18n,
			{
				defaultLocale: 'es',
				catalogs: {
					es: { common: 'app/locales/es/common.json', checkout: 'app/locales/es/checkout.json' },
					en: { common: 'app/locales/en/common.json', checkout: 'app/locales/en/checkout.json' },
					ar: { common: 'app/locales/ar/common.json', checkout: 'app/locales/ar/checkout.json' },
				},
				routes: { '/namespaces': ['checkout'] },
				directions: { ar: 'rtl' },
			},
		],
	],
	ui: docsTheme,
	document: {
		lang: 'es',
		head: {
			title: 'Meeko i18n',
			meta: [{ name: 'description', content: 'Traducciones tipadas, catálogos, plurales y formatos para aplicaciones Meeko.' }],
			link: [{ rel: 'icon', type: 'image/png', href: '/brand/meeko-logo.png' }],
		},
	},
})

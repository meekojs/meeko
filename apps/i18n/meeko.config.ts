import { defineMeekoConfig } from '@meekojs/meeko/framework'
import { docsTheme } from 'meeko-docs/theme'

export default defineMeekoConfig({
	theme: { default: 'dark' },
	viewTransitions: true,
	// URL absolutas de hreflang y del sitemap, también fuera de producción: tiene prioridad sobre MEEKO_PUBLIC_ORIGIN.
	// meeko-docs sirve /sitemap.xml con la moderación vigente: un `sitemap: true` estático lo taparía.
	site: 'https://i18n.meekojs.com',
	modules: ['@meekojs/ui', 'meeko-docs', '@meekojs/i18n'],
	ui: docsTheme,
	// site: la moderación y los avisos del dashboard (DATABASE_URL, opcional).
	docs: { site: 'i18n' },
	i18n: {
		defaultLocale: 'es',
		// `site` son los textos de la web (navegación, error, controles del laboratorio) y `shell`, los del
		// Shell compartido (meeko-docs). El árabe sólo demuestra el laboratorio: su interfaz de la web y
		// del Shell es la española, que el Shell marca con lang="es".
		catalogs: {
			es: { common: 'app/locales/es/common.json', checkout: 'app/locales/es/checkout.json', site: 'app/locales/es/site.json', shell: 'node_modules/meeko-docs/locales/es/shell.json' },
			en: { common: 'app/locales/en/common.json', checkout: 'app/locales/en/checkout.json', site: 'app/locales/en/site.json', shell: 'node_modules/meeko-docs/locales/en/shell.json' },
			ar: { common: 'app/locales/ar/common.json', checkout: 'app/locales/ar/checkout.json', site: 'app/locales/es/site.json', shell: 'node_modules/meeko-docs/locales/es/shell.json' },
		},
		// Se pintan en todas las rutas, también en la de error.
		global: ['site', 'shell'],
		// Shared with the other sites of meekojs.com; on another host (localhost) it stays on that host.
		cookie: { name: 'meeko-locale', domain: 'meekojs.com' },
		// es sin prefijo (las URL de siempre) y en con /en/…, generadas desde las mismas páginas.
		strategy: 'prefix_except_default',
		routes: { '/namespaces': ['checkout'] },
		directions: { ar: 'rtl' },
		// El árabe sólo demuestra RTL en el laboratorio: ninguna otra página tiene versión /ar/….
		partial: { ar: ['/playground'] },
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

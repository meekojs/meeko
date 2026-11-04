import { defineMeekoConfig } from '@meekojs/meeko/framework'
import { docsLocaleDefaults, docsShellCatalog, docsSiteDefaults } from 'meeko-docs/site-config'

export default defineMeekoConfig({
	...docsSiteDefaults('i18n', 'Traducciones tipadas, catálogos, plurales y formatos para aplicaciones Meeko.'),
	// meeko-docs sirve /sitemap.xml con la moderación vigente: un `sitemap: true` estático lo taparía.
	modules: ['@meekojs/ui', 'meeko-docs', '@meekojs/i18n'],
	i18n: {
		...docsLocaleDefaults(),
		// `site` son los textos de la web (navegación, error, controles del laboratorio) y `shell`, los del
		// Shell compartido (meeko-docs). El árabe sólo demuestra el laboratorio: su interfaz de la web y
		// del Shell es la española, que el Shell marca con lang="es".
		catalogs: {
			es: { common: 'app/locales/es/common.json', checkout: 'app/locales/es/checkout.json', site: 'app/locales/es/site.json', ...docsShellCatalog('es') },
			en: { common: 'app/locales/en/common.json', checkout: 'app/locales/en/checkout.json', site: 'app/locales/en/site.json', ...docsShellCatalog('en') },
			ar: { common: 'app/locales/ar/common.json', checkout: 'app/locales/ar/checkout.json', site: 'app/locales/es/site.json', ...docsShellCatalog('es') },
		},
		// Se pintan en todas las rutas, también en la de error.
		global: ['site', 'shell'],
		// es sin prefijo (las URL de siempre) y en con /en/…, generadas desde las mismas páginas.
		strategy: 'prefix_except_default',
		routes: { '/namespaces': ['checkout'] },
		directions: { ar: 'rtl' },
		// El árabe sólo demuestra RTL en el laboratorio: ninguna otra página tiene versión /ar/….
		partial: { ar: ['/playground'] },
	},
})

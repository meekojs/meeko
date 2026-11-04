import { defineMeekoConfig } from '@meekojs/meeko/framework'
import { docsLocaleDefaults, docsShellCatalog, docsSiteDefaults } from 'meeko-docs/site-config'

export default defineMeekoConfig({
	...docsSiteDefaults('ui', 'Componentes tipados, temas y documentación para construir interfaces con Meeko.'),
	modules: ['@meekojs/ui', '@meekojs/ui/editor', '@meekojs/icon', 'meeko-docs', '@meekojs/i18n'],
	// Iconos de Lucide resueltos al compilar; include, los que la guía de /icons alterna con bind:name.
	icon: { collections: ['lucide'], include: ['lucide:sun', 'lucide:moon'] },
	// es sin prefijo (las URL de siempre) y en con /en/…. Las páginas traducidas viven en
	// app/pages/en/; el resto muestra el original con el aviso «sin traducir». `shell` es el catálogo
	// del Shell compartido (meeko-docs).
	i18n: {
		...docsLocaleDefaults(),
		catalogs: {
			es: { common: 'app/locales/es/common.json', ...docsShellCatalog('es') },
			en: { common: 'app/locales/en/common.json', ...docsShellCatalog('en') },
		},
		// El Shell se pinta en todas las rutas, también en la de error: su catálogo se carga siempre.
		global: ['shell'],
	},
})

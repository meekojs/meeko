import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	theme: { default: 'dark' },
	viewTransitions: true,
	// URL absolutas de hreflang y del sitemap, también fuera de producción: tiene prioridad sobre MEEKO_PUBLIC_ORIGIN.
	site: 'https://ui.meekojs.com',
	modules: ['@meekojs/ui', '@meekojs/icon', 'meeko-docs', '@meekojs/i18n'],
	// Iconos de Lucide resueltos al compilar; include, los que la guía de /icons alterna con bind:name.
	icon: { collections: ['lucide'], include: ['lucide:sun', 'lucide:moon'] },
	// site: la moderación y los avisos del dashboard (DATABASE_URL, opcional).
	docs: { site: 'ui' },
	// es sin prefijo (las URL de siempre) y en con /en/…. Las páginas traducidas viven en
	// app/pages/en/; el resto muestra el original con el aviso «sin traducir». `shell` es el catálogo
	// del Shell compartido (meeko-docs).
	i18n: {
		defaultLocale: 'es',
		catalogs: {
			es: { common: 'app/locales/es/common.json', shell: 'node_modules/meeko-docs/locales/es/shell.json' },
			en: { common: 'app/locales/en/common.json', shell: 'node_modules/meeko-docs/locales/en/shell.json' },
		},
		// El Shell se pinta en todas las rutas, también en la de error: su catálogo se carga siempre.
		global: ['shell'],
		// Shared with the other sites of meekojs.com; on another host (localhost) it stays on that host.
		cookie: { name: 'meeko-locale', domain: 'meekojs.com' },
	},
	document: {
		lang: 'es',
		head: {
			title: 'Meeko UI',
			meta: [{ name: 'description', content: 'Componentes tipados, temas y documentación para construir interfaces con Meeko.' }],
			link: [{ rel: 'icon', type: 'image/png', href: '/brand/meeko-logo.png' }],
		},
	},
})

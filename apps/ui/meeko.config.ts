import { defineMeekoConfig } from '@meekojs/meeko/framework'
import { docsTheme } from 'meeko-docs/theme'

export default defineMeekoConfig({
	theme: { default: 'dark' },
	viewTransitions: true,
	modules: ['@meekojs/ui', '@meekojs/icon', 'meeko-docs'],
	ui: docsTheme,
	// Iconos de Lucide resueltos al compilar; include, los que la guía de /icons alterna con bind:name.
	icon: { collections: ['lucide'], include: ['lucide:sun', 'lucide:moon'] },
	// site: la moderación y los avisos del dashboard (DATABASE_URL, opcional).
	docs: { site: 'ui' },
	document: {
		lang: 'es',
		head: {
			title: 'Meeko UI',
			meta: [{ name: 'description', content: 'Componentes tipados, temas y documentación para construir interfaces con Meeko.' }],
			link: [{ rel: 'icon', type: 'image/png', href: '/brand/meeko-logo.png' }],
		},
	},
})

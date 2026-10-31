import { defineMeekoConfig } from '@meekojs/meeko/framework'
import ui from '@meekojs/ui'
import docs from 'meeko-docs'
import { docsTheme } from 'meeko-docs/theme'

export default defineMeekoConfig({
	theme: { default: 'dark' },
	viewTransitions: true,
	modules: [ui, docs],
	ui: docsTheme,
	document: {
		lang: 'es',
		head: {
			title: 'Meeko UI',
			meta: [{ name: 'description', content: 'Componentes tipados, temas y documentación para construir interfaces con Meeko.' }],
			link: [{ rel: 'icon', type: 'image/png', href: '/brand/meeko-logo.png' }],
		},
	},
})

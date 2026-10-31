import { defineMeekoConfig } from '@meekojs/meeko/framework'
import ui from '@meekojs/ui'

export default defineMeekoConfig({
	theme: { default: 'dark' },
	viewTransitions: true,
	modules: [ui],
	ui: {
		tokens: {
			accent: 'var(--accent)',
			accentHover: 'var(--accent-ink)',
			onAccent: 'var(--on-accent)',
			primary: 'var(--pill)',
			primaryHover: 'var(--pill-hover)',
			onPrimary: 'var(--on-pill)',
			accentSoft: 'var(--accent-soft)',
			accentText: 'var(--accent-ink)',
			surface: 'var(--surface)',
			surfaceHover: 'var(--surface-2)',
			text: 'var(--ink)',
			textSoft: 'var(--ink-soft)',
			muted: 'var(--muted)',
			border: 'var(--line)',
			borderStrong: 'var(--line-strong)',
			focus: 'var(--accent)',
			danger: 'var(--danger)',
			font: 'var(--font-ui)',
			radius: 'var(--radius)',
		},
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

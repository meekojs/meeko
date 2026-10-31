import type { UIOptions } from '@meekojs/ui'

/** Identidad compartida de las webs documentales de Meeko. */
export const docsTheme = {
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
} satisfies UIOptions

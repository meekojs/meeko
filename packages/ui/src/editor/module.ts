import { defineMeekoModule } from '@meekojs/meeko/framework'

/** What the browser imports from the editor chunk: `meeko dev` prebundles them before the first visit. */
const browserDependencies = [
	'@codemirror/lang-css',
	'@codemirror/lang-html',
	'@codemirror/lang-javascript',
	'@codemirror/lang-json',
	'@codemirror/language',
	'@codemirror/view',
	'@lezer/highlight',
	'@milkdown/crepe/builder',
	'@milkdown/crepe/feature/block-edit',
	'@milkdown/crepe/feature/code-mirror',
	'@milkdown/crepe/feature/cursor',
	'@milkdown/crepe/feature/link-tooltip',
	'@milkdown/crepe/feature/list-item',
	'@milkdown/crepe/feature/placeholder',
	'@milkdown/crepe/feature/table',
	'@milkdown/crepe/feature/toolbar',
	'@milkdown/kit/core',
	'@milkdown/kit/plugin/upload',
	'@milkdown/kit/preset/commonmark',
	'@milkdown/kit/prose/state',
	'@milkdown/kit/utils',
] as const

/**
 * Módulo que registra `<UIMarkdownEditor>` en una aplicación. Va aparte de `@meekojs/ui` porque el
 * registro de componentes de Meeko genera un `import()` por cada componente: dentro del módulo
 * principal, Crepe sería un chunk del build de cualquier web, y fallaría sin sus dependencias
 * opcionales.
 *
 * @since 0.2.0
 * @example
 * ```ts
 * import { defineMeekoConfig } from '@meekojs/meeko/framework'
 *
 * export default defineMeekoConfig({
 * 	modules: ['@meekojs/ui', '@meekojs/ui/editor'],
 * })
 * ```
 */
export default defineMeekoModule({
	meta: {
		name: '@meekojs/ui/editor',
		compatibility: {
			meeko: '>=1.8 <2',
		},
	},
	setup(_options, meeko) {
		meeko.addComponentsDir(new URL('./components', import.meta.url), { prefix: 'UI' })
		// The theme and the shell, without Crepe: they keep the marker of the first paint in its place.
		meeko.addStylesheet(new URL('../../src/app/styles/markdown-editor.css', import.meta.url))
		meeko.addVitePlugin({
			name: 'meeko-ui:editor',
			config: () => ({
				// Milkdown renders its menus with the Vue that comes inside its chunk: no Options API and no
				// devtools there, and no warning in the console for flags nobody set.
				define: {
					__VUE_OPTIONS_API__: 'false',
					__VUE_PROD_DEVTOOLS__: 'false',
					__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
				},
				// `@meekojs/ui` is served from its source, so Vite would find these only on the first visit
				// to the editor, and would reload the page in the middle of it.
				optimizeDeps: { include: browserDependencies.map((name) => `@meekojs/ui > ${name}`) },
			}),
		})
	},
})

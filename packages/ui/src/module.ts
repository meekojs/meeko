import { defineMeekoModule } from '@meekojs/meeko/framework'
import { join } from 'node:path'

export default defineMeekoModule({
	meta: {
		name: '@meekojs/ui',
		compatibility: {
			meeko: '>=1.7 <2',
		},
	},
	setup(_options, meeko) {
		meeko.addComponentsDir(new URL('./app/components', import.meta.url), {
			prefix: 'UI',
			exclude: ['internal/**'],
		})

		meeko.addStylesheet(new URL('../src/app/styles/main.css', import.meta.url))

		meeko.addAutoImports(['useModal', 'useModalInstance'].map((name) => ({ name, from: '@meekojs/ui/runtime', scope: 'app' as const, componentOnly: true })))
		const components = join(meeko.rootDir, '.meeko', 'generated', 'components.ts')
		meeko.addVitePlugin({
			name: 'meeko-ui:components',
			resolveId(id: string) {
				if (id === 'virtual:meeko-ui-components') return components
			},
		})
		meeko.addPlugin(new URL('./app/plugins/modal.js', import.meta.url))
	},
})

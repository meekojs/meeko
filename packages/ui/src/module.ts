import { defineMeekoModule } from '@meekojs/meeko/framework'

export default defineMeekoModule({
	meta: {
		name: '@meekojs/ui',
		compatibility: {
			meeko: '>=1.7 <2',
		},
	},
	setup(_options, meeko) {
		meeko.addComponentsDir(new URL('./app/components', import.meta.url), { prefix: 'Ui' })

		meeko.addStylesheet(new URL('../src/app/styles/main.css', import.meta.url))
	},
})

import { defineMeekoModule } from '@meekojs/meeko/framework'

import { uiCss } from './styles'

export default defineMeekoModule({
	meta: {
		name: '@meekojs/ui',
		compatibility: {
			meeko: '>=1.7 <2',
		},
	},
	setup(_options, meeko) {
		meeko.addComponentsDir(new URL('./components', import.meta.url), { prefix: 'Ui' })

		meeko.addPublicFile('_meeko/ui.css', uiCss)

		meeko.addHead({
			link: [
				{
					rel: 'stylesheet',
					href: '/_meeko/ui.css',
					key: 'meeko-ui',
				},
			],
		})
	},
})

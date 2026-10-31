import { defineMeekoModule } from '@meekojs/meeko/framework'

/** Base documental privada del monorepo; no forma parte de los paquetes publicados. */
export default defineMeekoModule({
	meta: { name: 'meeko-docs', compatibility: { meeko: '>=1.7 <2' } },
	setup(_options, meeko) {
		meeko.addComponentsDir(new URL('./app/components', import.meta.url))
		meeko.addStylesheet(new URL('./app/styles/docs.css', import.meta.url))
	},
})

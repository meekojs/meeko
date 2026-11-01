import { defineMeekoConfig } from '@meekojs/meeko/framework'

// Declara las dependencias de las plantillas al generar sus tipos adyacentes. El catálogo `shell`
// tipa las claves `shell.*` de los componentes; cada web lo declara como namespace `shell`.
export default defineMeekoConfig({
	modules: ['@meekojs/ui', '@meekojs/i18n'],
	theme: true,
	i18n: {
		defaultLocale: 'es',
		catalogs: { es: { common: 'locales/es/shell.json' }, en: { common: 'locales/en/shell.json' } },
	},
})

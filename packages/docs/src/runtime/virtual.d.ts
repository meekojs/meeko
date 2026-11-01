declare module 'virtual:meeko-docs-sitemap' {
	/** La web de la moderación. */
	export const site: 'i18n' | 'ui'
	/** Origen público de las URL del sitemap. */
	export const origin: string
	/** Idiomas de la web y el que no lleva prefijo. */
	export const locales: readonly string[]
	export const defaultLocale: string
	/** Las URL de las rutas sin parámetros del manifiesto final, ordenadas. */
	export const pathnames: readonly string[]
}

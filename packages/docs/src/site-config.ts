/** Valores comunes de las dos webs documentales. Cada llamada crea objetos independientes. */
export function docsSiteDefaults(site: 'ui' | 'i18n', description: string) {
	return {
		theme: { default: 'dark' as const },
		viewTransitions: true,
		site: `https://${site}.meekojs.com`,
		docs: { site },
		document: {
			lang: 'es',
			head: {
				title: `Meeko ${site === 'ui' ? 'UI' : 'i18n'}`,
				meta: [{ name: 'description', content: description }],
				link: [{ rel: 'icon', type: 'image/png', href: '/brand/meeko-logo.png' }],
			},
		},
	}
}

/** Catálogo del Shell resuelto desde la dependencia de cada aplicación. */
export function docsShellCatalog(locale: 'en' | 'es') {
	return { shell: `node_modules/meeko-docs/locales/${locale}/shell.json` }
}

/** Idioma y cookie compartidos; cada web conserva sus catálogos y orden global propios. */
export function docsLocaleDefaults() {
	return { defaultLocale: 'es', cookie: { name: 'meeko-locale', domain: 'meekojs.com' } }
}

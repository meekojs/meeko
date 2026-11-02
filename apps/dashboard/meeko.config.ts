import { defineMeekoConfig } from '@meekojs/meeko/framework'

const namespaces = ['common', 'overview', 'login', 'sources', 'source', 'editor', 'translations', 'moderation', 'metrics', 'health', 'snapshots'] as const

/** The catalogs of one language: the dashboard's namespaces and the Shell of meeko-docs. */
function catalogs(locale: 'en' | 'es'): Record<string, string> {
	const files: Record<string, string> = Object.fromEntries(namespaces.map((name) => [name, `app/locales/${locale}/${name}.json`]))
	files.shell = `node_modules/meeko-docs/locales/${locale}/shell.json`
	return files
}

export default defineMeekoConfig({
	// The identity of Meeko's documentation webs: the tokens of @meekojs/ui and the same themes.
	theme: { default: 'dark' },
	modules: ['@meekojs/ui', '@meekojs/ui/editor', 'meeko-docs', '@meekojs/i18n'],
	// Bilingual interface: Spanish without a prefix (the usual URLs) and English under /en/…, from
	// the same pages. `shell` is the catalog of meeko-docs, whose components the moderation preview
	// renders. Each page loads its own namespace; `common` holds the header, errors and labels.
	i18n: {
		defaultLocale: 'es',
		catalogs: {
			es: catalogs('es'),
			en: catalogs('en'),
		},
		routes: {
			'/': ['overview'],
			'/login': ['login'],
			'/sources': ['sources'],
			'/sources/[id]': ['source'],
			'/sources/[id]/edit': ['editor'],
			'/translations': ['translations'],
			'/translations/[id]': ['translations'],
			// The preview of the announcements renders DocsAnnouncements of meeko-docs.
			'/moderation': ['moderation', 'shell'],
			'/metrics': ['metrics'],
			'/health': ['health'],
			'/snapshots': ['snapshots'],
		},
		// Namespaces of every route, like `common` (@meekojs/i18n `global`, in progress): the Shell of
		// meeko-docs, also for the error page.
		global: ['shell'],
		// Its own cookie: the choice of the dashboard does not suggest a language to the public webs.
		cookie: { name: 'meeko-dashboard-locale' },
	},
	server: {
		adapter: 'node',
		// F5: in production (`NODE_ENV=production` when building) it listens on every interface, behind
		// Coolify/Traefik and the tunnel; server/runtime.ts refuses to start production without the
		// administrator login. Development stays on loopback. MEEKO_HOST overrides both; see README.
		host: process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1',
		port: 4310,
		contentSecurityPolicy: {
			'default-src': ["'self'"],
			'script-src': ["'self'"],
			// Meeko writes each component's styles in a <style> element.
			'style-src': ["'self'", "'unsafe-inline'"],
			'img-src': ["'self'"],
			'font-src': ["'self'"],
			'connect-src': ["'self'"],
			'object-src': ["'none'"],
			'base-uri': ["'none'"],
			'frame-ancestors': ["'none'"],
			'form-action': ["'self'"],
		},
		headers: {
			'X-Content-Type-Options': 'nosniff',
			'Referrer-Policy': 'same-origin',
			'X-Robots-Tag': 'noindex, nofollow',
		},
	},
	document: {
		lang: 'es',
		head: {
			title: 'Meeko Dashboard',
			meta: [
				{ name: 'robots', content: 'noindex, nofollow' },
				{ name: 'theme-color', content: '#0a0b0d' },
			],
			link: [{ rel: 'icon', type: 'image/png', href: '/brand/meeko-logo.png' }],
		},
	},
})

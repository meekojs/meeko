import { defineMeekoConfig } from '@meekojs/meeko/framework'
import { docsTheme } from 'meeko-docs/theme'

export default defineMeekoConfig({
	// The identity of Meeko's documentation webs: the tokens of packages/docs and the same themes.
	theme: { default: 'dark' },
	modules: ['@meekojs/ui', 'meeko-docs'],
	ui: docsTheme,
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

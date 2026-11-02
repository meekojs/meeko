import { defineMeekoModule } from '@meekojs/meeko/framework'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { UIOptions } from './options'

import { messagesConfig, tokenStyles, validateOptions } from './options'

declare module '@meekojs/meeko/framework' {
	interface MeekoConfig {
		readonly ui?: UIOptions
	}
}

const fontFile = 'inter-latin-opsz-normal.woff2'
/** A path of its own: a module's public file that collides with an app's `public/` breaks `meeko build`. */
const fontPath = `_meeko-ui/fonts/${fontFile}`

export default defineMeekoModule<UIOptions>({
	meta: {
		name: '@meekojs/ui',
		configKey: 'ui',
		compatibility: {
			meeko: '>=1.8 <2',
		},
	},
	defaults: {},
	setup(options, meeko) {
		validateOptions(options)
		meeko.addComponentsDir(new URL('./app/components', import.meta.url), {
			prefix: 'UI',
			exclude: ['internal/**'],
		})

		// Registered first so that its layer goes before any layer of the app, and loses to it.
		if (options.base !== false) meeko.addStylesheet(new URL('../src/app/styles/base.css', import.meta.url))
		meeko.addStylesheet(new URL('../src/app/styles/main.css', import.meta.url))
		// With CORS: fonts always load with it, and a document with an opaque origin, such as a sandboxed preview, is another origin.
		meeko.addPublicFile(fontPath, () => readFile(new URL(`../src/app/styles/fonts/${fontFile}`, import.meta.url)), { headers: { 'Access-Control-Allow-Origin': '*' } })
		meeko.addHead({ link: [{ rel: 'preload', href: `/${fontPath}`, as: 'font', type: 'font/woff2', crossorigin: 'anonymous' }] })
		const tokensFile = fileURLToPath(new URL('../src/app/styles/main.css', import.meta.url))
			.replaceAll('\\', '/')
			.toLowerCase()
		const customTokens = tokenStyles(options.tokens)
		if (customTokens)
			meeko.addVitePlugin({
				name: 'meeko-ui:tokens',
				enforce: 'pre',
				transform(code: string, id: string) {
					if (id.split('?')[0]?.replaceAll('\\', '/').toLowerCase() === tokensFile) return { code: code + customTokens, map: null }
				},
			})
		if (options.defaults && Object.keys(options.defaults).length) meeko.addPlugin({ src: new URL('./app/plugins/config.js', import.meta.url), options: options.defaults })

		// Without these options the components read the texts of the package, or the locale of i18n, by themselves.
		if (options.locale !== undefined || options.messages !== undefined)
			meeko.addPlugin({
				src: new URL('./app/plugins/messages.js', import.meta.url),
				options: messagesConfig(options),
			})

		meeko.addAutoImports(['useModal', 'useModalInstance', 'useToast'].map((name) => ({ name, from: '@meekojs/ui/runtime', scope: 'app' as const, componentOnly: true })))
		const components = join(meeko.rootDir, '.meeko', 'generated', 'components.ts')
		meeko.addVitePlugin({
			name: 'meeko-ui:components',
			resolveId(id: string) {
				if (id === 'virtual:meeko-ui-components') return components
			},
		})
		meeko.addPlugin(new URL('./app/plugins/modal.js', import.meta.url))
		meeko.addPlugin(new URL('./app/plugins/toast.js', import.meta.url))
	},
})

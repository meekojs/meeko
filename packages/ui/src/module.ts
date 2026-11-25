import { defineMeekoModule } from '@meekojs/meeko/framework'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { UIOptions } from './options'

import { normalizeDefaults } from './defaults'
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

		const source = new URL('../src/', import.meta.url)
		const useSource = meeko.dev && existsSync(new URL('app/components', source))
		const app = new URL('app/', useSource ? source : import.meta.url)
		const styles = useSource ? new URL('styles/main.css', app) : new URL('./styles/main.css', import.meta.url)
		const plugin = (name: string) => new URL(`plugins/${name}.${useSource ? 'ts' : 'js'}`, app)

		if (useSource) {
			meeko.addVitePlugin({
				name: 'meeko-ui:source-runtime',
				config: () => ({
					resolve: {
						alias: [{ find: /^@meekojs\/ui\/runtime$/, replacement: fileURLToPath(new URL('runtime.ts', source)) }],
					},
				}),
			})
		}

		meeko.addComponentsDir(new URL('components', app), {
			prefix: 'UI',
			exclude: ['internal/**'],
			generateTypesInDev: useSource,
		})

		// Registered first so that its layer goes before any layer of the app, and loses to it.
		if (options.base !== false) meeko.addStylesheet(new URL('../src/app/styles/base.css', import.meta.url))
		// Vite compiles the source during workspace development. Published UI ships plain CSS.
		meeko.addStylesheet(styles)
		// With CORS: fonts always load with it, and a document with an opaque origin, such as a sandboxed preview, is another origin.
		meeko.addPublicFile(fontPath, () => readFile(new URL(`../src/app/styles/fonts/${fontFile}`, import.meta.url)), { headers: { 'Access-Control-Allow-Origin': '*' } })
		meeko.addHead({ link: [{ rel: 'preload', href: `/${fontPath}`, as: 'font', type: 'font/woff2', crossorigin: 'anonymous' }] })
		const tokensFile = fileURLToPath(styles).replaceAll('\\', '/').toLowerCase()
		const customTokens = tokenStyles(options.tokens)
		if (customTokens)
			meeko.addVitePlugin({
				name: 'meeko-ui:tokens',
				enforce: 'pre',
				transform(code: string, id: string) {
					if (id.split('?')[0]?.replaceAll('\\', '/').toLowerCase() === tokensFile) return { code: code + customTokens, map: null }
				},
			})
		// Only the validated plain values reach the client, where every page reads them.
		const defaults = options.defaults && normalizeDefaults(options.defaults)
		if (defaults && Object.keys(defaults).length) meeko.addPlugin({ src: plugin('config'), options: defaults })

		// Without these options the components read the texts of the package, or the locale of i18n, by themselves.
		if (options.locale !== undefined || options.messages !== undefined)
			meeko.addPlugin({
				src: plugin('messages'),
				options: messagesConfig(options),
			})

		meeko.addAutoImports(['useModal', 'useModalInstance', 'useScrollLock', 'useToast'].map((name) => ({ name, from: '@meekojs/ui/runtime', scope: 'app' as const, componentOnly: true })))
		const components = join(meeko.rootDir, '.meeko', 'generated', 'components.ts')
		meeko.addVitePlugin({
			name: 'meeko-ui:components',
			resolveId(id: string) {
				if (id === 'virtual:meeko-ui-components') return components
			},
		})
		meeko.addPlugin(plugin('modal'))
		meeko.addPlugin(plugin('toast'))
		// The width of the gutter of the scrollbar, `--ui-scrollbar-gutter`, for the locks of the page and for the app.
		meeko.addPlugin(plugin('scrollbar-gutter'))
		if (useSource) return import('@tailwindcss/vite').then(({ default: tailwind }) => meeko.addVitePlugin(tailwind()))
	},
})

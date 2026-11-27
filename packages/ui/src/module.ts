import { defineMeekoModule } from '@meekojs/meeko/framework'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { UIOptions } from './options'

import { normalizeDefaults } from './defaults'
import { messagesConfig, tokenStyles, validateOptions } from './options'
import { importsEntry, insertTokens, tailwindPlugins } from './styles'

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
		// Meeko keeps module packages out of the optimizer, so Vite would find the recipes' runtime only on the
		// first visit, optimize it then and reload the page in the middle of it.
		if (meeko.dev)
			meeko.addVitePlugin({
				name: 'meeko-ui:optimize-deps',
				config: () => ({ optimizeDeps: { include: ['@meekojs/ui > tailwind-variants/config'] } }),
			})

		meeko.addComponentsDir(new URL('components', app), {
			prefix: 'UI',
			exclude: ['internal/**'],
			generateTypesInDev: useSource,
		})

		// Plain CSS, registered first: its `@layer base, ui-base` puts the base right after Tailwind's preflight
		// and before the layers of the app's sheet, which wins over it.
		if (options.base !== false) meeko.addStylesheet(new URL('../src/app/styles/base.css', import.meta.url))
		// The rest of the CSS of UI is the entry `@import '@meekojs/ui'`, which the app's sheet compiles with Tailwind.
		const appStyles = join(meeko.rootDir, 'app', 'styles', 'main.css')
		// The sheet may import UI through a local sheet of its own (`@import './ui.css'`), which is followed too.
		if (meeko.dev && !importsEntry(existsSync(appStyles) ? readFileSync(appStyles, 'utf8') : undefined, appStyles)) meeko.warn("app/styles/main.css no importa @meekojs/ui: los componentes no tendrán estilos. Empiece la hoja con @import 'tailwindcss'; @import '@meekojs/ui';")
		// With CORS: fonts always load with it, and a document with an opaque origin, such as a sandboxed preview, is another origin.
		meeko.addPublicFile(fontPath, () => readFile(new URL(`../src/app/styles/fonts/${fontFile}`, import.meta.url)), { headers: { 'Access-Control-Allow-Origin': '*' } })
		meeko.addHead({ link: [{ rel: 'preload', href: `/${fontPath}`, as: 'font', type: 'font/woff2', crossorigin: 'anonymous' }] })
		const customTokens = tokenStyles(options.tokens)
		// Before Tailwind inlines the imports: in the sheet that imports UI, directly or through its local imports,
		// after its imports and before its rules. Tailwind reads the imported sheets itself, so only the sheet that
		// Vite loads passes through this transform.
		if (customTokens)
			meeko.addVitePlugin({
				name: 'meeko-ui:tokens',
				enforce: 'pre',
				transform: {
					order: 'pre',
					handler(code: string, id: string) {
						if (!/\.css(?:$|\?)/.test(id)) return
						const css = insertTokens(code, customTokens, id.replace(/[?#].*$/, ''))
						if (css !== undefined) return { code: css, map: null }
					},
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
		// The one compilation of the app's sheet, with the classes of UI and those of the app. Loaded only when
		// Vite resolves its configuration; it steps aside if the app already registers @tailwindcss/vite.
		meeko.addVitePlugin(tailwindPlugins())
	},
})

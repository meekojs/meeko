import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { routeKey } from '../../meeko/dist/app/runtime/navigation.js'
import { compile } from '../../meeko/dist/compiler.js'
import { createRoot, provide } from '../../meeko/dist/index.js'
import { uiDefaultsKey } from '../dist/app/utils/defaults.js'
import { validateDefaults } from '../dist/defaults.js'

/** Compiles UINavigationTabs, with its badge and its link, and a page that uses it, and renders it in SSR with `ui.defaults`. */
async function render(context, template, defaults) {
	const parent = fileURLToPath(new URL('../.meeko/', import.meta.url))
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(parent + 'navigation-tabs-')
	context.after(() => rm(directory, { recursive: true, force: true }))
	const runtime = (path) => JSON.stringify(new URL(`../../meeko/dist/${path}`, import.meta.url).href)
	const write = async (file, source) => {
		const code = compile(source, `${directory}/${file}.meeko`)
			.code.replaceAll('from "@meekojs/meeko/internal"', `from ${runtime('internal.js')}`)
			.replaceAll('from "@meekojs/meeko"', `from ${runtime('index.js')}`)
			.replace(/from ["']\.\/internal\/ItemLink\.meeko["']/g, 'from "./ItemLink.ts"')
			.replace(/from ["']\.\/(\w+)\.meeko["']/g, 'from "./$1.ts"')
			.replace(/from ["'](?:\.\.\/)+(types|utils|theme(?:\/components)?)\/([\w-]+)["']/g, (_, folder, utility) => `from ${JSON.stringify(new URL(`../dist/app/${folder}/${utility}.js`, import.meta.url).href)}`)
		await writeFile(`${directory}/${file}.ts`, code)
	}
	await write('ItemLink', await readFile(new URL('../src/app/components/internal/ItemLink.meeko', import.meta.url), 'utf8'))
	// onMounted is an auto-import of the app; this compilation has no app, so it imports it.
	const autoImports = (source) => source.replace(/(<script[^>]*>)/, '$1\nimport { onMounted } from "@meekojs/meeko"')
	await write('Badge', await readFile(new URL('../src/app/components/Badge.meeko', import.meta.url), 'utf8'))
	await write('NavigationTabs', autoImports(await readFile(new URL('../src/app/components/NavigationTabs.meeko', import.meta.url), 'utf8')))
	await write('Page', `<script lang="ts">import * as UINavigationTabs from "./NavigationTabs.meeko"</script><template>${template}</template>`)
	const page = await import(pathToFileURL(`${directory}/Page.ts`).href)
	return createRoot(() => {
		provide(routeKey, {})
		if (defaults) provide(uiDefaultsKey, defaults)
		return page.renderToString({}).replace(/<!--.*?-->/g, '')
	})
}

/** The classes of each badge of the row, in order: the spans of its links that carry a background. */
const badges = (html) => [...html.matchAll(/<a\b[^>]*>[^<]*<span\b[^>]*class="([^"]*)"/g)].map(([, value]) => value.split(' '))

const template = `<UINavigationTabs label="Filtro" bind:items="[{ label: 'Todas', href: '#todas', badge: '3' }, { label: 'Activas', href: '#activas', badge: '2', badgeColor: 'success' }]" />`

test('a counter without badgeColor takes the color of ui.defaults.badge, and badgeColor wins over it', async (context) => {
	const defaults = { badge: { color: 'primary' } }
	validateDefaults(defaults)
	const [own, colored] = badges(await render(context, template, defaults))
	assert.ok(own.includes('bg-primary-3') && !own.includes('bg-control'), own.join(' '))
	assert.ok(colored.includes('bg-success-3') && !colored.includes('bg-primary-3'), colored.join(' '))
})

test('without ui.defaults a counter without badgeColor is neutral, the default of UIBadge', async (context) => {
	const [own] = badges(await render(context, template))
	// The neutral soft badge reads the semantic tokens of the page.
	assert.ok(own.includes('bg-control') && own.includes('text-text-soft'), own.join(' '))
})

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { routeKey } from '../../meeko/dist/app/runtime/navigation.js'
import { compile } from '../../meeko/dist/compiler.js'
import { createRoot, provide } from '../../meeko/dist/index.js'
import { uiDefaultsKey, uiTheme } from '../dist/app/utils/defaults.js'

const components = ['Card', 'Table', 'Stat', 'Alert', 'Button']

/** Compiles the real components and a page that uses them, and renders it in SSR with the given `ui.defaults`. */
async function render(context, template, defaults) {
	const parent = fileURLToPath(new URL('../.meeko/', import.meta.url))
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(parent + 'defaults-render-')
	context.after(() => rm(directory, { recursive: true, force: true }))
	const runtime = (path) => JSON.stringify(new URL(`../../meeko/dist/${path}`, import.meta.url).href)
	const write = async (file, source) => {
		const code = compile(source, `${directory}/${file}.meeko`)
			.code.replaceAll('from "@meekojs/meeko/internal"', `from ${runtime('internal.js')}`)
			.replaceAll('from "@meekojs/meeko"', `from ${runtime('index.js')}`)
			.replace(/from ["']\.\/(\w+)\.meeko["']/g, 'from "./$1.ts"')
			.replace(/from ["'](?:\.\.\/)+(utils|variants)\/([\w-]+)["']/g, (_, folder, utility) => `from ${JSON.stringify(new URL(`../dist/app/${folder}/${utility}.js`, import.meta.url).href)}`)
			.replace(/from ["']\.\/internal\/Icon\.meeko["']/g, 'from "./Icon.ts"')
		await writeFile(`${directory}/${file}.ts`, code)
	}
	await write('Icon', await readFile(new URL('../src/app/components/internal/Icon.meeko', import.meta.url), 'utf8'))
	for (const name of components) {
		const source = await readFile(new URL(`../src/app/components/${name}.meeko`, import.meta.url), 'utf8')
		// useId is an auto-import of the app; this compilation has no app, so it imports it.
		await write(name, source.includes('useId()') ? source.replace(/(<script[^>]*>)/, '$1\nimport { useId } from "@meekojs/meeko"') : source)
	}
	const imports = components.map((name) => `import * as UI${name} from "./${name}.meeko"`).join('; ')
	await write('Page', `<script lang="ts">${imports}; const rows = [{ id: 1, name: "Ana" }]; const columns = [{ key: "name" as const, label: "Name" }]</script><template>${template}</template>`)
	const page = await import(pathToFileURL(`${directory}/Page.ts`).href)
	return createRoot(() => {
		provide(routeKey, {})
		if (defaults) provide(uiDefaultsKey, defaults)
		return page.renderToString({}).replace(/<!--.*?-->/g, '')
	})
}

/** The class attribute of the first element that matches `pattern` (the opening tag up to the attribute). */
const classOf = (html, pattern) => html.match(new RegExp(`${pattern}[^>]*?class="([^"]*)"`))?.[1]?.split(' ') ?? []

const defaults = {
	card: { padding: 'sm', class: 'app-card', ui: { header: 'app-card-header', body: 'app-card-body' } },
	table: { density: 'compact', class: 'app-table', ui: { base: 'app-table-scroll', cell: 'app-cell' } },
	stat: { ui: { value: 'app-stat-value' } },
	alert: { class: 'app-alert', ui: { title: 'app-alert-title' } },
	button: { variant: 'ghost', class: 'app-button' },
}

test('an instance without props gets the classes and variants of ui.defaults', async (context) => {
	const html = await render(context, '<UICard title="Plan">Body</UICard><UITable bind:rows="rows" bind:columns="columns" rowKey="id" /><UIStat label="Sales" value="12" /><UIAlert title="Saved" /><UIButton>Go</UIButton>', defaults)
	const card = classOf(html, '<section')
	assert.ok(card.includes('app-card'), 'class reaches the root of the card')
	assert.ok(card.includes('ui:[--card-padding:var(--ui-space-3)]'), 'the padding of ui.defaults')
	assert.ok(classOf(html, '<header').includes('app-card-header'))
	assert.match(html, /<div class="[^"]*app-card-body"[^>]*>Body<\/div>/)
	assert.ok(classOf(html, '<table').includes('app-table'), 'the class of a table reaches the <table>, as its prop does')
	assert.ok(classOf(html, '<div tabindex="0"').includes('app-table-scroll'), 'ui.base reaches the scroll container')
	const cell = classOf(html, '<td')
	assert.ok(cell.includes('app-cell'))
	assert.ok(cell.includes('ui:py-1'), 'the density of ui.defaults')
	assert.match(html, /<dd[^>]*class="[^"]*app-stat-value[^"]*"[^>]*>12<\/dd>/)
	assert.match(html, /class="[^"]*app-alert[^"]*"/)
	assert.match(html, /class="[^"]*app-alert-title[^"]*"[^>]*>\s*Saved/)
	const button = classOf(html, '<button')
	assert.ok(button.includes('app-button'))
	assert.ok(button.includes('ui:bg-transparent'), 'the variant of ui.defaults: ghost')
	assert.doesNotMatch(html, /undefined/)
})

test('the classes of an instance are added after those of ui.defaults, which come after those of the component', async (context) => {
	const html = await render(context, '<UICard title="Plan" class="mine" bind:ui="{ header: \'my-header\', footer: \'my-footer\' }">Body<snippet name="footer">End</snippet></UICard><UITable bind:rows="rows" bind:columns="columns" rowKey="id" class="my-table" bind:ui="{ cell: \'my-cell\' }" /><UIStat label="Sales" value="12" bind:ui="{ value: \'my-value\', label: \'my-label\' }" />', defaults)
	const card = classOf(html, '<section')
	assert.ok(card.indexOf('ui:flex') < card.indexOf('app-card') && card.indexOf('app-card') < card.indexOf('mine'), `component, defaults and instance, in that order: ${card.join(' ')}`)
	const header = classOf(html, '<header')
	assert.ok(header.indexOf('app-card-header') < header.indexOf('my-header') && header.indexOf('app-card-header') > 0)
	assert.ok(classOf(html, '<footer').includes('my-footer'), 'a slot without defaults keeps the classes of the instance')
	const table = classOf(html, '<table')
	assert.ok(table.indexOf('app-table') < table.indexOf('my-table') && table.indexOf('app-table') >= 0)
	const cell = classOf(html, '<td')
	assert.ok(cell.indexOf('app-cell') < cell.indexOf('my-cell') && cell.indexOf('app-cell') >= 0)
	assert.match(html, /<dd[^>]*class="[^"]*app-stat-value my-value[^"]*"/)
	assert.match(html, /<dt[^>]*class="[^"]*my-label[^"]*"/)
})

test('an explicit prop wins over a variant of ui.defaults', async (context) => {
	const html = await render(context, '<UICard title="A" padding="lg">A</UICard><UICard title="B" density="compact">B</UICard><UITable bind:rows="rows" bind:columns="columns" rowKey="id" density="comfortable" /><UIButton variant="primary">Go</UIButton>', { ...defaults, card: { padding: 'none', variant: 'soft' } })
	const cards = [...html.matchAll(/<section[^>]*?class="([^"]*)"/g)].map((match) => match[1].split(' '))
	assert.ok(cards[0].includes('ui:[--card-padding:var(--ui-space-6)]'), 'padding of the instance')
	assert.ok(cards[1].includes('ui:[--card-padding:var(--ui-space-3)]'), 'the density of the instance wins over the padding of ui.defaults')
	assert.ok(cards[0].includes('ui:bg-control-hover'), 'while the variant of ui.defaults still applies')
	const cell = classOf(html, '<td')
	assert.ok(cell.includes('ui:py-4') && !cell.includes('ui:py-1'))
	const button = classOf(html, '<button')
	assert.ok(button.includes('ui:bg-primary') && !button.includes('ui:bg-transparent'))
})

test('a density of ui.defaults gives the padding of a card, and without defaults nothing changes', async (context) => {
	const dense = await render(context, '<UICard title="A">A</UICard>', { card: { density: 'comfortable' } })
	assert.ok(classOf(dense, '<section').includes('ui:[--card-padding:var(--ui-space-6)]'))
	const plain = await render(context, '<UICard title="A" class="mine">A</UICard><UIStat label="Sales" value="12" />')
	const card = classOf(plain, '<section')
	assert.ok(card.includes('ui:[--card-padding:var(--ui-space-5)]') && card.includes('mine'))
	assert.doesNotMatch(plain, /undefined|app-/)
})

/** A card with title, description and actions, and the classes of its header and of its actions. */
const actionCard = (props = '') => `<UICard title="Orders" description="Today"${props}><snippet name="actions"><UIButton>Export</UIButton></snippet>Body</UICard>`
const headerParts = (html) => [...html.matchAll(/<header[^>]*?class="([^"]*)"[\s\S]*?<div class="([^"]*)"/g)].map(([, header, actions]) => ({ header: header.split(' '), actions: actions.split(' ') }))

test('actionsWrap places the actions of a card beside, below or by the width of its header, without a script', async (context) => {
	const html = await render(context, [actionCard(), actionCard(' actionsWrap="inline"'), actionCard(' actionsWrap="below"'), actionCard(' actionsWrap="auto"'), '<UICard title="Plain" actionsWrap="auto">Body</UICard>'].join(''))
	const [plain, inline, below, auto] = headerParts(html)
	assert.deepEqual(plain, inline, 'inline is the default: a card without the prop does not change')
	assert.ok(inline.header.includes('ui:grid-cols-[minmax(0,1fr)_auto]') && inline.header.includes('ui:gap-x-4'))
	assert.ok(inline.actions.includes('ui:col-[2]') && inline.actions.includes('ui:row-[1/span_2]') && inline.actions.includes('ui:justify-end'))
	assert.ok(!inline.header.includes('ui:@container'), 'only auto makes the header a container')
	assert.ok(!below.header.some((name) => name.startsWith('ui:grid-cols-')), 'below has a single column')
	assert.ok(!below.actions.some((name) => /col-|row-|justify-end/.test(name)) && below.actions.includes('ui:pt-1.5'))
	assert.ok(auto.header.includes('ui:@container') && auto.header.includes('ui:grid-cols-[minmax(0,1fr)_auto]') && !auto.header.includes('ui:gap-x-4'))
	for (const name of ['ui:col-[2]', 'ui:ms-4', 'ui:@max-card-narrow:col-[1]', 'ui:@max-card-narrow:row-auto', 'ui:@max-card-narrow:ms-0', 'ui:@max-card-narrow:justify-start']) assert.ok(auto.actions.includes(name), `auto: ${name}`)
	// The order of the DOM does not change: the title, the description and then the actions.
	for (const match of html.matchAll(/<header[\s\S]*?<\/header>/g)) if (match[0].includes('Export')) assert.match(match[0], /<h2[\s\S]*Orders[\s\S]*<p[\s\S]*Today[\s\S]*Export/)
	const header = [...html.matchAll(/<header[^>]*?class="([^"]*)"/g)].at(-1)[1]
	assert.ok(!header.includes('@container') && !header.includes('grid-cols'), 'without actions the prop changes nothing')
	assert.doesNotMatch(html, /undefined/)
})

test('actionsWrap takes a default from ui.defaults, and the prop of the instance wins over it', async (context) => {
	const html = await render(context, actionCard() + actionCard(' actionsWrap="inline"'), { card: { actionsWrap: 'auto' } })
	const [fromDefaults, own] = headerParts(html)
	assert.ok(fromDefaults.header.includes('ui:@container') && fromDefaults.actions.includes('ui:@max-card-narrow:col-[1]'))
	assert.ok(!own.header.includes('ui:@container') && own.header.includes('ui:gap-x-4'))
	const below = headerParts(await render(context, actionCard(), { card: { actionsWrap: 'below' } }))[0]
	assert.ok(below.actions.includes('ui:pt-1.5') && !below.actions.includes('ui:col-[2]'))
})

test('uiTheme sums the classes slot by slot, follows the props and reuses the merge of the same ui', () => {
	createRoot((dispose) => {
		provide(uiDefaultsKey, { stat: { class: 'd', ui: { base: 'd-base', value: 'd-value' } } })
		let own = { class: 'i', ui: { value: 'i-value', label: 'i-label' } }
		const theme = uiTheme('stat', () => own)
		assert.equal(theme.class, 'd i')
		assert.deepEqual({ ...theme.ui }, { base: 'd-base', value: 'd-value i-value', label: 'i-label' })
		assert.equal(theme.ui, theme.ui, 'one merge for the slots that a template reads')
		own = {}
		assert.equal(theme.class, 'd')
		assert.equal(theme.ui.value, 'd-value')
		assert.equal(theme.ui.label, undefined)
		const other = uiTheme('card', () => ({ ui: { header: 'h' } }))
		assert.equal(other.class, undefined)
		assert.equal(other.ui.header, 'h')
		assert.equal(other.defaults, undefined)
		dispose()
	})
	assert.equal(uiTheme('card', () => ({})).ui.base, undefined, 'outside an application there are no defaults')
})

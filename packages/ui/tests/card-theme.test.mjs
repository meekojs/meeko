import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { routeKey } from '../../meeko/dist/app/runtime/navigation.js'
import { compile } from '../../meeko/dist/compiler.js'
import { createRoot, provide } from '../../meeko/dist/index.js'
import { colorCompoundVariants } from '../dist/app/theme/base/colors.js'
import { cardTheme, linkCardTheme } from '../dist/app/theme/components/card.js'
import { cardTheme as exported, linkCardTheme as exportedLink } from '../dist/app/theme/index.js'
import { uiDefaultsKey } from '../dist/app/utils/defaults.js'

const components = ['Card', 'LinkCard']

/** Compiles UICard and UILinkCard and a page that uses them, and renders it in SSR with the given `ui.defaults`. */
async function render(context, template, defaults) {
	const parent = fileURLToPath(new URL('../.meeko/', import.meta.url))
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(parent + 'card-theme-')
	context.after(() => rm(directory, { recursive: true, force: true }))
	const runtime = (path) => JSON.stringify(new URL(`../../meeko/dist/${path}`, import.meta.url).href)
	const write = async (file, source) => {
		const code = compile(source, `${directory}/${file}.meeko`)
			.code.replaceAll('from "@meekojs/meeko/internal"', `from ${runtime('internal.js')}`)
			.replaceAll('from "@meekojs/meeko"', `from ${runtime('index.js')}`)
			.replace(/from ["']\.\/(\w+)\.meeko["']/g, 'from "./$1.ts"')
			.replace(/from ["'](?:\.\.\/)+(utils|theme(?:\/components)?)\/([\w-]+)["']/g, (_, folder, utility) => `from ${JSON.stringify(new URL(`../dist/app/${folder}/${utility}.js`, import.meta.url).href)}`)
		await writeFile(`${directory}/${file}.ts`, code)
	}
	for (const name of components) {
		const source = await readFile(new URL(`../src/app/components/${name}.meeko`, import.meta.url), 'utf8')
		// useId is an auto-import of the app; this compilation has no app, so it imports it.
		await write(name, source.includes('useId()') && !/import \{[^}]*\buseId\b/.test(source) ? source.replace(/(<script[^>]*>)/, '$1\nimport { useId } from "@meekojs/meeko"') : source)
	}
	const imports = components.map((name) => `import * as UI${name} from "./${name}.meeko"`).join('; ')
	await write('Page', `<script lang="ts">${imports}</script><template>${template}</template>`)
	const page = await import(pathToFileURL(`${directory}/Page.ts`).href)
	return createRoot(() => {
		provide(routeKey, {})
		if (defaults) provide(uiDefaultsKey, defaults)
		return page.renderToString({}).replace(/<!--.*?-->/g, '')
	})
}

const decode = (value) => value.replaceAll('&amp;', '&').replaceAll('&gt;', '>').replaceAll('&lt;', '<').split(' ')
/** The classes of every element that opens with `tag`, in order. */
const classesOf = (html, tag) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*?class="([^"]*)"`, 'g'))].map(([, value]) => decode(value))
/** The classes of each card: its <section>, the <p> of its description and its body. */
const cardsOf = (html) => {
	const bodies = [...html.matchAll(/<\/header>\s*<div class="([^"]*)"/g)].map(([, value]) => decode(value))
	return classesOf(html, 'section').map((base, index) => ({ base, description: classesOf(html, 'p')[index], body: bodies[index] }))
}

const treatments = ['surface', 'outline', 'soft', 'subtle', 'solid', 'glass', 'plain']
const colors = ['primary', 'secondary', 'neutral', 'success', 'info', 'warning', 'danger']
const card = (props = '') => `<UICard title="T" description="D"${props}>Body</UICard>`

test('@meekojs/ui/theme exports the card recipes', () => {
	assert.equal(exported, cardTheme)
	assert.equal(exportedLink, linkCardTheme)
})

test('without props UICard is the surface of before: the semantic surface, border and text, radius lg and padding md', async (context) => {
	const [{ base, description }] = cardsOf(await render(context, card()))
	const recipe = cardTheme()
	assert.deepEqual(base, recipe.base().split(' '))
	for (const name of ['group/card', 'border-(length:--ui-border-width)', 'border-border', 'bg-surface', 'text-text', 'rounded-lg', '[--card-padding:var(--ui-space-5)]', 'meeko-ui-component']) assert.ok(base.includes(name), name)
	assert.ok(description.includes('text-text-soft'), 'the description is the soft text')
	assert.ok(!base.some((name) => name.startsWith('shadow-')), 'no shadow by default')
	assert.ok(!base.some((name) => name.startsWith('not-disabled:')), 'a card does not react to the pointer')
	for (const name of ['bg-neutral-2', 'border-neutral-6', 'text-neutral-11']) assert.ok(!base.includes(name), `${name}: the neutral card reads the semantic tokens`)
})

test('every pair of variant and color paints the root with the catalog, without the pointer states', async (context) => {
	const template = treatments.flatMap((variant) => colors.map((color) => card(` variant="${variant}" color="${color}"`))).join('')
	const html = await render(context, template)
	const rendered = cardsOf(html)
	assert.equal(rendered.length, treatments.length * colors.length)
	let index = 0
	for (const variant of treatments) {
		for (const color of colors) {
			const { base, description, body } = rendered[index++]
			assert.ok(!base.some((name) => name.startsWith('not-disabled:')), `${variant}/${color}: no pointer states`)
			assert.ok(base.includes('group/card') && base.includes('rounded-lg'), `${variant}/${color}: the structure stays`)
			assert.ok(!body.some((name) => /^(?:bg|border|text)-(?:primary|secondary|neutral|success|info|warning|danger)-/.test(name)), `${variant}/${color}: the color goes to the root, not to the body`)
			const compound = colorCompoundVariants.find((entry) => entry.variant === variant && entry.color === color)
			if (variant === 'plain') {
				assert.equal(compound, undefined)
				assert.ok(!base.some((name) => /^(?:bg|text)-/.test(name)), `plain/${color} does not paint`)
				continue
			}
			const still = compound.class.split(' ').filter((name) => !name.startsWith('not-disabled:'))
			// A neutral card reads the semantic tokens instead of its scale.
			const replaced = color !== 'neutral' ? null : variant === 'surface' ? /^(?:text-neutral-11|bg-neutral-2|border-neutral-6)$/ : variant === 'soft' ? /^(?:text-neutral-11|bg-neutral-3)$/ : /^text-neutral-11$/
			for (const name of still) if (!replaced?.test(name)) assert.ok(base.includes(name), `${variant}/${color}: ${name}`)
			if (color === 'neutral' && variant !== 'solid') {
				assert.ok(base.includes('text-text'), `${variant}/neutral: the text of the page`)
				assert.ok(description.includes('text-text-soft'), `${variant}/neutral: the soft description`)
			}
		}
	}
	assert.doesNotMatch(html, /<section[^>]*\s(?:variant|color|radius|elevation|appearance)=/, 'the look is classes, not attributes')
})

test('solid keeps the text of its contrast readable, and soft neutral is the hovered control of before', async (context) => {
	const [solid, soft] = cardsOf(await render(context, card(' variant="solid" color="primary"') + card(' variant="soft"')))
	for (const name of ['bg-primary-9', 'text-primary-contrast', 'border-transparent', '[&_:where(p,li):not([class])]:text-inherit']) assert.ok(solid.base.includes(name), name)
	assert.ok(!solid.description.includes('text-text-soft'), 'the description of a solid inherits its contrast text')
	for (const name of ['bg-control-hover', 'text-text', 'border-transparent']) assert.ok(soft.base.includes(name), name)
})

test('glass paints with the alpha gray whatever its color', async (context) => {
	const rendered = cardsOf(await render(context, colors.map((color) => card(` variant="glass" color="${color}"`)).join('')))
	for (const [index, { base }] of rendered.entries()) {
		for (const name of ['bg-gray-a3', 'border-gray-a6', 'backdrop-blur-md', 'border-(length:--ui-border-width)']) assert.ok(base.includes(name), `${colors[index]}: ${name}`)
		assert.ok(!base.includes('bg-surface'), 'the glass replaces the surface')
	}
})

test('radius, elevation, padding and density reach the root', async (context) => {
	const [round, flat, dense] = cardsOf(await render(context, card(' radius="full" elevation="md" padding="lg"') + card(' radius="none" elevation="none"') + card(' density="compact"')))
	for (const name of ['rounded-full', 'shadow-md', '[--card-padding:var(--ui-space-6)]']) assert.ok(round.base.includes(name), name)
	assert.ok(!round.base.includes('rounded-lg'))
	for (const name of ['rounded-none', 'shadow-none']) assert.ok(flat.base.includes(name), name)
	assert.ok(dense.base.includes('[--card-padding:var(--ui-space-3)]'))
})

test('the class of the instance is merged with Tailwind Merge and wins over the recipe', async (context) => {
	const html = await render(context, card(' class="rounded-none bg-red-500 border-blue-500 shadow-xl my-card" elevation="sm"'))
	const [{ base }] = cardsOf(html)
	for (const name of ['rounded-none', 'bg-red-500', 'border-blue-500', 'shadow-xl', 'my-card']) assert.ok(base.includes(name), name)
	for (const name of ['rounded-lg', 'bg-surface', 'border-border', 'shadow-sm']) assert.ok(!base.includes(name), `${name} gives way to the class`)
	assert.ok(base.includes('text-text') && base.includes('border-(length:--ui-border-width)'), 'what the class does not set stays')
})

test('ui.defaults.card gives the base values of the look, and the props of the instance win', async (context) => {
	const defaults = { card: { variant: 'soft', color: 'primary', radius: 'xl', elevation: 'sm', class: 'app-card' } }
	const html = await render(context, card() + card(' variant="outline" color="success" radius="sm" elevation="none" class="mine"'), defaults)
	const [fromDefaults, own] = cardsOf(html)
	for (const name of ['bg-primary-3', 'text-primary-11', 'rounded-xl', 'shadow-sm', 'app-card']) assert.ok(fromDefaults.base.includes(name), name)
	assert.ok(!fromDefaults.base.includes('bg-surface'))
	for (const name of ['border-success-7', 'text-success-11', 'rounded-sm', 'shadow-none', 'app-card', 'mine']) assert.ok(own.base.includes(name), name)
	for (const name of ['bg-primary-3', 'rounded-xl', 'shadow-sm']) assert.ok(!own.base.includes(name), `${name}: the prop wins`)
	assert.ok(own.base.indexOf('app-card') < own.base.indexOf('mine'), 'the class of ui.defaults goes before that of the instance')
})

test('UILinkCard keeps the look of before by default, with the pointer states, and takes variant, color, radius and elevation', async (context) => {
	const html = await render(context, '<UILinkCard href="/a" title="A" description="Da" /><UILinkCard href="/b" title="B" description="Db" variant="soft" color="primary" radius="md" elevation="lg" class="rounded-none mine" />')
	const [plain, tinted] = classesOf(html, 'a')
	assert.deepEqual(plain, linkCardTheme().base().split(' '))
	for (const name of ['border-border', 'bg-surface', 'text-text', 'rounded-lg', 'not-disabled:hover:border-border-strong', 'not-disabled:hover:bg-control-hover', 'p-[var(--ui-link-card-padding,var(--ui-space-4))]', 'focus-visible:outline-focus']) assert.ok(plain.includes(name), name)
	assert.ok(classesOf(html, 'span')[0].includes('text-text-soft'), 'the description is the soft text')
	for (const name of ['bg-primary-3', 'text-primary-11', 'not-disabled:hover:bg-primary-4', 'shadow-lg', 'rounded-none', 'mine']) assert.ok(tinted.includes(name), name)
	assert.ok(!tinted.includes('rounded-md') && !tinted.includes('bg-surface'))
	const [fromDefaults] = classesOf(await render(context, '<UILinkCard href="/a" title="A" />', { linkCard: { variant: 'outline', color: 'danger', radius: 'full' } }), 'a')
	for (const name of ['border-danger-7', 'text-danger-11', 'rounded-full', 'not-disabled:hover:bg-danger-2']) assert.ok(fromDefaults.includes(name), name)
})

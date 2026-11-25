import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { routeKey } from '../../meeko/dist/app/runtime/navigation.js'
import { compile } from '../../meeko/dist/compiler.js'
import { createRoot, provide } from '../../meeko/dist/index.js'
import { colorCompoundVariants } from '../dist/app/theme/base/colors.js'
import { buttonTheme } from '../dist/app/theme/components/button.js'
import { uiDefaultsKey } from '../dist/app/utils/defaults.js'

const components = ['Button', 'Link']

/** Compiles UIButton and UILink and a page that uses them, and renders it in SSR with the given `ui.defaults`. */
async function render(context, template, defaults) {
	const parent = fileURLToPath(new URL('../.meeko/', import.meta.url))
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(parent + 'button-theme-')
	context.after(() => rm(directory, { recursive: true, force: true }))
	const runtime = (path) => JSON.stringify(new URL(`../../meeko/dist/${path}`, import.meta.url).href)
	const write = async (file, source) => {
		const code = compile(source, `${directory}/${file}.meeko`)
			.code.replaceAll('from "@meekojs/meeko/internal"', `from ${runtime('internal.js')}`)
			.replaceAll('from "@meekojs/meeko"', `from ${runtime('index.js')}`)
			.replace(/from ["']\.\/(\w+)\.meeko["']/g, 'from "./$1.ts"')
			.replace(/from ["'](?:\.\.\/)+(utils|variants|theme(?:\/components)?)\/([\w-]+)["']/g, (_, folder, utility) => `from ${JSON.stringify(new URL(`../dist/app/${folder}/${utility}.js`, import.meta.url).href)}`)
		await writeFile(`${directory}/${file}.ts`, code)
	}
	for (const name of components) await write(name, await readFile(new URL(`../src/app/components/${name}.meeko`, import.meta.url), 'utf8'))
	const imports = components.map((name) => `import * as UI${name} from "./${name}.meeko"`).join('; ')
	await write('Page', `<script lang="ts">${imports}</script><template>${template}</template>`)
	const page = await import(pathToFileURL(`${directory}/Page.ts`).href)
	return createRoot(() => {
		provide(routeKey, {})
		if (defaults) provide(uiDefaultsKey, defaults)
		return page.renderToString({}).replace(/<!--.*?-->/g, '')
	})
}

/** The classes of each <button> or <a> of the HTML, in order. */
const classesOf = (html) => [...html.matchAll(/<(?:button|a)\b[^>]*?class="([^"]*)"/g)].map(([, value]) => value.replaceAll('&amp;', '&').replaceAll('&gt;', '>').split(' '))

const treatments = ['solid', 'soft', 'surface', 'outline', 'subtle', 'ghost', 'link']
const colors = ['primary', 'secondary', 'neutral', 'success', 'info', 'warning', 'danger']

test('without props UIButton is a solid primary button of size md and radius md, with its native states', async (context) => {
	const [classes] = classesOf(await render(context, '<UIButton>Guardar</UIButton>'))
	assert.deepEqual(classes, buttonTheme().split(' '))
	for (const name of ['bg-primary-9', 'text-primary-contrast', 'not-disabled:hover:bg-primary-10', 'border-transparent', 'min-h-(--ui-control-height-md)', 'p-(--ui-control-padding-md)', 'text-control-md', 'leading-tight', 'rounded-md']) assert.ok(classes.includes(name), name)
	// The native states: focus ring, disabled and the spinner of aria-busy.
	for (const name of ['focus-visible:outline-focus', 'disabled:opacity-(--ui-opacity-disabled)', 'aria-busy:cursor-progress', 'aria-busy:before:animate-spin']) assert.ok(classes.includes(name), name)
	assert.ok(!classes.includes('bg-transparent'), 'the solid replaces the transparent background of the base')
})

test('every pair of variant and color paints with the classes of the catalog', async (context) => {
	const template = treatments.flatMap((variant) => colors.map((color) => `<UIButton variant="${variant}" color="${color}">x</UIButton>`)).join('')
	const rendered = classesOf(await render(context, template))
	let index = 0
	for (const variant of treatments) {
		for (const color of colors) {
			const classes = rendered[index++]
			const compound = colorCompoundVariants.find((entry) => entry.variant === variant && entry.color === color).class.split(' ')
			// A neutral outline keeps the border of the controls, for its contrast.
			const expected = variant === 'outline' && color === 'neutral' ? compound.filter((name) => !name.includes('border-neutral-')) : compound
			for (const name of expected) assert.ok(classes.includes(name), `${variant}/${color}: ${name}`)
		}
	}
	const neutralOutline = rendered[treatments.indexOf('outline') * colors.length + colors.indexOf('neutral')]
	assert.ok(neutralOutline.includes('border-control-border') && neutralOutline.includes('not-disabled:hover:border-control-border'))
	assert.ok(!neutralOutline.includes('border-neutral-7'))
})

test('size, radius, width and elevation are classes, not attributes', async (context) => {
	const html = await render(context, '<UIButton variant="outline" color="danger" size="xl" radius="full" width="full" elevation="sm">A</UIButton><UIButton size="xs" radius="none">B</UIButton>')
	const [large, small] = classesOf(html)
	for (const name of ['min-h-(--ui-control-height-xl)', 'p-(--ui-control-padding-xl)', 'text-control-xl', 'rounded-full', 'w-full', 'shadow-sm', 'border-danger-7']) assert.ok(large.includes(name), name)
	for (const name of ['min-h-(--ui-control-height-xs)', 'text-control-xs', 'rounded-none']) assert.ok(small.includes(name), name)
	assert.ok(!small.includes('rounded-md'))
	assert.doesNotMatch(html, /\s(?:variant|color|size|radius|width|elevation)=/, 'the look is classes, not attributes')
})

test('the removed tone and shape neither change the look nor reach the element', async (context) => {
	// The types reject them (tests/types/button.ts); without the types, they are props that UIButton does not declare.
	const html = await render(context, '<UIButton>A</UIButton><UIButton tone="danger" shape="pill">B</UIButton>')
	const [plain, legacy] = classesOf(html)
	assert.deepEqual(legacy, plain, 'tone and shape add no class: the color is `color` and the radius is `radius`')
	assert.ok(!legacy.includes('bg-danger-9') && !legacy.includes('rounded-full'))
	assert.doesNotMatch(html, /\s(?:tone|shape)=/, 'nor are they attributes')
})

test('iconOnly is a square without padding, and loading keeps the focus and announces the spinner', async (context) => {
	const html = await render(context, '<UIButton iconOnly ariaLabel="Cerrar" size="sm" variant="ghost" color="neutral"><svg aria-hidden="true"></svg></UIButton><UIButton bind:loading="true">Guardando</UIButton>')
	const [icon, busy] = classesOf(html)
	for (const name of ['p-0', 'min-w-(--ui-control-height-sm)', 'min-h-(--ui-control-height-sm)', '[&>svg]:size-(--ui-icon-size)', 'aria-busy:*:hidden', 'bg-transparent', 'text-neutral-11']) assert.ok(icon.includes(name), name)
	assert.ok(!icon.includes('p-(--ui-control-padding-sm)'), 'the padding of the size goes')
	assert.match(html, /<button[^>]*aria-label="Cerrar"/)
	assert.match(html, /<button[^>]*aria-busy="true"[^>]*aria-disabled="true"[^>]*>\s*Guardando/)
	assert.doesNotMatch(html.match(/<button[^>]*aria-busy[^>]*>/)[0], /\sdisabled(?=[\s=>])/, 'busy is not disabled: it keeps the focus')
	assert.ok(busy.includes('p-(--ui-control-padding-md)'))
})

test('the class of the instance is merged with Tailwind Merge and wins over the recipe', async (context) => {
	const html = await render(context, '<UIButton class="rounded-none bg-red-500 px-6 my-action">A</UIButton><UILink href="/docs" class="text-control-lg">Docs</UILink>')
	const [button, link] = classesOf(html)
	for (const name of ['rounded-none', 'bg-red-500', 'px-6', 'my-action']) assert.ok(button.includes(name), name)
	for (const name of ['rounded-md', 'bg-primary-9']) assert.ok(!button.includes(name), `${name} gives way to the class`)
	assert.ok(button.includes('not-disabled:hover:bg-primary-10'), 'another modifier is another property')
	assert.ok(link.includes('text-control-lg') && !link.includes('text-control-md'))
	assert.ok(link.includes('text-primary-contrast'), 'a font size does not remove a text color')
})

test('a font size of the instance keeps the line height of the recipe, and a line height of the instance replaces it', async (context) => {
	const html = await render(context, '<UIButton class="text-sm">A</UIButton><UIButton class="text-sm leading-loose">B</UIButton><UILink href="/a" class="text-lg">C</UILink>')
	const [sized, spaced, link] = classesOf(html)
	assert.ok(sized.includes('text-sm') && !sized.includes('text-control-md'), 'the size of the instance wins')
	assert.ok(sized.includes('leading-tight'), 'text-sm reads --tw-leading in Tailwind 4: it does not drop leading-tight')
	assert.ok(spaced.includes('leading-loose') && !spaced.includes('leading-tight'))
	assert.ok(link.includes('text-lg') && link.includes('leading-tight'))
})

test('ui.defaults.button and ui.defaults.link give the base values, and the props of the instance win', async (context) => {
	const defaults = { button: { variant: 'outline', color: 'neutral', size: 'sm', radius: 'full', class: 'app-button' }, link: { variant: 'ghost', color: 'danger' } }
	const html = await render(context, '<UIButton>A</UIButton><UIButton variant="solid" color="success" radius="sm" class="mine">B</UIButton><UILink href="/a">C</UILink><UILink href="/b" color="info">D</UILink>', defaults)
	const [fromDefaults, own, link, ownLink] = classesOf(html)
	for (const name of ['border-control-border', 'min-h-(--ui-control-height-sm)', 'rounded-full', 'app-button']) assert.ok(fromDefaults.includes(name), name)
	for (const name of ['bg-success-9', 'rounded-sm', 'min-h-(--ui-control-height-sm)', 'app-button', 'mine']) assert.ok(own.includes(name), name)
	assert.ok(!own.includes('rounded-full') && !own.includes('border-control-border'))
	assert.ok(own.indexOf('app-button') < own.indexOf('mine'), 'the class of ui.defaults goes before that of the instance')
	assert.ok(link.includes('text-danger-11') && link.includes('bg-transparent'), 'a danger ghost of ui.defaults.link')
	assert.ok(ownLink.includes('text-info-11') && !ownLink.includes('text-danger-11'))
})

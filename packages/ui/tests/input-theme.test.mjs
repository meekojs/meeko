import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { compile } from '../../meeko/dist/compiler.js'
import { createRoot, provide } from '../../meeko/dist/index.js'
import { colorCompoundVariants } from '../dist/app/theme/base/colors.js'
import { checkboxTheme } from '../dist/app/theme/components/checkbox.js'
import { comboboxTheme } from '../dist/app/theme/components/combobox.js'
import { fieldTheme } from '../dist/app/theme/components/field.js'
import { inputControlTheme, inputRevealTheme, inputTheme } from '../dist/app/theme/components/input.js'
import { markdownEditorTheme } from '../dist/app/theme/components/markdown-editor.js'
import { radioGroupTheme } from '../dist/app/theme/components/radio-group.js'
import { segmentedControlTheme } from '../dist/app/theme/components/segmented-control.js'
import { selectTheme } from '../dist/app/theme/components/select.js'
import { sliderTheme } from '../dist/app/theme/components/slider.js'
import { switchTheme } from '../dist/app/theme/components/switch.js'
import { textareaTheme } from '../dist/app/theme/components/textarea.js'
import { uiDefaultsKey } from '../dist/app/utils/defaults.js'
import { validateDefaults } from '../dist/defaults.js'

const components = ['Input', 'Textarea']

/** Compiles UIInput and UITextarea and a page that uses them, and renders it in SSR with the given `ui.defaults`. */
async function render(context, template, defaults) {
	const parent = fileURLToPath(new URL('../.meeko/', import.meta.url))
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(parent + 'input-theme-')
	context.after(() => rm(directory, { recursive: true, force: true }))
	const runtime = (path) => JSON.stringify(new URL(`../../meeko/dist/${path}`, import.meta.url).href)
	const write = async (file, source) => {
		const code = compile(source, `${directory}/${file}.meeko`)
			.code.replaceAll('from "@meekojs/meeko/internal"', `from ${runtime('internal.js')}`)
			.replaceAll('from "@meekojs/meeko"', `from ${runtime('index.js')}`)
			.replace(/from ["']\.\/(\w+)\.meeko["']/g, 'from "./$1.ts"')
			.replace(/from ["'](?:\.\.\/)+(utils|theme(?:\/components)?)\/([\w-]+)["']/g, (_, folder, utility) => `from ${JSON.stringify(new URL(`../dist/app/${folder}/${utility}.js`, import.meta.url).href)}`)
			.replace(/from ["']\.\/internal\/Icon\.meeko["']/g, 'from "./Icon.ts"')
		await writeFile(`${directory}/${file}.ts`, code)
	}
	await write('Icon', await readFile(new URL('../src/app/components/internal/Icon.meeko', import.meta.url), 'utf8'))
	for (const name of components) await write(name, await readFile(new URL(`../src/app/components/${name}.meeko`, import.meta.url), 'utf8'))
	const imports = components.map((name) => `import * as UI${name} from "./${name}.meeko"`).join('; ')
	await write('Page', `<script lang="ts">${imports}</script><template>${template}</template>`)
	const page = await import(pathToFileURL(`${directory}/Page.ts`).href)
	return createRoot(() => {
		if (defaults) provide(uiDefaultsKey, defaults)
		return page.renderToString({}).replace(/<!--.*?-->/g, '')
	})
}

/** The classes of each element `tag` of the HTML, in order. */
const classesOf = (html, tag) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*?class="([^"]*)"`, 'g'))].map(([, value]) => value.replaceAll('&amp;', '&').replaceAll('&gt;', '>').split(' '))

const sorted = (classes) => [...new Set(typeof classes === 'string' ? classes.split(' ') : classes)].sort()

/** The classes of the field before the migration to `inputTheme`: the look a field without props must keep. */
const before = {
	structure: [
		'box-border block w-full ps-3 py-1.5',
		'border-(length:--ui-border-width) aria-[invalid=true]:border-danger',
		'font-sans text-(length:--ui-input-font-size) leading-snug font-regular',
		'transition-[background-color] duration-(--ui-duration-fast) motion-reduce:transition-none motion-reduce:duration-0',
		'focus-visible:outline-(length:--ui-focus-ring-width) focus-visible:outline-focus focus-visible:outline-offset-(--ui-focus-ring-offset) focus-visible:outline-solid',
		'rounded-md border-solid border-control-border bg-control not-disabled:hover:bg-control-hover text-text placeholder:text-text-soft',
	].join(' '),
	disabled: 'disabled:cursor-not-allowed disabled:opacity-(--ui-opacity-disabled)',
}

const treatments = ['outline', 'surface', 'soft', 'ghost']
const colors = ['primary', 'secondary', 'neutral', 'success', 'info', 'warning', 'danger']

test('without props UIInput, UITextarea and the trigger of a select keep the look they had before the migration', async (context) => {
	const html = await render(context, '<UIInput name="q" /><UITextarea name="t" />')
	const [field] = classesOf(html, 'input')
	const [area] = classesOf(html, 'textarea')
	assert.deepEqual(sorted(field), sorted(`${before.structure} min-h-(--ui-control-height-md) ${before.disabled} pe-3`))
	assert.deepEqual(sorted(field), sorted(inputTheme()), 'the component paints the default recipe')
	assert.deepEqual(sorted(area), sorted(`${before.structure} min-h-24 resize-y pe-3 ${before.disabled}`))
	assert.deepEqual(sorted(area), sorted(textareaTheme()))
	assert.deepEqual(sorted(inputControlTheme()), sorted(`${before.structure} min-h-(--ui-control-height-md) pe-3`))
	assert.deepEqual(sorted(inputControlTheme({ clearable: true, multiline: true })), sorted(`${before.structure} min-h-24 resize-y pe-(--ui-control-height-md)`))
})

test('every pair of variant and color paints the background and the text of the catalog, on the border of the controls', async (context) => {
	const template = treatments.flatMap((variant) => colors.map((color) => `<UIInput variant="${variant}" color="${color}" />`)).join('')
	const html = await render(context, template)
	const rendered = classesOf(html, 'input')
	let index = 0
	for (const variant of treatments) {
		for (const color of colors) {
			const classes = rendered[index++]
			const label = `${variant}/${color}`
			const compound = colorCompoundVariants.find((entry) => entry.variant === variant && entry.color === color).class.split(' ')
			const painted = compound.filter((name) => !name.startsWith('border-') && !name.startsWith('not-disabled:hover:border-') && !name.startsWith('not-disabled:active:') && name !== 'text-neutral-11')
			if (variant === 'outline' && color === 'neutral') {
				for (const name of ['bg-control', 'not-disabled:hover:bg-control-hover', 'text-text']) assert.ok(classes.includes(name), `${label}: ${name}`)
				assert.ok(!classes.includes('not-disabled:hover:bg-neutral-2'), `${label}: the field of always`)
			} else for (const name of painted) assert.ok(classes.includes(name), `${label}: ${name}`)
			assert.ok(classes.includes('border-control-border') && classes.includes('aria-[invalid=true]:border-danger'), `${label}: the border of a control, danger when invalid`)
			assert.ok(!classes.some((name) => /^(?:not-disabled:hover:)?border-(?:primary|secondary|neutral|success|info|warning|danger|transparent)/.test(name)), `${label}: no border of the scale in ${classes.join(' ')}`)
			assert.ok(!classes.some((name) => name.startsWith('not-disabled:active:')), `${label}: a click does not flash the field`)
			if (color === 'neutral') assert.ok(classes.includes('text-text') && !classes.includes('text-neutral-11'), `${label}: a neutral field writes with the text of the page`)
			if (variant === 'ghost') assert.ok(classes.includes('border-x-0') && classes.includes('border-t-0'), `${label}: only the bottom line`)
		}
	}
	assert.doesNotMatch(html, /\s(?:variant|color)=/, 'the look is classes, not attributes')
})

test('size and radius are classes, and the button of reveal is as wide as the field of its size is tall', async (context) => {
	const html = await render(context, '<UIInput size="xs" radius="none" /><UIInput size="xl" radius="full" /><UIInput type="password" reveal size="lg" />')
	const [small, large, secret] = classesOf(html, 'input')
	for (const name of ['min-h-(--ui-control-height-xs)', 'ps-1.5', 'pe-1.5', 'rounded-none']) assert.ok(small.includes(name), name)
	for (const name of ['min-h-(--ui-control-height-xl)', 'ps-5', 'pe-5', 'text-control-xl', 'rounded-full']) assert.ok(large.includes(name), name)
	assert.ok(!small.includes('rounded-md') && !small.includes('min-h-(--ui-control-height-md)'))
	assert.ok(!large.includes('text-(length:--ui-input-font-size)'), 'xl sets its own font size')
	for (const name of ['min-h-(--ui-control-height-lg)', 'ps-4', 'pe-(--ui-control-height-lg)']) assert.ok(secret.includes(name), name)
	assert.ok(!secret.includes('pe-4'), 'reveal replaces the end padding of the size')
	const [toggle] = classesOf(html, 'button')
	assert.ok(toggle.includes('w-(--ui-control-height-lg)') && !toggle.includes('w-(--ui-control-height-md)'), toggle.join(' '))
	assert.ok(inputRevealTheme().toggle().includes('w-(--ui-control-height-md)'), 'md by default')
	assert.doesNotMatch(html, /\s(?:size|radius)=/)
})

test('each size fits its line, padding and border in the height of its token, the one of a button of that size', () => {
	// The vertical padding and the font of each size; md is the field of always (checked class by class above).
	const expected = {
		xs: ['min-h-(--ui-control-height-xs)', 'py-0.5', 'text-control-xs'],
		sm: ['min-h-(--ui-control-height-sm)', 'py-0.5', 'text-control-sm'],
		md: ['min-h-(--ui-control-height-md)', 'py-1.5', 'text-(length:--ui-input-font-size)'],
		lg: ['min-h-(--ui-control-height-lg)', 'py-1.5', 'text-(length:--ui-input-font-size)'],
		xl: ['min-h-(--ui-control-height-xl)', 'py-1.5', 'text-control-xl'],
	}
	const vertical = (name) => /^(?:min-h|h|py|pt|pb)-|^text-(?:control|\(length)/.test(name)
	for (const [size, classes] of Object.entries(expected)) {
		const field = inputTheme({ size }).split(' ')
		assert.deepEqual(sorted(field.filter(vertical)), sorted(classes), size)
		assert.ok(field.includes('leading-snug'), `${size}: the line height of a field`)
		// With reveal, the button keeps the square of the size: the end padding is its height.
		const secret = inputTheme({ size, reveal: true }).split(' ')
		assert.deepEqual(sorted(secret.filter(vertical)), sorted(classes), `${size} with reveal`)
		assert.ok(secret.includes(`pe-(--ui-control-height-${size})`), `${size}: room for the button of reveal`)
	}
	// Textarea and the trigger of a select or a combobox do not take a size: they keep the structure of always.
	for (const classes of [textareaTheme(), inputControlTheme(), inputControlTheme({ clearable: true })]) {
		const list = classes.split(' ')
		assert.ok(list.includes('py-1.5') && list.includes('text-(length:--ui-input-font-size)') && !list.includes('py-0.5'), classes)
	}
})

test('the class of the instance is merged with Tailwind Merge and wins over the recipe of each form control', async (context) => {
	const html = await render(context, '<UIInput variant="surface" color="primary" class="bg-red-500 rounded-none ps-8 my-field" /><UITextarea class="min-h-40 bg-red-500" />')
	const [field] = classesOf(html, 'input')
	const [area] = classesOf(html, 'textarea')
	for (const name of ['bg-red-500', 'rounded-none', 'ps-8', 'my-field', 'pe-3', 'text-primary-11', 'not-disabled:hover:bg-primary-3']) assert.ok(field.includes(name), name)
	for (const name of ['bg-primary-2', 'rounded-md', 'ps-3']) assert.ok(!field.includes(name), `${name} gives way to the class`)
	assert.ok(area.includes('min-h-40') && !area.includes('min-h-24') && area.includes('bg-red-500') && !area.includes('bg-control'), area.join(' '))
	// The recipes with slots merge the class of each slot too.
	const slotted = [
		[checkboxTheme().input({ class: 'size-6' }), 'size-6', 'size-4'],
		[switchTheme().input({ class: 'bg-red-500' }), 'bg-red-500', 'bg-control'],
		[radioGroupTheme().options({ class: 'gap-6' }), 'gap-6', 'gap-2'],
		[segmentedControlTheme().options({ class: 'rounded-none' }), 'rounded-none', 'rounded-lg'],
		[fieldTheme().label({ class: 'text-lg' }), 'text-lg', 'text-sm'],
		[sliderTheme().base({ class: 'gap-4' }), 'gap-4', 'gap-2'],
		[selectTheme().clear({ class: 'rounded-none' }), 'rounded-none', 'rounded-md'],
		[comboboxTheme().chip({ class: 'rounded-sm' }), 'rounded-sm', 'rounded-full'],
		[markdownEditorTheme().surface({ class: 'rounded-none' }), 'rounded-none', 'rounded-lg'],
	]
	for (const [classes, wins, loses] of slotted) {
		const list = classes.split(' ')
		assert.ok(list.includes(wins) && !list.includes(loses), `${wins} over ${loses}: ${classes}`)
	}
})

test('ui.defaults.input gives the base variant, color, size and radius, and the props of the instance win', async (context) => {
	const defaults = { input: { variant: 'soft', color: 'primary', size: 'sm', radius: 'full', class: 'app-field' } }
	validateDefaults(defaults)
	const html = await render(context, '<UIInput /><UIInput variant="outline" color="neutral" size="lg" radius="sm" class="mine" />', defaults)
	const [fromDefaults, own] = classesOf(html, 'input')
	for (const name of ['bg-primary-3', 'text-primary-11', 'min-h-(--ui-control-height-sm)', 'rounded-full', 'app-field']) assert.ok(fromDefaults.includes(name), name)
	for (const name of ['bg-control', 'text-text', 'min-h-(--ui-control-height-lg)', 'rounded-sm', 'app-field', 'mine']) assert.ok(own.includes(name), name)
	assert.ok(!own.includes('bg-primary-3') && !own.includes('rounded-full'))
	assert.throws(() => validateDefaults({ input: { variant: 'solid' } }), /defaults\.input\.variant/)
	assert.throws(() => validateDefaults({ input: { appearance: { color: 'danger' } } }), /defaults\.input\.appearance/)
})

test('the removed appearance prop neither changes the look nor reaches the element', async (context) => {
	// The types reject it; without the types, it is a prop that UIInput does not declare, so it falls through.
	const html = await render(context, `<UIInput name="a" /><UIInput name="b" bind:appearance="{ variant: 'soft', color: 'danger', size: 'lg' }" />`)
	const [plain, legacy] = classesOf(html, 'input')
	assert.deepEqual(legacy, plain, 'appearance adds no class: the look is variant, color, size and radius')
})

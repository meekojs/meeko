import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { routeKey } from '../../meeko/dist/app/runtime/navigation.js'
import { checkSource } from '../../meeko/dist/check.js'
import { compile } from '../../meeko/dist/compiler.js'
import { createRoot, provide } from '../../meeko/dist/index.js'
import { uiDefaultsKey } from '../dist/app/utils/defaults.js'
import { builtinMessages } from '../dist/app/utils/messages.js'
import { radioGroup, segmentedControl } from '../dist/app/variants/choice.js'
import { validateDefaults } from '../dist/defaults.js'

const components = ['Popover', 'Menu', 'SegmentedControl', 'RadioGroup']

/** Compiles the real components and a page that uses them, and renders it in SSR, with `ui.defaults` if given. */
async function render(context, template, defaults) {
	const parent = fileURLToPath(new URL('../.meeko/', import.meta.url))
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(parent + 'menu-render-')
	context.after(() => rm(directory, { recursive: true, force: true }))
	const runtime = (path) => JSON.stringify(new URL(`../../meeko/dist/${path}`, import.meta.url).href)
	const write = async (file, source) => {
		const code = compile(source, `${directory}/${file}.meeko`)
			.code.replaceAll('from "@meekojs/meeko/internal"', `from ${runtime('internal.js')}`)
			.replaceAll('from "@meekojs/meeko"', `from ${runtime('index.js')}`)
			.replace(/from ["']\.\/internal\/Icon\.meeko["']/g, 'from "./Icon.ts"')
			.replace(/from ["']\.\/(\w+)\.meeko["']/g, 'from "./$1.ts"')
			.replace(/from ["'](?:\.\.\/)+(utils|variants|theme(?:\/components)?)\/([\w-]+)["']/g, (_, folder, utility) => `from ${JSON.stringify(new URL(`../dist/app/${folder}/${utility}.js`, import.meta.url).href)}`)
		await writeFile(`${directory}/${file}.ts`, code)
	}
	await write('Icon', await readFile(new URL('../src/app/components/internal/Icon.meeko', import.meta.url), 'utf8'))
	for (const name of components) {
		const source = await readFile(new URL(`../src/app/components/${name}.meeko`, import.meta.url), 'utf8')
		// useId is an auto-import of the app; this compilation has no app, so it imports it.
		await write(name, source.includes('useId') && !/import \{[^}]*useId/.test(source) ? source.replace(/(<script[^>]*>)/, '$1\nimport { useId } from "@meekojs/meeko"') : source)
	}
	const imports = components.map((name) => `import * as UI${name} from "./${name}.meeko"`).join('; ')
	await write('Page', `<script lang="ts">import { signal } from "@meekojs/meeko"; ${imports}; const days = [{ value: '7', label: '7 días' }, { value: '30', label: '30 días' }, { value: '90', label: '90 días', disabled: true }]</script><template>${template}</template>`)
	const page = await import(pathToFileURL(`${directory}/Page.ts`).href)
	return createRoot(() => {
		provide(routeKey, {})
		if (defaults) provide(uiDefaultsKey, defaults)
		return page.renderToString({}).replace(/<!--.*?-->/g, '')
	})
}

/** The opening tags of the elements whose attributes match. */
const tags = (html, pattern) => [...html.matchAll(/<[a-z][^>]*>/g)].map(([value]) => value).filter((value) => pattern.test(value))
const tag = (html, pattern) => {
	const found = tags(html, pattern)[0]
	assert.ok(found, `no tag matches ${pattern}`)
	return found
}
const attribute = (markup, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(markup)?.[1]
const classes = (markup) => (attribute(markup, 'class') ?? '').split(' ')

const items = `[
	{ label: 'Renombrar', value: 'rename', shortcut: 'F2', icon: 'M2 2h4' },
	{ label: 'Ajustes', href: '/settings' },
	{ label: 'Fuera', href: 'https://example.com', target: '_blank' },
	{ label: 'Archivar', disabled: true },
	{ label: 'Perdido', href: '/gone', disabled: true },
	{ separator: true },
	{ label: 'Eliminar', tone: 'danger' },
]`

test('UIMenu renders the Menu Button pattern on the server: trigger, menu, items, links and separators', { timeout: 60_000 }, async (context) => {
	const html = await render(context, `<UIMenu triggerLabel="Acciones" bind:items="${items}"><button type="button" role="menuitem">Propio</button></UIMenu>`)
	const trigger = tag(html, /aria-haspopup=/)
	assert.match(trigger, /^<button/)
	assert.equal(attribute(trigger, 'type'), 'button')
	assert.equal(attribute(trigger, 'aria-haspopup'), 'menu')
	assert.equal(attribute(trigger, 'aria-expanded'), 'false')
	const menu = tag(html, /role="menu"/)
	assert.equal(attribute(trigger, 'popovertarget'), attribute(menu, 'id'), 'the native popover opens it without JavaScript')
	assert.equal(attribute(trigger, 'aria-controls'), attribute(menu, 'id'))
	assert.equal(attribute(menu, 'aria-labelledby'), attribute(trigger, 'id'), 'the menu is named by its trigger')
	assert.equal(attribute(menu, 'popover'), 'auto')
	assert.match(menu, /^<span/, 'the content is phrasing content, valid inside a <p>')
	assert.equal(attribute(trigger, 'aria-label'), undefined, 'a trigger with text is named by its text')
	assert.match(html, /<button[^>]*aria-haspopup="menu"[^>]*>Acciones\s*<svg[^>]*aria-hidden="true"/, 'the text and a chevron')
	assert.ok(classes(trigger).includes('bg-neutral-2') && classes(trigger).includes('border-neutral-6'), 'a trigger with text is a neutral surface button')

	const menuitems = tags(html, /role="menuitem"/)
	assert.equal(menuitems.length, 7, 'six items of the data and one of the snippet')
	const [rename, settings, outside, archive, lost, remove, own] = menuitems
	assert.match(rename, /^<button/)
	assert.equal(attribute(rename, 'type'), 'button')
	assert.equal(attribute(rename, 'tabindex'), '-1', 'the arrows move the focus, not Tab')
	assert.equal(attribute(rename, 'data-value'), 'rename')
	assert.match(html, /role="menuitem"[^>]*>\s*<svg[^>]*>\s*<path d="M2 2h4"[^>]*><\/path>\s*<\/svg>\s*<span[^>]*>Renombrar<\/span><kbd[^>]*>F2<\/kbd><\/button>/, 'icon, text and shortcut, in that order')
	assert.match(settings, /^<a/)
	assert.equal(attribute(settings, 'href'), '/settings')
	assert.equal(attribute(outside, 'rel'), 'noopener noreferrer')
	assert.equal(attribute(archive, 'aria-disabled'), 'true')
	assert.equal(attribute(archive, 'disabled'), undefined, 'a disabled item stays perceivable, and the arrows skip it')
	assert.match(lost, /^<a/)
	assert.equal(attribute(lost, 'href'), undefined, 'a disabled link goes nowhere')
	assert.equal(attribute(lost, 'aria-disabled'), 'true')
	assert.ok(classes(remove).includes('text-danger-text'), 'the danger tone')
	assert.ok(!classes(rename).includes('text-danger-text'))
	assert.equal(own, '<button type="button" role="menuitem">', 'the items of the snippet go after those of the data')
	const separator = tag(html, /role="separator"/)
	assert.match(separator, /^<span/)
	assert.ok(classes(separator).includes('bg-border'))
	assert.doesNotMatch(html, /undefined|\bto="/)
})

test('UIMenu without a text or a trigger is an icon button named by the messages, or by ariaLabel', { timeout: 60_000 }, async (context) => {
	const html = await render(context, `<UIMenu bind:items="[{ label: 'Uno' }]" /><UIMenu ariaLabel="Acciones de la fila" size="sm" variant="outline" placement="bottom-end" bind:items="[{ label: 'Dos' }]" /><UIMenu label="Cuenta" bind:disabled="true"><snippet name="trigger"><img alt="Mi cuenta" src="/me.png"></snippet></UIMenu>`)
	const [plain, named, custom] = tags(html, /aria-haspopup=/)
	assert.equal(attribute(plain, 'aria-label'), builtinMessages.es.menu.trigger)
	assert.ok(classes(plain).includes('p-0') && classes(plain).includes('bg-transparent'), 'a square ghost button')
	assert.match(html, /aria-label="Más acciones"[^>]*>\s*<svg[^>]*>\s*<path d="M2\.75 8a/, 'the three dots')
	assert.equal(attribute(named, 'aria-label'), 'Acciones de la fila')
	assert.ok(classes(named).includes('min-h-(--ui-control-height-sm)'))
	assert.ok(classes(named).includes('border-control-border'), 'the variant of the trigger')
	const menus = tags(html, /role="menu"/)
	assert.ok(classes(menus[1]).includes('[position-area:bottom_span-left]'), 'placement')
	assert.equal(attribute(custom, 'aria-label'), undefined, 'the content of the snippet names it')
	assert.match(custom, /\sdisabled(?:=""|\s|>)/)
	assert.match(html, /<button[^>]*aria-haspopup="menu"[^>]*><img alt="Mi cuenta" src="\/me.png"><\/button>/)
	assert.equal(attribute(menus[2], 'aria-label'), 'Cuenta')
	assert.equal(attribute(menus[2], 'aria-labelledby'), undefined)
})

test('UIMenu takes class and ui, after those of ui.defaults, and paints an item snippet', { timeout: 60_000 }, async (context) => {
	const html = await render(context, `<UIMenu triggerLabel="Más" class="my-menu" bind:ui="{ item: 'my-item', trigger: 'my-trigger', separator: 'my-line' }" bind:items="[{ label: 'Uno', value: 'one' }, { separator: true }]"><snippet name="item" params="item"><strong>{item.label}!</strong></snippet></UIMenu>`, { menu: { class: 'app-menu', ui: { item: 'app-item' } } })
	const menu = classes(tag(html, /role="menu"/))
	assert.ok(menu.includes('min-w-(--ui-page-aside-width)'), 'the look of a menu of <UIPopover>')
	assert.ok(menu.indexOf('app-menu') < menu.indexOf('my-menu') && menu.indexOf('app-menu') >= 0)
	const item = classes(tag(html, /role="menuitem"/))
	assert.ok(item.indexOf('app-item') < item.indexOf('my-item') && item.indexOf('app-item') >= 0)
	assert.ok(classes(tag(html, /aria-haspopup=/)).includes('my-trigger'))
	assert.ok(classes(tag(html, /role="separator"/)).includes('my-line'))
	assert.match(html, /role="menuitem"[^>]*><strong>Uno!<\/strong><\/button>/)
})

test('UISegmentedControl renders native radios with a hidden legend, a size, a track that scrolls and defaults', { timeout: 60_000 }, async (context) => {
	const html = await render(context, `<UISegmentedControl legend="Periodo" bind:hideLegend="true" size="sm" name="days" bind:required="true" model="signal('30')" bind:options="days" /><UISegmentedControl ariaLabel="Vista" bind:options="days" /><UISegmentedControl legend="Con defaults" bind:options="days" class="mine" bind:ui="{ option: 'my-option' }" />`, { segmentedControl: { size: 'sm', class: 'app-segmented', ui: { options: 'app-track' } } })
	const fieldsets = tags(html, /<fieldset/)
	assert.equal(fieldsets.length, 3)
	assert.match(html, /<legend[^>]*>Periodo<\/legend>/, 'the legend names the group, without whitespace')
	const legend = classes(tag(html, /<legend/))
	assert.ok(legend.includes('[clip-path:inset(50%)]'), 'only for screen readers')
	const radios = tags(html, /type="radio"/)
	assert.equal(radios.length, 9)
	assert.ok(
		radios.slice(0, 3).every((radio) => attribute(radio, 'name') === 'days' && /\srequired/.test(radio)),
		'one native group, which the form sends and validates',
	)
	assert.match(radios[1], /\schecked/)
	assert.match(radios[2], /\sdisabled/)
	assert.notEqual(attribute(radios[3], 'name'), attribute(radios[6], 'name'), 'a generated name per group')
	const options = tags(html, /<label/)
	assert.ok(classes(options[0]).includes('text-control-sm'))
	assert.ok(classes(options[0]).includes('whitespace-nowrap') && classes(options[0]).includes('shrink-0'), 'an option never breaks')
	const track = classes(tags(html, /<div/)[0])
	assert.ok(track.includes('overflow-x-auto') && track.includes('flex-nowrap') && track.includes('max-w-full'), 'the track scrolls inside its width')
	assert.equal(attribute(fieldsets[0], 'aria-label'), undefined)
	assert.equal(attribute(fieldsets[1], 'aria-label'), 'Vista')
	assert.equal(tags(html, /<legend/).length, 2, 'ariaLabel instead of a legend')
	assert.ok(classes(options[3]).includes('text-control-sm'), 'the size of ui.defaults')
	const last = classes(fieldsets[2])
	assert.ok(last.indexOf('app-segmented') < last.indexOf('mine') && last.indexOf('app-segmented') >= 0)
	assert.ok(classes(tags(html, /<div/)[2]).includes('app-track'))
	assert.ok(classes(options[6]).includes('my-option'))
	assert.doesNotMatch(html, /undefined/)
})

test('an explicit size wins over the one of ui.defaults, and ui.defaults validates both components', { timeout: 60_000 }, async (context) => {
	const html = await render(context, `<UISegmentedControl legend="P" size="md" bind:options="days" />`, { segmentedControl: { size: 'sm' } })
	assert.ok(classes(tag(html, /<label/)).includes('text-control-md'))
	validateDefaults({ menu: { class: 'a', ui: { item: 'b', shortcut: 'c' } }, segmentedControl: { size: 'md', ui: { legend: 'd' } } })
	assert.throws(() => validateDefaults({ segmentedControl: { size: 'lg' } }), /use one of sm, md/)
	assert.throws(() => validateDefaults({ menu: { ui: { list: 'x' } } }), /its slots are base, trigger, chevron, item, icon, label, shortcut, separator/)
	assert.throws(() => validateDefaults({ menu: { tone: 'danger' } }), /unknown option defaults.menu.tone/)
})

test('the segments of UIRadioGroup keep their classes, which UISegmentedControl shares', () => {
	const group = radioGroup({ variant: 'segmented' })
	for (const slot of ['options', 'option']) {
		for (const name of group[slot]()
			.split(' ')
			.filter((name) => !/min-h|px-3|outline-offset|w-fit|flex-wrap|text-md|leading-normal/.test(name))) {
			assert.ok(segmentedControl()[slot]().split(' ').includes(name), `${slot}: ${name}`)
		}
	}
	assert.ok(segmentedControl().input().includes('opacity-(--ui-opacity-hidden)'), 'the input covers its segment, unseen')
	assert.match(group.options(), /flex-wrap/, 'a radio group still wraps')
})

test('every text of the menu has Spanish and English', () => {
	assert.equal(builtinMessages.es.menu.trigger, 'Más acciones')
	assert.equal(builtinMessages.en.menu.trigger, 'More actions')
})

test('UIMenu and UISegmentedControl type their props, items, events and snippets in a template', { timeout: 180_000 }, async (context) => {
	const parent = fileURLToPath(new URL('../.meeko/', import.meta.url))
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(parent + 'menu-types-')
	context.after(() => rm(directory, { recursive: true, force: true }))
	const filename = directory + '/Consumer.meeko'
	const component = (name) => relative(dirname(filename), fileURLToPath(new URL(`../dist/app/components/${name}.meeko`, import.meta.url))).replaceAll('\\', '/')
	const source = `<script lang="ts">
import { signal } from '@meekojs/meeko';
import * as UIMenu from '${component('Menu')}';
import * as UISegmentedControl from '${component('SegmentedControl')}';
const days = signal('7');
const open = signal(false);
const chosen = signal('');
</script>
<template><UIMenu triggerLabel="Acciones" placement="bottom-end" model="open" bind:items="[{ label: 'Uno', onSelect: (item) => (chosen.value = item.label) }, { label: 'Dos', href: '/dos' }, { separator: true }, { label: 'Tres', tone: 'danger', shortcut: 'Supr' }]" on:select="(item) => (chosen.value = item.label.toUpperCase())"><snippet name="item" params="item"><b>{item.label.toUpperCase()}</b></snippet></UIMenu><UISegmentedControl legend="Periodo" hideLegend size="sm" model="days" bind:options="[{ value: '7', label: '7 días' }]" /><UISegmentedControl ariaLabel="Vista" bind:options="[]" /></template>`
	const errors = (diagnostics) => diagnostics.filter((item) => item.severity !== 'warning')
	assert.deepEqual(errors(await checkSource(source, filename)), [])
	for (const [broken, pattern] of [
		[source.replace('placement="bottom-end"', 'placement="sideways"'), /sideways/],
		[source.replace("tone: 'danger'", "tone: 'warning'"), /warning/],
		[source.replace("href: '/dos' }", "href: '/dos', onSelect: () => {} }"), /onSelect|never/],
		[source.replace('item.label.toUpperCase())"', 'item.missing)"'), /missing/],
		[source.replace('{item.label.toUpperCase()}', '{item.label.toFixed()}'), /toFixed/],
		[source.replace('size="sm"', 'size="lg"'), /lg/],
		[source.replace('ariaLabel="Vista"', ''), /legend|ariaLabel/],
		[source.replace('ariaLabel="Vista"', 'ariaLabel="Vista" legend="Vista"'), /legend|never/],
	]) {
		const diagnostics = errors(await checkSource(broken, filename))
		assert.ok(
			diagnostics.some((item) => pattern.test(item.message)),
			JSON.stringify(diagnostics),
		)
	}
})

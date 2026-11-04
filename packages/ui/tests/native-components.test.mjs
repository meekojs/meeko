import { createRoot, signal } from '@meekojs/meeko'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { checkSource } from '../../meeko/dist/check.js'
import { commandKeyTarget, commandRows, commandShortcut } from '../dist/app/utils/command-palette.js'
import { builtinMessages, commandPaletteStatusText } from '../dist/app/utils/messages.js'
import { createSelect } from '../dist/app/utils/select.js'
import { createTabs, selectedTab, tabsKeyTarget } from '../dist/app/utils/tabs.js'
import { withViewTransition } from '../dist/app/utils/view-transition.js'

/** A browser with what withViewTransition reads; `prototype` is the one of ViewTransition. */
function fakeBrowser(t, { start, prototype = { types: null }, hidden = false, reduced = false, elements = 100 } = {}) {
	const names = ['document', 'matchMedia', 'ViewTransition']
	const before = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name))
	t.after(() => {
		names.forEach((name, index) => {
			if (before[index]) Object.defineProperty(globalThis, name, before[index])
			else delete globalThis[name]
		})
	})
	const size = { elements }
	globalThis.document = { startViewTransition: start, visibilityState: hidden ? 'hidden' : 'visible', getElementsByTagName: () => ({ length: size.elements }) }
	globalThis.matchMedia = () => ({ matches: reduced })
	globalThis.ViewTransition = prototype ? function ViewTransition() {} : undefined
	if (prototype) Object.assign(globalThis.ViewTransition.prototype, prototype)
	return size
}

const transition = (extra = {}) => ({ ready: Promise.resolve(), finished: Promise.resolve(), ...extra })

test('withViewTransition applies the update without animating when it cannot animate', (t) => {
	let calls = 0
	const update = () => calls++
	// Node has no document, as in SSR.
	assert.equal(withViewTransition(update), undefined)
	assert.equal(calls, 1)
	for (const options of [{ start: undefined }, { start: () => assert.fail('hidden'), hidden: true }, { start: () => assert.fail('reduced'), reduced: true }]) {
		fakeBrowser(t, options)
		assert.equal(withViewTransition(update), undefined)
	}
	assert.equal(calls, 4)
	// Names are limited to a type: a browser without types would only crossfade the page.
	fakeBrowser(t, { start: () => assert.fail('no types'), prototype: {} })
	assert.equal(withViewTransition(update, { types: ['x'] }), undefined)
	assert.equal(calls, 5)
	// A page above the limit, also with reduced motion or without the API.
	for (const options of [{ start: () => assert.fail('large') }, { start: () => assert.fail('large and reduced'), reduced: true }, { start: undefined }]) {
		fakeBrowser(t, { ...options, elements: 4001 })
		assert.equal(withViewTransition(update), undefined)
	}
	assert.equal(calls, 8)
})

test('withViewTransition animates up to the limit, and skips when the update brings the page over it', (t) => {
	let skips = 0
	let captured
	const start = (argument) => {
		captured = typeof argument === 'function' ? argument : argument.update
		return transition({ skipTransition: () => skips++ })
	}
	const size = fakeBrowser(t, { start, elements: 4000 })
	assert.ok(withViewTransition(() => {}))
	captured()
	assert.equal(skips, 0, 'a page at the limit keeps its animation')

	let calls = 0
	assert.ok(
		withViewTransition(
			() => {
				calls++
				size.elements = 4001
			},
			{ types: ['ui-tab'] },
		),
	)
	assert.equal(calls, 0, 'the update waits for the capture')
	captured()
	assert.equal(calls, 1)
	assert.equal(skips, 1)

	// The promise of an asynchronous update still reaches the browser, which waits for it.
	size.elements = 100
	const pending = Promise.resolve()
	withViewTransition(() => pending)
	assert.equal(captured(), pending)
})

test('withViewTransition passes the types and swallows the rejection of a skipped animation', async (t) => {
	const seen = []
	const running = transition({ ready: Promise.reject(new DOMException('Skipped', 'AbortError')) })
	let calls = 0
	const update = () => calls++
	fakeBrowser(t, {
		start(argument) {
			seen.push(argument)
			return running
		},
	})
	assert.equal(withViewTransition(update, { types: ['ui-tab'] }), running)
	assert.equal(withViewTransition(update), running)
	// The browser gets a wrapper of `update`, which then checks the size of the page.
	assert.deepEqual(seen[0].types, ['ui-tab'])
	seen[0].update()
	seen[1]()
	assert.equal(calls, 2)
	// An unhandled rejection would fail this test.
	await new Promise((done) => setImmediate(done))
})

test('tabs: the arrows wrap and skip disabled tabs, Home and End go to the ends, right-to-left swaps them', () => {
	const disabled = [false, true, false, false]
	assert.equal(tabsKeyTarget('ArrowRight', 0, disabled), 2)
	assert.equal(tabsKeyTarget('ArrowRight', 3, disabled), 0)
	assert.equal(tabsKeyTarget('ArrowLeft', 0, disabled), 3)
	assert.equal(tabsKeyTarget('ArrowLeft', 0, disabled, true), 2)
	assert.equal(tabsKeyTarget('Home', 3, [true, false, false]), 1)
	assert.equal(tabsKeyTarget('End', 0, [false, false, true]), 1)
	assert.equal(tabsKeyTarget('ArrowDown', 0, disabled), undefined)
	assert.equal(tabsKeyTarget('x', 0, disabled), undefined)
})

test('tabs: an unknown or disabled value shows the first tab that can be chosen', () => {
	const items = [
		{ value: 'a', label: 'A', disabled: true },
		{ value: 'b', label: 'B' },
		{ value: 'c', label: 'C' },
	]
	assert.equal(selectedTab(items, 'c'), 'c')
	assert.equal(selectedTab(items, undefined), 'b')
	assert.equal(selectedTab(items, 'a'), 'b')
	assert.equal(selectedTab(items, 'z'), 'b')
	assert.equal(selectedTab([], 'z'), undefined)
})

test('tabs: choosing writes the model and the event, once, and never a disabled or current tab', () => {
	createRoot((dispose) => {
		const items = [
			{ value: 'a', label: 'A' },
			{ value: 'b', label: 'B' },
			{ value: 'c', label: 'C', disabled: true },
		]
		const model = signal('a')
		const emitted = []
		const tabs = createTabs({ items }, model, 'id', (value) => emitted.push(value))
		assert.equal(tabs.selected.value, 'a')
		assert.equal(tabs.tabId(items[1]), 'id-tab-1')
		assert.equal(tabs.panelId(items[1]), 'id-panel-1')
		tabs.choose(items[0])
		tabs.choose(items[2])
		assert.deepEqual(emitted, [])
		tabs.choose(items[1])
		assert.equal(model.value, 'b')
		assert.deepEqual(emitted, ['b'])
		// Without a mounted element the screen follows the model only once mounted.
		const release = tabs.mount(null)
		assert.equal(tabs.selected.value, 'b', 'without the API the change applies at once')
		release()
		dispose()
	})
})

test('command palette: the rows are flat in the order of the arrows, with their depth, label and link', () => {
	const results = [
		{
			title: 'Guía',
			url: '/guide',
			sections: [
				{ title: 'Inicio', url: '/guide#start' },
				{ title: 'Fin', url: '/guide#end' },
			],
		},
		{ title: 'API', url: '/api' },
	]
	const rows = commandRows(results, { labelBy: 'title', hrefBy: 'url', childrenBy: 'sections' })
	assert.deepEqual(
		rows.map((row) => [row.index, row.depth, row.label, row.href]),
		[
			[0, 0, 'Guía', '/guide'],
			[1, 1, 'Inicio', '/guide#start'],
			[2, 1, 'Fin', '/guide#end'],
			[3, 0, 'API', '/api'],
		],
	)
	assert.equal(rows[1].item, results[0].sections[0])
	// Functions, and rows without a link.
	assert.deepEqual(
		commandRows(['a'], { labelBy: (item) => item.toUpperCase(), hrefBy: () => undefined }).map((row) => [row.label, row.href]),
		[['A', undefined]],
	)
})

test('command palette: the arrows wrap around, and the shortcuts respect what the reader is writing', () => {
	assert.equal(commandKeyTarget('ArrowDown', 3, 4), 0)
	assert.equal(commandKeyTarget('ArrowUp', 0, 4), 3)
	assert.equal(commandKeyTarget('ArrowDown', 0, 0), undefined)
	assert.equal(commandKeyTarget('Enter', 0, 4), undefined)
	const key = (name, extra = {}) => ({ key: name, ctrlKey: false, metaKey: false, altKey: false, ...extra })
	assert.equal(commandShortcut(key('k', { ctrlKey: true }), true), true, 'Ctrl+K also opens from a field')
	assert.equal(commandShortcut(key('K', { metaKey: true }), false), true)
	assert.equal(commandShortcut(key('k'), false), false)
	assert.equal(commandShortcut(key('/'), false), true)
	assert.equal(commandShortcut(key('/'), true), false, '/ is text inside a field')
	assert.equal(commandShortcut(key('/', { altKey: true }), false), false)
})

test('command palette: each status has its notice, and the query is inserted literally', () => {
	for (const locale of ['es', 'en']) {
		const text = builtinMessages[locale].commandPalette
		assert.equal(commandPaletteStatusText(text, 'ready', 'x'), '')
		assert.equal(commandPaletteStatusText(text, 'idle', ''), '')
		assert.equal(commandPaletteStatusText(text, 'loading', ''), text.loading)
		assert.equal(commandPaletteStatusText(text, 'unavailable', ''), text.unavailable)
	}
	assert.equal(commandPaletteStatusText(builtinMessages.es.commandPalette, 'empty', '$& <b>'), 'Sin resultados para «$& <b>».')
})

test('select: a hidden first option stands for no choice and for a value outside the options, only then', () => {
	createRoot((dispose) => {
		const model = signal(null)
		const options = signal([
			{ id: 1, name: 'Ana' },
			{ id: 2, name: 'Bea' },
		])
		const select = createSelect(
			{
				get options() {
					return options.value
				},
				by: 'id',
				placeholder: 'Elige',
			},
			model,
			'id',
			() => {},
		)
		assert.deepEqual([select.nativeIndex.value, select.blankValue.value, select.blankLabel.value], [0, '', 'Elige'])
		model.value = { id: 2, name: 'Bea' }
		assert.equal(select.nativeIndex.value, 2, 'by finds the option')
		// The options change: the model keeps the value, and the form still sends it.
		options.value = [{ id: 1, name: 'Ana' }]
		assert.deepEqual([select.nativeIndex.value, select.blankValue.value, select.blankLabel.value], [0, '2', 'Bea'])
		assert.deepEqual(model.value, { id: 2, name: 'Bea' })
		dispose()
	})
})

test('select: a native change chooses by position, which also works for objects and groups', () => {
	createRoot((dispose) => {
		const model = signal(null)
		const emitted = []
		const options = [
			{ id: 1, name: 'Ana', team: 'B' },
			{ id: 2, name: 'Bea', team: 'A' },
			{ id: 3, name: 'Carla', team: 'B' },
		]
		const select = createSelect({ options, by: 'id', groupBy: 'team' }, model, 'id', (value) => emitted.push(value))
		// In the DOM, the groups in the order of their first option: Ana, Carla, Bea, after the hidden one.
		select.change({ currentTarget: { selectedIndex: 2 } })
		assert.equal(model.value, options[2])
		assert.equal(select.nativeIndex.value, 2)
		// With a value chosen, the hidden option is gone and the positions move.
		select.change({ currentTarget: { selectedIndex: 2 } })
		assert.equal(model.value, options[1])
		assert.deepEqual(emitted, [options[2], options[1]])
		model.value = null
		select.change({ currentTarget: { selectedIndex: 0 } })
		assert.equal(model.value, null, 'the hidden option is never a choice')
		dispose()
	})
})

test('the new components type their props and snippets in a template', async (context) => {
	const parent = fileURLToPath(new URL('../.meeko/', import.meta.url))
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(parent + 'native-types-')
	context.after(() => rm(directory, { recursive: true, force: true }))
	const filename = directory + '/Consumer.meeko'
	const component = (name) => relative(dirname(filename), fileURLToPath(new URL(`../dist/app/components/${name}.meeko`, import.meta.url))).replaceAll('\\', '/')
	const source = `<script lang="ts">
import { signal } from '@meekojs/meeko';
import * as UITabs from '${component('Tabs')}';
import * as UITooltip from '${component('Tooltip')}';
import * as UICommandPalette from '${component('CommandPalette')}';
import * as UISelect from '${component('Select')}';
import * as UICombobox from '${component('Combobox')}';
const items = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] as const;
const pages = [{ title: 'Guía', url: '/guide', sections: [] as { title: string; url: string }[] }];
const one = signal<string | null>(null);
const many = signal<string[]>([]);
</script>
<template><UITabs bind:items="items"><snippet name="panel" params="item"><p>{item.label.toUpperCase()}</p></snippet><snippet name="panel-a"><p>A</p></snippet></UITabs><UITooltip text="Ayuda" placement="right"><snippet name="anchor" params="trigger"><button type="button" bind:id="trigger.id">?</button></snippet></UITooltip><UICommandPalette bind:results="pages" status="ready" hrefBy="url" labelBy="title"><snippet name="item" params="page, state"><b>{page.title.toUpperCase()} {state.depth.toFixed(0)}</b></snippet></UICommandPalette><UISelect model="one" bind:options="['a']" clearable><snippet name="option" params="option, state"><b>{option.toUpperCase()} {String(state.selected)}</b></snippet></UISelect><UICombobox model="many" multiple searchable bind:max="2" bind:options="['a']"><snippet name="option" params="option, state"><b>{option.toUpperCase()} {String(state.active)}</b></snippet><snippet name="empty">Nada</snippet></UICombobox></template>`
	const errors = (diagnostics) => diagnostics.filter((item) => item.severity !== 'warning')
	assert.deepEqual(errors(await checkSource(source, filename)), [])
	for (const [broken, pattern] of [
		[source.replace('item.label.toUpperCase()', 'item.label.toFixed()'), /toFixed/],
		[source.replace('placement="right"', 'placement="sideways"'), /sideways/],
		[source.replace('status="ready"', 'status="done"'), /done/],
		[source.replace('page.title.toUpperCase()', 'page.missing'), /missing/],
		[source.replace('hrefBy="url"', 'hrefBy="missing"'), /missing/],
		// A prop of the combobox on the native select says what to use instead.
		[source.replace('clearable>', 'clearable searchable>'), /usa <UICombobox searchable>/],
		[source.replace('clearable>', 'clearable multiple>'), /usa <UICombobox multiple>/],
		[source.replace('clearable>', 'clearable bind:max="2">'), /usa <UICombobox max>/],
		[source.replace('clearable>', 'clearable bind:filter="(query) => [query]">'), /usa <UICombobox filter>/],
		[source.replace('clearable>', 'clearable bind:loading="true">'), /usa <UICombobox filter>/],
		[source.replace('{String(state.selected)}', '{String(state.active)}'), /active/],
		[source.replace('clearable>', 'clearable><snippet name="empty">Nada</snippet>'), /empty/],
	]) {
		const diagnostics = errors(await checkSource(broken, filename))
		assert.ok(
			diagnostics.some((item) => pattern.test(item.message)),
			JSON.stringify(diagnostics),
		)
	}
})

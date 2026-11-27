// <UISelect>: a button and a list of its own on <UIPopover>. Its HTML from the server, and the controller that
// the template reads: the keyboard of a combobox that only selects, the form and the reset. The browser part
// (hydration, the popover, the focus) is in popover-select.e2e.mjs and native-components.e2e.mjs.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { compile } from '../../meeko/dist/compiler.js'
import { createRoot, provide, signal } from '../../meeko/dist/index.js'
import { comboboxTheme } from '../dist/app/theme/components/combobox.js'
import { inputControlTheme } from '../dist/app/theme/components/input.js'
import { selectTheme } from '../dist/app/theme/components/select.js'
import { uiDefaultsKey } from '../dist/app/utils/defaults.js'
import { createSelect } from '../dist/app/utils/select.js'
import { validateDefaults } from '../dist/defaults.js'

const components = ['Popover', 'Select']

const script = `
import { signal } from "@meekojs/meeko"
const people = [{ id: 1, name: 'Ana', team: 'Diseño' }, { id: 2, name: 'Bea', team: 'Ingeniería', disabled: true }, { id: 3, name: 'Carla', team: 'Diseño' }]
const field = { id: 'field-id', name: 'field-name', value: signal('b'), invalid: signal(true), describedBy: signal('field-error') }
`

/** Compiles the real components and a page that uses them, and renders it in SSR, with `ui.defaults` if given. */
async function render(context, template, defaults) {
	const parent = fileURLToPath(new URL('../.meeko/', import.meta.url))
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(parent + 'select-render-')
	context.after(() => rm(directory, { recursive: true, force: true }))
	const runtime = (path) => JSON.stringify(new URL(`../../meeko/dist/${path}`, import.meta.url).href)
	const write = async (file, source) => {
		const code = compile(source, `${directory}/${file}.meeko`)
			.code.replaceAll('from "@meekojs/meeko/internal"', `from ${runtime('internal.js')}`)
			.replaceAll('from "@meekojs/meeko"', `from ${runtime('index.js')}`)
			.replace(/from ["']\.\/internal\/Icon\.meeko["']/g, 'from "./Icon.ts"')
			.replace(/from ["']\.\/(\w+)\.meeko["']/g, 'from "./$1.ts"')
			.replace(/from ["'](?:\.\.\/)+(utils|theme(?:\/components)?)\/([\w-]+)["']/g, (_, folder, utility) => `from ${JSON.stringify(new URL(`../dist/app/${folder}/${utility}.js`, import.meta.url).href)}`)
		await writeFile(`${directory}/${file}.ts`, code)
	}
	await write('Icon', await readFile(new URL('../src/app/components/internal/Icon.meeko', import.meta.url), 'utf8'))
	for (const name of components) await write(name, await readFile(new URL(`../src/app/components/${name}.meeko`, import.meta.url), 'utf8'))
	const imports = components.map((name) => `import * as UI${name} from "./${name}.meeko"`).join('; ')
	await write('Page', `<script lang="ts">${imports};${script}</script><template>${template}</template>`)
	const page = await import(pathToFileURL(`${directory}/Page.ts`).href)
	return createRoot(() => {
		if (defaults) provide(uiDefaultsKey, defaults)
		return page.renderToString({})
	})
}

const withoutComments = (html) => html.replace(/<!--.*?-->/g, '')
/** The opening tags of the elements whose attributes match. */
const tags = (html, pattern) => [...html.matchAll(/<[a-z][^>]*>/g)].map(([value]) => value).filter((value) => pattern.test(value))
const tag = (html, pattern) => {
	const found = tags(html, pattern)[0]
	assert.ok(found, `no tag matches ${pattern} in ${html}`)
	return found
}
const attribute = (markup, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(markup)?.[1]
const classes = (markup) => (attribute(markup, 'class') ?? '').replaceAll('&amp;', '&').replaceAll('&gt;', '>').split(' ')

test('SSR: the trigger is a button with the combobox pattern, and a closed list sends no options', async (context) => {
	const html = await render(context, `<UISelect id="plan" name="plan" placeholder="Elige un plan" bind:options="['Personal', 'Equipo']" />`)
	const plain = withoutComments(html)
	const trigger = tag(plain, /data-meeko-select-trigger/)
	assert.match(trigger, /^<button /)
	assert.equal(attribute(trigger, 'type'), 'button')
	assert.equal(attribute(trigger, 'id'), 'plan', 'the id that a <label for> names')
	assert.equal(attribute(trigger, 'role'), 'combobox')
	assert.equal(attribute(trigger, 'aria-haspopup'), 'listbox')
	assert.equal(attribute(trigger, 'aria-expanded'), 'false')
	assert.equal(attribute(trigger, 'aria-activedescendant'), undefined)
	assert.doesNotMatch(plain, /<select|<option|selectedcontent/, 'no native select')
	// The list: a listbox named by its trigger, inside the popover that the trigger opens without a script.
	const list = tag(plain, /role="listbox"/)
	assert.equal(attribute(trigger, 'aria-controls'), attribute(list, 'id'))
	assert.equal(attribute(list, 'aria-labelledby'), 'plan')
	const popover = tag(plain, /data-meeko-popover[\s>=]/)
	assert.equal(attribute(popover, 'popover'), 'auto')
	assert.equal(attribute(trigger, 'popovertarget'), attribute(popover, 'id'), 'the declarative popover')
	assert.ok(classes(popover).includes('min-w-[anchor-size(width)]'), 'at least as wide as its trigger')
	assert.ok(classes(popover).includes('[position-area:bottom_span-right]'), 'bottom-start by default')
	assert.ok(
		classes(popover).some((name) => name.startsWith('motion-reduce:')),
		'reduced motion',
	)
	// Only the hydration markers of the `if` that holds the options.
	assert.match(html, new RegExp(`<div[^>]*\\bid="${attribute(list, 'id')}"[^>]*>(?:<!--[^>]*-->)*</div>`), 'the listbox is there, empty')
	assert.equal((plain.match(/role="option"/g) ?? []).length, 0)
	// Without a value: the placeholder in the trigger, an empty value in the form, no clear button.
	assert.match(plain, /<span[^>]*data-meeko-select-placeholder[^>]*>Elige un plan<\/span>/)
	assert.doesNotMatch(plain, /data-meeko-select-value/)
	assert.deepEqual(
		tags(plain, /type="hidden"/).map((input) => [attribute(input, 'name'), attribute(input, 'value')]),
		[['plan', '']],
	)
	assert.doesNotMatch(plain, /data-meeko-select-clear|data-meeko-select-validity/)
	// The chevron is decoration.
	assert.match(plain, /<svg[^>]*aria-hidden="true"[^>]*>/)
})

test('SSR: the value, the form value by `by`, required, disabled, label, clearable and the field of useForm', async (context) => {
	const html = withoutComments(
		await render(
			context,
			[
				`<section id="chosen"><UISelect name="person" by="id" labelBy="name" clearable required describedBy="help" bind:modelValue="people[2]" bind:options="people" /></section>`,
				`<section id="outside"><UISelect name="plan" modelValue="Antiguo" bind:options="['Personal']" /></section>`,
				`<section id="blank"><UISelect name="plan" required label="Plan" modelValue="" bind:options="['Personal']" /></section>`,
				`<section id="empty-option"><UISelect name="plan" modelValue="" bind:options="['', 'Personal']" /></section>`,
				`<section id="disabled"><UISelect name="plan" disabled required clearable modelValue="Personal" bind:options="['Personal']" /></section>`,
				`<section id="nameless"><UISelect modelValue="Personal" invalid bind:options="['Personal']" /></section>`,
				`<section id="field"><UISelect bind:field="field" bind:options="['a', 'b']" /></section>`,
			].join(''),
		),
	)
	const section = (id) => new RegExp(`<section id="${id}">(.*?)</section>`, 's').exec(html)[1]
	const hidden = (part) => tags(part, /type="hidden"/).map((input) => [attribute(input, 'name'), attribute(input, 'value'), /\sdisabled/.test(input)])

	const chosen = section('chosen')
	assert.match(chosen, /<span[^>]*data-meeko-select-value[^>]*>Carla<\/span>/)
	assert.doesNotMatch(chosen, /data-meeko-select-placeholder/)
	assert.deepEqual(hidden(chosen), [['person', '3', false]], 'the key of `by`, as the native select sent')
	const trigger = tag(chosen, /data-meeko-select-trigger/)
	assert.equal(attribute(trigger, 'aria-required'), 'true')
	assert.equal(attribute(trigger, 'aria-describedby'), 'help')
	assert.equal(attribute(trigger, 'aria-invalid'), undefined)
	// A hidden input does not validate `required`: a text one does, out of the tab order and of the tree.
	const validity = tag(chosen, /data-meeko-select-validity/)
	assert.match(validity, /type="text"/)
	assert.match(validity, /\shidden/)
	assert.match(validity, /\srequired/)
	assert.equal(attribute(validity, 'tabindex'), '-1')
	assert.equal(attribute(validity, 'aria-hidden'), 'true')
	assert.equal(attribute(validity, 'value'), 'selected')
	assert.equal(attribute(validity, 'name'), undefined, 'it is never sent')
	assert.equal(attribute(tag(chosen, /data-meeko-select-clear/), 'aria-label'), 'Quitar selección')
	assert.ok(classes(trigger).includes('pe-(--ui-control-height-md)'), 'room for the clear button')

	assert.match(section('outside'), /<span[^>]*data-meeko-select-value[^>]*>Antiguo<\/span>/, 'a value outside the options stays visible')
	assert.deepEqual(hidden(section('outside')), [['plan', 'Antiguo', false]], 'and the form still sends it')

	const blank = section('blank')
	assert.match(blank, /data-meeko-select-placeholder/, '"" is no choice unless an option is ""')
	assert.equal(attribute(tag(blank, /data-meeko-select-validity/), 'value'), '')
	assert.equal(attribute(tag(blank, /data-meeko-select-trigger/), 'aria-label'), 'Plan')
	assert.equal(attribute(tag(blank, /role="listbox"/), 'aria-label'), 'Plan')
	assert.equal(attribute(tag(blank, /role="listbox"/), 'aria-labelledby'), undefined)
	assert.match(section('empty-option'), /data-meeko-select-value/, 'an option "" can be chosen')

	const disabled = section('disabled')
	assert.match(tag(disabled, /data-meeko-select-trigger/), /\sdisabled/)
	assert.deepEqual(hidden(disabled), [['plan', 'Personal', true]], 'a disabled control is not sent')
	assert.match(tag(disabled, /data-meeko-select-validity/), /\sdisabled/)
	assert.doesNotMatch(disabled, /data-meeko-select-clear/)
	assert.match(tag(disabled, /data-meeko-select[\s>=]/), /data-disabled/)
	assert.ok(classes(tag(disabled, /data-meeko-select[\s>=]/)).includes('opacity-(--ui-opacity-disabled)'))

	assert.deepEqual(hidden(section('nameless')), [], 'nothing to send without a name')
	assert.equal(attribute(tag(section('nameless'), /data-meeko-select-trigger/), 'aria-invalid'), 'true')

	const field = section('field')
	const fieldTrigger = tag(field, /data-meeko-select-trigger/)
	assert.equal(attribute(fieldTrigger, 'id'), 'field-id')
	assert.equal(attribute(fieldTrigger, 'aria-invalid'), 'true')
	assert.equal(attribute(fieldTrigger, 'aria-describedby'), 'field-error')
	assert.deepEqual(hidden(field), [['field-name', 'b', false]])
	assert.match(field, /<span[^>]*data-meeko-select-value[^>]*>b<\/span>/)
})

test('SSR: the value snippet paints the trigger in every browser, and placement, offset and listClass reach the popover', async (context) => {
	const html = withoutComments(await render(context, `<UISelect by="id" labelBy="name" placement="top-end" listClass="my-list" bind:modelValue="people[0]" bind:options="people"><snippet name="value" params="person"><b>{person.name.toUpperCase()}</b> <i>{person.team}</i></snippet><snippet name="option" params="person, state"><b>{person.name}</b></snippet></UISelect>`))
	assert.match(html, /<span[^>]*data-meeko-select-value[^>]*><b>ANA<\/b> <i>Diseño<\/i><\/span>/)
	const popover = tag(html, /data-meeko-popover[\s>=]/)
	assert.ok(classes(popover).includes('[position-area:top_span-left]'))
	assert.ok(classes(popover).includes('my-list'))
	assert.equal((html.match(/role="option"/g) ?? []).length, 0, 'the option snippet waits for the list to open')
	// With only an option snippet, the trigger shows the label of the option, not its rich content.
	const labelled = withoutComments(await render(context, `<UISelect by="id" labelBy="name" bind:modelValue="people[2]" bind:options="people"><snippet name="option" params="person"><b>{person.name}</b> <i>{person.team}</i></snippet></UISelect>`))
	assert.match(labelled, /<span[^>]*data-meeko-select-value[^>]*>Carla<\/span>/)
})

test('the trigger is a field, and class, ui and ui.defaults reach every part', async (context) => {
	const defaults = { select: { class: 'app-select', ui: { trigger: 'app-trigger', chevron: 'app-chevron' } } }
	validateDefaults(defaults)
	const html = withoutComments(await render(context, `<UISelect class="mine" clearable modelValue="a" bind:options="['a']" bind:ui="{ trigger: 'bg-red-500 my-trigger', value: 'my-value', chevron: 'my-chevron', list: 'my-listbox', clear: 'my-clear' }" /><UISelect placeholder="x" bind:options="['a']" bind:ui="{ placeholder: 'my-placeholder' }" />`, defaults))
	const root = classes(tag(html, /data-meeko-select[\s>=]/))
	for (const name of ['font-sans', 'relative', 'app-select', 'mine']) assert.ok(root.includes(name), name)
	const trigger = classes(tag(html, /data-meeko-select-trigger/))
	// The look of a field, as <UIInput>, with what a button adds.
	for (const name of inputControlTheme({ clearable: true })
		.split(' ')
		.filter((name) => name !== 'block' && name !== 'bg-control'))
		assert.ok(trigger.includes(name), name)
	for (const name of ['flex', 'items-center', 'justify-between', 'cursor-pointer', 'text-start', 'app-trigger', 'my-trigger', 'bg-red-500']) assert.ok(trigger.includes(name), name)
	assert.ok(!trigger.includes('bg-control') && !trigger.includes('block'), 'the class of the consumer wins over the recipe')
	assert.ok(classes(tag(html, /data-meeko-select-value/)).includes('my-value'))
	assert.ok(classes(tag(html, /data-meeko-select-placeholder/)).includes('my-placeholder'))
	assert.ok(classes(tag(html, /data-meeko-select-placeholder/)).includes('text-text-soft'))
	const chevron = classes(tag(html, /<svg/))
	for (const name of ['app-chevron', 'my-chevron', 'in-aria-expanded:rotate-180', 'transition-[rotate]', 'motion-reduce:transition-none']) assert.ok(chevron.includes(name), name)
	assert.ok(classes(tag(html, /role="listbox"/)).includes('my-listbox'))
	assert.ok(classes(tag(html, /data-meeko-select-clear/)).includes('my-clear'))
	// The slots of the recipe, the ones `ui` and `ui.defaults` accept.
	assert.deepEqual(Object.keys(selectTheme()), ['base', 'trigger', 'value', 'placeholder', 'list', 'group', 'groupLabel', 'option', 'clear', 'chevron', 'indicator'])
	assert.throws(() => validateDefaults({ select: { ui: { arrow: 'x' } } }), /unknown slot arrow in defaults\.select\.ui; its slots are base, trigger, value, placeholder, list, group, groupLabel, option, clear, chevron, indicator/)
	// An option of both lists: the row of <UICombobox>, with the mark of the chosen one at its end.
	const option = selectTheme().option().split(' ')
	for (const name of comboboxTheme().option().split(' ')) assert.ok(option.includes(name), name)
	assert.ok(selectTheme().indicator().split(' ').includes('ms-auto'))
	assert.ok(selectTheme({ disabled: true }).base().includes('opacity-(--ui-opacity-disabled)'))
	// Nothing left of the native select.
	const recipe = await readFile(new URL('../src/app/theme/components/select.ts', import.meta.url), 'utf8')
	assert.doesNotMatch(recipe, /base-select|supports-\[/)
	assert.doesNotMatch(await readFile(new URL('../src/app/styles/components.css', import.meta.url), 'utf8'), /select\.css/)
})

/** A keydown as the trigger hears it. */
const key = (name, extra = {}) => {
	const event = { key: name, ctrlKey: false, altKey: false, metaKey: false, defaultPrevented: false, ...extra }
	event.preventDefault = () => {
		event.defaultPrevented = true
	}
	return event
}

/** A select with its controller, as the component creates it. */
function mounted(settings, initial, run) {
	return createRoot((dispose) => {
		const model = signal(initial)
		const emitted = []
		const select = createSelect(settings, model, 'id', (value) => emitted.push(value))
		const press = (name, extra) => {
			const event = key(name, extra)
			select.keydown(event)
			return event
		}
		try {
			return run({ select, model, emitted, press, activeLabel: () => select.entries.value[select.active.value]?.label })
		} finally {
			dispose()
		}
	})
}

const colors = ['Rojo', 'Verde', 'Azul', 'Ámbar', 'Rosa']

test('keyboard: Enter, Space and the arrows open the list on the chosen option, and it renders its options from then on', () => {
	for (const [name, start, expected] of [
		['Enter', 'Azul', 'Azul'],
		[' ', 'Azul', 'Azul'],
		['ArrowDown', 'Azul', 'Azul'],
		['ArrowUp', 'Azul', 'Azul'],
		['ArrowDown', null, 'Rojo'],
		['ArrowUp', null, 'Rosa'],
		['Home', 'Azul', 'Rojo'],
		['End', 'Azul', 'Rosa'],
	]) {
		mounted({ options: colors }, start, ({ select, press, activeLabel }) => {
			assert.equal(select.rendered.value, false, 'a closed list has no options')
			assert.equal(select.triggerAttributes.value['aria-expanded'], 'false')
			assert.equal(select.triggerAttributes.value['aria-activedescendant'], undefined)
			const event = press(name)
			assert.equal(event.defaultPrevented, true, `${name} does not scroll the page nor click the button`)
			assert.equal(select.open.value, true, name)
			assert.equal(select.rendered.value, true)
			assert.equal(activeLabel(), expected, `${JSON.stringify(name)} from ${start}`)
			assert.equal(select.triggerAttributes.value['aria-expanded'], 'true')
			assert.equal(select.triggerAttributes.value['aria-activedescendant'], select.entries.value[select.active.value].id)
			assert.equal(select.triggerAttributes.value['aria-controls'], select.listboxId)
		})
	}
})

test('keyboard: the arrows, Home, End and the pages move the active option, skip the disabled ones and stop at the ends', () => {
	const options = [{ name: 'Ana', disabled: true }, { name: 'Bea' }, { name: 'Carla', disabled: true }, { name: 'Dana' }, { name: 'Eva', disabled: true }]
	mounted({ options }, null, ({ select, press, activeLabel, model, emitted }) => {
		press('ArrowDown')
		assert.equal(activeLabel(), 'Bea', 'the first option that can be chosen')
		press('ArrowDown')
		assert.equal(activeLabel(), 'Dana', 'over a disabled one')
		press('ArrowDown')
		assert.equal(activeLabel(), 'Dana', 'no wrapping at the end')
		press('ArrowUp')
		assert.equal(activeLabel(), 'Bea')
		press('ArrowUp')
		assert.equal(activeLabel(), 'Bea', 'nor at the start')
		press('End')
		assert.equal(activeLabel(), 'Dana')
		press('Home')
		assert.equal(activeLabel(), 'Bea')
		press('PageDown')
		assert.equal(activeLabel(), 'Dana')
		press('PageUp')
		assert.equal(activeLabel(), 'Bea')
		// The pointer does not reach a disabled option either, and a click on it chooses nothing.
		select.choose(0)
		assert.equal(model.value, null)
		assert.equal(select.open.value, true)
		assert.deepEqual(emitted, [])
		assert.deepEqual(select.listOption(select.entries.value[0])['aria-disabled'], 'true')
		assert.deepEqual(select.stateOf(select.entries.value[0]), { selected: false, disabled: true })
	})
})

test('keyboard: Enter and Space choose the active option and close; Escape and Tab close without choosing', () => {
	for (const name of ['Enter', ' ']) {
		mounted({ options: colors }, 'Rojo', ({ select, press, model, emitted }) => {
			press('ArrowDown')
			press('ArrowDown')
			const event = press(name)
			assert.equal(event.defaultPrevented, true)
			assert.equal(model.value, 'Verde')
			assert.deepEqual(emitted, ['Verde'])
			assert.equal(select.open.value, false)
			assert.equal(select.label.value, 'Verde')
			assert.equal(select.rendered.value, true, 'the options stay for the next opening')
			// The same option again closes and tells nobody.
			press(name)
			press(name)
			assert.deepEqual(emitted, ['Verde'])
			assert.equal(select.open.value, false)
		})
	}
	mounted({ options: colors }, 'Rojo', ({ select, press, model, emitted }) => {
		press('ArrowDown')
		press('ArrowDown')
		assert.equal(press('Escape').defaultPrevented, true)
		assert.equal(select.open.value, false)
		press('ArrowDown')
		press('End')
		assert.equal(press('Tab').defaultPrevented, false, 'Tab still moves the focus on')
		assert.equal(select.open.value, false)
		assert.equal(model.value, 'Rojo')
		assert.deepEqual(emitted, [])
		// Alt+ArrowUp chooses and closes, as in a native select.
		press('ArrowDown')
		press('ArrowDown')
		press('ArrowUp', { altKey: true })
		assert.equal(model.value, 'Verde')
		assert.equal(select.open.value, false)
	})
})

test('keyboard: typing jumps to the option that starts with the text, without accents, on a closed or an open list', () => {
	mounted({ options: colors }, null, ({ select, press, activeLabel, model }) => {
		press('a')
		assert.equal(select.open.value, true, 'a letter opens the list')
		assert.equal(activeLabel(), 'Azul')
		press('Escape')
		assert.equal(model.value, null, 'and chooses nothing by itself')
	})
	mounted({ options: colors }, null, ({ press, activeLabel }) => {
		press('ArrowDown')
		press('r')
		press('o')
		press('s')
		assert.equal(activeLabel(), 'Rosa', 'a longer text')
	})
	mounted({ options: colors }, null, ({ press, activeLabel }) => {
		press('ArrowDown')
		press('a')
		assert.equal(activeLabel(), 'Azul')
		press('a')
		assert.equal(activeLabel(), 'Ámbar', 'the same letter goes to the next one')
		press('a')
		assert.equal(activeLabel(), 'Azul', 'and around')
	})
	mounted({ options: [{ name: 'Ana', disabled: true }, { name: 'Alba' }] }, null, ({ select, press, activeLabel }) => {
		press('a')
		assert.equal(activeLabel(), 'Alba', 'a disabled option is skipped')
		press('Escape')
		// A shortcut of the browser is no text, and Space chooses.
		press('a', { ctrlKey: true })
		assert.equal(select.open.value, false)
	})
})

test('a disabled select neither opens nor chooses', () => {
	mounted({ options: colors, disabled: true, clearable: true }, 'Rojo', ({ select, press, model }) => {
		for (const name of ['Enter', ' ', 'ArrowDown', 'a']) press(name)
		select.triggerClick(key('click'))
		assert.equal(select.open.value, false)
		assert.equal(select.showClear.value, false)
		assert.equal(select.triggerAttributes.value.disabled, true)
		assert.equal(model.value, 'Rojo')
	})
})

test('the trigger: a click toggles the list by script, and the click of a key already handled is not a second toggle', () => {
	mounted({ options: colors }, null, ({ select, press }) => {
		const click = key('click')
		select.triggerClick(click)
		assert.equal(click.defaultPrevented, true, 'popovertarget is for a page without the script: here the script opens')
		assert.equal(select.open.value, true)
		select.triggerClick(key('click'))
		assert.equal(select.open.value, false)
		// Enter opens on keydown; the click that the button fires for the same key changes nothing.
		press('Enter')
		select.triggerClick(key('click'))
		assert.equal(select.open.value, true)
	})
})

test('groups keep the order of the list as shown, and choosing by position works for objects', () => {
	const options = [
		{ id: 1, name: 'Ana', team: 'B' },
		{ id: 2, name: 'Bea', team: 'A' },
		{ id: 3, name: 'Carla', team: 'B' },
		{ id: 4, name: 'Dana' },
	]
	mounted({ options, by: 'id', groupBy: 'team', name: 'person' }, null, ({ select, model, emitted, press, activeLabel }) => {
		assert.deepEqual(
			select.groups.value.map((group) => [group.name, group.id, group.entries.map((entry) => entry.label)]),
			[
				['B', 'id-listbox-g0', ['Ana', 'Carla']],
				['A', 'id-listbox-g1', ['Bea']],
				[undefined, undefined, ['Dana']],
			],
		)
		press('ArrowDown')
		press('ArrowDown')
		assert.equal(activeLabel(), 'Carla', 'the arrows follow the groups, not `options`')
		press('Enter')
		assert.equal(model.value, options[2])
		assert.deepEqual(select.hiddenValues.value, ['3'])
		// A copy of the option with the same key is the chosen one.
		model.value = { id: 2, name: 'Otra Bea' }
		assert.equal(select.isSelected(select.entries.value[2]), true)
		assert.deepEqual(select.listOption(select.entries.value[2])['aria-selected'], 'true')
		assert.deepEqual(select.stateOf(select.entries.value[2]), { selected: true, disabled: false })
		assert.equal(select.label.value, 'Otra Bea', 'the trigger shows the value of the model')
		press('ArrowDown')
		assert.equal(activeLabel(), 'Bea', 'and the list opens on it')
		assert.deepEqual(emitted, [options[2]])
	})
})

test('a value outside the options stays in the model, in the trigger and in the form; late options find it', () => {
	createRoot((dispose) => {
		const model = signal({ id: 2, name: 'Bea' })
		const options = signal([{ id: 1, name: 'Ana' }])
		const select = createSelect(
			{
				get options() {
					return options.value
				},
				by: 'id',
				name: 'person',
			},
			model,
			'id',
			() => {},
		)
		assert.equal(select.chosen.value, true)
		assert.equal(select.label.value, 'Bea')
		assert.deepEqual(select.hiddenValues.value, ['2'])
		select.openList()
		assert.equal(select.entries.value[select.active.value].label, 'Ana', 'the list opens on its first option')
		options.value = [
			{ id: 1, name: 'Ana' },
			{ id: 2, name: 'Bea' },
		]
		assert.equal(select.isSelected(select.entries.value[1]), true)
		model.value = null
		assert.equal(select.chosen.value, false)
		assert.deepEqual(select.hiddenValues.value, [''], 'an empty value, as the placeholder of a native select sent')
		dispose()
	})
})

test('clearable empties the model, tells the application and closes the list', () => {
	mounted({ options: colors, clearable: true }, 'Rojo', ({ select, model, emitted }) => {
		assert.equal(select.showClear.value, true)
		select.openList()
		select.clear()
		assert.equal(model.value, null)
		assert.deepEqual(emitted, [null])
		assert.equal(select.open.value, false)
		assert.equal(select.showClear.value, false, 'nothing left to clear')
		select.clear()
		assert.deepEqual(emitted, [null])
	})
	mounted({ options: colors }, 'Rojo', ({ select, model }) => {
		assert.equal(select.showClear.value, false, 'off by default')
		select.clear()
		assert.equal(model.value, 'Rojo')
	})
})

test('the props of <UICombobox> do nothing here, also without the types', () => {
	mounted({ options: colors, multiple: true, searchable: true, max: 1, filter: () => [] }, 'Rojo', ({ select, model, press }) => {
		press(' ')
		assert.equal(select.open.value, true, 'Space opens: the trigger is not a search field')
		press('ArrowDown')
		press('Enter')
		assert.equal(model.value, 'Verde', 'one value, never an array')
		assert.equal(select.open.value, false)
	})
})

/** The root of a mounted select: what `mount` reads of the DOM, with a form that can be reset. */
function fakeRoot() {
	const listeners = new Map()
	const target = () => ({
		addEventListener: (type, listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
		removeEventListener: (type, listener) =>
			listeners.set(
				type,
				(listeners.get(type) ?? []).filter((known) => known !== listener),
			),
	})
	const focused = []
	const trigger = { focus: () => focused.push('trigger') }
	const form = target()
	const root = {
		...target(),
		ownerDocument: { ...target(), activeElement: null, getElementById: () => null },
		querySelector: (selector) => (selector === '[data-meeko-select-trigger]' ? trigger : null),
		closest: (selector) => (selector === 'form' ? form : null),
		contains: () => true,
	}
	return { root, focused, fire: (type, event = {}) => (listeners.get(type) ?? []).forEach((listener) => listener({ defaultPrevented: false, ...event })), count: (type) => (listeners.get(type) ?? []).length }
}

test('required: the form finds it empty, the trigger takes the error and the focus, and a value clears it', () => {
	mounted({ options: colors, required: true }, null, ({ select, press }) => {
		assert.equal(select.triggerAttributes.value['aria-required'], 'true')
		assert.equal(select.triggerAttributes.value['aria-invalid'], undefined)
		const focused = []
		const invalid = key('invalid')
		invalid.currentTarget = { closest: () => ({ querySelector: () => ({ focus: () => focused.push('trigger') }) }) }
		select.reportInvalid(invalid)
		assert.equal(invalid.defaultPrevented, true, 'without the bubble of the browser, which has no place on a hidden input')
		assert.deepEqual(focused, ['trigger'])
		assert.equal(select.triggerAttributes.value['aria-invalid'], 'true')
		press('ArrowDown')
		press('Enter')
		assert.equal(select.triggerAttributes.value['aria-invalid'], undefined)
	})
})

test('a reset of the form goes back to the value the select was mounted with, and a choice gives the focus back to the trigger', () => {
	mounted({ options: colors, name: 'color', required: true }, 'Rojo', ({ select, model, emitted }) => {
		const { root, focused, fire, count } = fakeRoot()
		const release = select.mount(root)
		assert.equal(count('reset'), 1)
		// A click on an option chooses it, closes the list and gives the focus back.
		select.openList()
		select.optionClick({ target: { closest: () => ({ getAttribute: () => '2' }) } })
		assert.equal(model.value, 'Azul')
		assert.equal(select.open.value, false)
		assert.deepEqual(focused, ['trigger'])
		select.openList()
		fire('reset')
		assert.equal(model.value, 'Rojo')
		assert.deepEqual(emitted, ['Azul', 'Rojo'], 'the application hears the reset as a change')
		assert.deepEqual(select.hiddenValues.value, ['Rojo'])
		assert.equal(select.open.value, false)
		fire('reset')
		assert.deepEqual(emitted, ['Azul', 'Rojo'], 'nothing to tell when nothing changes')
		// A reset that the application cancelled is no reset.
		select.choose(3)
		fire('reset', { defaultPrevented: true })
		assert.equal(model.value, 'Ámbar')
		release()
		assert.equal(count('reset'), 0, 'the listener leaves with the component')
		assert.equal(count('focusout'), 0)
		assert.equal(count('pointerdown'), 0)
	})
	// The error of `required` leaves with the reset too.
	mounted({ options: colors, required: true }, null, ({ select }) => {
		const { root, fire } = fakeRoot()
		const release = select.mount(root)
		const invalid = key('invalid')
		invalid.currentTarget = { closest: () => null }
		select.reportInvalid(invalid)
		assert.equal(select.triggerAttributes.value['aria-invalid'], 'true')
		fire('reset')
		assert.equal(select.triggerAttributes.value['aria-invalid'], undefined)
		release()
	})
})

test('the root of a select and a combobox is as wide as its container, also in a flex row or a grid', () => {
	for (const [name, look] of Object.entries({ select: selectTheme, combobox: comboboxTheme })) {
		for (const clearable of [false, true]) {
			const classes = look({ clearable }).base().split(' ')
			assert.ok(classes.includes('w-full') && classes.includes('block'), `${name} clearable=${clearable}: ${classes.join(' ')}`)
		}
	}
})

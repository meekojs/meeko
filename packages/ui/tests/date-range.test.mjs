import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { routeKey } from '../../meeko/dist/app/runtime/navigation.js'
import { compile } from '../../meeko/dist/compiler.js'
import { createRoot, provide, signal } from '../../meeko/dist/index.js'
import { addDays, createDateRange, dateRangeMessage, dayNumber, defaultDateRangePresets, endOfMonth, isCompleteDateRange, localToday, rangeDays, validateDateRange } from '../dist/app/utils/date-range.js'
import { uiDefaultsKey } from '../dist/app/utils/defaults.js'
import { builtinMessages, resolveUIMessages } from '../dist/app/utils/messages.js'
import { validateDefaults } from '../dist/defaults.js'

const components = ['DateRange', 'Field']

/** Compiles <UIDateRange>, <UIField> and a page with `template`, and renders it in SSR, with `ui.defaults` if given. */
async function render(context, template, { defaults, script = '' } = {}) {
	const parent = fileURLToPath(new URL('../.meeko/', import.meta.url))
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(parent + 'date-range-')
	context.after(() => rm(directory, { recursive: true, force: true }))
	const runtime = (path) => JSON.stringify(new URL(`../../meeko/dist/${path}`, import.meta.url).href)
	const write = async (file, source) => {
		const code = compile(source, `${directory}/${file}.meeko`)
			.code.replaceAll('from "@meekojs/meeko/internal"', `from ${runtime('internal.js')}`)
			.replaceAll('from "@meekojs/meeko"', `from ${runtime('index.js')}`)
			.replace(/from ["']\.\/(\w+)\.meeko["']/g, 'from "./$1.ts"')
			.replace(/from ["'](?:\.\.\/)+(utils|variants)\/([\w-]+)["']/g, (_, folder, utility) => `from ${JSON.stringify(new URL(`../dist/app/${folder}/${utility}.js`, import.meta.url).href)}`)
		await writeFile(`${directory}/${file}.ts`, code)
	}
	for (const name of components) await write(name, await readFile(new URL(`../src/app/components/${name}.meeko`, import.meta.url), 'utf8'))
	await write('Page', `<script lang="ts">import { signal } from "@meekojs/meeko"; import * as UIDateRange from "./DateRange.meeko"; import * as UIField from "./Field.meeko"; ${script}</script><template>${template}</template>`)
	const page = await import(pathToFileURL(`${directory}/Page.ts`).href)
	return createRoot(() => {
		provide(routeKey, {})
		if (defaults) provide(uiDefaultsKey, defaults)
		return page.renderToString({}).replace(/<!--.*?-->/g, '')
	})
}

/** Renders with a clock that throws: the render must never read it. */
async function renderWithoutClock(context, template, options) {
	const RealDate = globalThis.Date
	class NoClock extends RealDate {
		constructor(...args) {
			if (args.length === 0) throw new Error('the render read the clock')
			super(...args)
		}
		static now() {
			throw new Error('the render read the clock')
		}
	}
	globalThis.Date = NoClock
	try {
		return await render(context, template, options)
	} finally {
		globalThis.Date = RealDate
	}
}

/** The opening tags of the elements whose attributes match. */
const tags = (html, pattern) => [...html.matchAll(/<[a-z][^>]*>/g)].map(([value]) => value).filter((value) => pattern.test(value))
const attribute = (markup, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(markup)?.[1]
const classes = (markup) => (attribute(markup, 'class') ?? '').split(' ')
const presetsOf = (html) => [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, attributes, label]) => ({ label: label.trim(), pressed: attribute(attributes, 'aria-pressed'), disabled: /\sdisabled/.test(attributes) }))

const text = builtinMessages.es.dateRange
const apply = (today) => defaultDateRangePresets(text).map((preset) => [preset.label, preset.range(today)])

test('dates are days of the calendar: real dates only, month ends and leap years', () => {
	assert.equal(dayNumber('1970-01-02'), 1)
	assert.equal(dayNumber('2026-02-29'), undefined, '2026 is not a leap year')
	assert.equal(dayNumber('2024-02-29') - dayNumber('2024-02-28'), 1)
	for (const wrong of ['2026-13-01', '2026-04-31', '2026-1-01', '26-01-01', '', '2026-01-01T00:00', '0099-02-29']) assert.equal(dayNumber(wrong), undefined, wrong)
	assert.equal(dayNumber('0004-02-29') !== undefined, true, 'a leap year below 100 is not 1904')
	assert.equal(addDays('2024-03-01', -1), '2024-02-29')
	assert.equal(addDays('2026-03-01', -1), '2026-02-28')
	assert.equal(addDays('2025-12-31', 1), '2026-01-01')
	assert.equal(endOfMonth('2024-02-10'), '2024-02-29')
	assert.equal(endOfMonth('2100-02-10'), '2100-02-28', 'a century is not a leap year')
	assert.equal(endOfMonth('2000-02-10'), '2000-02-29', 'unless it divides by 400')
	assert.equal(endOfMonth('2026-12-05'), '2026-12-31')
	assert.equal(rangeDays('2026-11-24', '2026-11-24'), 1)
	assert.equal(rangeDays('2024-01-01', '2024-12-31'), 366)
	assert.equal(localToday(new Date(2026, 0, 5, 23, 59)), '2026-01-05', 'the local date, not the UTC one')
})

test('the default shortcuts with a fixed today: today, 7 days, this month and the previous month', () => {
	assert.deepEqual(apply('2026-11-24'), [
		['Hoy', { from: '2026-11-24', to: '2026-11-24' }],
		['7 días', { from: '2026-11-18', to: '2026-11-24' }],
		['Este mes', { from: '2026-11-01', to: '2026-11-24' }],
		['Mes anterior', { from: '2026-10-01', to: '2026-10-31' }],
	])
	// January: the previous month is December of the year before, and 7 days cross the year.
	assert.deepEqual(apply('2026-01-03'), [
		['Hoy', { from: '2026-01-03', to: '2026-01-03' }],
		['7 días', { from: '2025-12-28', to: '2026-01-03' }],
		['Este mes', { from: '2026-01-01', to: '2026-01-03' }],
		['Mes anterior', { from: '2025-12-01', to: '2025-12-31' }],
	])
	// March of a leap year: February has 29 days, and 7 days go through the 29th.
	assert.deepEqual(apply('2024-03-02').slice(1), [
		['7 días', { from: '2024-02-25', to: '2024-03-02' }],
		['Este mes', { from: '2024-03-01', to: '2024-03-02' }],
		['Mes anterior', { from: '2024-02-01', to: '2024-02-29' }],
	])
	assert.deepEqual(apply('2026-03-31')[3][1], { from: '2026-02-01', to: '2026-02-28' })
	// The last day of a 31-day month after a 30-day one.
	assert.deepEqual(apply('2026-05-31')[3][1], { from: '2026-04-01', to: '2026-04-30' })
	assert.deepEqual(
		defaultDateRangePresets(builtinMessages.en.dateRange).map(({ label }) => label),
		['Today', '7 days', 'This month', 'Last month'],
	)
})

test('the validation: order, maxDays counting both ends, min and max on each date, and incomplete ranges', () => {
	assert.equal(validateDateRange({ from: '', to: '' }), undefined)
	assert.equal(validateDateRange({ from: '2026-11-01', to: '' }), undefined, 'a missing date is not an error')
	assert.equal(validateDateRange({ from: '2026-11-01', to: '2026-11-30' }), undefined)
	assert.deepEqual(validateDateRange({ from: '2026-11-02', to: '2026-11-01' }), { issue: 'order', from: true, to: true })
	assert.equal(validateDateRange({ from: '2024-01-01', to: '2024-12-31' }, { maxDays: 366 }), undefined, 'a whole leap year fits in 366 days')
	assert.deepEqual(validateDateRange({ from: '2024-01-01', to: '2025-01-01' }, { maxDays: 366 }), { issue: 'length', from: true, to: true })
	assert.equal(validateDateRange({ from: '2026-11-24', to: '2026-11-24' }, { maxDays: 1 }), undefined)
	assert.deepEqual(validateDateRange({ from: '2025-12-31', to: '' }, { min: '2026-01-01' }), { issue: 'min', from: true, to: false }, 'each date alone against min')
	assert.deepEqual(validateDateRange({ from: '2026-01-01', to: '2027-01-01' }, { max: '2026-12-31' }), { issue: 'max', from: false, to: true })
	assert.deepEqual(validateDateRange({ from: '2027-01-02', to: '2027-01-01' }, { max: '2026-12-31' }), { issue: 'max', from: true, to: true }, 'the limits before the order')
	assert.equal(validateDateRange({ from: '2026-01-01', to: '2026-01-02' }, { min: 'soon', max: '', maxDays: Number.NaN }), undefined, 'a limit that is not a date does not apply')
	assert.equal(isCompleteDateRange({ from: '2026-01-01', to: '' }), false)
	assert.equal(isCompleteDateRange({ from: '2026-01-01', to: '2026-01-01' }, { maxDays: 1 }), true)
	const es = resolveUIMessages('es')
	assert.equal(dateRangeMessage('length', es.dateRange, 'es', { maxDays: 1000 }), 'El rango no puede tener más de 1000 días.')
	assert.equal(dateRangeMessage('min', es.dateRange, 'es', { min: '2026-01-01' }), 'Elige fechas a partir del 1 de enero de 2026.')
	const en = resolveUIMessages('en')
	assert.equal(dateRangeMessage('max', en.dateRange, 'en', { max: '2026-12-31' }), 'Choose dates up to December 31, 2026.')
	assert.equal(dateRangeMessage('order', en.dateRange, 'en', {}), 'The “From” date cannot be after the “To” date.')
})

test('change only carries a complete, valid and new range the user leaves; the models follow every edit', () => {
	createRoot((dispose) => {
		const from = signal('2026-11-01')
		const to = signal('2026-11-24')
		const emitted = []
		const props = { today: '2026-11-24', maxDays: 31 }
		const range = createDateRange(props, { from, to }, resolveUIMessages('es'), (value) => emitted.push(value))
		// What a field does: its model writes the value, then its input event reaches the group.
		const type = (field, value) => {
			;(field === 'from' ? from : to).value = value
			range.edited()
		}
		type('to', '')
		assert.deepEqual([from.value, to.value, emitted.length], ['2026-11-01', '', 0], 'an unfinished date reaches the model, not change')
		type('to', '2026-11-24')
		assert.equal(emitted.length, 0, 'back to the range in place: nothing new')
		type('from', '2026-11-30')
		assert.equal(range.problem.value.issue, 'order')
		assert.equal(emitted.length, 0, 'an invalid range is not emitted')
		type('from', '2026-10-01')
		assert.equal(range.problem.value.issue, 'length')
		assert.equal(emitted.length, 0)
		type('from', '2026-11-10')
		assert.deepEqual(emitted, [{ from: '2026-11-10', to: '2026-11-24' }])
		const today = range.presets.value.find((preset) => preset.label === 'Hoy')
		today.apply()
		assert.deepEqual(emitted.at(-1), { from: '2026-11-24', to: '2026-11-24' })
		assert.equal(range.presets.value.find((preset) => preset.label === 'Hoy').pressed, true)
		range.presets.value.find((preset) => preset.label === 'Hoy').apply()
		assert.equal(emitted.length, 2, 'the same shortcut again emits nothing')
		// The parent writes another range; a shortcut back to the last emitted one is new again.
		from.value = '2026-11-01'
		to.value = '2026-11-02'
		range.presets.value.find((preset) => preset.label === 'Hoy').apply()
		assert.equal(emitted.length, 3)
		dispose()
	})
})

test('without today the shortcuts wait for the mount, which reads the local date', () => {
	createRoot((dispose) => {
		const range = createDateRange({}, { from: signal(''), to: signal('') }, resolveUIMessages('es'), () => {})
		assert.equal(range.today.value, undefined)
		assert.ok(range.presets.value.every((preset) => !preset.pressed))
		range.mount()
		assert.equal(range.today.value, localToday())
		range.presets.value[0].apply()
		assert.ok(range.presets.value[0].pressed)
		dispose()
	})
})

test('UIDateRange renders on the server without reading the clock: a named group, two labelled native dates and disabled shortcuts', { timeout: 60_000 }, async (context) => {
	const html = await renderWithoutClock(context, `<UIDateRange fromName="desde" toName="hasta" min="2025-01-01" max="2026-12-31" bind:required="true" model:from="signal('2026-11-01')" model:to="signal('2026-11-24')" />`)
	const fieldset = tags(html, /<fieldset/)[0]
	assert.equal(attribute(fieldset, 'aria-label'), 'Periodo', 'the default name of the group')
	assert.equal(attribute(fieldset, 'aria-labelledby'), undefined)
	assert.match(html, /<div role="group" aria-label="Atajos"/)
	const dates = tags(html, /type="date"/)
	assert.equal(dates.length, 2)
	assert.deepEqual(
		dates.map((date) => [attribute(date, 'name'), attribute(date, 'value'), attribute(date, 'min'), attribute(date, 'max'), /\srequired/.test(date)]),
		[
			['desde', '2026-11-01', '2025-01-01', '2026-12-31', true],
			['hasta', '2026-11-24', '2025-01-01', '2026-12-31', true],
		],
	)
	assert.ok(classes(dates[0]).includes('ui:[font-variant-numeric:tabular-nums]'), 'the look of <UIInput type="date">')
	assert.match(html, /<label[^>]*>\s*<span[^>]*>Desde<\/span>\s*<input/, 'each date inside its own label')
	assert.match(html, /<span[^>]*>Hasta<\/span>/)
	// Without `today` the shortcuts cannot know their ranges: they wait disabled and unpressed.
	assert.deepEqual(presetsOf(html), [
		{ label: 'Hoy', pressed: 'false', disabled: true },
		{ label: '7 días', pressed: 'false', disabled: true },
		{ label: 'Este mes', pressed: 'false', disabled: true },
		{ label: 'Mes anterior', pressed: 'false', disabled: true },
	])
	assert.ok(
		tags(html, /<button/).every((button) => attribute(button, 'type') === 'button'),
		'a shortcut never submits the form',
	)
	assert.doesNotMatch(html, /aria-invalid|role="alert"|undefined/)
})

test('with today the shortcuts render enabled and the one of the range pressed, the same on every render', { timeout: 60_000 }, async (context) => {
	const template = `<UIDateRange today="2026-11-24" model:from="signal('2026-11-01')" model:to="signal('2026-11-24')" />`
	const html = await renderWithoutClock(context, template)
	assert.deepEqual(presetsOf(html), [
		{ label: 'Hoy', pressed: 'false', disabled: false },
		{ label: '7 días', pressed: 'false', disabled: false },
		{ label: 'Este mes', pressed: 'true', disabled: false },
		{ label: 'Mes anterior', pressed: 'false', disabled: false },
	])
	assert.equal(await renderWithoutClock(context, template), html, 'deterministic: the hydration finds the same markup')
	// Own shortcuts replace the default ones, and [] removes them.
	const own = await render(context, `<UIDateRange today="2026-11-24" bind:presets="[{ label: 'Ayer', range: () => ({ from: '2026-11-23', to: '2026-11-23' }) }]" model:from="signal('2026-11-23')" model:to="signal('2026-11-23')" />`)
	assert.deepEqual(presetsOf(own), [{ label: 'Ayer', pressed: 'true', disabled: false }])
	const none = await render(context, `<UIDateRange today="2026-11-24" bind:presets="[]" />`)
	assert.equal(tags(none, /<button|role="group"/).length, 0)
})

test('an invalid range marks its dates and describes them with a message', { timeout: 60_000 }, async (context) => {
	const order = await render(context, `<UIDateRange describedBy="help" model:from="signal('2026-11-24')" model:to="signal('2026-11-01')" />`)
	const error = tags(order, /role="alert"/)[0]
	const id = attribute(error, 'id')
	assert.ok(id)
	assert.match(order, /role="alert"[^>]*>\s*La fecha «Desde» no puede ser posterior a la fecha «Hasta»\.\s*<\/p>/)
	for (const date of tags(order, /type="date"/)) {
		assert.equal(attribute(date, 'aria-invalid'), 'true')
		assert.equal(attribute(date, 'aria-describedby'), `help ${id}`)
	}
	assert.ok(classes(tags(order, /type="date"/)[0]).includes('ui:aria-[invalid=true]:border-danger'), 'the look of an invalid field')
	const long = await render(context, `<UIDateRange bind:maxDays="366" model:from="signal('2024-01-01')" model:to="signal('2025-01-01')" />`)
	assert.match(long, /El rango no puede tener más de 366 días\./)
	const below = await render(context, `<UIDateRange min="2026-01-01" model:from="signal('2025-12-31')" />`)
	assert.match(below, /Elige fechas a partir del 1 de enero de 2026\./)
	const [from, to] = tags(below, /type="date"/)
	assert.equal(attribute(from, 'aria-invalid'), 'true')
	assert.equal(attribute(to, 'aria-invalid'), undefined, 'only the date out of bounds')
	const forced = await render(context, `<UIDateRange bind:invalid="true" />`)
	assert.equal(tags(forced, /aria-invalid="true"/).length, 2, 'invalid marks both dates without a message of its own')
	assert.doesNotMatch(forced, /role="alert"/)
})

test('inside UIField the group is named by the label of the field and its dates take describedBy', { timeout: 60_000 }, async (context) => {
	const html = await render(context, `<UIField id="period" label="Periodo de ventas" hint="Hasta 366 días"><snippet name="default" params="id, describedBy"><UIDateRange bind:id="id" bind:describedBy="describedBy" /></snippet></UIField>`)
	assert.match(html, /<label id="period-label" for="period"/)
	const fieldset = tags(html, /<fieldset/)[0]
	assert.equal(attribute(fieldset, 'id'), 'period')
	assert.equal(attribute(fieldset, 'aria-labelledby'), 'period-label')
	assert.equal(attribute(fieldset, 'aria-label'), 'Periodo', 'the fallback name when that label does not exist')
	assert.ok(tags(html, /type="date"/).every((date) => attribute(date, 'aria-describedby') === 'period-hint'))
	// A visible legend or ariaLabel name the group instead.
	const legend = await render(context, `<UIDateRange id="sales" label="Ventas" fromLabel="Inicio" toLabel="Fin" />`)
	assert.match(legend, /<legend[^>]*>Ventas<\/legend>/)
	assert.equal(attribute(tags(legend, /<fieldset/)[0], 'aria-label'), undefined)
	assert.equal(attribute(tags(legend, /<fieldset/)[0], 'aria-labelledby'), undefined)
	assert.match(legend, />Inicio<\/span>/)
	assert.match(legend, />Fin<\/span>/)
	const named = await render(context, `<UIDateRange ariaLabel="Fechas del informe" bind:disabled="true" form="filters" />`)
	assert.equal(attribute(tags(named, /<fieldset/)[0], 'aria-label'), 'Fechas del informe')
	assert.match(tags(named, /<fieldset/)[0], /\sdisabled/, 'a disabled fieldset disables its dates and its shortcuts')
	assert.ok(tags(named, /type="date"/).every((date) => attribute(date, 'form') === 'filters'))
})

test('UIDateRange takes class, ui and ui.defaults.dateRange, and its texts have Spanish and English', { timeout: 60_000 }, async (context) => {
	const html = await render(context, `<UIDateRange class="mine" bind:ui="{ preset: 'my-preset', input: 'my-input' }" />`, { defaults: { dateRange: { class: 'app-range', ui: { fields: 'app-fields' } } } })
	const base = classes(tags(html, /<fieldset/)[0])
	assert.ok(base.indexOf('app-range') >= 0 && base.indexOf('app-range') < base.indexOf('mine'))
	assert.ok(classes(tags(html, /<button/)[0]).includes('my-preset'))
	assert.ok(classes(tags(html, /type="date"/)[0]).includes('my-input'))
	assert.ok(tags(html, /<div/).some((div) => classes(div).includes('app-fields')))
	validateDefaults({ dateRange: { class: 'a', ui: { base: 'b', preset: 'c', error: 'd' } } })
	assert.throws(() => validateDefaults({ dateRange: { ui: { button: 'x' } } }), /its slots are base, legend, presets, preset, fields, field, fieldLabel, input, error/)
	for (const locale of ['es', 'en']) for (const [key, value] of Object.entries(builtinMessages[locale].dateRange)) assert.ok(value, `${locale}.dateRange.${key}`)
	assert.deepEqual(Object.keys(builtinMessages.en.dateRange), Object.keys(builtinMessages.es.dateRange))
})

test('the public types of UIDateRange compile', () => {
	const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
	execFileSync(process.execPath, [tsc, '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--allowImportingTsExtensions', '--allowArbitraryExtensions', '--module', 'nodenext', '--target', 'es2022', fileURLToPath(new URL('./types/date-range.ts', import.meta.url))], { stdio: 'pipe' })
})

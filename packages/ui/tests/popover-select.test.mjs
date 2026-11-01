import { createRoot, signal } from '@meekojs/meeko'
import assert from 'node:assert/strict'
import test from 'node:test'

import { computePopoverPosition, listKeyTarget, normalizeText, placementArea, placementMargin, popoverPlacement, typeaheadIndex } from '../dist/app/utils/popover.js'
import { createSelect, defaultSelectFilter, groupOptions, sameOption, selectDisabled, selectLabel, selectValue, toggleSelection } from '../dist/app/utils/select.js'
import { themeToggleItems, themeToggleKeyTarget, themeToggleMode, themeToggleStatus } from '../dist/app/utils/theme-toggle.js'

test('placements map to CSS anchor positioning and the fallback flips and stays in the viewport', () => {
	assert.equal(placementArea('bottom-start'), 'bottom span-right')
	assert.equal(placementArea('top-end'), 'top span-left')
	assert.equal(placementArea('right'), 'right')
	assert.equal(placementArea('left-start'), 'left span-bottom')
	assert.equal(popoverPlacement('sideways'), 'bottom-start')
	assert.equal(placementMargin('bottom-end', 8), '8px 0px 0px 0px')
	assert.equal(placementMargin('top', 4), '0px 0px 4px 0px')
	assert.equal(placementMargin('left', 2), '0px 2px 0px 0px')
	assert.equal(placementMargin('right', -1), '0px 0px 0px 0px')
	const viewport = { width: 800, height: 600 }
	const size = { width: 200, height: 100 }
	assert.deepEqual(computePopoverPosition({ left: 100, top: 100, width: 80, height: 30 }, size, viewport, 'bottom-start', 8), { x: 100, y: 138, side: 'bottom' })
	assert.deepEqual(computePopoverPosition({ left: 100, top: 100, width: 80, height: 30 }, size, viewport, 'bottom-end', 0), { x: 0, y: 130, side: 'bottom' })
	// No room below: it opens above.
	assert.deepEqual(computePopoverPosition({ left: 100, top: 540, width: 80, height: 30 }, size, viewport, 'bottom-start', 8), { x: 100, y: 432, side: 'top' })
	// Neither side has room: it keeps the side with more space, inside the viewport.
	assert.equal(computePopoverPosition({ left: 0, top: 250, width: 10, height: 10 }, { width: 50, height: 400 }, viewport, 'bottom', 0).y, 200)
	assert.deepEqual(computePopoverPosition({ left: 700, top: 200, width: 50, height: 20 }, size, viewport, 'right', 4), { x: 496, y: 160, side: 'left' })
})

test('menu keys and typeahead skip disabled items, ignore accents and cycle a repeated letter', () => {
	const skip = (index) => index === 1
	assert.equal(listKeyTarget('ArrowDown', 0, 3, skip), 2)
	assert.equal(listKeyTarget('ArrowDown', 2, 3, skip), 0, 'it wraps')
	assert.equal(listKeyTarget('ArrowDown', 2, 3, skip, false), 2, 'or not')
	assert.equal(listKeyTarget('ArrowUp', -1, 3), 2)
	assert.equal(
		listKeyTarget('Home', 2, 3, (index) => index === 0),
		1,
	)
	assert.equal(
		listKeyTarget('End', 0, 3, (index) => index === 2),
		1,
	)
	assert.equal(listKeyTarget('PageDown', 0, 30), 10)
	assert.equal(listKeyTarget('PageUp', 5, 30), 0)
	assert.equal(listKeyTarget('x', 0, 3), undefined)
	const labels = ['Rojo', 'Verde', 'Azul', 'Ámbar', 'Rosa']
	assert.equal(normalizeText('Ámbar Ñandú'), 'ambar nandu')
	assert.equal(typeaheadIndex(labels, 'a', 0), 2)
	assert.equal(typeaheadIndex(labels, 'a', 2), 3, 'the same letter again goes to the next')
	assert.equal(typeaheadIndex(labels, 'aa', 3), 2, 'a repeated letter cycles')
	assert.equal(typeaheadIndex(labels, 'ro', 0), 0, 'a longer prefix keeps the current item')
	assert.equal(typeaheadIndex(labels, 'ros', 0), 4)
	assert.equal(
		typeaheadIndex(labels, 'r', -1, (index) => index === 0),
		4,
	)
	assert.equal(typeaheadIndex(labels, 'z', 0), -1)
})

test('select helpers compare with by, label, group, filter without accents and respect max', () => {
	const ana = { id: 1, name: 'Ana', team: 'A' }
	assert.equal(selectLabel('x'), 'x')
	assert.equal(selectLabel(ana), 'Ana')
	assert.equal(selectLabel({ id: 1, name: 'n', label: 'L' }), 'L')
	assert.equal(selectLabel(ana, 'team'), 'A')
	assert.equal(
		selectLabel(ana, (user) => user.name.toUpperCase()),
		'ANA',
	)
	assert.ok(sameOption(ana, { id: 1, name: 'Otra' }, 'id'))
	assert.ok(!sameOption(ana, { id: 1, name: 'Ana' }), 'without by, identity')
	assert.ok(sameOption(ana, { id: 9, name: 'Ana' }, (a, b) => a.name === b.name))
	assert.equal(selectValue(ana, { by: 'id' }), '1')
	assert.equal(selectValue(2, {}), '2')
	assert.equal(selectValue(ana, {}), 'Ana')
	assert.ok(selectDisabled({ id: 2, name: 'B', disabled: true }))
	assert.ok(!selectDisabled(ana))
	assert.ok(selectDisabled(ana, (user) => user.id === 1))
	assert.deepEqual(defaultSelectFilter(['Rojo', 'Ámbar', 'Verde'], ' AMB ', String), ['Ámbar'])
	const groups = groupOptions([ana, { id: 2, name: 'Bea', team: 'B', disabled: true }, { id: 3, name: 'Carla', team: 'A' }, { id: 4, name: 'Sin' }], { groupBy: 'team' }, 'list')
	assert.deepEqual(
		groups.map((group) => [group.name, group.id, group.entries.map((entry) => [entry.index, entry.id, entry.label, entry.disabled])]),
		[
			[
				'A',
				'list-g0',
				[
					[0, 'list-0', 'Ana', false],
					[1, 'list-1', 'Carla', false],
				],
			],
			['B', 'list-g1', [[2, 'list-2', 'Bea', true]]],
			[undefined, undefined, [[3, 'list-3', 'Sin', false]]],
		],
	)
	assert.deepEqual(toggleSelection(['a'], 'b', { multiple: false }), ['b'])
	assert.equal(toggleSelection(['a'], 'a', { multiple: false }), undefined)
	assert.deepEqual(toggleSelection(['a'], 'b', { multiple: true }), ['a', 'b'])
	assert.deepEqual(toggleSelection(['a', 'b'], 'a', { multiple: true }), ['b'])
	assert.equal(toggleSelection(['a', 'b'], 'c', { multiple: true, max: 2 }), undefined, 'max reached')
	assert.deepEqual(toggleSelection([ana], { id: 1, name: 'copia' }, { multiple: true, by: 'id' }), [])
})

/** A toggle state like the one `useThemeToggle()` returns. */
function toggleState(choice, { resolved = choice, known = true, interactive = false, choices = ['light', 'dark', 'system'], system = { light: 'light', dark: 'dark' } } = {}) {
	return { theme: { theme: { value: choice }, resolved: { value: resolved } }, choices, system, known: { value: known }, interactive: { value: interactive } }
}

test('the theme toggle cycles its list, names the current and next theme, and stays neutral while the choice is unknown', () => {
	assert.equal(themeToggleMode(undefined), 'cycle')
	assert.equal(themeToggleMode('select'), 'select')
	assert.throws(() => themeToggleMode('menu'), /mode must be "cycle" or "select"/)
	const toggle = toggleState('dark')
	const items = themeToggleItems(toggle, {})
	assert.deepEqual(
		items.map((item) => [item.name, item.label, item.icon]),
		[
			['light', 'Claro', 'light'],
			['dark', 'Oscuro', 'dark'],
			['system', 'Sistema', 'system'],
		],
	)
	// The same choices keep their list, so a new array of props writes nothing again.
	assert.equal(themeToggleItems(toggle, {}, items), items)
	assert.deepEqual(themeToggleStatus(toggle, items, {}), { next: 'system', label: 'Tema: oscuro. Cambiar a sistema', checked: 'dark', focused: undefined })
	// Without "system" in the list, the icons of its themes carry system-light and system-dark.
	const pair = themeToggleItems(toggle, { themes: ['light', 'dark'], labels: { light: 'Light' } })
	assert.deepEqual(
		pair.map((item) => [item.label, item.icon]),
		[
			['Light', 'light system-light'],
			['Oscuro', 'dark system-dark'],
		],
	)
	// "system" outside the list moves on from the theme it shows.
	assert.equal(themeToggleStatus(toggleState('system', { resolved: 'dark' }), pair, {}).next, 'light')
	assert.deepEqual(themeToggleStatus(toggleState('dark', { known: false }), items, { messages: { unknown: 'Switch theme' } }), { next: 'system', label: 'Switch theme', checked: undefined, focused: undefined })
	assert.equal(themeToggleStatus(toggleState('dark', { interactive: true }), items, {}).focused, 'dark')
	assert.equal(themeToggleStatus(toggle, items, { messages: { cycle: (current, next) => `${current} → ${next}` } }).label, 'Oscuro → Sistema')
	assert.throws(() => themeToggleItems(toggle, { themes: ['sepia'] }), /unknown theme "sepia"/)
	assert.throws(() => themeToggleItems(toggle, { themes: [] }), /at least one theme/)
	assert.equal(themeToggleKeyTarget('ArrowRight', 2, 3), 0)
	assert.equal(themeToggleKeyTarget('ArrowUp', 0, 3), 2)
	assert.equal(themeToggleKeyTarget('End', 0, 3), 2)
	assert.equal(themeToggleKeyTarget('Tab', 0, 3), undefined)
})

test('clearable shows its button only with a selection and clear empties a single or multiple select', () => {
	const run = (settings, initial) =>
		createRoot((dispose) => {
			const model = signal(initial)
			const emitted = []
			const select = createSelect({ options: ['a', 'b'], ...settings }, model, 'id', (value) => emitted.push(value))
			const before = select.showClear.value
			select.open.value = true
			select.clear()
			const result = { before, after: select.showClear.value, value: model.value, emitted, open: select.open.value }
			dispose()
			return result
		})
	assert.deepEqual(run({ clearable: true }, 'a'), { before: true, after: false, value: null, emitted: [null], open: false })
	assert.deepEqual(run({ clearable: true, multiple: true }, ['a', 'b']), { before: true, after: false, value: [], emitted: [[]], open: false })
	assert.equal(run({ clearable: true }, null).before, false, 'nothing to clear')
	assert.equal(run({}, 'a').before, false, 'off by default')
	assert.equal(run({ clearable: true, disabled: true }, 'a').before, false, 'disabled')
	assert.deepEqual(run({}, 'a').emitted, [], 'clear does nothing without clearable')
})

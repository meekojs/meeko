import assert from 'node:assert/strict'
import test from 'node:test'

import { colorCompoundVariants } from '../dist/app/theme/base/colors.js'
import { alertTheme } from '../dist/app/theme/components/alert.js'
import { avatarTheme } from '../dist/app/theme/components/avatar.js'
import { badgeTheme } from '../dist/app/theme/components/badge.js'
import { menuTheme } from '../dist/app/theme/components/menu.js'
import { sparklineTheme } from '../dist/app/theme/components/sparkline.js'
import { toastTheme } from '../dist/app/theme/components/toast.js'

const colors = ['primary', 'secondary', 'neutral', 'success', 'info', 'warning', 'danger']

/** The classes of the catalog for a pair, without the pointer states that a static element drops. */
const still = (color, variant) =>
	colorCompoundVariants
		.find((entry) => entry.color === color && entry.variant === variant)
		.class.split(' ')
		.filter((name) => !name.startsWith('not-disabled:'))

const classes = (value) => value.split(' ')

test('every pair of variant and color of UIBadge and UIAvatar paints with the catalog, without the pointer states', () => {
	for (const [recipe, variants] of [
		[badgeTheme, ['soft', 'solid', 'surface', 'outline']],
		[avatarTheme, ['soft', 'solid', 'surface', 'outline']],
	]) {
		for (const variant of variants) {
			for (const color of colors) {
				if (recipe === badgeTheme && variant === 'soft' && color === 'neutral') continue
				const base = classes(recipe({ variant, color }).base())
				for (const name of still(color, variant)) assert.ok(base.includes(name), `${variant} ${color}: ${name} in ${base.join(' ')}`)
				assert.ok(!base.some((name) => name.startsWith('not-disabled:')), `${variant} ${color} does not react to the pointer`)
			}
		}
	}
})

test('UIBadge is a neutral soft pill by default, with the semantic tokens and the border it always had', () => {
	const base = classes(badgeTheme().base())
	for (const name of ['border-border', 'bg-control', 'text-text-soft', 'rounded-full', 'text-xs', 'leading-snug']) assert.ok(base.includes(name), name)
	for (const name of ['border-transparent', 'bg-neutral-3', 'text-neutral-11']) assert.ok(!base.includes(name), `${name} gives way to the semantic tokens`)
	// The old tones are the soft pairs: `accent` is primary.
	assert.deepEqual(
		classes(badgeTheme({ color: 'primary' }).base()).filter((name) => /^(bg|text|border)-primary/.test(name)),
		['bg-primary-3', 'text-primary-11'],
	)
	assert.ok(classes(badgeTheme({ radius: 'sm' }).base()).includes('rounded-sm') && !classes(badgeTheme({ radius: 'sm' }).base()).includes('rounded-full'))
})

test('the class of the consumer wins over the classes of the recipes it conflicts with', () => {
	const badge = classes(badgeTheme({ variant: 'solid', color: 'danger' }).base({ class: 'bg-amber-500 rounded-none' }))
	assert.ok(badge.includes('bg-amber-500') && !badge.includes('bg-danger-9') && badge.includes('text-danger-contrast'), badge.join(' '))
	assert.ok(badge.includes('rounded-none') && !badge.includes('rounded-full'), badge.join(' '))
	const alert = classes(alertTheme({ color: 'warning' }).base({ class: 'border-red-500 p-2' }))
	assert.ok(alert.includes('border-red-500') && !alert.includes('border-warning-7') && alert.includes('bg-warning-3'), alert.join(' '))
	assert.ok(alert.includes('p-2') && !alert.includes('p-4'), alert.join(' '))
	const avatar = classes(avatarTheme().base({ class: 'bg-white text-black' }))
	assert.ok(avatar.includes('bg-white') && !avatar.includes('bg-primary-3') && avatar.includes('text-black') && !avatar.includes('text-primary-11'), avatar.join(' '))
	const line = classes(sparklineTheme({ color: 'info' }).base({ class: 'text-amber-500' }))
	assert.ok(line.includes('text-amber-500') && !line.includes('text-info-11'), line.join(' '))
})

test('UIAlert and UIToast are soft by default, with the border of step 7, and neutral is the surface of the page', () => {
	for (const color of colors.filter((name) => name !== 'neutral')) {
		for (const recipe of [alertTheme, toastTheme]) {
			const base = classes(recipe({ color }).base())
			for (const name of [`bg-${color}-3`, `text-${color}-11`, `border-${color}-7`]) assert.ok(base.includes(name), `${color}: ${name}`)
			assert.ok(!base.includes('border-transparent') && !base.some((name) => name.startsWith('not-disabled:')), base.join(' '))
		}
	}
	const alert = classes(alertTheme().base())
	for (const name of ['border-border', 'bg-surface', 'text-text']) assert.ok(alert.includes(name), name)
	const toast = classes(toastTheme().base())
	for (const name of ['border-border', 'bg-surface-raised', 'text-text']) assert.ok(toast.includes(name), name)
	assert.ok(!toast.includes('bg-surface'))
	// The other treatments come from the catalog.
	for (const variant of ['surface', 'outline', 'solid']) {
		const base = classes(alertTheme({ variant, color: 'danger' }).base())
		for (const name of still('danger', variant)) assert.ok(base.includes(name), `${variant}: ${name}`)
	}
	assert.ok(classes(alertTheme({ variant: 'solid', color: 'danger' }).dismiss()).includes('hover:bg-gray-a4'), 'the close button of a solid keeps its contrast')
})

test('UISparkline paints step 11 of its color, the soft text when neutral, and the current color without one', () => {
	for (const color of colors.filter((name) => name !== 'neutral')) assert.ok(classes(sparklineTheme({ color }).base()).includes(`text-${color}-11`), color)
	assert.ok(classes(sparklineTheme({ color: 'neutral' }).base()).includes('text-text-soft'))
	assert.ok(
		!sparklineTheme()
			.base()
			.split(' ')
			.some((name) => name.startsWith('text-')),
		'without a color, currentColor',
	)
})

test('a danger item of UIMenu has the danger text and its soft background under the pointer and the focus', () => {
	const item = classes(menuTheme().item({ color: 'danger' }))
	for (const name of ['text-danger-11', 'not-aria-disabled:hover:bg-danger-3', 'not-aria-disabled:focus:bg-danger-3']) assert.ok(item.includes(name), name)
	assert.ok(!classes(menuTheme().item()).includes('text-danger-11'))
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { containerTheme } from '../dist/app/theme/components/container.js'
import { brandTheme, footerTheme, headerTheme } from '../dist/app/theme/components/header.js'
import { localeSuggestionTheme, localeSwitcherTheme } from '../dist/app/theme/components/locale.js'
import { breadcrumbTheme, navigationTabsTheme, navigationTreeTheme, pageNavigationTheme, paginationTheme, tableOfContentsLinkTheme, tableOfContentsTheme } from '../dist/app/theme/components/navigation.js'
import { pageColumnsTheme, pageHeaderTheme, pageTheme } from '../dist/app/theme/components/page.js'
import { themeToggleTheme } from '../dist/app/theme/components/theme-toggle.js'

const has = (classes, ...names) => {
	const list = classes.split(' ')
	for (const name of names) assert.ok(list.includes(name), name)
}

test('containerTheme keeps its base, size and gutter, and the class of the consumer wins', () => {
	has(containerTheme(), 'mx-auto', 'w-full', 'max-w-[var(--ui-container-max-width,var(--ui-container-xl))]', 'px-[var(--ui-container-gutter,var(--ui-container-gutter-md))]')
	has(containerTheme({ size: '4k', gutter: 'none' }), 'max-w-[var(--ui-container-max-width,var(--ui-container-4k))]', 'px-[var(--ui-container-gutter,0)]')
	const merged = containerTheme({ class: 'mx-0 w-1/2 mine' })
	has(merged, 'mx-0', 'w-1/2', 'mine')
	assert.ok(!merged.split(' ').includes('mx-auto') && !merged.split(' ').includes('w-full'))
})

test('header recipes keep their slots and merge the class of the consumer', () => {
	has(headerTheme().base(), 'border-b-border', 'bg-bg', 'text-text')
	has(headerTheme().bar(), 'flex', 'h-(--ui-header-height)')
	assert.ok(headerTheme({ sticky: true }).base().split(' ').includes('sticky'))
	assert.ok(!headerTheme({ sticky: false }).base().split(' ').includes('sticky'))
	assert.ok(!headerTheme().base({ class: 'bg-red-500' }).includes('bg-bg'))
	has(headerTheme().base({ class: 'bg-red-500' }), 'bg-red-500')
	has(footerTheme().base(), 'border-t-border', 'text-text-soft')
	has(footerTheme().inner(), 'grid', 'py-10')
	assert.ok(!footerTheme().inner({ class: 'py-2' }).includes('py-10'))
	has(brandTheme().base(), 'inline-flex', 'text-text')
	has(brandTheme({ yields: true }).name(), 'max-phone:hidden')
	assert.ok(!brandTheme().name().includes('max-phone:hidden'))
})

test('navigation recipes keep their base classes and merge the class of the consumer', () => {
	has(navigationTreeTheme().base(), 'grid', 'text-text-soft')
	has(navigationTabsTheme().base(), 'group/tabs', 'border-b-border')
	has(navigationTabsTheme({ variant: 'segmented' }).base(), 'rounded-lg', 'bg-control')
	has(breadcrumbTheme().list(), 'flex', 'list-none')
	has(pageNavigationTheme().base(), 'grid-cols-2')
	has(paginationTheme().base(), 'justify-between')
	has(tableOfContentsTheme().base(), 'text-md', 'text-text-soft')
	has(tableOfContentsLinkTheme({ nested: 1 }), 'ps-6')
	assert.ok(!navigationTreeTheme().base({ class: 'text-red-500' }).includes('text-text-soft'))
	has(navigationTreeTheme().base({ class: 'text-red-500' }), 'text-red-500')
	assert.ok(!paginationTheme().base({ class: 'gap-x-1' }).includes('gap-x-4'))
})

test('page recipes follow the layout and the columns of the body', () => {
	has(pageTheme().base(), 'group/page', 'min-h-dvh')
	has(pageTheme({ layout: 'landing' }).body(), 'max-w-none')
	has(pageTheme().body({ class: 'gap-2' }), 'gap-2')
	assert.ok(!pageTheme().body({ class: 'gap-2' }).includes('gap-12'))
	has(pageColumnsTheme(), 'grid-cols-[minmax(0,1fr)]')
	has(pageColumnsTheme({ sidebar: true, aside: false }), 'grid-cols-[var(--ui-page-sidebar-width)_minmax(0,1fr)]')
	has(pageHeaderTheme().title(), 'text-text')
	has(pageHeaderTheme({ layout: 'landing' }).title(), 'font-bold', 'tracking-display')
	assert.ok(!pageHeaderTheme().base({ class: 'mb-0' }).includes('mb-10'))
})

test('locale and theme toggle recipes keep their base and merge the class of the consumer', () => {
	has(localeSwitcherTheme().base(), 'inline-flex', 'border-border')
	has(localeSuggestionTheme().base(), 'fixed', 'bg-surface-raised')
	assert.ok(!localeSuggestionTheme().base({ class: 'bg-red-500' }).includes('bg-surface-raised'))
	has(themeToggleTheme().button(), 'min-h-(--ui-control-height-md)', 'bg-control')
	has(themeToggleTheme({ mode: 'select' }).button(), 'min-h-(--ui-control-height-sm)', 'bg-transparent')
	assert.ok(!themeToggleTheme().button({ class: 'bg-red-500' }).split(' ').includes('bg-control'))
	has(themeToggleTheme().button({ class: 'bg-red-500' }), 'bg-red-500')
})

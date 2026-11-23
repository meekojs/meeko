import assert from 'node:assert/strict'
import test from 'node:test'

import { builtinMessages } from '../dist/app/utils/messages.js'
import { clampPage, paginationCount, paginationItems } from '../dist/app/utils/pagination.js'
import { validateOptions } from '../dist/options.js'

test('paginationItems shows every page while they fit, and keeps one length after that', () => {
	assert.deepEqual(paginationItems(1, 1), [1])
	assert.deepEqual(paginationItems(4, 7), [1, 2, 3, 4, 5, 6, 7])
	assert.deepEqual(paginationItems(1, 10), [1, 2, 3, 4, 5, null, 10])
	assert.deepEqual(paginationItems(4, 10), [1, 2, 3, 4, 5, null, 10])
	assert.deepEqual(paginationItems(5, 10), [1, null, 4, 5, 6, null, 10])
	assert.deepEqual(paginationItems(7, 10), [1, null, 6, 7, 8, 9, 10])
	assert.deepEqual(paginationItems(10, 10), [1, null, 6, 7, 8, 9, 10])
	for (let page = 1; page <= 30; page++) {
		const items = paginationItems(page, 30)
		assert.equal(items.length, 7, `page ${page}`)
		assert.ok(items.includes(page), `page ${page} is shown`)
	}
})

test('paginationItems never hides a single page behind a gap, and takes the siblings asked for', () => {
	for (let page = 1; page <= 12; page++) {
		const items = paginationItems(page, 12)
		items.forEach((value, index) => {
			if (value === null) assert.ok(items[index + 1] - items[index - 1] > 2, `page ${page}: a gap hides more than one page`)
		})
	}
	assert.deepEqual(paginationItems(10, 20, 2), [1, null, 8, 9, 10, 11, 12, null, 20])
	assert.deepEqual(paginationItems(10, 20, 0), [1, null, 10, null, 20])
	assert.deepEqual(paginationItems(10, 20, -1), paginationItems(10, 20, 0), 'a negative count is none')
})

test('paginationCount and clampPage keep the page inside its pages', () => {
	assert.equal(paginationCount(4, undefined, undefined), 4)
	assert.equal(paginationCount(undefined, 57, 5), 12)
	assert.equal(paginationCount(undefined, 0, 5), 1, 'an empty list still has its page')
	assert.equal(paginationCount(undefined, undefined, 5), 1)
	assert.equal(paginationCount(Number.NaN, undefined, undefined), 1)
	assert.equal(clampPage(0, 4), 1)
	assert.equal(clampPage(9, 4), 4)
	assert.equal(clampPage(2.7, 4), 2)
	assert.equal(clampPage(Number.NaN, 4), 1)
})

test('the texts of the numbered mode come in Spanish and English and ui.messages validates them', () => {
	for (const key of ['range', 'page', 'previous', 'next', 'first', 'last']) {
		assert.ok(builtinMessages.es.pagination[key], `es.${key}`)
		assert.ok(builtinMessages.en.pagination[key], `en.${key}`)
	}
	assert.equal(builtinMessages.es.pagination.range, '{from}–{to} de {total}')
	assert.equal(builtinMessages.es.pagination.page, 'Página {page}')
	assert.doesNotThrow(() => validateOptions({ messages: { fr: { pagination: { previous: 'Page précédente', page: 'Page {page}' } } } }))
})

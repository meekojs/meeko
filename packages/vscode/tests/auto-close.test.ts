import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { TagCloseResponse } from '../src/auto-close-trigger'

import { tagCloseApplies, tagClosePosition, tagCloseTrigger } from '../src/auto-close-trigger'

const typed = (text: string, rangeLength = 0) => ({ text, rangeLength })

test('typing > or / in a .meeko document asks for the closing tag', () => {
	const close = typed('>')
	assert.equal(tagCloseTrigger({ languageId: 'meeko', reason: undefined, changes: [close] }), close)
	const slash = typed('/')
	assert.equal(tagCloseTrigger({ languageId: 'meeko', reason: undefined, changes: [slash] }), slash)
})

test('only the last change of the event decides', () => {
	const last = typed('>')
	assert.equal(tagCloseTrigger({ languageId: 'meeko', reason: undefined, changes: [typed('a'), last] }), last)
	assert.equal(tagCloseTrigger({ languageId: 'meeko', reason: undefined, changes: [typed('>'), typed('a')] }), undefined)
})

test('other languages, empty events and other text never ask', () => {
	assert.equal(tagCloseTrigger({ languageId: 'html', reason: undefined, changes: [typed('>')] }), undefined)
	assert.equal(tagCloseTrigger({ languageId: 'meeko', reason: undefined, changes: [] }), undefined)
	for (const text of ['', 'a', '<', '</', '>>', '>\n', ' ']) {
		assert.equal(tagCloseTrigger({ languageId: 'meeko', reason: undefined, changes: [typed(text)] }), undefined, JSON.stringify(text))
	}
})

test('replacing a selection with > does not ask', () => {
	assert.equal(tagCloseTrigger({ languageId: 'meeko', reason: undefined, changes: [typed('>', 3)] }), undefined)
	assert.equal(tagCloseTrigger({ languageId: 'meeko', reason: undefined, changes: [typed('/', 1)] }), undefined)
})

test('undo and redo do not ask, even when they restore a >', () => {
	assert.equal(tagCloseTrigger({ languageId: 'meeko', reason: 'undo', changes: [typed('>')] }), undefined)
	assert.equal(tagCloseTrigger({ languageId: 'meeko', reason: 'redo', changes: [typed('/')] }), undefined)
})

test('the request position is right after the typed character', () => {
	assert.deepEqual(tagClosePosition({ line: 4, character: 7 }), { line: 4, character: 8 })
	assert.deepEqual(tagClosePosition({ line: 0, character: 0 }), { line: 0, character: 1 })
})

const response = (overrides: Partial<TagCloseResponse> = {}): TagCloseResponse => ({
	snippet: '$0</div>',
	sameDocument: true,
	requestedVersion: 12,
	currentVersion: 12,
	requestedPosition: { line: 4, character: 8 },
	cursor: { line: 4, character: 8 },
	...overrides,
})

test('the closing tag is inserted when nothing moved since the request', () => {
	assert.equal(tagCloseApplies(response()), true)
})

test('an empty answer inserts nothing', () => {
	assert.equal(tagCloseApplies(response({ snippet: null })), false)
	assert.equal(tagCloseApplies(response({ snippet: undefined })), false)
	assert.equal(tagCloseApplies(response({ snippet: '' })), false)
})

test('the answer is dropped when typing went on, the cursor moved or the editor changed', () => {
	assert.equal(tagCloseApplies(response({ currentVersion: 13 })), false)
	assert.equal(tagCloseApplies(response({ cursor: { line: 4, character: 9 } })), false)
	assert.equal(tagCloseApplies(response({ cursor: { line: 5, character: 8 } })), false)
	assert.equal(tagCloseApplies(response({ cursor: undefined })), false)
	assert.equal(tagCloseApplies(response({ sameDocument: false })), false)
})

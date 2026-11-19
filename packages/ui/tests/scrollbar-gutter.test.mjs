import assert from 'node:assert/strict'
import test from 'node:test'

import { measureScrollbarGutter, trackScrollbarGutter } from '../dist/app/utils/scrollbar-gutter.js'
import { withDocument } from './helpers/document.mjs'

const gutter = '--ui-scrollbar-gutter'
const side = 'data-meeko-ui-scrollbar-gutter'

test('the gutter is what the window has beyond the root: its width and its side, on <html>', () => {
	withDocument({}, ({ properties, attributes }) => {
		measureScrollbarGutter()
		assert.equal(properties.get(gutter), '15px')
		assert.equal(attributes.get(side), 'right')
	})
	withDocument({ left: 15 }, ({ properties, attributes }) => {
		measureScrollbarGutter()
		assert.equal(properties.get(gutter), '15px')
		assert.equal(attributes.get(side), 'left', 'a browser that moves it to the left in a right-to-left page')
	})
})

test('without a scrollbar, or with one over the page, the gutter is 0', () => {
	for (const options of [{ clientWidth: 390, innerWidth: 390 }, { clientWidth: 1280 }]) {
		withDocument(options, ({ properties, attributes }) => {
			measureScrollbarGutter()
			assert.equal(properties.get(gutter), '0px')
			assert.equal(attributes.get(side), 'right')
		})
	}
	// Wider than the window, as some phones report it: never a negative padding.
	withDocument({ clientWidth: 1300 }, ({ properties }) => {
		measureScrollbarGutter()
		assert.equal(properties.get(gutter), '0px')
	})
})

test('while a lock has given the gutter back, or the page is zoomed with the fingers, the last width stays', () => {
	withDocument({ style: { overflow: 'hidden', scrollbarGutter: 'auto' }, clientWidth: 1280 }, ({ properties, attributes }) => {
		properties.set(gutter, '15px')
		measureScrollbarGutter()
		assert.equal(properties.get(gutter), '15px')
		assert.equal(attributes.size, 0)
	})
	withDocument({ scale: 2, innerWidth: 640 }, ({ properties }) => {
		measureScrollbarGutter()
		assert.equal(properties.has(gutter), false)
	})
	// An app whose root does not scroll keeps its stable gutter: that one is measured.
	withDocument({ style: { overflow: 'hidden', scrollbarGutter: '' } }, ({ properties }) => {
		measureScrollbarGutter()
		assert.equal(properties.get(gutter), '15px')
	})
})

test('the width follows the window, the zoom and the scrollbar, once per page', () => {
	withDocument({}, ({ root, properties, listeners, observers }) => {
		trackScrollbarGutter()
		trackScrollbarGutter()
		assert.equal(properties.get(gutter), '15px')
		assert.equal(observers.length, 1, 'a single observer')
		assert.equal(observers[0].target, root)
		// A zoom of 200%: the scrollbar keeps its pixels of the screen, half as many of CSS.
		globalThis.innerWidth = 640
		root.clientWidth = 632
		listeners.get('resize')()
		assert.equal(properties.get(gutter), '8px')
		// The scrollbar leaves, as when the content gets shorter without a stable gutter.
		root.clientWidth = 640
		observers[0].callback([])
		assert.equal(properties.get(gutter), '0px')
	})
})

test('without a document, as in SSR, nothing is measured or tracked', () => {
	assert.equal(globalThis.document, undefined)
	measureScrollbarGutter()
	trackScrollbarGutter()
})

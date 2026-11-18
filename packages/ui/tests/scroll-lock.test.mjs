import { createRoot, signal } from '@meekojs/meeko'
import assert from 'node:assert/strict'
import test from 'node:test'

import { useScrollLock } from '../dist/app/composables/useScrollLock.js'

/** A document whose <html> only has the inline styles that useScrollLock touches. */
function withDocument(style, run) {
	const previous = globalThis.document
	globalThis.document = { documentElement: { style } }
	try {
		run(style)
	} finally {
		if (previous === undefined) delete globalThis.document
		else globalThis.document = previous
	}
}

test('useScrollLock locks the document while active and puts back the inline styles of <html>', () => {
	withDocument({ overflow: 'clip', scrollbarGutter: '' }, (style) => {
		const open = signal(false)
		const dispose = createRoot((dispose) => {
			useScrollLock(() => open.value)
			return dispose
		})
		assert.equal(style.overflow, 'clip', 'inactive: nothing changes')
		open.value = true
		assert.deepEqual({ ...style }, { overflow: 'hidden', scrollbarGutter: 'stable' })
		open.value = false
		assert.deepEqual({ ...style }, { overflow: 'clip', scrollbarGutter: '' }, 'the styles the app had come back')
		open.value = true
		dispose()
		assert.deepEqual({ ...style }, { overflow: 'clip', scrollbarGutter: '' }, 'destroying the component releases its lock')
	})
})

test('useScrollLock counts the locks: the document scrolls again when the last one is released', () => {
	withDocument({ overflow: '', scrollbarGutter: '' }, (style) => {
		const first = signal(true)
		const second = signal(true)
		const disposeFirst = createRoot((dispose) => {
			useScrollLock(() => first.value)
			return dispose
		})
		const disposeSecond = createRoot((dispose) => {
			useScrollLock(() => second.value)
			return dispose
		})
		first.value = false
		assert.equal(style.overflow, 'hidden', 'the second drawer is still open')
		second.value = false
		assert.equal(style.overflow, '')
		disposeFirst()
		disposeSecond()
		assert.equal(style.overflow, '', 'releasing twice does not unlock a third component')
	})
})

test('useScrollLock does nothing without a document, as in SSR', () => {
	assert.equal(globalThis.document, undefined)
	const dispose = createRoot((dispose) => {
		useScrollLock(() => true)
		return dispose
	})
	dispose()
})

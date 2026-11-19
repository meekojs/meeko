import { createRoot, signal } from '@meekojs/meeko'
import assert from 'node:assert/strict'
import test from 'node:test'

import { useScrollLock } from '../dist/app/composables/useScrollLock.js'
import { withDocument } from './helpers/document.mjs'

const empty = { overflow: '', paddingLeft: '', paddingRight: '', scrollbarGutter: '' }

test('useScrollLock locks the document while active, gives the gutter back as padding and puts back the inline styles of <html>', () => {
	withDocument({ style: { ...empty, overflow: 'clip' } }, ({ style, properties }) => {
		const open = signal(false)
		const dispose = createRoot((dispose) => {
			useScrollLock(() => open.value)
			return dispose
		})
		assert.equal(style.overflow, 'clip', 'inactive: nothing changes')
		open.value = true
		assert.deepEqual({ ...style }, { overflow: 'hidden', paddingLeft: '', paddingRight: 'var(--ui-scrollbar-gutter)', scrollbarGutter: 'auto' })
		assert.equal(properties.get('--ui-scrollbar-gutter'), '15px', 'measured before the scrollbar leaves')
		open.value = false
		assert.deepEqual({ ...style }, { ...empty, overflow: 'clip' }, 'the styles the app had come back')
		open.value = true
		dispose()
		assert.deepEqual({ ...style }, { ...empty, overflow: 'clip' }, 'destroying the component releases its lock')
	})
})

test('useScrollLock pads the side of the gutter: on the left where the browser moves it there', () => {
	withDocument({ style: { ...empty, paddingLeft: '1px' }, left: 15 }, ({ style }) => {
		const dispose = createRoot((dispose) => {
			useScrollLock(() => true)
			return dispose
		})
		assert.deepEqual({ ...style }, { overflow: 'hidden', paddingLeft: 'var(--ui-scrollbar-gutter)', paddingRight: '', scrollbarGutter: 'auto' })
		dispose()
		assert.deepEqual({ ...style }, { ...empty, paddingLeft: '1px' })
	})
})

test('useScrollLock keeps the gutter with scrollbar-gutter: stable when its width cannot be measured', () => {
	withDocument({ style: { ...empty }, computed: false }, ({ style, attributes }) => {
		const dispose = createRoot((dispose) => {
			useScrollLock(() => true)
			return dispose
		})
		assert.equal(attributes.size, 0)
		assert.deepEqual({ ...style }, { ...empty, overflow: 'hidden', scrollbarGutter: 'stable' })
		dispose()
		assert.deepEqual({ ...style }, empty)
	})
})

test('useScrollLock counts the locks: the document scrolls again when the last one is released', () => {
	withDocument({ style: { ...empty } }, ({ style }) => {
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
		assert.equal(style.paddingRight, 'var(--ui-scrollbar-gutter)')
		second.value = false
		assert.deepEqual({ ...style }, empty)
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

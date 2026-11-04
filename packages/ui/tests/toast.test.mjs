import { createRoot } from '@meekojs/meeko'
import assert from 'node:assert/strict'
import test from 'node:test'

import { installToastPlugin, useToast, useToastHost } from '../dist/app/composables/useToast.js'
import { resolveUIMessages } from '../dist/app/utils/messages.js'

function app(side = 'client') {
	const values = new Map()
	installToastPlugin({ side, provide: (key, value) => values.set(key, value) })
	return values
}

test('toast messages support both locales and partial overrides', () => {
	assert.equal(resolveUIMessages('en').feedback.close, 'Dismiss notification')
	assert.equal(resolveUIMessages('es').feedback.loading, 'Cargando')
	assert.deepEqual(resolveUIMessages('en', { messages: { en: { feedback: { close: 'Close' } } } }).feedback, { close: 'Close', empty: 'No results.', loading: 'Loading' })
})

test('toast state is isolated per app, IDs never repeat and host disposal clears entries', async () => {
	const { provide } = await import('@meekojs/meeko')
	const first = app()
	const second = app()
	createRoot((dispose) => {
		for (const [key, value] of first) provide(key, value)
		const host = useToastHost()
		const toast = useToast()
		const id = toast.add({ text: 'First', duration: 0 })
		assert.equal(host.entries.value.length, 1)
		toast.remove(id)
		assert.equal(host.entries.value.length, 0)
		assert.ok(toast.add({ text: 'Second' }) > id)
		createRoot((release) => {
			for (const [key, value] of second) provide(key, value)
			assert.equal(useToastHost().entries.value.length, 0)
			release()
		})
		dispose()
		assert.equal(host.entries.value.length, 0)
	})
})

test('SSR cannot enqueue browser notifications or leak them into another request', async () => {
	const { provide } = await import('@meekojs/meeko')
	createRoot((dispose) => {
		for (const [key, value] of app('server')) provide(key, value)
		assert.throws(() => useToast().add({ text: 'SSR' }), /browser/)
		assert.equal(useToastHost().entries.value.length, 0)
		dispose()
	})
})

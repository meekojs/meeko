import { createRoot, effect, provide } from '@meekojs/meeko'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { createModalManager, installModalPlugin, modalExitRegistration, useModalHost } from '../dist/app/composables/useModal.js'
import { useModal, useModalInstance } from '../dist/runtime.js'

const component = { renderToString: () => '' }
const deferred = () => {
	let resolve, reject
	const promise = new Promise((yes, no) => {
		resolve = yes
		reject = no
	})
	return { promise, resolve, reject }
}
const tick = () => new Promise((done) => setImmediate(done))

test('instances publish reactively, resolve once and never reuse an ID', async () => {
	const manager = createModalManager(async () => component)
	const updates = []
	const stop = effect(() => updates.push([...manager.instances.value.keys()]))
	const first = manager.open('ModalConfirm', {})
	await tick()
	manager.close(1, true)
	manager.close(1, false)
	assert.equal(await first, true)
	const second = manager.open('ModalConfirm', {})
	await tick()
	assert.deepEqual([...manager.instances.value.keys()], [2])
	manager.dismiss(2)
	assert.equal(await second, undefined)
	assert.deepEqual(updates, [[], [1], [], [2], []])
	stop()
})

test('concurrent lazy loads preserve opening order and failed loads unblock later modals', async () => {
	const first = deferred(),
		second = deferred()
	const manager = createModalManager((name) => (name === 'ModalFirst' ? first.promise : second.promise))
	const pendingFirst = manager.open('ModalFirst', {})
	const pendingSecond = manager.open('ModalSecond', {})
	await tick()
	second.resolve(component)
	await tick()
	assert.equal(manager.instances.value.size, 0)
	const failure = assert.rejects(pendingFirst, /missing chunk/)
	first.reject(new Error('missing chunk'))
	await failure
	assert.deepEqual([...manager.instances.value.keys()], [2])
	manager.close(2, 'done')
	assert.equal(await pendingSecond, 'done')
})

test('closing keeps an instance mounted until its exit finishes and preserves the first result', async () => {
	const exit = deferred()
	const manager = createModalManager(async () => component)
	const result = manager.open('ModalConfirm', {})
	await tick()
	let calls = 0
	manager.registerExit(1, () => {
		calls++
		return exit.promise
	})
	manager.close(1, true)
	manager.close(1, false)
	manager.dismiss(1)
	assert.equal(manager.instances.value.size, 1)
	assert.equal(calls, 1)
	let settled = false
	void result.then(() => {
		settled = true
	})
	await tick()
	assert.equal(settled, false)
	exit.resolve()
	assert.equal(await result, true)
	assert.equal(manager.instances.value.size, 0)
})

test('provider disposal cancels pending exits immediately and ignores their late completions', async () => {
	const exit = deferred()
	const manager = createModalManager(async () => component)
	const result = manager.open('ModalConfirm', {})
	await tick()
	manager.registerExit(1, () => exit.promise)
	manager.close(1, true)
	manager.dispose()
	assert.equal(await result, undefined)
	assert.equal(manager.instances.value.size, 0)
	exit.resolve()
	await tick()
	assert.equal(manager.instances.value.size, 0)
})

test('failed exits and removed exit registrations never leave modal promises pending', async () => {
	const manager = createModalManager(async () => component)
	const first = manager.open('ModalConfirm', {})
	await tick()
	manager.registerExit(1, async () => {
		throw new Error('animation failed')
	})
	manager.close(1, 'done')
	assert.equal(await first, 'done')
	const second = manager.open('ModalConfirm', {})
	await tick()
	const unregister = manager.registerExit(2, () => new Promise(() => {}))
	unregister()
	manager.dismissAll()
	assert.equal(await second, undefined)
	assert.equal(manager.instances.value.size, 0)
})

test('disposing or dismissing during loading settles promises and prevents late mounting', async () => {
	const load = deferred()
	const manager = createModalManager(() => load.promise)
	const first = manager.open('ModalConfirm', {})
	const second = manager.open('ModalConfirm', {})
	await tick()
	manager.dispose()
	assert.deepEqual(await Promise.all([first, second]), [undefined, undefined])
	load.resolve(component)
	await tick()
	assert.equal(manager.instances.value.size, 0)
	await assert.rejects(manager.open('ModalConfirm', {}), /disposed/)
})

test('successful concurrent imports mount in request order and ignore late rejected cancellations', async () => {
	const first = deferred(),
		second = deferred(),
		canceled = deferred()
	const manager = createModalManager((name) => (name === 'ModalFirst' ? first.promise : name === 'ModalSecond' ? second.promise : canceled.promise))
	const results = [manager.open('ModalFirst', {}), manager.open('ModalSecond', {})]
	await tick()
	second.resolve(component)
	await tick()
	assert.equal(manager.instances.value.size, 0)
	first.resolve(component)
	await tick()
	assert.deepEqual([...manager.instances.value.keys()], [1, 2])
	manager.close(1, 'first')
	manager.close(2, 'second')
	assert.deepEqual(await Promise.all(results), ['first', 'second'])
	const late = manager.open('ModalCanceled', {})
	await tick()
	manager.dismissAll()
	assert.equal(await late, undefined)
	canceled.reject(new Error('network failure after cancellation'))
	await tick()
	assert.equal(manager.instances.value.size, 0)
})

test('opening without a host rejects immediately instead of leaving an invisible pending modal', async () => {
	const values = new Map()
	installModalPlugin({ side: 'client', provide: (key, value) => values.set(key, value) }, async () => component)
	const modal = createRoot((dispose) => {
		for (const [key, value] of values) provide(key, value)
		const current = useModal()
		dispose()
		return current
	})
	await assert.rejects(modal.open('ModalConfirm', {}), /Mount UIApp/)
})

test('plugin contexts are isolated, require a host and clean up when their host is released', async () => {
	const contexts = []
	for (let index = 0; index < 2; index++) {
		const values = new Map()
		installModalPlugin({ side: 'client', provide: (key, value) => values.set(key, value) }, async () => component)
		contexts.push(
			createRoot((dispose) => {
				for (const [key, value] of values) provide(key, value)
				const beforeHost = useModal()
				const host = useModalHost()
				assert.equal(host, beforeHost)
				assert.throws(() => useModalHost(), /Only one UIApp/)
				return { host, dispose }
			}),
		)
	}
	const result = contexts[0].host.open('ModalConfirm', {})
	await tick()
	assert.equal(contexts[0].host.instances.value.size, 1)
	assert.equal(contexts[1].host.instances.value.size, 0)
	contexts[0].dispose()
	assert.equal(await result, undefined)
	await assert.rejects(contexts[0].host.open('ModalConfirm', {}), /Mount UIApp/)
	contexts[1].dispose()
	assert.throws(() => useModal(), /Missing Meeko context/)
	assert.throws(() => useModalInstance(), /Missing Meeko context/)
})

test('a provider retained from before an HMR update remains usable without exit registration', () => {
	createRoot((dispose) => {
		provide(Symbol.for('@meekojs/ui/modal.instance'), { id: 1, close() {}, dismiss() {} })
		provide(Symbol.for('@meekojs/ui/modal.manager'), { dismiss() {} })
		assert.equal(modalExitRegistration(), undefined)
		dispose()
	})
})

test('SSR rejects programmatic opening without sharing state between requests', async () => {
	const values = new Map()
	installModalPlugin({ side: 'server', provide: (key, value) => values.set(key, value) }, async () => {
		throw new Error('must not load')
	})
	const context = createRoot((dispose) => {
		for (const [key, value] of values) provide(key, value)
		const host = useModalHost()
		dispose()
		return host
	})
	await assert.rejects(context.open('ModalConfirm', {}), /only be opened in the browser/)
	assert.equal(context.instances.value.size, 0)
})

test('consumer types correlate names and props and include cancellation in results', () => {
	const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
	execFileSync(process.execPath, [tsc, '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--module', 'nodenext', '--target', 'es2022', fileURLToPath(new URL('./types/consumer.ts', import.meta.url))], { stdio: 'pipe' })
})

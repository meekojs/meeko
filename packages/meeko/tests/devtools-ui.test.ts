import { Window as HappyWindow } from 'happy-dom'
import assert from 'node:assert/strict'
import test from 'node:test'

import type { DevtoolsHook, DevtoolsSnapshot } from '../src/app/runtime/devtools.ts'

import { mountDevtoolsPanel } from '../src/devtools-ui/index.ts'

test('panel DevTools muestra ausencia del hook y se conecta cuando queda disponible', () => {
	const browser = new HappyWindow()
	const view = browser as unknown as Window
	const document = view.document
	const panel = mountDevtoolsPanel({ container: document.body })
	const host = document.querySelector('[data-meeko-devtools-panel]')
	assert.ok(host?.shadowRoot)
	const shadow = host.shadowRoot
	assert.match(shadow.querySelector('[role=status]')?.textContent ?? '', /Hook no disponible/)

	const eventAt = Date.parse('2026-10-23T12:34:56Z')
	const snapshot: DevtoolsSnapshot = {
		protocolVersion: 1,
		selectedId: null,
		instances: [
			{ id: 'parent', componentId: 'p', name: 'Parent', file: 'Parent.meeko', props: { label: '<script>' }, signals: { count: 2 }, parentId: null, childIds: ['child'], status: 'hydrated', breakpoint: false },
			{ id: 'child', componentId: 'c', name: 'Child', file: 'Child.meeko', props: {}, signals: {}, parentId: 'parent', childIds: [], status: 'hydrated', breakpoint: false },
		],
		events: [
			{ id: 1, at: eventAt, kind: 'mount', instanceId: 'parent', componentName: 'Parent', file: 'Parent.meeko' },
			{ id: 2, at: eventAt, kind: 'signal', instanceId: 'parent', detail: 'count', componentName: 'Parent', file: 'Parent.meeko', value: 2, reads: [{ file: 'Parent.meeko', line: 8, column: 5, expression: 'count.value', kind: 'text' }] },
		],
	}
	const listeners = new Set<() => void>()
	const highlighted: Array<string | null> = []
	const hook: DevtoolsHook = {
		protocolVersion: 1,
		snapshot: () => snapshot,
		setSignal: () => ({ ok: true }),
		subscribe(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		select(id) {
			snapshot.selectedId = id
			for (const listener of listeners) listener()
		},
		highlight(id) {
			highlighted.push(id)
		},
		setBreakpoint(id, enabled) {
			const instance = snapshot.instances.find((item) => item.id === id)
			if (instance) instance.breakpoint = enabled
			for (const listener of listeners) listener()
		},
	}
	view.__MEEKO_DEVTOOLS__ = hook
	view.dispatchEvent(new browser.Event('meeko:devtools-ready') as unknown as Event)
	assert.equal(listeners.size, 1)
	assert.equal(shadow.querySelector('.tree-children button')?.textContent, 'Child')
	assert.equal(shadow.querySelectorAll('script').length, 0)
	const eventText = shadow.querySelector('.events ol > li:last-child')?.textContent ?? ''
	assert.ok(eventText.includes(new Date(eventAt).toLocaleTimeString('es', { hour12: false })))
	assert.match(eventText, /Montaje · parent/)
	assert.match(eventText, /Parent\.meeko/)
	assert.ok(!eventText.includes(String(eventAt)))
	const signalFilter = shadow.querySelector<HTMLInputElement>('.events input[type="checkbox"]')
	assert.ok(signalFilter)
	signalFilter.checked = true
	signalFilter.dispatchEvent(new browser.Event('change') as unknown as Event)
	assert.equal(shadow.querySelectorAll('.events ol > li').length, 1)
	assert.match(shadow.querySelector('.events ol > li')?.textContent ?? '', /Señal · parent.*count → 2/)
	assert.match(shadow.querySelector('.events ol > li details')?.textContent ?? '', /Parent\.meeko:8:5.*count\.value/)
	shadow.querySelector<HTMLButtonElement>('.events ol > li button')?.click()
	assert.equal(snapshot.selectedId, 'parent')

	const select = shadow.querySelector<HTMLButtonElement>('button[data-instance-id="parent"][data-action="select"]')
	assert.ok(select)
	select.click()
	assert.equal(snapshot.selectedId, 'parent')
	assert.match(shadow.textContent ?? '', /<script>/)
	assert.equal(shadow.querySelector('.content')?.getAttribute('data-view'), 'detail')
	const viewButtons = shadow.querySelectorAll<HTMLButtonElement>('.mobile-switch button')
	assert.equal(viewButtons[1]?.getAttribute('aria-pressed'), 'true')
	viewButtons[0]?.click()
	assert.equal(shadow.querySelector('.content')?.getAttribute('data-view'), 'instances')
	assert.equal(viewButtons[0]?.getAttribute('aria-pressed'), 'true')
	viewButtons[1]?.click()
	assert.equal(shadow.querySelector('.content')?.getAttribute('data-view'), 'detail')

	const breakpoint = shadow.querySelector<HTMLButtonElement>('button[data-action="breakpoint"]')
	assert.ok(breakpoint)
	breakpoint.click()
	assert.equal(snapshot.instances[0]?.breakpoint, true)
	assert.equal(shadow.querySelector('[data-action="breakpoint"]')?.getAttribute('aria-pressed'), 'true')

	const highlight = shadow.querySelector<HTMLButtonElement>('button[data-action="highlight"]')
	assert.ok(highlight)
	highlight.click()
	assert.deepEqual(highlighted, ['parent'])

	panel.unmount()
	assert.equal(listeners.size, 0)
	assert.equal(document.querySelector('[data-meeko-devtools-panel]'), null)
	assert.deepEqual(highlighted, ['parent', null])
	view.dispatchEvent(new browser.Event('meeko:devtools-ready') as unknown as Event)
	assert.equal(listeners.size, 0)
	panel.unmount()
	browser.happyDOM.abort()
})

/** Crea un hook falso con una captura mutable y notificaciones síncronas. */
function fakeHook(snapshot: DevtoolsSnapshot, setSignal?: DevtoolsHook['setSignal']): DevtoolsHook & { notify(): void } {
	const listeners = new Set<() => void>()
	const notify = () => {
		for (const listener of [...listeners]) listener()
	}
	return {
		protocolVersion: 1,
		notify,
		snapshot: () => snapshot,
		subscribe(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		select(id) {
			snapshot.selectedId = id
			notify()
		},
		highlight() {},
		setBreakpoint() {},
		setSignal: setSignal ?? (() => ({ ok: false, error: 'not implemented' })),
	}
}

function mountWith(hook: unknown): { browser: HappyWindow; shadow: ShadowRoot; panel: ReturnType<typeof mountDevtoolsPanel> } {
	const browser = new HappyWindow()
	const view = browser as unknown as Window
	view.__MEEKO_DEVTOOLS__ = hook as DevtoolsHook
	const panel = mountDevtoolsPanel({ container: view.document.body })
	const shadow = view.document.querySelector('[data-meeko-devtools-panel]')!.shadowRoot!
	return { browser, shadow, panel }
}

test('el panel integrado rechaza hooks y capturas de otra versión del protocolo', () => {
	const legacy = { snapshot: () => ({ instances: [], events: [], selectedId: null }), subscribe: () => () => {}, select() {}, highlight() {}, setBreakpoint() {} }
	const first = mountWith(legacy)
	assert.match(first.shadow.querySelector('[role=status]')?.textContent ?? '', /no declara versión de protocolo.*admite la versión 1/)
	assert.equal(first.shadow.querySelectorAll('button[data-action="select"]').length, 0)
	first.panel.unmount()
	first.browser.happyDOM.abort()

	const future = fakeHook({ protocolVersion: 2 as 1, instances: [{ id: 'x', componentId: 'x', name: 'X', file: 'X.meeko', props: {}, signals: {}, parentId: null, childIds: [], status: 'hydrated', breakpoint: false }], events: [], selectedId: null })
	const second = mountWith({ ...future, protocolVersion: 2 })
	assert.match(second.shadow.querySelector('[role=status]')?.textContent ?? '', /la página usa 2 y este panel admite 1/)
	second.panel.unmount()
	second.browser.happyDOM.abort()

	const third = mountWith(future)
	assert.match(third.shadow.querySelector('[role=status]')?.textContent ?? '', /la página usa 2/)
	assert.equal(third.shadow.querySelectorAll('button[data-action="select"]').length, 0)
	third.panel.unmount()
	third.browser.happyDOM.abort()
})

test('el panel integrado edita señales con JSON validado e informa errores', () => {
	const snapshot: DevtoolsSnapshot = {
		protocolVersion: 1,
		selectedId: 'counter',
		instances: [{ id: 'counter', componentId: 'c', name: 'Counter', file: 'Counter.meeko', props: {}, signals: { count: 1, label: 'uno' }, parentId: null, childIds: [], status: 'hydrated', breakpoint: false }],
		events: [],
	}
	const calls: Array<[string, string, unknown]> = []
	const hook = fakeHook(snapshot, (id, name, value) => {
		calls.push([id, name, value])
		if (name === 'label') return { ok: false, error: 'rejected by runtime' }
		snapshot.instances[0]!.signals[name] = value
		snapshot.events.push({ id: snapshot.events.length + 1, at: 0, kind: 'signal', instanceId: id, detail: name, value, write: { kind: 'devtools' } })
		hook.notify()
		return { ok: true }
	})
	const { browser, shadow, panel } = mountWith(hook)
	const form = () => shadow.querySelector<HTMLFormElement>('form.editor')!
	const textarea = () => shadow.querySelector<HTMLTextAreaElement>('textarea[data-action="edit-value"]')!
	const select = () => shadow.querySelector<HTMLSelectElement>('select[data-action="edit-name"]')!
	const message = () => shadow.querySelector('.editor-message')!
	const type = (text: string) => {
		textarea().value = text
		textarea().dispatchEvent(new browser.Event('input') as unknown as Event)
	}
	assert.equal(textarea().value, '1')
	assert.equal(shadow.querySelector('label[for="meeko-devtools-edit-value"]')?.textContent, 'Nuevo valor (JSON)')

	type('{ invalid')
	// Una notificación ajena no descarta el texto que se está escribiendo.
	hook.notify()
	assert.equal(textarea().value, '{ invalid')
	shadow.querySelector<HTMLButtonElement>('button[data-action="edit-apply"]')!.click()
	assert.equal(calls.length, 0)
	assert.match(message().textContent ?? '', /JSON no válido/)
	assert.equal(message().getAttribute('data-state'), 'error')
	assert.equal(message().getAttribute('role'), 'alert')

	type('{"value": [1, 2]}')
	form().dispatchEvent(new browser.Event('submit', { cancelable: true }) as unknown as Event)
	assert.deepEqual(calls, [['counter', 'count', { value: [1, 2] }]])
	assert.match(message().textContent ?? '', /Señal count actualizada/)
	assert.equal(textarea().value, JSON.stringify({ value: [1, 2] }, null, 2))
	const event = shadow.querySelector('.events ol > li')?.textContent ?? ''
	assert.match(event, /Escrita desde DevTools/)

	select().value = 'label'
	select().dispatchEvent(new browser.Event('change') as unknown as Event)
	assert.equal(textarea().value, '"uno"')
	type('"dos"')
	form().dispatchEvent(new browser.Event('submit', { cancelable: true }) as unknown as Event)
	assert.match(message().textContent ?? '', /No se pudo editar label: rejected by runtime/)
	assert.equal(snapshot.instances[0]!.signals.label, 'uno')
	panel.unmount()
	browser.happyDOM.abort()
})

test('la línea de tiempo integrada muestra la escritura y el tipo de cada lectura', () => {
	const snapshot: DevtoolsSnapshot = {
		protocolVersion: 1,
		selectedId: null,
		instances: [{ id: 'p', componentId: 'p', name: 'Parent', file: 'Parent.meeko', props: {}, signals: { count: 2 }, parentId: null, childIds: [], status: 'hydrated', breakpoint: false }],
		events: [
			{
				id: 1,
				at: 0,
				kind: 'signal',
				instanceId: 'p',
				detail: 'count',
				value: 2,
				write: { kind: 'assignment', file: 'Parent.meeko', line: 11, column: 3, expression: 'count.value += 1' },
				reads: [
					{ file: 'Parent.meeko', line: 8, column: 26, expression: '() => count.value * 2', kind: 'computed' },
					{ file: 'Parent.meeko', line: 26, column: 19, expression: 'count.value > 0', kind: 'if' },
					{ file: 'Parent.meeko', line: 27, column: 22, expression: 'items.value', kind: 'each' },
					{ file: 'Parent.meeko', line: 28, column: 39, expression: 'String(count.value)', kind: 'prop', name: 'label' },
				],
			},
		],
	}
	const { browser, shadow, panel } = mountWith(fakeHook(snapshot))
	const row = shadow.querySelector('.events ol > li')!
	assert.match(row.querySelector('.event-write')?.textContent ?? '', /Escrita en Parent\.meeko:11:3: count\.value \+= 1/)
	const reads = [...row.querySelectorAll('.event-reads li')].map((item) => item.textContent)
	assert.deepEqual(reads, [
		'Parent.meeko:8:26 computed: () => count.value * 2',
		'Parent.meeko:26:19 if:when: count.value > 0',
		'Parent.meeko:27:22 each:of: items.value',
		'Parent.meeko:28:39 prop label: String(count.value)',
	])
	panel.unmount()
	browser.happyDOM.abort()
})

test('el panel integrado se fija en la esquina de position y rechaza otras', () => {
	const document = (new HappyWindow() as unknown as Window).document
	const panel = mountDevtoolsPanel({ container: document.body, position: 'top-left' })
	assert.equal(document.querySelector('[data-meeko-devtools-panel]')?.getAttribute('data-position'), 'top-left')
	panel.unmount()
	mountDevtoolsPanel({ container: document.body }).unmount()
	assert.throws(() => mountDevtoolsPanel({ container: document.body, position: 'middle' as never }), /position must be one of bottom-right, bottom-left, top-right, top-left/)
	assert.equal(document.querySelector('[data-meeko-devtools-panel]'), null)
})

test('el panel integrado se minimiza a una pastilla con los eventos nuevos y lo recuerda', () => {
	const browser = new HappyWindow()
	const view = browser as unknown as Window
	const document = view.document
	const events: DevtoolsSnapshot['events'] = [{ id: 1, at: 0, kind: 'mount', instanceId: 'a' }]
	const listeners = new Set<() => void>()
	const hook: DevtoolsHook = {
		protocolVersion: 1,
		snapshot: () => ({ protocolVersion: 1, selectedId: null, instances: [], events }),
		setSignal: () => ({ ok: true }),
		subscribe(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		select() {},
		highlight() {},
		setBreakpoint() {},
	}
	;(view as Window & { __MEEKO_DEVTOOLS__?: DevtoolsHook }).__MEEKO_DEVTOOLS__ = hook
	const panel = mountDevtoolsPanel({ container: document.body })
	const host = document.querySelector('[data-meeko-devtools-panel]')!
	const shadow = host.shadowRoot!
	const minimize = shadow.querySelector<HTMLButtonElement>('button[aria-label^="Minimizar"]')!
	const pill = shadow.querySelector<HTMLButtonElement>('.pill')!
	assert.equal(minimize.getAttribute('aria-expanded'), 'true')
	assert.equal(minimize.getAttribute('aria-keyshortcuts'), 'Alt+Shift+M')
	assert.equal(pill.hidden, true)

	minimize.click()
	assert.ok(host.hasAttribute('data-minimized'))
	assert.equal(shadow.querySelector<HTMLElement>('.panel')!.hidden, true)
	assert.equal(pill.hidden, false)
	assert.equal(minimize.getAttribute('aria-expanded'), 'false')
	assert.equal(shadow.activeElement, pill, 'focus moves to the pill')
	assert.equal(shadow.querySelector('.badge')?.textContent, '')
	events.push({ id: 2, at: 0, kind: 'signal', instanceId: 'a' }, { id: 3, at: 0, kind: 'signal', instanceId: 'a' })
	for (const listener of listeners) listener()
	assert.equal(shadow.querySelector('.badge')?.textContent, '2')
	assert.match(pill.getAttribute('aria-label') ?? '', /^Restaurar Meeko DevTools · 2 eventos nuevos \(Alt\+Mayús\+M\)$/)
	assert.deepEqual(JSON.parse(view.localStorage.getItem('meeko:devtools-panel')!), { minimized: true, position: 'bottom-right', configured: 'bottom-right' })

	// The state survives a new mount (a reload); the shortcut restores it.
	panel.unmount()
	const again = mountDevtoolsPanel({ container: document.body })
	const reloaded = document.querySelector('[data-meeko-devtools-panel]')!
	assert.ok(reloaded.hasAttribute('data-minimized'))
	view.dispatchEvent(new browser.KeyboardEvent('keydown', { code: 'KeyM', key: 'M', altKey: true, shiftKey: true }) as unknown as Event)
	assert.equal(reloaded.hasAttribute('data-minimized'), false)
	assert.equal(JSON.parse(view.localStorage.getItem('meeko:devtools-panel')!).minimized, false)

	// The arrows move the panel to another corner, which a reload keeps while the configured one is the same.
	const handle = reloaded.shadowRoot!.querySelector<HTMLButtonElement>('.handle')!
	handle.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }) as unknown as Event)
	handle.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }) as unknown as Event)
	assert.equal(reloaded.getAttribute('data-position'), 'top-left')
	assert.match(handle.getAttribute('aria-label') ?? '', /arriba a la izquierda/)
	again.unmount()
	mountDevtoolsPanel({ container: document.body }).unmount()
	assert.equal(JSON.parse(view.localStorage.getItem('meeko:devtools-panel')!).position, 'top-left')
	const configured = mountDevtoolsPanel({ container: document.body, position: 'bottom-left' })
	assert.equal(document.querySelector('[data-meeko-devtools-panel]')!.getAttribute('data-position'), 'bottom-left', 'a new configured corner wins')
	configured.unmount()
	view.dispatchEvent(new browser.KeyboardEvent('keydown', { code: 'KeyM', altKey: true, shiftKey: true }) as unknown as Event)
	assert.equal(document.querySelector('[data-meeko-devtools-panel]'), null, 'the shortcut is released on unmount')
})

test('el panel integrado sigue el data-theme de la página y sobrevive sin localStorage', async () => {
	const browser = new HappyWindow()
	const view = browser as unknown as Window
	const document = view.document
	Object.defineProperty(view, 'localStorage', {
		get() {
			throw new Error('blocked')
		},
	})
	document.documentElement.setAttribute('data-theme', 'light')
	const panel = mountDevtoolsPanel({ container: document.body })
	const host = document.querySelector('[data-meeko-devtools-panel]')!
	assert.equal(host.getAttribute('data-theme'), 'light')
	document.documentElement.setAttribute('data-theme', 'dark')
	await new Promise((done) => setTimeout(done, 0))
	assert.equal(host.getAttribute('data-theme'), 'dark')
	document.documentElement.setAttribute('data-theme', 'sepia')
	await new Promise((done) => setTimeout(done, 0))
	assert.equal(host.hasAttribute('data-theme'), false, 'another theme follows the system')
	host.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label^="Minimizar"]')!.click()
	assert.ok(host.hasAttribute('data-minimized'))
	panel.unmount()
})

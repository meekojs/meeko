import { Window } from 'happy-dom'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import type { DevtoolsHook } from '../src/app/runtime/devtools.ts'

import { enableHotModule, replaceHotModule } from '../src/app/runtime/hmr.ts'
import { checkSource } from '../src/check.ts'
import { compile } from '../src/compiler.ts'
import { MeekoCompileError } from '../src/compiler/parser/sfc.ts'

interface RuntimeModule {
	renderToString(props: Record<string, unknown>, state?: Record<string, unknown>): string
	renderWithState(props: Record<string, unknown>): { html: string; state: Record<string, unknown> }
	hydrate(root: Element, props: Record<string, unknown>, state?: Record<string, unknown>): () => void
}

const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href)

/** Compiles components against the source runtime, so the test and the components share one instance of it. */
async function load(components: Record<string, string>, entry: string, hot = false): Promise<{ component: RuntimeModule; modules: Record<string, RuntimeModule>; recompile: (name: string, source: string) => Promise<RuntimeModule>; cleanup: () => Promise<void> }> {
	const parent = resolve('.meeko')
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(join(parent, 'model-props-test-'))
	const compiled = (name: string, source: string): string => {
		let code = compile(source, join(directory, `${name}.meeko`), { hot })
			.code.replace(`from "@meekojs/meeko/internal"`, `from ${runtime('src/internal.ts')}`)
			.replaceAll(`from "@meekojs/meeko"`, `from ${runtime('src/index.ts')}`)
		for (const other of Object.keys(components)) code = code.replace(`from "./${other}.meeko"`, `from "./${other}.ts"`)
		return code
	}
	for (const [name, source] of Object.entries(components)) await writeFile(join(directory, `${name}.ts`), compiled(name, source))
	const modules: Record<string, RuntimeModule> = {}
	for (const name of Object.keys(components)) modules[name] = (await import(pathToFileURL(join(directory, `${name}.ts`)).href)) as RuntimeModule
	return {
		component: modules[entry]!,
		modules,
		// A new version of a component: the same file, so the same hot id.
		async recompile(name, source) {
			const file = join(directory, `${name}.next.ts`)
			await writeFile(file, compiled(name, source))
			return (await import(pathToFileURL(file).href)) as RuntimeModule
		},
		cleanup: () => rm(directory, { recursive: true, force: true }),
	}
}

/** The child of every row of the table: one model of each kind, shown and written from inside. */
const child = `<script lang="ts">
const value = defineModel<string>({ default: "fallback" });
const touched = defineModel<boolean>("touched", { default: false });
</script>
<template><div class="child"><input class="inner" model="value" /><span class="state">{value.value}|{touched.value}</span><button type="button" class="touch" on:click="() => touched.value = !touched.value">t</button><button type="button" class="write" on:click="() => value.value = 'written'">w</button></div></template>`

const parentOf = (script: string, tag: string): string => `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as Child from "./Child.meeko";
${script}
</script>
<template><section>${tag}</section></template>`

interface Mounted {
	readonly root: HTMLElement
	readonly html: string
	readonly state: Record<string, unknown>
	/** State of the first child, as it travels in its marker. */
	readonly childState: unknown
	text(selector?: string): string
	input(): HTMLInputElement
	click(selector: string): void
	type(value: string): void
	release: () => void
}

function mount(window: Window, component: RuntimeModule): Mounted {
	const root = window.document.createElement('main') as unknown as HTMLElement
	const { html, state } = component.renderWithState({})
	root.innerHTML = html
	const marker = /<!--meeko:component:\d+:([^>]*)-->/.exec(html)?.[1]
	const release = component.hydrate(root as unknown as Element, {}, state)
	return {
		root,
		html,
		state,
		childState: marker === undefined ? undefined : JSON.parse(decodeURIComponent(marker)),
		text: (selector = '.state') => root.querySelector(selector)?.textContent ?? '',
		input: () => root.querySelector('input.inner') as unknown as HTMLInputElement,
		click: (selector) => (root.querySelector(selector) as unknown as HTMLElement).click(),
		type(value) {
			const input = root.querySelector('input.inner') as unknown as HTMLInputElement
			input.value = value
			input.dispatchEvent(new window.Event('input', { bubbles: true }) as unknown as Event)
		},
		release,
	}
}

/** Mounts a parent of `child`, fails on a hydration error, and always cleans up. */
async function withParent(script: string, tag: string, run: (mounted: Mounted, window: Window) => void | Promise<void>, components: Record<string, string> = {}): Promise<void> {
	const { component, cleanup } = await load({ Child: child, Parent: parentOf(script, tag), ...components }, 'Parent')
	const window = new Window()
	try {
		await run(mount(window, component), window)
	} finally {
		window.happyDOM.abort()
		await cleanup()
	}
}

test('bind:modelValue with its event: the value follows the prop and the parent decides each write', async () => {
	const script = `const name = signal("Ada");\nconst calls = signal(0);\nconst setName = (next: string): void => { calls.value++; name.value = next; };`
	const tag = `<Child bind:modelValue="name.value" on:update:modelValue="setName" /><p class="outer">{name.value}|{calls.value}</p><button type="button" class="rename" on:click="() => name.value = 'Grace'">r</button>`
	await withParent(script, tag, ({ html, childState, text, input, type, click, release }) => {
		// SSR renders the value of the prop and the child does not send what the parent already has.
		assert.match(html, /value="Ada"/)
		assert.deepEqual(childState, { touched: false })
		// Hydrating is not a write.
		assert.equal(text('.outer'), 'Ada|0')
		assert.equal(input().value, 'Ada')
		type('Linus')
		assert.equal(text('.outer'), 'Linus|1')
		assert.equal(text(), 'Linus|false')
		assert.equal(input().value, 'Linus')
		click('.rename')
		assert.equal(text(), 'Grace|false')
		assert.equal(input().value, 'Grace')
		assert.equal(text('.outer'), 'Grace|1')
		release()
	})
})

test('a parent that keeps the prop gets the event, and the child goes back to the prop', async () => {
	const script = `const name = signal("Ada");\nconst seen = signal("-");`
	const tag = `<Child bind:modelValue="name.value" on:update:modelValue="(next) => seen.value = next" /><p class="seen">{seen.value}</p>`
	await withParent(script, tag, ({ text, input, type, click, release }) => {
		type('typed')
		assert.equal(text('.seen'), 'typed')
		assert.equal(input().value, 'Ada', 'the control goes back to the value of the prop')
		assert.equal(text(), 'Ada|false')
		click('.write')
		assert.equal(text('.seen'), 'written')
		assert.equal(text(), 'Ada|false')
		release()
	})
})

test('a parent that changes what was written shows its own value in the control', async () => {
	const script = `const code = signal("AB");`
	const tag = `<Child bind:modelValue="code.value" on:update:modelValue="(next) => code.value = next.slice(0, 2).toUpperCase()" />`
	await withParent(script, tag, ({ input, type, release }) => {
		type('abc')
		// `AB` again: the parent's signal does not change, and the control still goes back.
		assert.equal(input().value, 'AB')
		type('xyz')
		assert.equal(input().value, 'XY')
		release()
	})
})

test('a write of the current value calls nobody', async () => {
	const script = `const name = signal("written");\nconst calls = signal(0);`
	const tag = `<Child bind:modelValue="name.value" on:update:modelValue="() => calls.value++" /><p class="calls">{calls.value}</p>`
	await withParent(script, tag, ({ text, click, release }) => {
		click('.write')
		assert.equal(text('.calls'), '0')
		release()
	})
})

test('only bind:modelValue: a write stays in the child until the prop changes', async () => {
	const script = `const name = signal("Ada");`
	const tag = `<Child bind:modelValue="name.value" /><button type="button" class="rename" on:click="() => name.value = 'Grace'">r</button><button type="button" class="same" on:click="() => name.value = 'Ada'">s</button>`
	await withParent(script, tag, ({ html, childState, text, input, type, click, release }) => {
		assert.match(html, /value="Ada"/)
		assert.deepEqual(childState, { touched: false })
		type('local')
		assert.equal(text(), 'local|false')
		assert.equal(input().value, 'local')
		// The same value is no change of the prop.
		click('.same')
		assert.equal(text(), 'local|false')
		click('.rename')
		assert.equal(text(), 'Grace|false')
		assert.equal(input().value, 'Grace')
		release()
	})
})

test('only on:update:modelValue: the default stays local, and each write also calls the event', async () => {
	const script = `const seen = signal("-");`
	const tag = `<Child on:update:modelValue="(next) => seen.value = next" /><p class="seen">{seen.value}</p>`
	await withParent(script, tag, ({ html, childState, text, input, type, release }) => {
		assert.match(html, /value="fallback"/)
		// A model of its own travels with the state, as without a parent.
		assert.deepEqual(childState, { value: 'fallback', touched: false })
		assert.equal(text('.seen'), '-')
		type('typed')
		assert.equal(text(), 'typed|false')
		assert.equal(input().value, 'typed')
		assert.equal(text('.seen'), 'typed')
		release()
	})
})

test('nothing passed: the default stays local', async () => {
	await withParent('', `<Child />`, ({ childState, text, type, release }) => {
		assert.deepEqual(childState, { value: 'fallback', touched: false })
		type('typed')
		assert.equal(text(), 'typed|false')
		release()
	})
})

test('a literal value, and a named model by prop and event', async () => {
	const script = `const touched = signal(true);\nconst calls = signal(0);`
	const tag = `<Child bind:modelValue="'hola'" bind:touched="touched.value" on:update:touched="(next) => { calls.value++; touched.value = next; }" /><p class="outer">{touched.value}|{calls.value}</p>`
	await withParent(script, tag, ({ html, childState, text, click, release }) => {
		assert.match(html, /value="hola"/)
		assert.deepEqual(childState, {})
		assert.equal(text(), 'hola|true')
		click('.touch')
		assert.equal(text('.outer'), 'false|1')
		assert.equal(text(), 'hola|false')
		release()
	})
})

test('bind="object" carries the value of a model, and follows it as it appears and goes away', async () => {
	const script = `const props = signal<{ modelValue?: string; touched?: boolean }>({ modelValue: "hola", touched: true });`
	const tag = `<Child bind="props.value" /><button type="button" class="next" on:click="() => props.value = { modelValue: 'adiós' }">n</button><button type="button" class="clear" on:click="() => props.value = {}">c</button>`
	await withParent(script, tag, ({ html, text, input, click, release }) => {
		assert.match(html, /value="hola"/)
		assert.equal(text(), 'hola|true')
		click('.next')
		assert.equal(text(), 'adiós|false')
		assert.equal(input().value, 'adiós')
		// Without the prop, its default: as a prop of `defineProps` with a default.
		click('.clear')
		assert.equal(text(), 'fallback|false')
		assert.equal(input().value, 'fallback')
		release()
	})
})

test('a prop that starts undefined takes the default, and is local until the parent gives it a value', async () => {
	const script = `const name = signal<string | undefined>(undefined);`
	const tag = `<Child bind:modelValue="name.value" /><button type="button" class="set" on:click="() => name.value = 'Ada'">s</button><button type="button" class="unset" on:click="() => name.value = undefined">u</button>`
	await withParent(script, tag, ({ childState, text, type, click, release }) => {
		assert.equal(text(), 'fallback|false')
		assert.deepEqual(childState, { value: 'fallback', touched: false })
		type('typed')
		assert.equal(text(), 'typed|false')
		click('.set')
		assert.equal(text(), 'Ada|false')
		click('.unset')
		assert.equal(text(), 'fallback|false')
		release()
	})
})

test('with the event and a prop that is undefined, the parent still decides', async () => {
	const script = `const name = signal<string | undefined>(undefined);\nconst seen = signal("-");`
	const tag = `<Child bind:modelValue="name.value" on:update:modelValue="(next) => seen.value = next" /><p class="seen">{seen.value}</p>`
	await withParent(script, tag, ({ text, input, type, release }) => {
		type('typed')
		assert.equal(text('.seen'), 'typed')
		assert.equal(input().value, 'fallback')
		release()
	})
})

test('a model by prop passes on as a signal: the grandchild writes through it', async () => {
	const middle = `<script lang="ts">
import * as Child from "./Child.meeko";
const value = defineModel<string>();
</script>
<template><Child model="value" /></template>`
	const parent = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as Middle from "./Middle.meeko";
const name = signal("Ada");
</script>
<template><section><Middle bind:modelValue="name.value" on:update:modelValue="(next) => name.value = next.toUpperCase()" /><p class="outer">{name.value}</p></section></template>`
	const { component, cleanup } = await load({ Child: child, Middle: middle, Parent: parent }, 'Parent')
	const window = new Window()
	try {
		const { text, input, type, release } = mount(window, component)
		assert.equal(text(), 'Ada|false')
		type('linus')
		assert.equal(text('.outer'), 'LINUS')
		assert.equal(input().value, 'LINUS')
		release()
	} finally {
		window.happyDOM.abort()
		await cleanup()
	}
})

test('an unmounted child stops following the prop and calling the event', async () => {
	const counted = `<script lang="ts">
import { effect } from "@meekojs/meeko";
const props = defineProps<{ onRun: () => void }>();
const value = defineModel<string>({ default: "" });
effect(() => { void value.value; props.onRun(); });
</script>
<template><input class="inner" model="value" /></template>`
	const script = `const name = signal("Ada");\nconst show = signal(true);\nconst seen = signal(0);\nlet runs = 0;\nconst run = (): void => { runs++; };\nconst report = signal(0);`
	const parent = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as Counted from "./Counted.meeko";
${script}
</script>
<template><section><template if:when="show.value"><Counted bind:modelValue="name.value" bind:onRun="run" on:update:modelValue="() => seen.value++" /></template><p class="seen">{seen.value}</p><button type="button" class="hide" on:click="() => show.value = false">h</button><button type="button" class="rename" on:click="() => { name.value = name.value + '!'; }">r</button><button type="button" class="report" on:click="() => report.value = runs">c</button><p class="runs">{report.value}</p></section></template>`
	const { component, cleanup } = await load({ Counted: counted, Parent: parent }, 'Parent')
	const window = new Window()
	try {
		const { text, click, type, input, release } = mount(window, component)
		click('.rename')
		click('.report')
		const running = Number(text('.runs'))
		const stale = input()
		type('typed')
		assert.equal(text('.seen'), '1')
		click('.hide')
		click('.rename')
		click('.rename')
		click('.report')
		assert.equal(Number(text('.runs')), running, 'the effect that reads the model no longer runs')
		stale.value = 'detached'
		stale.dispatchEvent(new window.Event('input', { bubbles: true }) as unknown as Event)
		assert.equal(text('.seen'), '1', 'nobody listens to the removed control')
		release()
	} finally {
		window.happyDOM.abort()
		await cleanup()
	}
})

test('restoring the state of a model is not a write: no event, and the prop still wins', async () => {
	const { component, cleanup } = await load({ Child: child }, 'Child')
	const window = new Window()
	try {
		let calls = 0
		const onUpdate = (): void => {
			calls++
		}
		// As a hot replacement or a rebuilt child restores it.
		const root = window.document.createElement('main')
		root.innerHTML = component.renderToString({ 'onUpdate:modelValue': onUpdate }, { value: 'restored' })
		assert.match(root.innerHTML, /value="restored"/)
		const release = component.hydrate(root as unknown as Element, { 'onUpdate:modelValue': onUpdate }, { value: 'restored' })
		assert.equal(calls, 0)
		assert.equal(root.querySelector('.state')?.textContent, 'restored|false')
		release()
		assert.match(component.renderToString({ modelValue: 'prop' }, { value: 'restored' }), /value="prop"/)
	} finally {
		window.happyDOM.abort()
		await cleanup()
	}
})

test('the props of a model are not props of the child: Object.keys, in, a rest and bind="props" leave them out', async () => {
	const wrapper = `<script lang="ts">
const props = defineProps<{ id: string; title?: string }>();
const { id: _id, ...rest } = props;
const value = defineModel<string>({ default: "" });
const emitless = Object.keys(props).join(",");
</script>
<template><input class="spread" bind="props" model="value" /><output class="keys">{emitless}|{"modelValue" in props}|{"onUpdate:modelValue" in props}</output><span class="rest" bind="rest"></span></template>`
	const { component, cleanup } = await load({ Wrapper: wrapper }, 'Wrapper')
	const window = new Window()
	try {
		const props = { id: 'x', title: 't', modelValue: 'hola', 'onUpdate:modelValue': () => {} }
		const root = window.document.createElement('main')
		root.innerHTML = component.renderToString(props)
		const input = root.querySelector('input.spread')!
		assert.equal(input.getAttribute('value'), 'hola')
		assert.equal(input.getAttribute('id'), 'x')
		assert.equal(input.hasAttribute('modelvalue'), false)
		assert.equal(root.querySelector('.keys')?.textContent, 'id,title|false|false')
		assert.equal(root.querySelector('.rest')?.getAttribute('title'), 't')
		assert.equal(root.querySelector('.rest')?.hasAttribute('modelvalue'), false)
	} finally {
		window.happyDOM.abort()
		await cleanup()
	}
})

test('a required model takes its prop, and without anything fails at runtime naming both forms', async () => {
	const required = `<script lang="ts">
const value = defineModel<string>();
</script>
<template><input model="value" /></template>`
	const { component, cleanup } = await load({ Required: required }, 'Required')
	try {
		assert.match(component.renderToString({ modelValue: 'hola' }), /value="hola"/)
		assert.throws(() => component.renderToString({}), /model "default" is required: pass model="signal" or bind:modelValue="value"/)
		assert.throws(() => component.renderToString({ 'onUpdate:modelValue': () => {} }), /model "default" is required/)
	} finally {
		await cleanup()
	}
})

test('a hot replacement keeps the model: the prop for the one that follows it, the local value without an event for its own', async () => {
	const script = `const name = signal("Ada");\nconst calls = signal(0);`
	const tag = `<section id="bound"><Child bind:modelValue="name.value" on:update:modelValue="(next) => { calls.value++; name.value = next; }" /></section><section id="own"><Child on:update:modelValue="() => calls.value++" /></section><p class="calls">{calls.value}</p><button type="button" class="rename" on:click="() => name.value = 'Grace'">r</button>`
	const { component, modules, recompile, cleanup } = await load({ Child: child, Parent: parentOf(script, tag) }, 'Parent', true)
	const next = await recompile('Child', child.replace('class="state"', 'class="state next"'))
	const window = new Window()
	try {
		const id = (modules.Child as unknown as { __hotId: string }).__hotId
		enableHotModule(id)
		const root = window.document.createElement('main')
		const { html, state } = component.renderWithState({})
		root.innerHTML = html
		const release = component.hydrate(root as unknown as Element, {}, state)
		const shown = (section: string): string => root.querySelector(`#${section} .state`)?.textContent ?? ''
		const input = root.querySelector('#own input') as unknown as HTMLInputElement
		input.value = 'mine'
		input.dispatchEvent(new window.Event('input', { bubbles: true }) as unknown as Event)
		assert.equal(root.querySelector('.calls')?.textContent, '1')

		replaceHotModule(id, next)

		assert.ok(root.querySelector('#bound .state.next'), 'the new version is mounted')
		assert.equal(shown('bound'), 'Ada|false')
		assert.equal(shown('own'), 'mine|false')
		assert.equal(root.querySelector('.calls')?.textContent, '1', 'restoring is not a write')
		// The new instance follows the prop and calls the event; the old one is gone.
		;(root.querySelector('.rename') as unknown as HTMLElement).click()
		assert.equal(shown('bound'), 'Grace|false')
		const bound = root.querySelector('#bound input') as unknown as HTMLInputElement
		bound.value = 'typed'
		bound.dispatchEvent(new window.Event('input', { bubbles: true }) as unknown as Event)
		assert.equal(shown('bound'), 'typed|false')
		assert.equal(root.querySelector('.calls')?.textContent, '2')
		release()
	} finally {
		window.happyDOM.abort()
		await cleanup()
	}
})

test('DevTools shows a model that follows a prop, its changes, and an edit reaches the parent as a write', async () => {
	const script = `const name = signal("Ada");\nconst seen = signal("-");`
	const tag = `<Child bind:modelValue="name.value" on:update:modelValue="(next) => seen.value = next" /><p class="seen">{seen.value}</p><button type="button" class="rename" on:click="() => name.value = 'Grace'">r</button>`
	const { component, cleanup } = await load({ Child: child, Parent: parentOf(script, tag) }, 'Parent', true)
	const window = new Window()
	const names = ['window', 'Node'] as const
	const previous = names.map((name) => ({ name, value: Reflect.get(globalThis, name), present: Reflect.has(globalThis, name) }))
	Reflect.set(globalThis, 'window', window)
	Reflect.set(globalThis, 'Node', window.Node)
	try {
		const root = window.document.createElement('main')
		const { html, state } = component.renderWithState({})
		root.innerHTML = html
		const release = component.hydrate(root as unknown as Element, {}, state)
		const hook = Reflect.get(window, '__MEEKO_DEVTOOLS__') as DevtoolsHook
		const instance = (): DevtoolsHook extends { snapshot(): { instances: Array<infer I> } } ? I : never => hook.snapshot().instances.find((item) => item.name === 'Child')!
		assert.equal(instance().signals.value, 'Ada')
		;(root.querySelector('.rename') as unknown as HTMLElement).click()
		assert.equal(instance().signals.value, 'Grace')
		assert.ok(hook.snapshot().events.some((event) => event.kind === 'signal' && event.instanceId === instance().id && event.detail === 'value'))
		// An edit in the panel is a write of the child: the parent decides, and the value stays.
		assert.deepEqual(hook.setSignal(instance().id, 'value', 'edited'), { ok: true })
		assert.equal(root.querySelector('.seen')?.textContent, 'edited')
		assert.equal(instance().signals.value, 'Grace')
		release()
		assert.equal(hook.snapshot().instances.length, 0)
	} finally {
		for (const item of previous) {
			if (item.present) Reflect.set(globalThis, item.name, item.value)
			else Reflect.deleteProperty(globalThis, item.name)
		}
		window.happyDOM.abort()
		await cleanup()
	}
})

function assertCompileError(source: string, code: string, offset: number, message?: RegExp): void {
	assert.throws(
		() => compile(source, 'Models.meeko'),
		(error: unknown) => {
			assert.ok(error instanceof MeekoCompileError, String(error))
			assert.equal(error.diagnostic.code, code, error.message)
			assert.equal(error.diagnostic.location.offset, offset, error.message)
			if (message) assert.match(error.message, message)
			return true
		},
	)
}

test('MEEK066: a model goes by its signal or by its prop and event, not both', () => {
	const tag = (attributes: string): string => `<script lang="ts">const Child = 1;\nconst v = 1;\nconst f = () => {};</script>\n<template><Child ${attributes} /></template>`
	const dynamic = (attributes: string): string => `<script lang="ts">const Child = 1;\nconst v = 1;\nconst f = () => {};</script>\n<template><component is="v ? Child : 'section'" ${attributes} /></template>`
	for (const source of [tag, dynamic]) {
		const value = source(`model="v" bind:modelValue="v"`)
		assertCompileError(value, 'MEEK066', value.indexOf('bind:modelValue'), /model y bind:modelValue pasan los dos el modelo modelValue/)
		const reversed = source(`bind:modelValue="v" model="v"`)
		assertCompileError(reversed, 'MEEK066', reversed.indexOf(`model="v"`))
		const event = source(`model="v" on:update:modelValue="f"`)
		assertCompileError(event, 'MEEK066', event.indexOf('on:update:modelValue'), /model y on:update:modelValue no se combinan/)
		const named = source(`model:touched="v" bind:touched="v"`)
		assertCompileError(named, 'MEEK066', named.indexOf('bind:touched'))
		const namedEvent = source(`model:touched="v" on:update:touched="f"`)
		assertCompileError(namedEvent, 'MEEK066', namedEvent.indexOf('on:update:touched'))
	}
	assert.doesNotThrow(() => compile(tag(`model:touched="v" bind:modelValue="v" on:update:modelValue="f"`), 'Models.meeko'))
	assert.doesNotThrow(() => compile(tag(`model="v" on:update:touched="f"`), 'Models.meeko'))
})

test('on:update:name is the only event name with a colon', () => {
	const tag = (attributes: string): string => `<script lang="ts">const Child = 1;\nconst f = () => {};</script>\n<template><Child ${attributes} /></template>`
	assert.match(compile(tag(`on:update:modelValue="f"`), 'Models.meeko').code, /"onUpdate:modelValue": f/)
	const other = tag(`on:other:thing="f"`)
	assertCompileError(other, 'MEEK011', other.indexOf('on:other:thing'))
	const empty = tag(`on:update:="f"`)
	assertCompileError(empty, 'MEEK011', empty.indexOf('on:update:'))
})

test('MEEK063: the script cannot declare the prop or the event of its model', () => {
	const script = (body: string): string => `<script lang="ts">\n${body}\n</script><template><p>x</p></template>`
	const inline = script(`const props = defineProps<{ modelValue: string }>();\nconst value = defineModel<string>();`)
	assertCompileError(inline, 'MEEK063', inline.indexOf('modelValue: string'), /modelValue ya es de defineModel<T>\(\).*quítalo de defineProps/)
	const named = script(`const touched = defineModel<boolean>("touched", { default: false });\nconst props = defineProps<{ touched?: boolean }>();`)
	assertCompileError(named, 'MEEK063', named.indexOf('touched?: boolean'))
	const local = script(`interface Props { label: string; modelValue?: string }\nconst props = defineProps<Props>();\nconst value = defineModel<string>({ default: "" });`)
	assertCompileError(local, 'MEEK063', local.indexOf('modelValue?: string'))
	const alias = script(`type Props = { label: string } & { modelValue: string };\nconst props = defineProps<Props>();\nconst value = defineModel<string>();`)
	assertCompileError(alias, 'MEEK063', alias.indexOf('modelValue: string'))
	const event = script(`const emit = defineEmits<{ "update:modelValue": [next: string] }>();\nconst value = defineModel<string>();`)
	assertCompileError(event, 'MEEK063', event.indexOf('"update:modelValue"'), /quítalo de defineEmits/)
	const twice = script(`const a = defineModel<string>();\nconst b = defineModel<string>("modelValue");`)
	assertCompileError(twice, 'MEEK063', twice.indexOf('"modelValue"'), /cuya prop es modelValue/)
	// The prop of another model is free, and `default` is no prop of a model.
	assert.doesNotThrow(() => compile(script(`const props = defineProps<{ touched: boolean; default: string }>();\nconst value = defineModel<string>();`), 'Models.meeko'))
	// A wrapper with the props of what it wraps declares its own model: they are not spelled here.
	assert.doesNotThrow(() => compile(script(`import type { InputProps } from "./types";\nconst props = defineProps<InputProps>();\nconst value = defineModel<string>({ default: "" });`), 'Models.meeko'))
})

test('MEEK101: reading a prop in the default of defineModel is on purpose; anywhere else it still warns', () => {
	const warnings = (body: string): string[] => (compile(`<script lang="ts">\n${body}\n</script><template><p>{1}</p></template>`, 'Models.meeko').warnings ?? []).filter((warning) => warning.code === 'MEEK101').map((warning) => warning.message)
	assert.deepEqual(warnings(`const props = defineProps<{ initial?: string }>();\nconst value = defineModel<string>({ default: props.initial ?? "" });`), [])
	assert.deepEqual(warnings(`const props = defineProps<{ initial?: string }>();\nconst open = defineModel<string>("open", { default: props.initial ?? "" });`), [])
	assert.deepEqual(warnings(`const { initial = "" } = defineProps<{ initial?: string }>();\nconst value = defineModel<string>({ default: initial });`), [])
	assert.equal(warnings(`const props = defineProps<{ initial?: string }>();\nconst value = defineModel<string>({ default: "" });\nconst copy = props.initial;`).length, 1)
	assert.equal(warnings(`const { initial = "" } = defineProps<{ initial?: string }>();\nconst value = defineModel<string>({ default: "" });\nconst copy = initial;`).length, 1)
})

const typed = `<script lang="ts">
const value = defineModel<string>();
const touched = defineModel<boolean>("touched", { default: false });
const props = defineProps<{ placeholder?: string }>();
</script>
<template><input model="value" bind:placeholder="props.placeholder" /><b>{touched.value}</b></template>`

const typedOptional = `<script lang="ts">
const value = defineModel<string>({ default: "" });
</script>
<template><input model="value" /></template>`

test('meeko check knows the prop and the event of a model, and that a required one needs one of its forms', { timeout: 120_000 }, async () => {
	const parentDirectory = resolve('.meeko')
	await mkdir(parentDirectory, { recursive: true })
	const root = await mkdtemp(join(parentDirectory, 'model-props-check-'))
	await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}\n')
	await writeFile(join(root, 'tsconfig.json'), `${JSON.stringify({ compilerOptions: { types: ['node'], paths: { '@meekojs/meeko/internal': ['../../src/internal.ts'], '@meekojs/meeko': ['../../src/index.ts'] } } })}\n`)
	await writeFile(join(root, 'Typed.meeko'), typed)
	await writeFile(join(root, 'Optional.meeko'), typedOptional)
	const parent = (template: string, extra = ''): string => `<script lang="ts">
import { signal } from "@meekojs/meeko";
import type { Component } from "@meekojs/meeko";
import * as Typed from "./Typed.meeko";
import * as Optional from "./Optional.meeko";
import type { ComponentEmits, ComponentProps as TypedProps, __MeekoPropsOnly as TypedOnly } from "./Typed.meeko";
const name = signal("a");
const maybe = signal<string | undefined>(undefined);
const flag = signal(true);
${extra}
</script><template>${template}</template>`
	const cases: Array<{ name: string; source: string; codes: string[]; at?: string }> = [
		{ name: 'Signal', source: parent(`<Typed model="name" />`), codes: [] },
		{ name: 'Value', source: parent(`<Typed bind:modelValue="name.value" />`), codes: [] },
		{ name: 'Literal', source: parent(`<Typed bind:modelValue="'hola'" />`), codes: [] },
		{ name: 'WithEvent', source: parent(`<Typed bind:modelValue="name.value" on:update:modelValue="(next) => { const text: string = next; name.value = text; }" />`), codes: [] },
		{ name: 'NamedProp', source: parent(`<Typed model="name" bind:touched="flag.value" on:update:touched="(next) => { const on: boolean = next; flag.value = on; }" />`), codes: [] },
		{ name: 'Spread', source: parent(`<Typed bind="option" />`, `const option = { modelValue: "hola", placeholder: "x" };`), codes: [] },
		{ name: 'SpreadWrongValue', source: parent(`<Typed bind="option" />`, `const option = { modelValue: 1, placeholder: "x" };`), codes: ['TS2345'] },
		{ name: 'WrongValue', source: parent(`<Typed bind:modelValue="1" />`), codes: ['TS2322'], at: 'modelValue' },
		{ name: 'WrongNamed', source: parent(`<Typed model="name" bind:touched="1" />`), codes: ['TS2322'], at: 'touched' },
		{ name: 'WrongEventParameter', source: parent(`<Typed model:touched="flag" bind:modelValue="name.value" on:update:modelValue="(next: number) => next" />`), codes: ['TS2322'] },
		{ name: 'UnknownEvent', source: parent(`<Typed model="name" on:update:nope="() => {}" />`), codes: ['TS2353'], at: 'on:update:nope' },
		{ name: 'OnlyEvent', source: parent(`<Typed on:update:modelValue="() => {}" />`), codes: ['TS2741'], at: '<Typed' },
		{ name: 'Nothing', source: parent(`<Typed />`), codes: ['TS2741'], at: '<Typed' },
		{ name: 'MaybeOnRequired', source: parent(`<Typed bind:modelValue="maybe.value" />`), codes: ['TS2741'], at: '<Typed' },
		{ name: 'MaybeOnOptional', source: parent(`<Optional bind:modelValue="maybe.value" />`), codes: [] },
		{ name: 'OptionalNothing', source: parent(`<Optional />`), codes: [] },
		{ name: 'OptionalOnlyEvent', source: parent(`<Optional on:update:modelValue="(next) => { const text: string = next; void text; }" />`), codes: [] },
		{ name: 'DefaultIsNoApi', source: parent(`<Typed bind:modelValue="name.value" bind:default="name.value" />`), codes: ['TS2353'], at: 'default' },
		{ name: 'DefaultEventIsNoApi', source: parent(`<Typed bind:modelValue="name.value" on:update:default="() => {}" />`), codes: ['TS2353'], at: 'on:update:default' },
		{ name: 'BindHandler', source: parent(`<Typed model="name" bind="option" />`, `const option = { "onUpdate:modelValue": () => {} };`), codes: ['MEEK113'] },
		{
			name: 'Types',
			source: parent(
				`<p>x</p>`,
				`const props: TypedProps = { modelValue: "x", "onUpdate:modelValue": (next) => { const text: string = next; void text; }, touched: true };
const only: TypedOnly = { modelValue: "x", touched: false, placeholder: "y" };
const events: ComponentEmits = { "update:modelValue": ["x"], "update:touched": [true] };
const noEvents: ComponentEmits = {};
void noEvents;
const viaRender: typeof Typed extends { renderToString: (props: infer Props, ...rest: never[]) => string } ? Props : never = { modelValue: "x" };
const asComponent: Component<TypedProps> = Typed;
void [props, only, events, viaRender, asComponent];`,
			),
			codes: [],
		},
		{ name: 'TypesWrong', source: parent(`<p>x</p>`, `const props: TypedProps = { modelValue: 1 };\nvoid props;`), codes: ['TS2322'] },
		{ name: 'TypesNoHandlerInProps', source: parent(`<p>x</p>`, `const only: TypedOnly = { "onUpdate:modelValue": () => {} };\nvoid only;`), codes: ['TS2353'] },
		{ name: 'ComponentValue', source: parent(`<component is="dynamic" bind:modelValue="name.value" on:update:modelValue="(next) => { const text: string = next; void text; }" />`, `const dynamic: Component<TypedProps> = Typed;`), codes: [] },
		{ name: 'UnionOfModules', source: parent(`<component is="flag.value ? Typed : Optional" bind:modelValue="name.value" />`), codes: [] },
	]
	try {
		const failures: string[] = []
		for (const item of cases) {
			const diagnostics = await checkSource(item.source, join(root, `${item.name}.meeko`))
			const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code))
			const wrong = (item.codes.length === 0 && codes.size > 0) || item.codes.some((code) => !codes.has(code)) || diagnostics.some((diagnostic) => diagnostic.message.startsWith('TypeScript generado')) || (item.at !== undefined && !diagnostics.some((diagnostic) => item.source.startsWith(item.at!, diagnostic.location.offset)))
			if (wrong) failures.push(`${item.name}: ${JSON.stringify(diagnostics)}`)
		}
		assert.deepEqual(failures, [])
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

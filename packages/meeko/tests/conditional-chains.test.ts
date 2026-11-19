import { Window } from 'happy-dom'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { TextDocument } from 'vscode-languageserver-textdocument'

import { bindIf, renderIf } from '../src/app/runtime/renderer.ts'
import { compile } from '../src/compiler.ts'
import { signal } from '../src/core/reactivity.ts'
import { directiveNameCompletion } from '../src/language-server/features.ts'
import { valueSiteAt } from '../src/language-server/template-values.ts'

/** Clicks the element of `root` that `selector` names: happy-dom's elements are not the DOM types of `lib`. */
function click(root: { querySelector(selector: string): unknown }, selector: string): void {
	;(root.querySelector(selector) as HTMLElement).click()
}

interface Component {
	renderWithState(props: Record<string, unknown>): { html: string; state: Record<string, unknown> }
	hydrate(root: Element, props: Record<string, unknown>, state: Record<string, unknown>): () => void
}

async function load(files: Record<string, string>, run: (component: Component) => Promise<void> | void): Promise<void> {
	const parent = resolve('.meeko')
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(join(parent, 'conditional-chains-'))
	try {
		for (const [name, source] of Object.entries(files)) {
			let code = compile(source, join(directory, `${name}.meeko`)).code
			for (const [specifier, file] of [
				['@meekojs/meeko/internal', 'src/internal.ts'],
				['@meekojs/meeko', 'src/index.ts'],
			]) {
				for (const quote of ['"', "'"]) code = code.replaceAll(`from ${quote}${specifier}${quote}`, `from ${JSON.stringify(pathToFileURL(resolve(file!)).href)}`)
			}
			code = code.replace(/from (['"])\.\/([\w-]+)\.meeko\1/g, 'from "./$2.ts"')
			await writeFile(join(directory, `${name}.ts`), code)
		}
		await run((await import(pathToFileURL(join(directory, 'Page.ts')).href)) as Component)
	} finally {
		await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
	}
}

test('if/else-if/else selects only the first matching SSR branch and short-circuits later tests', async () => {
	const source = `<script lang="ts">const props=defineProps<{ initial:number; probe:(index:number,value:boolean)=>boolean }>();</script>
<template><p if="props.probe(0,props.initial===0)">zero</p><!-- between --><p else-if="props.probe(1,props.initial===1)">one</p><p else-if="props.probe(2,props.initial===2)">two</p><p else>other</p></template>`
	await load({ Page: source }, (component) => {
		for (const initial of [0, 1, 2, 3]) {
			const visited: number[] = []
			const { html } = component.renderWithState({ initial, probe: (index: number, value: boolean) => (visited.push(index), value) })
			assert.equal(html.replace(/<!--[\s\S]*?-->/g, ''), `<p>${['zero', 'one', 'two', 'other'][initial]}</p>`)
			assert.deepEqual(visited, initial === 0 ? [0] : initial === 1 ? [0, 1] : [0, 1, 2])
		}
	})
})

test('hydrates every initial branch, updates exclusively, and preserves an unchanged branch', async () => {
	const source = `<script lang="ts">import { signal } from '@meekojs/meeko';const props=defineProps<{initial:number}>();const mode=signal(props.initial);const count=signal(0);</script>
<template><p if="mode.value===0" class="branch">zero:{count.value}</p><p else-if="mode.value===1" class="branch">one:{count.value}</p><p else class="branch">other:{count.value}</p><button id="next" on:click="()=>mode.value=(mode.value+1)%3">next</button><button id="increment" on:click="()=>count.value++">+</button></template>`
	await load({ Page: source }, (component) => {
		for (const initial of [0, 1, 2]) {
			const browser = new Window()
			try {
				const props = { initial }
				const rendered = component.renderWithState(props)
				const root = browser.document.createElement('main')
				root.innerHTML = rendered.html
				const release = component.hydrate(root as unknown as Element, props, rendered.state)
				try {
					const branch = root.querySelector('.branch')
					click(root, '#increment')
					assert.equal(root.querySelector('.branch'), branch)
					assert.match(root.querySelector('.branch')!.textContent, /:1$/)
					for (let step = 1; step <= 6; step++) {
						click(root, '#next')
						assert.equal(root.querySelectorAll('.branch').length, 1)
						assert.equal(root.querySelector('.branch')!.textContent, `${['zero', 'one', 'other'][(initial + step) % 3]}:1`)
					}
				} finally {
					release()
				}
			} finally {
				browser.happyDOM.abort()
			}
		}
	})
})

test('switching a component branch releases its resources and creates fresh component state', async () => {
	const Child = `<script lang="ts">import { signal,onCleanup,onMounted } from '@meekojs/meeko';const props=defineProps<{label:string;record:(label:string)=>void}>();const count=signal(0);let mounted=false;onMounted(()=>{mounted=true});onCleanup(()=>{if(mounted)props.record(props.label)});</script><template><button class="child" on:click="()=>count.value++">{props.label}:{count.value}</button></template>`
	const Page = `<script lang="ts">import { signal } from '@meekojs/meeko';import * as Child from './Child.meeko';const props=defineProps<{record:(label:string)=>void}>();const mode=signal(0);</script><template><Child if="mode.value===0" label="a" bind:record="props.record"/><Child else-if="mode.value===1" label="b" bind:record="props.record"/><Child else label="c" bind:record="props.record"/><button id="next" on:click="()=>mode.value=(mode.value+1)%3">next</button></template>`
	await load({ Child, Page }, (component) => {
		const released: string[] = []
		const props = { record: (label: string) => released.push(label) }
		const browser = new Window()
		try {
			const rendered = component.renderWithState(props)
			released.length = 0
			const root = browser.document.createElement('main')
			root.innerHTML = rendered.html
			const release = component.hydrate(root as unknown as Element, props, rendered.state)
			try {
				click(root, '.child')
				assert.equal(root.querySelector('.child')!.textContent, 'a:1')
				for (const label of ['b', 'c', 'a']) {
					click(root, '#next')
					assert.equal(root.querySelector('.child')!.textContent, `${label}:0`)
				}
				assert.deepEqual(released, ['a', 'b', 'c'])
			} finally {
				release()
			}
			assert.deepEqual(released, ['a', 'b', 'c', 'a'])
		} finally {
			browser.happyDOM.abort()
		}
	})
})

test('supports nested template chains inside keyed lists and legacy if:when as the first branch', async () => {
	const Page = `<script lang="ts">import { signal } from '@meekojs/meeko';const items=signal([0,1,2]);</script><template><template each:of="items.value" each:as="item" each:key="item"><template if:when="item===0"><i class="entry">zero</i></template><template else-if="item===1"><i class="entry">one</i></template><template else><b class="entry">other</b></template></template><button id="swap" on:click="()=>items.value=[2,0]">swap</button></template>`
	await load({ Page }, (component) => {
		const browser = new Window()
		try {
			const rendered = component.renderWithState({})
			const root = browser.document.createElement('main')
			root.innerHTML = rendered.html
			const release = component.hydrate(root as unknown as Element, {}, rendered.state)
			try {
				assert.deepEqual(
					[...root.querySelectorAll('.entry')].map((element) => element.textContent),
					['zero', 'one', 'other'],
				)
				click(root, '#swap')
				assert.deepEqual(
					[...root.querySelectorAll('.entry')].map((element) => element.textContent),
					['other', 'zero'],
				)
			} finally {
				release()
			}
		} finally {
			browser.happyDOM.abort()
		}
	})
})

test('rejects orphan, conflicting, valued and misplaced branches with MEEK138', () => {
	for (const body of ['<p else>x</p>', '<p else-if="true">x</p>', '<p if="true">a</p>text<p else>b</p>', '<p if="true">a</p><b>x</b><p else>b</p>', '<p if="true">a</p><p else>b</p><p else>c</p>', '<p if="true">a</p><p else="false">b</p>', '<p if="true" else>x</p>', '<p if="true" if:when="true">x</p>', '<p if="">x</p>', '<p if="false">a</p><p else-if="">b</p>', '<p if="false">a</p><p else each:of="[]" each:as="item">b</p>']) {
		assert.throws(() => compile(`<template>${body}</template>`, 'Invalid.meeko'), /MEEK138/)
	}
	assert.throws(() => compile('<template><p if="true" each:of="[]" each:as="item">x</p></template>'), /MEEK021/)
})

test('the editor offers short directives and treats if and else-if values as expressions', () => {
	const source = '<template><p ></p></template>'
	const document = TextDocument.create('file:///Short.meeko', 'meeko', 1, source)
	const items = directiveNameCompletion(document, document.positionAt(source.indexOf(' >') + 1)) ?? []
	for (const name of ['if', 'else-if', 'else', 'if:when']) {
		const item = items.find((entry) => entry.label === name)
		assert.ok(item, name)
		assert.equal(item.textEdit && 'newText' in item.textEdit ? item.textEdit.newText : undefined, name === 'else' ? 'else' : `${name}="$1"`)
	}
	for (const name of ['if', 'else-if']) {
		const text = `<template><p ${name}="value"></p></template>`
		assert.equal(valueSiteAt(text, text.indexOf('value') + 2)?.attribute, name)
	}
})

test('checks browser-only references inside alternative branches', () => {
	const source = '<script lang="ts">const first=useElementRef("box");const box=await useElementRef("box");const late="not available in SSR";</script><template><div if="true" ref:box>ready</div><p else>{late}</p></template>'
	assert.throws(() => compile(source, 'Late.meeko'), /MEEK057/)
})

test('a failed alternate render leaves the active branch intact and can recover', () => {
	const browser = new Window()
	const root = browser.document.createElement('main')
	const selected = signal(true)
	let fail = true
	let releases = 0
	const alternate = () => {
		if (fail) throw new Error('alternate failed')
		return '<b>alternate</b>'
	}
	root.innerHTML = renderIf(0, true, () => '<i>active</i>', alternate)
	const release = bindIf(
		{ root: root as unknown as Element },
		0,
		() => selected.value,
		() => '<i>active</i>',
		() => () => {
			releases++
		},
		alternate,
		() => () => {
			releases++
		},
	)
	try {
		assert.throws(() => {
			selected.value = false
		}, /alternate failed/)
		assert.equal(root.textContent, 'active')
		assert.equal(releases, 0)
		fail = false
		selected.value = true
		selected.value = false
		assert.equal(root.textContent, 'alternate')
		assert.equal(releases, 1)
	} finally {
		release()
		browser.happyDOM.abort()
	}
	assert.equal(releases, 2)
})

import { Window } from 'happy-dom'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import type * as hmr_tsTypes from '../src/app/runtime/hmr.ts'
import type * as lifecycle_tsTypes from '../src/app/runtime/lifecycle.ts'

import { compile } from '../src/compiler.ts'
import { meeko } from '../src/vite.ts'

/** The runtime as the compiled components import it, by file URL: one instance of every module. */
const runtimeUrl = (path: string): string => pathToFileURL(resolve(path)).href
const runtime = (path: string): string => JSON.stringify(runtimeUrl(path))
const { acceptHotModule, enableHotModule, replaceHotModule } = (await import(runtimeUrl('src/app/runtime/hmr.ts'))) as typeof hmr_tsTypes
const { mountBatch } = (await import(runtimeUrl('src/app/runtime/lifecycle.ts'))) as typeof lifecycle_tsTypes

interface Module {
	renderToString(props: object): string
	hydrate(root: Element, props: object): () => void
	readonly __hotId: string
	readonly css: string
}

/** A cart whose lines live in localStorage: the SSR shows the empty branch, the browser the other one. */
const cart = (label: string, color = 'red'): string => `<script lang="ts">
import { useStorage } from "@meekojs/meeko/framework";
import { signal } from "@meekojs/meeko";
const lines = useStorage("cart:lines", [] as string[]);
const opened = signal(0);
</script>
<template><section><p class="empty" if:when="lines.value.length === 0">Vacío</p><p class="full" if:when="lines.value.length > 0">${label} {lines.value.join(",")}</p><button class="open" on:click="() => opened.value++">{opened.value}</button></section></template>
<style scoped>.full { color: ${color}; }</style>`

/** The header badge of the same cart: while it stays mounted, the stored lines stay loaded. */
const badge = `<script lang="ts">
import { useStorage } from "@meekojs/meeko/framework";
const lines = useStorage("cart:lines", [] as string[]);
</script>
<template><span class="badge">{String(lines.value.length)}</span></template>`

let counter = 0

async function load(directory: string, source: string, name = 'Cart'): Promise<Module> {
	const output = join(directory, `${name}${++counter}.ts`)
	// Every version compiles as the same file, so it keeps the hot id of the instances it replaces.
	const code = compile(source, join(directory, `${name}.meeko`), { hot: true })
		.code.replace(`from "@meekojs/meeko/internal"`, `from ${runtime('src/internal.ts')}`)
		.replace(`from "@meekojs/meeko/framework"`, `from ${runtime('src/framework.ts')}`)
		.replace(`from "@meekojs/meeko"`, `from ${runtime('src/index.ts')}`)
	await writeFile(output, code)
	return (await import(pathToFileURL(output).href)) as Module
}

async function setup() {
	await mkdir(resolve('.meeko'), { recursive: true })
	const directory = await mkdtemp(resolve('.meeko', 'hmr-client-state-'))
	const browser = new Window({ url: 'https://example.test/' })
	browser.localStorage.setItem('cart:lines', '["pan","leche"]')
	const names = ['window', 'document', 'Node'] as const
	const previous = names.map((name) => ({ name, value: Reflect.get(globalThis, name), present: Reflect.has(globalThis, name) }))
	Reflect.set(globalThis, 'window', browser)
	Reflect.set(globalThis, 'document', browser.document)
	Reflect.set(globalThis, 'Node', browser.Node)
	const header = browser.document.createElement('header') as unknown as Element
	const root = browser.document.createElement('main') as unknown as Element
	browser.document.body.append(header as unknown as Parameters<typeof browser.document.body.append>[0], root as unknown as Parameters<typeof browser.document.body.append>[0])
	const badgeModule = await load(directory, badge, 'Badge')
	const original = await load(directory, cart('Con artículos:'))
	enableHotModule(original.__hotId)
	// A plain render keeps the initial value, as the SSR does; hydration then applies the stored one.
	header.innerHTML = badgeModule.renderToString({})
	root.innerHTML = original.renderToString({})
	assert.ok(root.querySelector('.empty'), 'the SSR shows the empty branch')
	// One page hydration: the stored value arrives once both have hydrated.
	const [releaseBadge, release] = mountBatch(() => [badgeModule.hydrate(header, {}), original.hydrate(root, {})])
	assert.equal(header.textContent, '2')
	const restore = async (): Promise<void> => {
		release()
		releaseBadge()
		for (const item of previous) {
			if (item.present) Reflect.set(globalThis, item.name, item.value)
			else Reflect.deleteProperty(globalThis, item.name)
		}
		browser.happyDOM.abort()
		await rm(directory, { recursive: true, force: true })
	}
	return { directory, root, original, restore }
}

const click = (root: Element, selector: string): void => (root.querySelector(selector) as unknown as HTMLButtonElement).click()

test('HMR remounts a component whose browser-only state diverged from the SSR, keeping its signals', async () => {
	const { directory, root, original, restore } = await setup()
	try {
		assert.equal(root.querySelector('.empty'), null)
		assert.equal(root.querySelector('.full')?.textContent, 'Con artículos: pan,leche')
		click(root, '.open')
		click(root, '.open')
		const edited = await load(directory, cart('En el carrito:'))
		assert.equal(edited.__hotId, original.__hotId)
		// Hydrating the live DOM against an SSR-like render threw "Hydration mismatch in condition".
		replaceHotModule(original.__hotId, edited)
		assert.equal(root.querySelector('.empty'), null)
		assert.equal(root.querySelector('.full')?.textContent, 'En el carrito: pan,leche')
		assert.equal(root.querySelector('.open')?.textContent, '2', 'the editable signals survive')
		// The new instance stays live: its bindings and listeners update.
		click(root, '.open')
		assert.equal(root.querySelector('.open')?.textContent, '3')
		// And a second edit still applies.
		replaceHotModule(original.__hotId, await load(directory, cart('Tercera:')))
		assert.equal(root.querySelector('.full')?.textContent, 'Tercera: pan,leche')
		assert.equal(root.querySelector('.open')?.textContent, '3')
	} finally {
		await restore()
	}
})

test('HMR of a <style>-only edit replaces the stylesheet and leaves the instances mounted', async () => {
	const { directory, root, original, restore } = await setup()
	try {
		const button = root.querySelector('.open')
		const restyled = await load(directory, cart('Con artículos:', 'blue'))
		assert.notEqual(restyled.css, original.css)
		acceptHotModule(original.__hotId, restyled, { styleOnly: true, reload: () => assert.fail('no reload') })
		assert.equal(root.querySelector('.open'), button, 'the DOM was not rendered again')
		const sheet = [...document.querySelectorAll<HTMLStyleElement>('style[data-meeko-hot]')].find((style) => style.dataset.meekoHot === original.__hotId)
		assert.match(sheet?.textContent ?? '', /blue/)
	} finally {
		await restore()
	}
})

test('HMR keeps the previous version mounted when the new one fails', async () => {
	const { directory, root, original, restore } = await setup()
	try {
		const reports: unknown[] = []
		let reloads = 0
		const options = { reload: () => reloads++, report: (_message: string, error: unknown) => reports.push(error) }
		// A setup that throws: the previous version mounts again, client-rendered with its stored state.
		const broken = await load(directory, cart('Roto:').replace('const opened = signal(0);', 'const opened = signal(0);\nif (opened.value === 0) throw new Error("setup failed");'))
		acceptHotModule(original.__hotId, broken, options)
		assert.equal(reloads, 0)
		assert.match(String(reports[0]), /setup failed/)
		assert.equal(root.querySelector('.full')?.textContent, 'Con artículos: pan,leche')
		click(root, '.open')
		assert.equal(root.querySelector('.open')?.textContent, '1', 'the restored instance is live')
		// A module that is not a component cannot be applied: the page reloads.
		acceptHotModule(original.__hotId, { css: '' }, options)
		assert.equal(reloads, 1)
	} finally {
		await restore()
	}
})

test('the Vite plugin marks a <style>-only edit, so the update leaves the instances mounted', async () => {
	await mkdir(resolve('.meeko'), { recursive: true })
	const root = await mkdtemp(resolve('.meeko', 'hmr-style-only-'))
	try {
		await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}\n')
		const plugin = meeko()
		;(plugin.configResolved as (config: unknown) => void)({ command: 'serve', build: { ssr: false }, root })
		const transform = plugin.transform as (this: unknown, code: string, id: string, options?: { ssr?: boolean }) => Promise<{ code: string }>
		const file = join(root, 'app', 'components', 'Cart.meeko')
		const signature = async (source: string): Promise<string> => {
			const { code } = await transform.call({ resolve: async () => null }, source, file, { ssr: false })
			assert.match(code, /__meeko\.acceptHotModule\(__hotId, next, \{ styleOnly: /)
			return /const __meekoHotCode = "([0-9a-f]+)"/.exec(code)![1]!
		}
		const first = await signature(cart('Con artículos:'))
		assert.equal(await signature(cart('Con artículos:', 'blue')), first, 'only the <style> changed')
		assert.notEqual(await signature(cart('En el carrito:')), first, 'the template changed')
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

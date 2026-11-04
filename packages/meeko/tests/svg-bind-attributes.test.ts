import { Window } from 'happy-dom'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { compile } from '../src/compiler.ts'

interface RuntimeModule {
	renderWithState(props: Record<string, unknown>): { html: string; state: Record<string, unknown> }
	hydrate(root: Element, props: Record<string, unknown>, state?: Record<string, unknown>): () => void
}

const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href)

/** Compiles one component inside the repository; the runtime is imported by file URL, as one instance. */
async function load(source: string): Promise<{ component: RuntimeModule; cleanup: () => Promise<void> }> {
	const parent = resolve('.meeko')
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(join(parent, 'svg-bind-test-'))
	const code = compile(source, join(directory, 'Icon.meeko'))
		.code.replace(`from "@meekojs/meeko/internal"`, `from ${runtime('src/internal.ts')}`)
		.replaceAll(`from "@meekojs/meeko"`, `from ${runtime('src/index.ts')}`)
	await writeFile(join(directory, 'Icon.ts'), code)
	const component = (await import(pathToFileURL(join(directory, 'Icon.ts')).href)) as RuntimeModule
	return { component, cleanup: () => rm(directory, { recursive: true, force: true }) }
}

const icon = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const box = signal("0 0 24 24");
const ratio = signal("xMidYMid meet");
</script>
<template><div><svg bind:viewBox="box.value" bind:preserveAspectRatio="ratio.value" bind:stroke-width="2"><path d="M0 0h24v24H0z" /></svg><i on:click="() => { box.value = '0 0 16 16'; ratio.value = 'none' }"></i></div></template>`

test('bind: in <svg> keeps the case of the standard: viewBox and preserveAspectRatio, like the static attributes', () => {
	const { code } = compile(icon, 'Icon.meeko')
	assert.match(code, /__meeko\.renderAttribute\("viewBox", box\.value\)/)
	assert.match(code, /__meeko\.renderAttribute\("preserveAspectRatio", ratio\.value\)/)
	assert.match(code, /__meeko\.bindAttribute\(__scope, \d+, "viewBox", /)
	// Names without a case of their own stay as written; HTML elements do not change.
	assert.match(code, /__meeko\.renderAttribute\("stroke-width", 2\)/)
	assert.match(compile('<template><div bind:tabIndex="1"></div></template>', 'Html.meeko').code, /renderAttribute\("tabindex", 1\)/)
	assert.match(compile('<template><math bind:definitionURL="url"></math></template>', 'Math.meeko').code, /renderAttribute\("definitionURL", url\)/)
})

test('bind:viewBox renders, hydrates without a mismatch and updates the attribute of the <svg>', async () => {
	const { component, cleanup } = await load(icon)
	const window = new Window({ url: 'https://meeko.test/' })
	const warnings: string[] = []
	const original = { warn: console.warn, error: console.error }
	console.warn = (...args: unknown[]) => {
		warnings.push(args.map(String).join(' '))
	}
	console.error = (...args: unknown[]) => {
		warnings.push(args.map(String).join(' '))
	}
	try {
		const rendered = component.renderWithState({})
		assert.match(rendered.html, /<svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" stroke-width="2"/)
		const root = window.document.createElement('div')
		window.document.body.appendChild(root)
		root.innerHTML = rendered.html
		const svg = root.querySelector('svg')!
		const release = component.hydrate(root as unknown as Element, {}, rendered.state)
		assert.equal(root.querySelector('svg'), svg, "hydration keeps the server's element")
		assert.deepEqual(
			warnings.filter((message) => /mismatch/i.test(message)),
			[],
		)
		;(root.querySelector('i') as unknown as HTMLElement).click()
		assert.equal(svg.getAttribute('viewBox'), '0 0 16 16')
		assert.equal(svg.getAttribute('preserveAspectRatio'), 'none')
		assert.deepEqual(
			[...svg.attributes].map((attribute) => attribute.name).filter((name) => /^(?:viewbox|preserveaspectratio)$/.test(name)),
			[],
			'no lowercase copy',
		)
		release()
	} finally {
		console.warn = original.warn
		console.error = original.error
		await window.happyDOM.close()
		await cleanup()
	}
})

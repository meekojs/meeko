import { Window as HappyWindow } from 'happy-dom'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import type { ClientComponent } from '../src/app/runtime/client.ts'

import { mountClientApp } from '../src/app/runtime/client.ts'
import { createRouteManifest } from '../src/app/runtime/router.ts'
import { compile } from '../src/compiler.ts'
import { createFrameworkHandler } from '../src/server/runtime/framework-render.ts'

/** A page whose effect cleans up with both forms, and whose onMounted registers a cleanup. */
const counterPage = `<script lang="ts">
import { effect, onCleanup, onMounted, signal } from "@meekojs/meeko";
const log = (globalThis as unknown as { effectLog: string[] }).effectLog;
const count = signal(0);
effect(() => {
  const value = count.value;
  log.push(\`run:\${value}\`);
  onCleanup(() => { log.push(\`onCleanup:\${value}\`); });
  return () => { log.push(\`returned:\${value}\`); };
});
onMounted(() => {
  onCleanup(() => { log.push("mounted-cleanup"); });
});
</script>
<template><button type="button" on:click="() => count.value++">{count.value}</button></template>`

const otherPage = `<script lang="ts"></script>
<template><p data-page="other">other</p></template>`

test('effect cleanups follow SSR, hydration, updates and release of a compiled page', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'meeko-effect-cleanup-'))
	const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href)
	const log: string[] = []
	;(globalThis as unknown as { effectLog: string[] }).effectLog = log
	const browser = new HappyWindow({ url: 'https://example.test/counter' })
	try {
		const modules: Record<string, ClientComponent> = {}
		for (const [name, source] of [
			['counter', counterPage],
			['other', otherPage],
		] as const) {
			const code = compile(source, join(directory, `${name}.meeko`))
				.code.replace(`from "@meekojs/meeko/internal"`, `from ${runtime('src/internal.ts')}`)
				.replace(`from "@meekojs/meeko"`, `from ${runtime('src/index.ts')}`)
			await writeFile(join(directory, `${name}.ts`), code)
			modules[`${name}.meeko`] = (await import(pathToFileURL(join(directory, `${name}.ts`)).href)) as ClientComponent
		}
		const routes = createRouteManifest([
			{ id: '/counter', file: 'counter.meeko', layouts: [] },
			{ id: '/other', file: 'other.meeko', layouts: [] },
		])
		const server = createFrameworkHandler({ routes, loadPage: async (file) => modules[file]! })
		const html = await (await server(new Request('https://example.test/counter'))).text()
		// SSR: the effect runs once and its root is released when the render ends.
		assert.deepEqual(log.splice(0), ['run:0', 'onCleanup:0', 'returned:0'])

		browser.document.write(html)
		const root = browser.document.getElementById('app')!
		const payload = browser.document.getElementById('meeko-payload')!.textContent!
		const app = await mountClientApp({
			routes,
			root: root as unknown as Element,
			payload,
			loadPage: async (file) => modules[file]!,
			browser: browser as unknown as Window,
		})
		// Hydration runs the effect once and keeps the server DOM.
		assert.deepEqual(log.splice(0), ['run:0'])
		const button = root.querySelector('button')!
		assert.equal(button.textContent, '0')

		// An update releases the previous run first, in registration order.
		button.click()
		assert.equal(button.textContent, '1')
		assert.deepEqual(log.splice(0), ['onCleanup:0', 'returned:0', 'run:1'])
		button.click()
		assert.deepEqual(log.splice(0), ['onCleanup:1', 'returned:1', 'run:2'])

		// Leaving the page releases the last run and the onMounted cleanup, once each.
		assert.equal(await app.navigate('/other'), true)
		assert.deepEqual(log.splice(0).sort(), ['mounted-cleanup', 'onCleanup:2', 'returned:2'])
		assert.equal(await app.navigate('/counter'), true)
		// A client navigation renders the page as HTML first, which releases its root like SSR, then mounts it.
		assert.deepEqual(log.splice(0), ['run:0', 'onCleanup:0', 'returned:0', 'run:0'])
		root.querySelector('button')!.click()
		assert.deepEqual(log.splice(0), ['onCleanup:0', 'returned:0', 'run:1'])
	} finally {
		browser.happyDOM.abort()
		delete (globalThis as { effectLog?: string[] }).effectLog
		await rm(directory, { recursive: true, force: true })
	}
})

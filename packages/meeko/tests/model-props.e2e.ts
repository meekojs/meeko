import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Page } from 'playwright-core'

import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

import type * as framework_server_tsTypes from '../src/framework-server.ts'
import type * as node_tsTypes from '../src/node.ts'

import { buildProject } from '../src/framework/project.ts'
import { createTempProject, linkRepositoryPackages } from './helpers/temp-project.ts'

const field = `<script lang="ts">
const { placeholder } = defineProps<{ placeholder?: string }>();
const value = defineModel<string>({ default: "por-defecto" });
const touched = defineModel<boolean>("touched", { default: false });
</script>
<template>
  <div class="field">
    <input model="value" bind:placeholder="placeholder" />
    <output>{value.value}|{touched.value}</output>
    <button type="button" class="touch" on:click="() => touched.value = !touched.value">t</button>
  </div>
</template>
`

const page = `<script lang="ts">
import { provideErrorHandler } from "@meekojs/meeko";
const viaSignal = signal("señal");
const controlled = signal("abcd");
const ignored = signal("fijo");
const ignoredSeen = signal("-");
const clamped = signal("AB");
const onlyBind = signal("uno");
const onlyEventSeen = signal("-");
const option = signal({ props: { modelValue: "hola", placeholder: "Escribe" } });
const touched = signal(false);
const touchedCalls = signal(0);
const show = signal(true);
const released = signal(0);
const asyncValue = signal("abcd");
const failingValue = signal("fija");
const failure = signal("-");
provideErrorHandler((error) => { failure.value = error instanceof Error ? error.message : String(error); });
const failingSave = async (): Promise<void> => {
  await new Promise((done) => setTimeout(done, 40));
  throw new Error("no se pudo guardar");
};
const syncValue = signal("abcd");
const saved = signal("-");
const save = (next: string): Promise<void> => new Promise((done) => setTimeout(() => { saved.value = next; done(); }, 40));
const resolved = signal<ResolvedComponent<"Field"> | undefined>(undefined);
onMounted(async () => {
  resolved.value = await resolveComponent("Field", { modelValue: "diferido" });
});
</script>
<template>
  <main>
    <section id="by-signal"><Field model="viaSignal" /><p class="outer">{viaSignal.value}</p></section>
    <section id="controlled"><Field bind:modelValue="controlled.value" on:update:modelValue="(next) => controlled.value = next" /><p class="outer">{controlled.value}</p></section>
    <section id="ignored"><Field bind:modelValue="ignored.value" on:update:modelValue="(next) => ignoredSeen.value = next" /><p class="outer">{ignoredSeen.value}</p></section>
    <section id="clamped"><Field bind:modelValue="clamped.value" on:update:modelValue="(next) => clamped.value = next.slice(0, 2).toUpperCase()" /></section>
    <section id="only-bind"><Field bind:modelValue="onlyBind.value" /><button type="button" class="change" on:click="() => onlyBind.value = 'dos'">c</button></section>
    <section id="only-event"><Field on:update:modelValue="(next) => onlyEventSeen.value = next" /><p class="outer">{onlyEventSeen.value}</p></section>
    <section id="nothing"><Field /></section>
    <section id="literal"><Field bind:modelValue="'literal'" /></section>
    <section id="spread"><Field bind="option.value.props" /><button type="button" class="change" on:click="() => option.value = { props: { modelValue: 'adiós', placeholder: 'Otra' } }">c</button></section>
    <section id="named"><Field bind:touched="touched.value" on:update:touched="(next) => { touchedCalls.value++; touched.value = next; }" /><p class="outer">{touched.value}|{touchedCalls.value}</p></section>
    <section id="is"><component is="Field" bind:modelValue="controlled.value" on:update:modelValue="(next) => controlled.value = next" /></section>
    <section id="resolved"><component if:when="resolved.value" is="resolved.value!" /></section>
    <section id="async-parent"><Field bind:modelValue="asyncValue.value" on:update:modelValue="async (next) => { await save(next); asyncValue.value = next; }" /><p class="outer">{asyncValue.value}</p></section>
    <section id="failing-parent"><Field bind:modelValue="failingValue.value" on:update:modelValue="failingSave" /><p class="outer">{failure.value}</p></section>
    <section id="sync-parent"><Field bind:modelValue="syncValue.value" on:update:modelValue="(next) => { syncValue.value = next; void save(next); }" /><p class="outer">{saved.value}</p></section>
    <section id="released">
      <template if:when="show.value"><Field bind:modelValue="controlled.value" on:update:modelValue="() => released.value++" /></template>
      <button type="button" class="hide" on:click="() => show.value = false">h</button>
      <p class="outer">{released.value}</p>
    </section>
  </main>
</template>
`

const output = (browser: Page, section: string): Promise<string> => browser.locator(`#${section} output`).first().innerText()
const input = (browser: Page, section: string) => browser.locator(`#${section} input`).first()
const outer = (browser: Page, section: string): Promise<string> => browser.locator(`#${section} .outer`).innerText()

test('defineModel by prop and event in Chrome: every row of the table, in SSR, hydration and updates', { timeout: 300_000 }, async () => {
	const project = await createTempProject('model-props-e2e')
	const root = project.root
	type ServerModule = typeof framework_server_tsTypes
	type NodeModule = typeof node_tsTypes
	let server: Server | undefined
	let app: Awaited<ReturnType<ServerModule['createServerApp']>> | undefined
	let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
	try {
		const files: Record<string, string> = {
			'package.json': '{"name":"model-props-app","private":true,"type":"module"}\n',
			'app/components/Field.meeko': field,
			'app/pages/index.meeko': page,
		}
		for (const [file, contents] of Object.entries(files)) {
			await mkdir(dirname(join(root, file)), { recursive: true })
			await writeFile(join(root, file), contents)
		}
		await linkRepositoryPackages(root, ['@meekojs/meeko', 'vite'])
		const built = await buildProject(root)
		const { createServerApp } = (await import(pathToFileURL(resolve('dist/framework-server.js')).href)) as ServerModule
		const { createNodeAssetReader, toNodeListener } = (await import(pathToFileURL(resolve('dist/node.js')).href)) as NodeModule
		const bundle = (await import(pathToFileURL(join(built.output, 'index.mjs')).href)) as Pick<Parameters<ServerModule['createServerApp']>[0], 'load' | 'manifest'>
		app = await createServerApp({
			manifest: bundle.manifest,
			load: bundle.load,
			production: false,
			assets: createNodeAssetReader({ root: join(built.output, 'client'), assets: bundle.manifest.assets ?? {} }),
		})
		const running = app
		server = createHttpServer(toNodeListener((request) => running.fetch(request)))
		await new Promise<void>((ready) => server!.listen(0, '127.0.0.1', ready))
		const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

		// The HTML of the server: each form gives its value, and what the parent has does not travel twice.
		const html = await (await fetch(`${origin}/`)).text()
		const section = (id: string): string => new RegExp(`<section id="${id}">([\\s\\S]*?)</section>`).exec(html)?.[1] ?? ''
		const childState = (id: string): unknown => {
			const marker = /<!--meeko:component:\d+:([^>]*)-->/.exec(section(id))?.[1]
			return marker === undefined ? undefined : JSON.parse(decodeURIComponent(marker))
		}
		const rendered = (id: string): string | undefined => /<input[^>]*\bvalue="([^"]*)"/.exec(section(id))?.[1]
		assert.equal(rendered('by-signal'), 'señal')
		assert.equal(rendered('controlled'), 'abcd')
		assert.equal(rendered('only-bind'), 'uno')
		assert.equal(rendered('only-event'), 'por-defecto')
		assert.equal(rendered('nothing'), 'por-defecto')
		assert.equal(rendered('literal'), 'literal')
		assert.equal(rendered('spread'), 'hola')
		assert.match(section('spread'), /placeholder="Escribe"/)
		assert.doesNotMatch(html, /modelvalue=|onupdate/i)
		assert.deepEqual(childState('controlled'), { touched: false })
		assert.deepEqual(childState('only-bind'), { touched: false })
		assert.deepEqual(childState('spread'), { touched: false })
		assert.deepEqual(childState('by-signal'), { touched: false })
		assert.deepEqual(childState('only-event'), { value: 'por-defecto', touched: false })
		assert.deepEqual(childState('nothing'), { value: 'por-defecto', touched: false })

		browser = await chromium.launch({
			...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' as const }),
			headless: true,
		})
		const context = await browser.newContext()
		const tab = await context.newPage()
		const errors: string[] = []
		tab.on('pageerror', (error) => errors.push(error.message))
		tab.on('console', (message) => {
			if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text())
		})
		// No flicker: hydrating writes nothing to the controls that the server rendered.
		await tab.addInitScript(() => {
			const writes: string[] = []
			Object.assign(window, { __valueWrites: writes })
			const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!
			Object.defineProperty(HTMLInputElement.prototype, 'value', {
				...descriptor,
				set(next: string) {
					writes.push(next)
					descriptor.set!.call(this, next)
				},
			})
		})
		await tab.goto(`${origin}/`)
		await tab.waitForFunction(() => performance.getEntriesByName('meeko-hydration').length > 0)
		assert.deepEqual(await tab.evaluate(() => (window as unknown as { __valueWrites: string[] }).__valueWrites), [])
		assert.equal(await output(tab, 'controlled'), 'abcd|false')
		assert.equal(await output(tab, 'spread'), 'hola|false')

		// model="signal", unchanged.
		await input(tab, 'by-signal').fill('nueva')
		assert.equal(await outer(tab, 'by-signal'), 'nueva')

		// Prop and event, with a parent that takes the value: typing in the middle keeps the caret.
		await input(tab, 'controlled').click()
		await input(tab, 'controlled').evaluate((element) => (element as HTMLInputElement).setSelectionRange(2, 2))
		await tab.keyboard.type('XY')
		assert.equal(await outer(tab, 'controlled'), 'abXYcd')
		assert.equal(await input(tab, 'controlled').inputValue(), 'abXYcd')
		assert.equal(await input(tab, 'controlled').evaluate((element) => (element as HTMLInputElement).selectionStart), 4)
		assert.equal(await input(tab, 'is').inputValue(), 'abXYcd', '<component is> follows the same prop')

		// Prop and event, with a parent that keeps its prop: the event fires and the control goes back.
		await input(tab, 'ignored').click()
		await tab.keyboard.type('x')
		assert.match(await outer(tab, 'ignored'), /x/)
		assert.equal(await input(tab, 'ignored').inputValue(), 'fijo')
		assert.equal(await output(tab, 'ignored'), 'fijo|false')

		// A parent that writes something else, also when its own value does not change.
		await input(tab, 'clamped').fill('abc')
		assert.equal(await input(tab, 'clamped').inputValue(), 'AB')
		await input(tab, 'clamped').fill('xyz')
		assert.equal(await input(tab, 'clamped').inputValue(), 'XY')

		// Only the prop: a write is local until the prop changes.
		await input(tab, 'only-bind').fill('local')
		assert.equal(await output(tab, 'only-bind'), 'local|false')
		await tab.locator('#only-bind .change').click()
		assert.equal(await output(tab, 'only-bind'), 'dos|false')
		assert.equal(await input(tab, 'only-bind').inputValue(), 'dos')

		// Only the event: local, and it hears each write.
		await input(tab, 'only-event').fill('propio')
		assert.equal(await output(tab, 'only-event'), 'propio|false')
		assert.equal(await outer(tab, 'only-event'), 'propio')

		// Nothing: local.
		await input(tab, 'nothing').fill('solo')
		assert.equal(await output(tab, 'nothing'), 'solo|false')

		// bind="object": the props and the model follow the object.
		await tab.locator('#spread .change').click()
		assert.equal(await input(tab, 'spread').inputValue(), 'adiós')
		assert.equal(await input(tab, 'spread').getAttribute('placeholder'), 'Otra')

		// A named model by prop and event.
		await tab.locator('#named .touch').click()
		assert.equal(await outer(tab, 'named'), 'true|1')
		assert.equal(await output(tab, 'named'), 'por-defecto|true')

		// resolveComponent(name, props), a module loaded later.
		await tab.waitForFunction(() => document.querySelector('#resolved input') !== null)
		assert.equal(await input(tab, 'resolved').inputValue(), 'diferido')
		await input(tab, 'resolved').fill('tocado')
		assert.equal(await output(tab, 'resolved'), 'tocado|false')

		// A parent that awaits before changing its prop, typing faster than it saves: nothing is lost and the caret stays.
		await input(tab, 'async-parent').click()
		await input(tab, 'async-parent').evaluate((element) => (element as HTMLInputElement).setSelectionRange(2, 2))
		await tab.keyboard.type('XYZ')
		assert.equal(await input(tab, 'async-parent').inputValue(), 'abXYZcd')
		assert.equal(await input(tab, 'async-parent').evaluate((element) => (element as HTMLInputElement).selectionStart), 5)
		await tab.waitForFunction(() => document.querySelector('#async-parent .outer')!.textContent === 'abXYZcd')
		assert.equal(await input(tab, 'async-parent').inputValue(), 'abXYZcd')
		assert.equal(await input(tab, 'async-parent').evaluate((element) => (element as HTMLInputElement).selectionStart), 5, 'the save does not move the caret')
		// Slower than the keys, one by one, also in the middle of what was saved.
		await tab.keyboard.type('12', { delay: 60 })
		await tab.waitForFunction(() => document.querySelector('#async-parent .outer')!.textContent === 'abXYZ12cd')
		assert.equal(await input(tab, 'async-parent').inputValue(), 'abXYZ12cd')
		assert.equal(await input(tab, 'async-parent').evaluate((element) => (element as HTMLInputElement).selectionStart), 7)

		// A save that fails: the error reaches the application, and the control goes back to the prop.
		await input(tab, 'failing-parent').click()
		await tab.keyboard.type('!')
		assert.equal(await input(tab, 'failing-parent').inputValue(), 'fija!', 'it stays while the save is pending')
		await tab.waitForFunction(() => document.querySelector('#failing-parent .outer')!.textContent === 'no se pudo guardar')
		assert.equal(await input(tab, 'failing-parent').inputValue(), 'fija')

		// The same parent, changing its signal first and saving after: nothing jumps and nothing is lost.
		await input(tab, 'sync-parent').click()
		await input(tab, 'sync-parent').evaluate((element) => (element as HTMLInputElement).setSelectionRange(2, 2))
		await tab.keyboard.type('XY')
		assert.equal(await input(tab, 'sync-parent').inputValue(), 'abXYcd')
		assert.equal(await input(tab, 'sync-parent').evaluate((element) => (element as HTMLInputElement).selectionStart), 4)
		await tab.waitForFunction(() => document.querySelector('#sync-parent .outer')!.textContent === 'abXYcd')
		assert.equal(await input(tab, 'sync-parent').inputValue(), 'abXYcd')

		// Unmounted, it no longer calls the event.
		await input(tab, 'released').fill('escrito')
		assert.equal(await outer(tab, 'released'), '1')
		await tab.locator('#released .hide').click()
		assert.equal(await tab.locator('#released input').count(), 0)
		await input(tab, 'controlled').fill('otra')
		assert.equal(await outer(tab, 'released'), '1')

		assert.deepEqual(errors, [])
		await context.close()
	} finally {
		await browser?.close()
		if (server) await new Promise<void>((done) => server!.close(() => done()))
		await app?.close()
		await project.remove()
	}
})

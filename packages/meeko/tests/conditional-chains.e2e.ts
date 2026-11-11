import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

import type * as framework_server_tsTypes from '../src/framework-server.ts'
import type * as node_tsTypes from '../src/node.ts'

import { buildProject } from '../src/framework/project.ts'
import { createTempProject, linkRepositoryPackages } from './helpers/temp-project.ts'

test('Chrome: short conditional chains hydrate exclusively and release component branches', { timeout: 240_000 }, async () => {
	const project = await createTempProject('conditional-chains-e2e')
	type ServerModule = typeof framework_server_tsTypes
	type NodeModule = typeof node_tsTypes
	let server: Server | undefined
	let app: Awaited<ReturnType<ServerModule['createServerApp']>> | undefined
	try {
		const files = {
			'meeko.config.ts': 'export default {};\n',
			'app/components/Branch.meeko': `<script lang="ts">
const props=defineProps<{label:string}>();
const count=signal(0);
let mounted=false;
onMounted(()=>{mounted=true});
onCleanup(()=>{
  if(mounted){
    const state=globalThis as typeof globalThis & {__branchReleases?:string[]};
    (state.__branchReleases??=[]).push(props.label);
  }
});
</script>
<template><button type="button" class="branch" on:click="()=>count.value++">{props.label}:{count.value}</button></template>`,
			'app/pages/index.meeko': `<script lang="ts">const mode=signal(0);</script>
<template><main><Branch if="mode.value===0" label="zero"/><!-- alternative --><Branch else-if="mode.value===1" label="one"/><Branch else label="other"/><button type="button" id="next" on:click="()=>mode.value=(mode.value+1)%3">next</button></main></template>`,
		}
		for (const [file, contents] of Object.entries(files)) {
			await mkdir(dirname(join(project.root, file)), { recursive: true })
			await writeFile(join(project.root, file), contents)
		}
		await linkRepositoryPackages(project.root, ['@meekojs/meeko', 'vite'])
		const built = await buildProject(project.root)
		const { createServerApp } = (await import(pathToFileURL(resolve('dist/framework-server.js')).href)) as ServerModule
		const { createNodeAssetReader, toNodeListener } = (await import(pathToFileURL(resolve('dist/node.js')).href)) as NodeModule
		const output = (await import(pathToFileURL(join(built.output, 'index.mjs')).href)) as Pick<Parameters<ServerModule['createServerApp']>[0], 'load' | 'manifest'>
		app = await createServerApp({ manifest: output.manifest, load: output.load, production: false, assets: createNodeAssetReader({ root: join(built.output, 'client'), assets: output.manifest.assets ?? {} }) })
		const running = app
		server = createServer(toNodeListener((request) => running.fetch(request)))
		await new Promise<void>((ready) => server!.listen(0, '127.0.0.1', ready))
		const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
		const html = await (await fetch(origin)).text()
		assert.match(html, /zero/)
		assert.doesNotMatch(html, />one:|>other:/)
		const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' as const }), headless: true })
		try {
			const page = await browser.newPage()
			const errors: string[] = []
			page.on('pageerror', (error) => errors.push(error.message))
			page.on('console', (message) => {
				if (message.type() === 'error') errors.push(message.text())
			})
			await page.goto(origin, { waitUntil: 'networkidle' })
			assert.equal(await page.locator('.branch').count(), 1)
			await page.locator('.branch').click()
			assert.equal(await page.locator('.branch').textContent(), 'zero:1')
			for (const label of ['one', 'other', 'zero']) {
				await page.locator('#next').click()
				assert.equal(await page.locator('.branch').count(), 1)
				assert.equal(await page.locator('.branch').textContent(), `${label}:0`)
			}
			assert.deepEqual(await page.evaluate(() => (globalThis as typeof globalThis & { __branchReleases?: string[] }).__branchReleases), ['zero', 'one', 'other'])
			assert.deepEqual(errors, [])
		} finally {
			await browser.close()
		}
	} finally {
		if (server) await new Promise<void>((done) => server!.close(() => done()))
		await app?.close()
		await project.remove()
	}
})

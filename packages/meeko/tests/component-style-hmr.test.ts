import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { createServer, type HotPayload, type ViteDevServer } from 'vite'

import { meeko } from '../src/vite.ts'
import { createTempProject, linkRepositoryPackages } from './helpers/temp-project.ts'

const card = (color: string): string => `<template><p class="card">x</p></template>\n<style scoped>\n.card { color: ${color}; }\n</style>\n`

/** The ids that the browser module of a component imports for its stylesheet: the CSS that Vite injects and `&inline`. */
function styleImports(code: string): string[] {
	return [...code.matchAll(/import (?:\w+ from )?"([^"]*\?meeko-style=[0-9a-f]{64}(?:&inline)?&lang\.css)"/g)].map(([, id]) => id!)
}

/** What the browser does after a hot update: it imports the new version of the component and then its stylesheets. */
async function load(server: ViteDevServer, url: string): Promise<string[]> {
	const environment = server.environments.client
	const component = await environment.transformRequest(url)
	const imports = styleImports(component?.code ?? '')
	for (const id of imports) await environment.transformRequest(id)
	return imports
}

/** Edits the file, lets Vite handle the change as its watcher would, and returns what it sent to the browser. */
async function edit(server: ViteDevServer, file: string, source: string): Promise<HotPayload[]> {
	const sent: HotPayload[] = []
	const hot = server.environments.client.hot
	const send = hot.send.bind(hot)
	hot.send = ((payload: HotPayload) => {
		sent.push(payload)
		send(payload)
	}) as typeof hot.send
	try {
		await writeFile(file, source)
		server.watcher.emit('change', file)
		const deadline = Date.now() + 10_000
		while (!sent.some((payload) => payload.type === 'update' || payload.type === 'full-reload') && Date.now() < deadline) await new Promise((done) => setTimeout(done, 20))
		return sent
	} finally {
		hot.send = send as typeof hot.send
	}
}

test('editing the <style> of a component twice hot-updates it both times, without a full reload', { timeout: 60_000 }, async () => {
	// Each edit changes the hash of the stylesheet: the `&inline` module of the previous hash stays in the
	// graph of the file without importers in the browser. Vite saw it as a dead end and reloaded the page on
	// the second edit.
	const project = await createTempProject('vite-style-hmr-')
	const root = project.root
	await linkRepositoryPackages(root)
	const server = await createServer({ root, configFile: false, plugins: [meeko()], server: { middlewareMode: true, ws: false, watch: null }, logLevel: 'silent' })
	try {
		// A component of `app/components/`, the folder that `meeko dev` watches for its own hot updates.
		await mkdir(join(root, 'app', 'components'), { recursive: true })
		const file = join(root, 'app', 'components', 'Card.meeko')
		await writeFile(file, card('red'))
		const url = '/app/components/Card.meeko'
		// The page was rendered on the server first: the SSR version of the component imports the `&inline`
		// string too, and keeps importing the old hash after a hot update, until the next render.
		await server.ssrLoadModule(file)
		let previous = await load(server, url)
		assert.equal(previous.length, 2, 'the CSS and its &inline string')
		for (const [round, color] of ['green', 'blue', 'purple'].entries()) {
			const sent = await edit(server, file, card(color))
			assert.ok(!sent.some((payload) => payload.type === 'full-reload'), `edit #${round + 1} reloads the page: ${JSON.stringify(sent)}`)
			const update = sent.find((payload) => payload.type === 'update')
			assert.ok(update && update.type === 'update', `edit #${round + 1} sends a hot update: ${JSON.stringify(sent)}`)
			assert.ok(
				update.updates.some((entry) => entry.path === url && entry.acceptedPath === url),
				JSON.stringify(update.updates),
			)
			// The stylesheets of an earlier <style> are not fetched again: they would put back its rules.
			const stale = previous.map((id) => /meeko-style=([0-9a-f]{64})/.exec(id)![1]!)
			const older = update.updates.filter((entry) => stale.every((hash) => !entry.path.includes(hash)) && entry.path.includes('meeko-style='))
			assert.deepEqual(older, [], `edit #${round + 1} updates only the current stylesheets`)
			const imports = await load(server, url)
			assert.notDeepEqual(imports, previous, 'the hash follows the CSS')
			assert.match((await server.environments.client.transformRequest(imports.find((id) => id.includes('&inline'))!))?.code ?? '', new RegExp(color))
			previous = imports
		}
	} finally {
		await server.close()
		await project.remove()
	}
})

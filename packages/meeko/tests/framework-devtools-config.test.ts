import assert from 'node:assert/strict'
import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { checkFrameworkProject, prepareFrameworkTypes } from '../src/framework/check-project.ts'
import { loadConfiguredModules, loadMeekoConfig } from '../src/framework/config.ts'
import { devtoolsPanelUrl, resolveDevtoolsConfig } from '../src/framework/dev-devtools.ts'
import { initFrameworkProject } from '../src/framework/init.ts'
import { unknownConfigKeys } from '../src/framework/module-loader.ts'
import { buildProject } from '../src/framework/project.ts'
import { linkRepositoryPackages, repositoryRoot, stopChild, tempProject } from './helpers/temp-project.ts'

async function put(root: string, path: string, source: string): Promise<void> {
	const file = join(root, path)
	await mkdir(dirname(file), { recursive: true })
	await writeFile(file, source)
}

const config = (devtools: string): string => `import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  devtools: ${devtools},
});
`

/** Runs `run` and returns what it wrote to stderr. */
async function stderrOf(run: () => Promise<unknown>): Promise<string> {
	const original = process.stderr.write
	let written = ''
	process.stderr.write = ((chunk: string | Uint8Array) => {
		written += String(chunk)
		return true
	}) as typeof process.stderr.write
	try {
		await run()
	} finally {
		process.stderr.write = original
	}
	return written
}

async function freePort(): Promise<number> {
	const server = createServer()
	server.listen(0, '127.0.0.1')
	await once(server, 'listening')
	const address = server.address()
	assert.ok(address && typeof address !== 'string')
	server.close()
	await once(server, 'close')
	return address.port
}

async function waitFor(ready: () => boolean, message: () => string, child: ChildProcess, timeout = 30_000): Promise<void> {
	const start = Date.now()
	while (!ready()) {
		if (child.exitCode !== null || Date.now() - start > timeout) throw new Error(message())
		await new Promise((done) => setTimeout(done, 25))
	}
}

async function devtoolsProject(root: string, devtools?: string): Promise<void> {
	await initFrameworkProject(root)
	await put(
		root,
		'app/pages/index.meeko',
		`<script lang="ts">
const count = signal(0);
</script>

<template><button id="count" type="button" on:click="() => count.value++">{count.value}</button></template>
`,
	)
	if (devtools !== undefined) await put(root, 'meeko.config.ts', config(devtools))
	await linkRepositoryPackages(root, ['@meekojs/meeko', 'vite'])
}

async function startDev(root: string): Promise<{ child: ChildProcess; origin: string; output(): string }> {
	const port = await freePort()
	const child = spawn(process.execPath, [join(repositoryRoot, 'dist', 'cli.js'), 'dev', root], {
		cwd: root,
		env: { ...process.env, PORT: String(port), MEEKO_HMR_PORT: String(await freePort()), MEEKO_LINK_WATCH: '0', MEEKO_EDITOR_BRIDGE: '0' },
		stdio: ['ignore', 'pipe', 'pipe'],
		windowsHide: true,
	})
	let output = ''
	child.stdout?.on('data', (chunk: Buffer) => {
		output += chunk.toString()
	})
	child.stderr?.on('data', (chunk: Buffer) => {
		output += chunk.toString()
	})
	await waitFor(
		() => output.includes(`http://localhost:${port}\n`),
		() => `meeko dev did not listen: ${output}`,
		child,
	)
	return { child, origin: `http://127.0.0.1:${port}`, output: () => output }
}

/** Text that only the panel or its loader put in a document or a bundle. */
const panelMarkers = /meeko:devtools-panel|devtools-ui|data-meeko-devtools-panel|mountDevtoolsPanel|Meeko DevTools/

test('devtools is off by default and normalizes true and its object form', () => {
	assert.deepEqual(resolveDevtoolsConfig(undefined), { panel: false, position: 'bottom-right' })
	assert.deepEqual(resolveDevtoolsConfig(false), { panel: false, position: 'bottom-right' })
	assert.deepEqual(resolveDevtoolsConfig(true), { panel: true, position: 'bottom-right' })
	assert.deepEqual(resolveDevtoolsConfig({}), { panel: true, position: 'bottom-right' }, 'an object turns DevTools on')
	assert.deepEqual(resolveDevtoolsConfig({ position: 'top-left' }), { panel: true, position: 'top-left' })
	assert.deepEqual(resolveDevtoolsConfig({ panel: false, position: 'bottom-left' }), { panel: false, position: 'bottom-left' })
})

test('loadMeekoConfig rejects an invalid devtools with a clear message', async (context) => {
	const root = await tempProject(context, 'devtools-config-invalid')
	await linkRepositoryPackages(root)
	for (const [devtools, message] of [
		['"yes"', /meeko\.config\.ts: devtools debe ser un booleano o un objeto \{ panel\?: boolean, position\?: "bottom-right" \| "bottom-left" \| "top-right" \| "top-left" \}/],
		['[]', /devtools debe ser un booleano o un objeto/],
		['{ panel: "on" }', /meeko\.config\.ts: devtools\.panel debe ser un booleano/],
		['{ position: "middle" }', /meeko\.config\.ts: devtools\.position debe ser "bottom-right", "bottom-left", "top-right" o "top-left"/],
		['{ pannel: true }', /meeko\.config\.ts: devtools: campo desconocido pannel; devtools admite panel y position/],
	] as const) {
		await put(root, 'meeko.config.ts', config(`${devtools} as never`))
		await assert.rejects(
			loadMeekoConfig(root),
			(error: Error) => {
				assert.ok(error instanceof TypeError, error.message)
				assert.match(error.message, message)
				return true
			},
			devtools,
		)
	}
})

test('devtools is a known key: no unknown-key warning, and no module may take it', async (context) => {
	assert.deepEqual(unknownConfigKeys({ devtools: true }, []), [])
	const root = await tempProject(context, 'devtools-config-known')
	await linkRepositoryPackages(root)
	await put(root, 'meeko.config.ts', config('true'))
	assert.doesNotMatch(await stderrOf(() => loadConfiguredModules(root)), /desconocida/)
	await put(
		root,
		'modules/devtools/index.ts',
		`import { defineMeekoModule } from "@meekojs/meeko/framework";
export default defineMeekoModule({ meta: { name: "devtools", configKey: "devtools" }, setup() {} });
`,
	)
	await put(
		root,
		'meeko.config.ts',
		`import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ modules: ["./modules/devtools"] });
`,
	)
	await assert.rejects(loadConfiguredModules(root), /meta\.configKey "devtools", que es una opción del propio Meeko desde 1\.8/)
})

test('meeko check types devtools in meeko.config.ts', { timeout: 180_000 }, async (context) => {
	const root = await tempProject(context, 'devtools-config-check')
	await devtoolsProject(root, '{ panel: true, position: "top-left" }')
	await checkFrameworkProject(root)
	await put(
		root,
		'meeko.config.ts',
		`import { defineMeekoConfig } from "@meekojs/meeko/framework";

const position = "top-left" as string;
export default defineMeekoConfig({ devtools: { panel: true, position } });
`,
	)
	// Valid when it runs, but typed as any string: the types of meeko.config.ts reject it.
	await assert.rejects(checkFrameworkProject(root), /meeko\.config\.ts:4:\d+ TS2322/)
})

test('meeko dev adds the panel only with devtools, and the build never has it', { timeout: 240_000 }, async (context) => {
	let running: ChildProcess | undefined
	const on = await tempProject(context, 'devtools-config-dev-on', () => stopChild(running))
	await devtoolsProject(on, '{ position: "bottom-left" }')
	let dev = await startDev(on)
	running = dev.child
	const html = await (await fetch(`${dev.origin}/`, { headers: { accept: 'text/html' } })).text()
	assert.match(html, new RegExp(`<script type="module" async src="${devtoolsPanelUrl}"></script>`), dev.output())
	const module = await fetch(`${dev.origin}${devtoolsPanelUrl}`)
	assert.equal(module.status, 200)
	const source = await module.text()
	assert.match(source, /mountDevtoolsPanel\(\{ position: "bottom-left" \}\)/)
	assert.match(source, /data-meeko-devtools-panel/, 'a panel the application mounted is kept')
	assert.doesNotMatch(dev.output(), /desconocida/)
	await stopChild(running)

	const off = await tempProject(context, 'devtools-config-dev-off')
	await devtoolsProject(off)
	dev = await startDev(off)
	running = dev.child
	const plain = await (await fetch(`${dev.origin}/`, { headers: { accept: 'text/html' } })).text()
	assert.match(plain, /<button id="count"/)
	assert.doesNotMatch(plain, panelMarkers)
	assert.notEqual((await fetch(`${dev.origin}${devtoolsPanelUrl}`)).status, 200)
	await stopChild(running)
	running = undefined

	// `meeko build` of the project with devtools: true, prerendered page included, has no panel.
	await put(
		on,
		'app/pages/about.meeko',
		`<script server lang="ts">
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({ render: "prerender" });
</script>

<template><p>About</p></template>
`,
	)
	await prepareFrameworkTypes(on)
	const { output } = await buildProject(on, { adapter: 'node' })
	const built = (await readdir(output, { withFileTypes: true, recursive: true })).filter((entry) => entry.isFile() && /\.(?:m?js|html|json)$/.test(entry.name)).map((entry) => join(entry.parentPath, entry.name))
	assert.ok(built.some((file) => file.includes(join('client', 'assets')) && file.endsWith('.js')))
	assert.ok(
		built.some((file) => file.endsWith('.html')),
		'the prerendered page is in the output',
	)
	for (const file of built) assert.doesNotMatch(await readFile(file, 'utf8'), panelMarkers, file)
})

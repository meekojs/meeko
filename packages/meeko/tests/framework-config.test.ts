import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { configuredClassProviders, discoverConfiguredRoutes, loadMeekoConfig, readClassProvidersSync, readMeekoConfigSync, resolveConfigSources } from '../src/framework/config.ts'
import { generateRoutes } from '../src/framework/generate.ts'
import { resolveMeekoModules } from '../src/framework/module-loader.ts'

async function put(root: string, name: string, value: string): Promise<void> {
	const file = join(root, name)
	await mkdir(dirname(file), { recursive: true })
	await writeFile(file, value)
}

test('config composes app, layer and module pages into generated route types and manifest', async () => {
	const root = await mkdtemp(join(tmpdir(), 'meeko-config-'))
	try {
		await put(root, 'meeko.config.ts', `export default { extends: ["./layers/base"], modules: ["./modules/chat"], imports: { serverDirs: ["server/services"] } };`)
		await put(root, 'app/pages/index.meeko', '<template>Home</template>')
		await put(root, 'layers/base/app/pages/+layout.meeko', '<template>Layout</template>')
		await put(root, 'layers/base/app/pages/layer-demo.meeko', '<template>Layer</template>')
		await put(root, 'modules/chat/app/pages/chat.meeko', '<template>Chat</template>')
		assert.deepEqual((await loadMeekoConfig(root)).imports?.serverDirs, ['server/services'])
		assert.deepEqual(readMeekoConfigSync(root).imports?.serverDirs, ['server/services'])
		assert.deepEqual(readMeekoConfigSync(root).extends, ['./layers/base'])
		assert.deepEqual(readMeekoConfigSync(root).modules, ['./modules/chat'])
		const routes = await discoverConfiguredRoutes(root)
		assert.deepEqual(new Set(routes.map((route) => route.id)), new Set(['/', '/layer-demo', '/chat']))
		assert.equal(routes.find((route) => route.id === '/layer-demo')?.layouts.length, 1)
		const generated = await generateRoutes(root)
		assert.equal(generated.count, 3)
		assert.match(await readFile(generated.types, 'utf8'), /"\/layer-demo"/)
		assert.match(await readFile(generated.manifest, 'utf8'), /layers\/base\/app\/pages\/layer-demo\.meeko/)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('config rejects colliding routes and source names with file paths', async () => {
	const root = await mkdtemp(join(tmpdir(), 'meeko-config-'))
	try {
		await put(root, 'meeko.config.mjs', `export default { extends: ["./layers/base"], modules: ["./modules/chat"] };`)
		await put(root, 'app/pages/chat.meeko', '<template>App</template>')
		await put(root, 'modules/chat/app/pages/chat.meeko', '<template>Module</template>')
		await put(root, 'layers/base/app/pages/base.meeko', '<template>Layer</template>')
		await assert.rejects(discoverConfiguredRoutes(root), /Route collision:.*chat\.meeko/)
		await put(root, 'meeko.config.mjs', `export default { extends: ["./layers/base"], modules: ["./modules/base"] };`)
		await put(root, 'modules/base/app/pages/other.meeko', '<template>Other</template>')
		await assert.rejects(discoverConfiguredRoutes(root), /no válido o repetido base/)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('configured layers cannot escape the project through a directory link', async () => {
	const root = await mkdtemp(join(tmpdir(), 'meeko-config-'))
	const external = await mkdtemp(join(tmpdir(), 'meeko-external-layer-'))
	try {
		await put(external, 'app/pages/secret.meeko', '<template>External</template>')
		await mkdir(join(root, 'layers'))
		await symlink(external, join(root, 'layers', 'external'), 'junction')
		await assert.rejects(resolveConfigSources(root, { extends: ['./layers/external'] }), /sale de la raíz del proyecto/)
	} finally {
		await rm(root, { recursive: true, force: true })
		await rm(external, { recursive: true, force: true })
	}
})

test('loadMeekoConfig reads a rewrite that keeps the same mtime', async () => {
	// Two writes within one mtime tick, as a fast editor save or a test can make them.
	const root = await mkdtemp(join(tmpdir(), 'meeko-config-reload-'))
	try {
		const file = join(root, 'meeko.config.mjs')
		await writeFile(file, `export default { css: { scopeAttribute: "all" } };\n`)
		const { atime, mtime } = await stat(file)
		assert.equal((await loadMeekoConfig(root)).css?.scopeAttribute, 'all')
		await writeFile(file, `export default { css: { scopeAttribute: "matched" } };\n`)
		await utimes(file, atime, mtime)
		assert.equal((await loadMeekoConfig(root)).css?.scopeAttribute, 'matched')
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('loadMeekoConfig validates the dev options', async () => {
	const root = await mkdtemp(join(tmpdir(), 'meeko-config-dev-'))
	try {
		const file = join(root, 'meeko.config.mjs')
		await writeFile(file, `export default { dev: { serverLogs: false } };\n`)
		assert.equal((await loadMeekoConfig(root)).dev?.serverLogs, false)
		for (const [dev, error] of [
			['[]', /dev debe ser un objeto/],
			['{ serverLogs: "no" }', /dev\.serverLogs debe ser un booleano/],
		] as const) {
			await writeFile(file, `export default { dev: ${dev} };\n`)
			await assert.rejects(loadMeekoConfig(root), error)
		}
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('loadMeekoConfig validates dev.portless', async () => {
	const root = await mkdtemp(join(tmpdir(), 'meeko-config-portless-'))
	try {
		const file = join(root, 'meeko.config.mjs')
		for (const portless of ['true', 'false', '{ name: "ui.meeko" }']) {
			await writeFile(file, `export default { dev: { portless: ${portless} } };\n`)
			assert.deepEqual((await loadMeekoConfig(root)).dev?.portless, JSON.parse(portless.replace('name', '"name"')))
		}
		for (const [portless, error] of [
			['"ui"', /dev\.portless debe ser un booleano o un objeto \{ name \}/],
			['{}', /dev\.portless\.name debe ser una cadena no vacía/],
			['{ name: "Mi_App" }', /dev\.portless\.name "Mi_App" no es un nombre válido/],
			['{ name: "ui", port: 1 }', /dev\.portless\.port no es una opción/],
		] as const) {
			await writeFile(file, `export default { dev: { portless: ${portless} } };\n`)
			await assert.rejects(loadMeekoConfig(root), error)
		}
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

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

test('an unknown key of meeko.config warns once with the closest key, and module keys are known', async () => {
	const root = await mkdtemp(join(tmpdir(), 'meeko-config-unknown-'))
	try {
		await put(root, 'meeko.config.mjs', `export default { sitmap: true, site: "https://example.com", extra: 1 };\n`)
		const warned = await stderrOf(async () => {
			const config = await loadMeekoConfig(root)
			assert.equal((config as Record<string, unknown>).sitmap, true, 'still loads: a warning, not an error')
			await resolveMeekoModules(root, config)
		})
		assert.equal(
			warned,
			[
				`[meeko] Aviso: meeko.config.mjs tiene la clave desconocida "sitmap", que Meeko ignora. ¿Quisiste decir "sitemap"?\n`,
				`[meeko] Aviso: meeko.config.mjs tiene la clave desconocida "extra", que Meeko ignora. Si son las opciones de un módulo, añádalo a modules: su meta.configKey la declara.\n`,
			].join(''),
		)
		// A module's configKey is a key of the configuration; a typo of it is not.
		await put(root, 'modules/hello/index.mjs', `export default { [Symbol.for("meeko.module")]: true, meta: { name: "hello", configKey: "hello" }, setup() {} };\n`)
		await put(root, 'meeko.config.mjs', `export default { modules: ["./modules/hello"], hello: { greeting: "Hola" }, helo: {}, alias: { "lib/": "app/lib/" } };\n`)
		const modules = await stderrOf(async () => resolveMeekoModules(root, await loadMeekoConfig(root)))
		assert.equal(modules, `[meeko] Aviso: meeko.config.mjs tiene la clave desconocida "helo", que Meeko ignora. ¿Quisiste decir "hello"?\n`)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('css.classProviders and addClassProvider declare class providers for the editor, validated in Spanish', async () => {
	const root = await mkdtemp(join(tmpdir(), 'meeko-config-class-providers-'))
	const tailwind = { name: 'Tailwind CSS', vscode: ['bradlc.vscode-tailwindcss'], languages: ['tailwindcss'] }
	const uno = { name: 'UnoCSS', vscode: ['antfu.unocss'], languages: [] }
	try {
		await put(root, 'modules/engine/index.mjs', `export default { [Symbol.for("meeko.module")]: true, meta: { name: "engine" }, setup(_options, meeko) { meeko.addClassProvider({ name: "Tailwind CSS", vscode: ["bradlc.vscode-tailwindcss", "bradlc.vscode-tailwindcss"], languages: ["tailwindcss"] }) } };\n`)
		await put(root, 'meeko.config.mjs', `export default { modules: ["./modules/engine"], css: { scopeAttribute: "matched", classProviders: [{ name: "UnoCSS", vscode: ["antfu.unocss"] }] } };\n`)
		const config = await loadMeekoConfig(root)
		assert.deepEqual((await resolveMeekoModules(root, config)).classProviders, [tailwind], 'repeated ids once')
		assert.deepEqual(await configuredClassProviders(root), [tailwind, uno], 'the modules first, then the configuration')
		assert.deepEqual(readClassProvidersSync(root), [uno], 'without running it, only the literal of the configuration')
		for (const [value, message] of [
			['{}', /css\.classProviders debe ser un array de proveedores/],
			['[{ vscode: ["a.b"] }]', /css\.classProviders\[0\]\.name debe ser un texto no vacío/],
			['[{ name: "x", vscode: "a.b" }]', /css\.classProviders\[0\]\.vscode debe ser un array de ids como "bradlc\.vscode-tailwindcss"/],
			['[{ name: "x", vscode: ["no-dot"] }]', /css\.classProviders\[0\]\.vscode debe ser un array de ids/],
			['[{ name: "x", languages: ["meeko"] }]', /css\.classProviders\[0\]\.languages no puede incluir "meeko"/],
			['[{ name: "x", command: "run" }]', /css\.classProviders\[0\]: campo desconocido command; se admiten name, vscode, languages/],
		] as const) {
			await put(root, 'meeko.config.mjs', `export default { css: { classProviders: ${value} } };\n`)
			await assert.rejects(loadMeekoConfig(root), message)
		}
		// Node caches an imported module by its URL: the invalid one is another file.
		await put(root, 'modules/broken/index.mjs', `export default { [Symbol.for("meeko.module")]: true, meta: { name: "broken" }, setup(_options, meeko) { meeko.addClassProvider({ name: "Tailwind CSS", languages: "tailwindcss" }) } };\n`)
		await put(root, 'meeko.config.mjs', `export default { modules: ["./modules/broken"] };\n`)
		await assert.rejects(resolveMeekoModules(root, await loadMeekoConfig(root)), /El módulo de Meeko broken falló en setup: Módulo de Meeko broken: addClassProvider\.languages debe ser un array de ids/)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

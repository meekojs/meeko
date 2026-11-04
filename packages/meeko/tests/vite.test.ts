import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { build, createLogger, createServer } from 'vite'

import { meeko } from '../src/vite.ts'
import { createTempProject, linkRepositoryPackages } from './helpers/temp-project.ts'

test('Vite carga el mismo componente .meeko en el entorno SSR', async () => {
	const server = await createServer({
		configFile: false,
		plugins: [meeko()],
		server: { middlewareMode: true, hmr: false },
	})
	try {
		const filename = resolve('examples/counter/Counter.meeko')
		const source = await readFile(filename, 'utf8')
		const originalMarker = source.lastIndexOf('doubled.value')
		assert.ok(originalMarker >= 0)
		const originalLine = source.slice(0, originalMarker).split(/\r\n|\r|\n/).length
		const transformed = await server.transformRequest(filename, { ssr: true })
		assert.ok(transformed?.map && 'sources' in transformed.map && transformed.map.sources.some((source) => source.endsWith('Counter.meeko')))
		const marker = transformed?.code.indexOf('doubled.value') ?? -1
		assert.ok(marker >= 0)
		const prior = transformed!.code.slice(0, marker).split('\n')
		assert.equal(mappedLine(transformed!.map!.mappings, prior.length, prior.at(-1)!.length), originalLine)
		const module = (await server.ssrLoadModule(filename)) as { renderToString: (props: { initial: number }) => string; css: string }
		assert.match(module.renderToString({ initial: 4 }), /meeko:text:0-->4/)
		assert.match(module.css, /data-meeko-s-/)
	} finally {
		await server.close()
	}
})

test("a component's CSS is a module beside its file, so PostCSS resolves relative imports", async () => {
	// Tailwind's `@reference` and `@import` resolve from the module id: a virtual id with a null
	// byte made them fail with "path must be … without null bytes".
	const project = await createTempProject('vite-style-')
	const root = project.root
	await linkRepositoryPackages(root)
	const server = await createServer({ root, configFile: false, plugins: [meeko()], server: { middlewareMode: true, hmr: false }, logLevel: 'silent' })
	try {
		await mkdir(join(root, 'components'), { recursive: true })
		await writeFile(join(root, 'components', 'tokens.css'), '.tokens { color: rgb(1, 2, 3); }\n')
		const filename = join(root, 'components', 'Card.meeko')
		await writeFile(filename, `<template><p class="card">x</p></template>\n<style scoped>\n@import "./tokens.css";\n.card { color: red; }\n</style>\n`)
		const component = await server.transformRequest(filename)
		const id = /import "([^"]*\?meeko-style=[0-9a-f]{64}&lang\.css)"/.exec(component?.code ?? '')?.[1]
		assert.ok(id, component?.code)
		const style = await server.transformRequest(id)
		assert.match(style?.code ?? '', /rgb\(1, 2, 3\)/, 'the relative @import is inlined')
		assert.match(style?.code ?? '', /\.card\[data-meeko-s-[0-9a-f]+\]/)
	} finally {
		await server.close()
		await project.remove()
	}
})

test("a component's css export is its stylesheet after PostCSS, in the SSR graph and in the browser", async () => {
	// The SSR document embeds `css` before the client bundle loads: a PostCSS transform (Tailwind's
	// @apply, @utilities) missing there would only apply after hydration.
	const project = await createTempProject('vite-style-inline-')
	const root = project.root
	await linkRepositoryPackages(root)
	const brand = {
		postcssPlugin: 'brand',
		Declaration(declaration: { value: string }) {
			declaration.value = declaration.value.replace('brand()', 'rgb(4, 5, 6)')
		},
	}
	const server = await createServer({ root, configFile: false, plugins: [meeko()], css: { postcss: { plugins: [brand] } }, server: { middlewareMode: true, hmr: false }, logLevel: 'silent' })
	try {
		await mkdir(join(root, 'components'), { recursive: true })
		await writeFile(join(root, 'components', 'tokens.css'), '.tokens { color: rgb(1, 2, 3); }\n')
		const filename = join(root, 'components', 'Card.meeko')
		await writeFile(filename, `<template><p class="card">x</p></template>\n<style scoped>\n@import "./tokens.css";\n.card { color: brand(); }\n</style>\n`)
		const module = (await server.ssrLoadModule(filename)) as { css: string; renderToString: (props: object) => string }
		assert.match(module.css, /rgb\(1, 2, 3\)/, 'the relative @import is inlined')
		assert.match(module.css, /\.card\[data-meeko-s-[0-9a-f]+\]\s*\{\s*color: rgb\(4, 5, 6\)/)
		assert.doesNotMatch(module.css, /@import|brand\(\)/)
		assert.match(module.renderToString({}), /<p class="card" data-meeko-s-[0-9a-f]+/)
		// The browser module exports the same processed CSS (hot updates reapply it) and still
		// imports the stylesheet that Vite injects and bundles.
		const client = await server.transformRequest(filename)
		assert.match(client?.code ?? '', /import "[^"]*\?meeko-style=[0-9a-f]{64}&lang\.css"/)
		const inline = /import \w+ from "([^"]*\?meeko-style=[0-9a-f]{64}&inline&lang\.css)"/.exec(client?.code ?? '')?.[1]
		assert.ok(inline, client?.code)
		assert.match((await server.transformRequest(inline))?.code ?? '', /export default "[^"]*rgb\(4, 5, 6\)/)
	} finally {
		await server.close()
		await project.remove()
	}
})

test("the production client bundle keeps the compiler's css string and runs PostCSS once per component", { timeout: 60_000 }, async () => {
	// Nothing reads `css` in the production client: the processed copy would be dead weight in the
	// page chunks, and its `?inline` module a second PostCSS pass per component.
	const project = await createTempProject('vite-style-client-build-')
	const root = project.root
	await linkRepositoryPackages(root)
	const runs: string[] = []
	const brand = {
		postcssPlugin: 'brand',
		Once(_root: unknown, { result }: { result: { opts: { from?: string | undefined } } }) {
			runs.push(result.opts.from ?? '')
		},
		Declaration(declaration: { value: string }) {
			declaration.value = declaration.value.replace('brand()', 'rgb(4, 5, 6)')
		},
	}
	try {
		const filename = join(root, 'Card.meeko')
		await writeFile(filename, `<template><p class="card">x</p></template>\n<style scoped>\n.card { color: brand(); }\n</style>\n`)
		await writeFile(join(root, 'entry.ts'), 'import * as card from "./Card.meeko";\n(globalThis as Record<string, unknown>).css = card.css;\n')
		const result = await build({
			root,
			configFile: false,
			plugins: [meeko()],
			logLevel: 'silent',
			css: { postcss: { plugins: [brand] } },
			build: { outDir: join(root, 'dist'), write: false, minify: false, rollupOptions: { input: join(root, 'entry.ts') } },
		})
		const outputs = (Array.isArray(result) ? result : [result]) as Array<{ output: Array<{ type: string; fileName: string; code?: string; source?: string | Uint8Array }> }>
		const chunks = outputs.flatMap((entry) => entry.output)
		const code = chunks.map((chunk) => chunk.code ?? '').join('\n')
		const assets = chunks
			.filter((chunk) => chunk.fileName.endsWith('.css'))
			.map((chunk) => String(chunk.source))
			.join('\n')
		// `css` is the compiler's string, before PostCSS; no processed copy and no `?inline` module.
		assert.match(code, /brand\(\)/)
		assert.doesNotMatch(code, /rgb\(4, 5, 6\)|&inline|__meeko_css/)
		// The bundled stylesheet still carries the processed CSS.
		assert.match(assets, /\.card\[data-meeko-s-[0-9a-f]+\]\s*\{\s*color: rgb\(4, 5, 6\)/)
		assert.equal(runs.filter((from) => from.includes('Card.meeko')).length, 1, runs.join('\n'))
	} finally {
		await project.remove()
	}
})

test("a host that does not process CSS (Vitest without css: true) keeps the compiler's css string", async () => {
	// Vitest replaces every CSS module outside `test.css.include` with `export default ""`.
	const project = await createTempProject('vite-style-unprocessed-')
	const root = project.root
	await linkRepositoryPackages(root)
	const emptyCss = { name: 'empty-css', enforce: 'post' as const, transform: (_code: string, id: string) => (/\.css(?:$|\?)/.test(id) ? { code: 'export default ""' } : undefined) }
	const server = await createServer({ root, configFile: false, plugins: [meeko(), emptyCss], server: { middlewareMode: true, hmr: false }, logLevel: 'silent' })
	try {
		const filename = join(root, 'Card.meeko')
		await writeFile(filename, `<template><p class="card">x</p></template>\n<style scoped>\n.card { color: red; }\n</style>\n`)
		const module = (await server.ssrLoadModule(filename)) as { css: string }
		assert.match(module.css, /\.card\[data-meeko-s-[0-9a-f]+\]\s*\{\s*color: red;?\s*\}/)
	} finally {
		await server.close()
		await project.remove()
	}
})

test('a component without a <style> exports an empty css string', async () => {
	const project = await createTempProject('vite-style-none-')
	const root = project.root
	await linkRepositoryPackages(root)
	const server = await createServer({ root, configFile: false, plugins: [meeko()], server: { middlewareMode: true, hmr: false }, logLevel: 'silent' })
	try {
		const filename = join(root, 'Plain.meeko')
		await writeFile(filename, `<template><p>x</p></template>\n`)
		const module = (await server.ssrLoadModule(filename)) as { css: string }
		assert.equal(module.css, '')
		assert.doesNotMatch((await server.transformRequest(filename))?.code ?? '', /meeko-style/)
	} finally {
		await server.close()
		await project.remove()
	}
})

test('an unknown component stylesheet is served empty with a warning, and old ones are released', async () => {
	// A tab from before a restart of `meeko dev` asks for a hash this server never compiled: Vite
	// must not read the .meeko file itself as CSS.
	const project = await createTempProject('vite-style-stale-')
	const root = project.root
	await linkRepositoryPackages(root)
	const warnings: string[] = []
	const customLogger = createLogger('silent')
	customLogger.warn = (message) => {
		warnings.push(message)
	}
	const server = await createServer({ root, configFile: false, plugins: [meeko()], server: { middlewareMode: true, hmr: false }, customLogger })
	try {
		const filename = join(root, 'Card.meeko')
		const styleId = async (color: string): Promise<string> => {
			await writeFile(filename, `<template><p class="card">x</p></template>\n<style scoped>\n.card { color: ${color}; }\n</style>\n`)
			server.moduleGraph.invalidateAll()
			const component = await server.transformRequest(filename)
			const id = /import "([^"]*\?meeko-style=[0-9a-f]{64}&lang\.css)"/.exec(component?.code ?? '')?.[1]
			assert.ok(id, component?.code)
			return id
		}
		const stale = `${filename.replaceAll('\\', '/')}?meeko-style=${'b'.repeat(64)}&lang.css`
		const unknown = await server.transformRequest(stale)
		assert.doesNotMatch(unknown?.code ?? '', /card|template/, 'an empty stylesheet, not the component source')
		assert.ok(
			warnings.some((warning) => /bbbbbbbb ya no existe/.test(warning)),
			JSON.stringify(warnings),
		)
		const first = await styleId('red')
		assert.match((await server.transformRequest(first))?.code ?? '', /color: red/)
		await styleId('green')
		const third = await styleId('blue')
		assert.match((await server.transformRequest(third))?.code ?? '', /color: blue/)
		// Only the last two stylesheets of a file are kept: the first one is gone.
		server.moduleGraph.invalidateAll()
		warnings.length = 0
		assert.doesNotMatch((await server.transformRequest(first))?.code ?? '', /color: red/)
		assert.equal(warnings.length, 1)
	} finally {
		await server.close()
		await project.remove()
	}
})

function mappedLine(mappings: string, line: number, column: number): number | undefined {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
	let sourceLine = 0
	for (const [index, row] of mappings.split(';').entries()) {
		let generatedColumn = 0
		let result: number | undefined
		for (const segment of row.split(',')) {
			if (!segment) continue
			const values: number[] = []
			let bits = 0
			let shift = 0
			for (const char of segment) {
				const digit = alphabet.indexOf(char)
				bits |= (digit & 31) << shift
				if (digit & 32) shift += 5
				else {
					values.push(bits & 1 ? -(bits >> 1) : bits >> 1)
					bits = 0
					shift = 0
				}
			}
			generatedColumn += values[0] ?? 0
			if (values.length > 1) sourceLine += values[2] ?? 0
			if (index + 1 === line && generatedColumn <= column) result = values.length > 1 ? sourceLine + 1 : undefined
		}
		if (index + 1 === line) return result
	}
	return undefined
}

test('Vite rejects a transitive server import in the client graph', async () => {
	const root = await mkdtemp(join(tmpdir(), 'meeko-vite-boundary-'))
	await mkdir(join(root, 'app'))
	await mkdir(join(root, 'app', 'composables'))
	await mkdir(join(root, 'server'))
	await writeFile(join(root, 'app', 'entry.ts'), 'import { secret } from "../server/secret.js"; export const value = secret;')
	await writeFile(join(root, 'app', 'dynamic.ts'), 'export const load = () => import("../server/secret.js");')
	await writeFile(join(root, 'app', 'composables', 'count.ts'), 'export const useCount = () => 1;')
	await writeFile(join(root, 'app', 'auto.ts'), 'export const count = useCount();')
	await writeFile(join(root, 'app', 'browser.client.ts'), 'export const browserOnly = true;')
	await writeFile(join(root, 'server', 'secret.ts'), 'export const secret = "private";')
	await mkdir(join(root, 'layers', 'base', 'app', 'pages'), { recursive: true })
	await mkdir(join(root, 'layers', 'base', 'app', 'composables'), { recursive: true })
	await mkdir(join(root, 'layers', 'base', 'server'), { recursive: true })
	await writeFile(join(root, 'meeko.config.ts'), 'export default { extends: ["./layers/base"] };')
	await writeFile(join(root, 'layers', 'base', 'app', 'composables', 'count.ts'), 'export const layerCount = () => 1;')
	await writeFile(join(root, 'layers', 'base', 'app', 'auto.ts'), 'export const count = layerCount();')
	await writeFile(join(root, 'layers', 'base', 'server', 'secret.ts'), 'export const layerSecret = "private";')
	await writeFile(join(root, 'app', 'layer-import.ts'), 'import { layerSecret } from "../layers/base/server/secret.js"; export const value = layerSecret;')
	const server = await createServer({ root, configFile: false, plugins: [meeko()], server: { middlewareMode: true, hmr: false } })
	try {
		await assert.rejects(server.transformRequest('/app/entry.ts'), /server-only module/)
		await assert.rejects(server.transformRequest('/app/dynamic.ts'), /server-only module/)
		await assert.rejects(server.transformRequest('/app/layer-import.ts'), /server-only module/)
		await assert.rejects(server.transformRequest('/layers/base/server/secret.ts'), /Server-only module/)
		const auto = await server.transformRequest('/app/auto.ts')
		assert.match(auto?.code ?? '', /import.*useCount/)
		const layerAuto = await server.transformRequest('/layers/base/app/auto.ts')
		assert.match(layerAuto?.code ?? '', /import.*layerCount/)
		await assert.rejects(server.transformRequest('/app/browser.client.ts', { ssr: true }), /Client-only module/)
	} finally {
		await server.close()
		await rm(root, { recursive: true, force: true })
	}
})

test('Vite reloads routes and autoimports in a configured source directory', async () => {
	const root = await mkdtemp(join(tmpdir(), 'meeko-vite-configured-hmr-'))
	try {
		await mkdir(join(root, 'vendor', 'base', 'app', 'pages'), { recursive: true })
		await mkdir(join(root, 'vendor', 'base', 'app', 'composables'), { recursive: true })
		await writeFile(join(root, 'meeko.config.ts'), 'export default { extends: ["./vendor/base"] };')
		const sent: unknown[] = []
		let invalidations = 0
		const plugin = meeko() as unknown as {
			configResolved(config: { root: string; command: 'serve'; build: { ssr: false } }): void
			handleHotUpdate(context: { file: string; server: { moduleGraph: { invalidateAll(): void }; ws: { send(message: unknown): void } } }): Promise<unknown> | unknown
		}
		plugin.configResolved({ root, command: 'serve', build: { ssr: false } })
		const server = {
			moduleGraph: {
				invalidateAll: () => {
					invalidations++
				},
			},
			ws: {
				send: (message: unknown) => {
					sent.push(message)
				},
			},
		}
		for (const file of [
			join(root, 'vendor', 'base', 'app', 'pages', 'index.meeko'),
			join(root, 'vendor', 'base', 'app', 'composables', 'useLayer.ts'),
		]) {
			assert.deepEqual(await plugin.handleHotUpdate({ file, server }), [])
		}
		assert.equal(invalidations, 2)
		assert.deepEqual(sent, [{ type: 'full-reload' }, { type: 'full-reload' }])
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

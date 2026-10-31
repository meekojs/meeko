import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

test('esbuild preserves module identity, runtime resources, CLI headers and NodeNext declarations', async () => {
	const temporaryRoot = resolve('.meeko/build-tests')
	await mkdir(temporaryRoot, { recursive: true })
	const root = await mkdtemp(join(temporaryRoot, 'package-'))
	try {
		await mkdir(join(root, 'src/nested'), { recursive: true })
		await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
		await writeFile(
			join(root, 'tsconfig.json'),
			JSON.stringify({
				compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', declaration: true, strict: true, skipLibCheck: true, types: [], rootDir: 'src', outDir: 'dist' },
				include: ['src/**/*.ts'],
			}),
		)
		await writeFile(join(root, 'src/state.ts'), 'export const state = { count: 0 }; export interface State { count: number }')
		await writeFile(join(root, 'src/index.ts'), 'export { state } from "./state"; export type { State } from "./state"; export type Other = import("./state").State;')
		await writeFile(join(root, 'src/nested/index.ts'), 'import { state } from "../state"; export { state }; export const resource = new URL("./resource.txt", import.meta.url);')
		await writeFile(join(root, 'src/cli.ts'), '#!/usr/bin/env node\nexport { state } from "./state.js";')
		execFileSync(process.execPath, [resolve('scripts/build-package.mjs'), root], { stdio: 'pipe', windowsHide: true })
		await writeFile(join(root, 'dist/nested/resource.txt'), 'resource')
		const entry = await import(pathToFileURL(join(root, 'dist/index.js')).href)
		const nested = await import(pathToFileURL(join(root, 'dist/nested/index.js')).href)
		const cli = await import(pathToFileURL(join(root, 'dist/cli.js')).href)
		assert.equal(entry.state, nested.state)
		assert.equal(entry.state, cli.state)
		assert.equal(await readFile(nested.resource, 'utf8'), 'resource')
		assert.match(await readFile(join(root, 'dist/cli.js'), 'utf8'), /^#!\/usr\/bin\/env node/)
		const declaration = await readFile(join(root, 'dist/index.d.ts'), 'utf8')
		assert.match(declaration, /from "\.\/state\.js"/)
		assert.match(declaration, /import\("\.\/state\.js"\)/)
		await writeFile(join(root, 'consumer.ts'), 'import { state, type Other } from "./dist/index.js"; import { state as nested } from "./dist/nested/index.js"; const value: Other = nested; state.count = value.count;')
		const compiler = resolve('node_modules/typescript/bin/tsc6')
		execFileSync(process.execPath, [compiler, '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', join(root, 'consumer.ts')], { stdio: 'pipe', windowsHide: true })
	} finally {
		// root is created by mkdtemp inside the fixed workspace-owned temporaryRoot.
		assert.equal(root.startsWith(temporaryRoot + '\\') || root.startsWith(temporaryRoot + '/'), true)
		await rm(root, { recursive: true, force: true })
	}
})

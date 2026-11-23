import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { checkSource } from '../src/check.ts'
import { generateFrameworkTsconfigs } from '../src/framework/type-declarations.ts'
import { linkRepositoryPackages, tempProject } from './helpers/temp-project.ts'

interface GeneratedTsconfig {
	compilerOptions: Record<string, unknown>
}

async function project(context: { after(fn: () => Promise<void>): void }, config: string): Promise<string> {
	const root = await tempProject(context, 'typescript-options')
	await writeFile(join(root, 'package.json'), `${JSON.stringify({ name: 'typescript-options', private: true, type: 'module' })}\n`)
	await writeFile(join(root, 'meeko.config.mjs'), config)
	await mkdir(join(root, 'app', 'pages'), { recursive: true })
	await writeFile(join(root, 'app', 'pages', 'index.meeko'), '<template><p>ok</p></template>\n')
	return root
}

async function generated(root: string, name: 'app' | 'server' | 'shared'): Promise<GeneratedTsconfig> {
	return JSON.parse(await readFile(join(root, '.meeko', `tsconfig.${name}.json`), 'utf8')) as GeneratedTsconfig
}

test('typescript.compilerOptions changes the rigor and the language version of the three generated tsconfigs', async (context) => {
	const root = await project(context, 'export default { typescript: { compilerOptions: { target: "ES2023", lib: ["ES2023", "DOM"], exactOptionalPropertyTypes: false, noUncheckedIndexedAccess: false, noUnusedLocals: true } } };\n')
	await generateFrameworkTsconfigs(root)
	for (const name of ['app', 'server', 'shared'] as const) {
		const { compilerOptions } = await generated(root, name)
		assert.equal(compilerOptions.target, 'ES2023', name)
		assert.deepEqual(compilerOptions.lib, ['ES2023', 'DOM'], name)
		assert.equal(compilerOptions.exactOptionalPropertyTypes, false, name)
		assert.equal(compilerOptions.noUncheckedIndexedAccess, false, name)
		assert.equal(compilerOptions.noUnusedLocals, true, name)
		// What Meeko needs to compile stays its own.
		assert.equal(compilerOptions.moduleResolution, 'Bundler', name)
		assert.equal(compilerOptions.strict, true, name)
	}
})

test('without typescript the generated tsconfigs keep Meeko defaults', async (context) => {
	const root = await project(context, 'export default {};\n')
	await generateFrameworkTsconfigs(root)
	const { compilerOptions } = await generated(root, 'server')
	assert.equal(compilerOptions.target, 'ES2022')
	assert.equal(compilerOptions.exactOptionalPropertyTypes, true)
	assert.equal(compilerOptions.noUncheckedIndexedAccess, true)
})

test('an option Meeko owns, an unknown field or a wrong value stop with a clear error', async (context) => {
	const cases: Array<[string, RegExp]> = [
		['{ compilerOptions: { moduleResolution: "Node" } }', /typescript\.compilerOptions\.moduleResolution no se puede cambiar/],
		['{ compilerOptions: { paths: {} } }', /typescript\.compilerOptions\.paths no se puede cambiar/],
		['{ tsconfig: "x" }', /typescript: campo desconocido tsconfig/],
		['{ compilerOptions: { exactOptionalPropertyTypes: "no" } }', /exactOptionalPropertyTypes debe ser true o false/],
		['{ compilerOptions: { lib: [] } }', /lib debe ser un array no vacío de textos/],
		['"strict"', /typescript debe ser un objeto/],
	]
	for (const [value, message] of cases) {
		const root = await project(context, `export default { typescript: ${value} };\n`)
		await assert.rejects(generateFrameworkTsconfigs(root), message, value)
	}
})

test('a component checked alone follows typescript.compilerOptions, as the whole project does', async (context) => {
	// Reading an index without a check is an error under Meeko's default noUncheckedIndexedAccess.
	const source = '<script lang="ts">\n\tconst names: string[] = ["Ada"]\n\tconst first: string = names[0]\n</script>\n<template><p>{first}</p></template>\n'
	const strict = await project(context, 'export default {};\n')
	await generateFrameworkTsconfigs(strict)
	const file = join(strict, 'app', 'pages', 'index.meeko')
	await writeFile(file, source)
	assert.ok((await checkSource(source, file)).some((diagnostic) => diagnostic.code === 'TS2322'))

	const relaxed = await project(context, 'export default { typescript: { compilerOptions: { noUncheckedIndexedAccess: false } } };\n')
	await generateFrameworkTsconfigs(relaxed)
	const relaxedFile = join(relaxed, 'app', 'pages', 'index.meeko')
	await writeFile(relaxedFile, source)
	// The temporary project has no node_modules: only the index read matters here.
	assert.equal((await checkSource(source, relaxedFile)).filter((diagnostic) => diagnostic.code === 'TS2322').length, 0)
})

test('a component checked alone in a project without vite or @types/node gets its diagnostics, not a global TS2688', async (context) => {
	// Outside the repository, with only @meekojs/meeko linked: the generated tsconfig lists `node`
	// and `vite/client`, which nothing here resolves.
	const root = await mkdtemp(join(tmpdir(), 'meeko-missing-types-'))
	const link = join(root, 'node_modules', '@meekojs', 'meeko')
	// The link goes first, so removing the project never walks into the package.
	context.after(async () => {
		await unlink(link).catch(() => undefined)
		await rm(root, { recursive: true, force: true })
	})
	await linkRepositoryPackages(root)
	await writeFile(join(root, 'package.json'), `${JSON.stringify({ name: 'missing-types', private: true, type: 'module' })}\n`)
	await writeFile(join(root, 'meeko.config.mjs'), 'export default {};\n')
	await mkdir(join(root, 'app', 'pages'), { recursive: true })
	await generateFrameworkTsconfigs(root)
	assert.deepEqual((await generated(root, 'app')).compilerOptions.types, ['node', 'vite/client'])
	const source = '<script lang="ts">\n\tconst count: number = "one"\n</script>\n<template><p>{count}</p></template>\n'
	const file = join(root, 'app', 'pages', 'index.meeko')
	await writeFile(file, source)
	const diagnostics = await checkSource(source, file)
	assert.deepEqual(
		diagnostics.map((diagnostic) => diagnostic.code),
		['TS2322'],
		JSON.stringify(diagnostics.map((diagnostic) => `${diagnostic.code} ${diagnostic.message}`)),
	)
})

import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { generateFrameworkTsconfigs } from '../src/framework/type-declarations.ts'
import { tempProject } from './helpers/temp-project.ts'

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

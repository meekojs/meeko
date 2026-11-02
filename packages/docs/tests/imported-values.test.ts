import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { tsImport } from 'tsx/esm/api'

import { importedValues } from '../src/imported-values'

/** A directory with `files`, and the function that reads the values of `source` as the transform does. */
async function project(context: { after(fn: () => Promise<void>): void }, files: Record<string, string>) {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'meeko-docs-values-')))
	context.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
	await writeFile(join(root, 'package.json'), '{ "type": "module" }\n')
	for (const [name, text] of Object.entries(files)) await writeFile(join(root, name), text)
	const watched = new Set<string>()
	let loads = 0
	const read = (source = "import { examples } from './data'\n") =>
		importedValues(
			source,
			join(root, 'page.meeko'),
			(module) => {
				loads++
				return tsImport(module, import.meta.url)
			},
			(file) => watched.add(file),
		)
	let tick = Date.now()
	/** Writes `name` with a later modification time, whatever the resolution of the file system. */
	const edit = async (name: string, text: string) => {
		await writeFile(join(root, name), text)
		tick += 10_000
		await utimes(join(root, name), new Date(tick), new Date(tick))
	}
	return { root, read, edit, watched, loads: () => loads }
}

const code = async (values: Promise<Map<string, unknown>>) => (await values).get('examples') as { readonly code: string }

test('a change of a file the data module imports reaches the values, and it is watched', { timeout: 60_000 }, async (context) => {
	const { root, read, edit, watched, loads } = await project(context, {
		'base.ts': "export const examples = { code: 'before' }\n",
		'data.ts': "export { examples } from './base'\n",
	})
	assert.equal((await code(read())).code, 'before')
	assert.deepEqual([...watched].sort(), [join(root, 'base.ts'), join(root, 'data.ts')])
	await edit('base.ts', "export const examples = { code: 'after' }\n")
	assert.equal((await code(read())).code, 'after')
	assert.equal(loads(), 2)
})

test('nothing is read again while no file of the chain changes', { timeout: 60_000 }, async (context) => {
	const { read, loads } = await project(context, {
		'base.ts': "export const examples = { code: 'same' }\n",
		'data.ts': "import { examples as base } from './base'\nexport const examples = { ...base }\n",
	})
	await read()
	await read()
	assert.equal(loads(), 1)
})

test('the whole chain counts, in every form of import, and a cycle ends', { timeout: 60_000 }, async (context) => {
	const { root, read, edit, watched } = await project(context, {
		'data.ts': `import {
	first,
} from "./first"
import * as second from './second.js'
export * from './third.ts'
import './side'
export const examples = { code: first + second.value + (await import('./fourth')).value }
`,
		'first.ts': "export { value as first } from './nested/index'\n",
		'second.ts': "export const value = 'b'\n",
		'third.ts': "import { examples } from './data'\nexport const third = () => examples\n",
		'side.ts': 'export {}\n',
		'fourth.ts': "import value from './deep/fourth-value'\nexport { value }\n",
	})
	await mkdir(join(root, 'nested'))
	await mkdir(join(root, 'deep'))
	await writeFile(join(root, 'nested', 'index.ts'), "export const value = 'a'\n")
	await writeFile(join(root, 'deep', 'fourth-value.ts'), "export default 'c'\n")
	assert.equal((await code(read())).code, 'abc')
	assert.deepEqual([...watched].sort(), ['data.ts', 'deep/fourth-value.ts', 'first.ts', 'fourth.ts', 'nested/index.ts', 'second.ts', 'side.ts', 'third.ts'].map((name) => join(root, ...name.split('/'))).sort())
	await edit('deep/fourth-value.ts', "export default 'z'\n")
	assert.equal((await code(read())).code, 'abz')
	await edit('nested/index.ts', "export const value = 'y'\n")
	assert.equal((await code(read())).code, 'ybz')
})

test('a text that looks like an import is harmless: the code of an example is data', { timeout: 60_000 }, async (context) => {
	const { root, read, watched } = await project(context, {
		'data.ts': "export const examples = { code: `import { x } from './does-not-exist'\\nimport y from 'package'` }\n",
	})
	assert.match((await code(read())).code, /does-not-exist/)
	assert.deepEqual([...watched], [join(root, 'data.ts')])
})

test('a file the chain needs, created later, reads the module again', { timeout: 60_000 }, async (context) => {
	const { read, edit } = await project(context, { 'data.ts': "export { examples } from './base'\n" })
	await assert.rejects(read())
	await edit('base.ts', "export const examples = { code: 'created' }\n")
	assert.equal((await code(read())).code, 'created')
})

test('an import of the component that is not a script is left alone', { timeout: 60_000 }, async (context) => {
	const { read, loads } = await project(context, { 'Badge.meeko': '<template><b /></template>\n' })
	assert.deepEqual([...(await read("import { Badge } from './Badge.meeko'\n")).keys()], [])
	assert.equal(loads(), 0)
})

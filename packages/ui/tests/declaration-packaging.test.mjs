import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { rebaseComponentDeclaration } from '../../../scripts/rebase-component-declaration.mjs'

test('relocating component declarations rewrites only relative module specifiers and emits NodeNext extensions', async (context) => {
	const root = fileURLToPath(new URL('../.meeko/', import.meta.url))
	await mkdir(root, { recursive: true })
	const directory = await mkdtemp(join(root, 'declaration-rebase-'))
	context.after(() => rm(directory, { recursive: true, force: true }))
	const generated = join(directory, '.meeko/types/dist/app/components/Card.d.meeko.ts')
	const destination = join(directory, 'dist/app/components/Card.d.meeko.ts')
	const typeFile = join(directory, 'dist/app/types/card.d.ts')
	await mkdir(dirname(typeFile), { recursive: true })
	await writeFile(typeFile, 'export type Size = "sm" | "lg";')
	const specifier = '../../../../../dist/app/types/card'
	const original = `import type { Size } from '${specifier}';\nexport type { Size } from '${specifier}';\nexport type Inline = import('${specifier}').Size;\nimport type * as Child from './Child.meeko';\nexport type Text = '${specifier}';\nimport type { Signal } from '@meekojs/meeko';\n`
	const relocated = rebaseComponentDeclaration(original, generated, destination)
	assert.equal((relocated.match(/from '\.\.\/types\/card\.js'/g) ?? []).length, 2)
	assert.match(relocated, /import\('\.\.\/types\/card\.js'\)/)
	assert.ok(relocated.includes("from './Child.meeko'"))
	assert.ok(relocated.includes(`export type Text = '${specifier}'`))
	assert.ok(relocated.includes("from '@meekojs/meeko'"))
})

test('all shipped component declarations resolve in strict NodeNext without skipLibCheck', async () => {
	const declaration = await readFile(new URL('../dist/app/components/Modal.d.meeko.ts', import.meta.url), 'utf8')
	assert.match(declaration, /from ['"]\.\.\/types\/modal\.js['"]/)
	const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
	execFileSync(process.execPath, [tsc, '--ignoreConfig', '--noEmit', '--strict', '--allowImportingTsExtensions', '--allowArbitraryExtensions', '--target', 'es2022', '--module', 'nodenext', '--moduleResolution', 'nodenext', resolve(fileURLToPath(new URL('./types/declarations.ts', import.meta.url)))], { stdio: 'pipe' })
})

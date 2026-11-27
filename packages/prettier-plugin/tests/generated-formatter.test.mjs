import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import test from 'node:test'

import * as corePackaging from '../../meeko/dist/formatters/prettier/packaging.js'
import * as packaging from '../dist/packaging.js'
import { generatedFiles, generateModule, staleModules, targetDirectory } from '../scripts/generate-formatter.mjs'

// The formatter has one source, packages/meeko/src/formatters/prettier; this package publishes a copy
// that `build` and `check` regenerate. These tests catch a copy edited by hand or left behind, and a
// fork of the logic in this package outside the generated files.

test('the generated copies match the source of the core', async () => {
	assert.deepEqual(await staleModules(), [], 'run: pnpm -F @meekojs/prettier-plugin run formatter:generate')
})

test('src only has the generated copies, the entry point and packaging.ts', async () => {
	const files = (await readdir(targetDirectory)).sort()
	assert.deepEqual(files, ['index.ts', 'packaging.ts', ...Object.values(generatedFiles)].sort())
})

test('the build published every generated module', async () => {
	const built = await readdir(new URL('../dist/', import.meta.url))
	for (const file of Object.values(generatedFiles)) assert.ok(built.includes(file.replace(/\.ts$/, '.js')), file)
})

test('the packaging module of the plugin exports what the one of the core exports', () => {
	assert.deepEqual(Object.keys(packaging).sort(), Object.keys(corePackaging).sort())
	for (const name of Object.keys(corePackaging)) assert.equal(typeof packaging[name], typeof corePackaging[name], name)
	// The markers differ on purpose: the core, last in the language server, delegates to this printer.
	assert.notEqual(packaging.ownPrinterMarker, corePackaging.ownPrinterMarker)
	assert.deepEqual(corePackaging.foreignPrinterMarkers, [])
	assert.deepEqual(packaging.foreignPrinterMarkers, [corePackaging.ownPrinterMarker])
})

test('the copy only rewrites imports between shared modules and the name of the package in the docs', () => {
	const source = "import type { A } from './classes'\nimport { b } from './packaging'\n/** `plugins: [\"@meekojs/meeko/prettier\"]` */\nexport const c = import('./template')\r\n"
	const copy = generateModule(source, 'arrays.ts')
	assert.match(copy, /^\/\/ Generado por scripts\/generate-formatter\.mjs desde packages\/meeko\/src\/formatters\/prettier\/arrays\.ts/)
	assert.ok(copy.endsWith("import type { A } from './classes.generated'\nimport { b } from './packaging'\n/** `plugins: [\"@meekojs/prettier-plugin\"]` */\nexport const c = import('./template.generated')\n"))
})

test('the copy rejects a private module of the core', () => {
	assert.throws(() => generateModule("import { clean } from '../../framework/clean'\n", 'classes.ts'), /classes\.ts importa \.\.\/\.\.\/framework\/clean/)
	assert.throws(() => generateModule("import { editor } from './editor'\n", 'plugin.ts'), /plugin\.ts importa \.\/editor/)
})

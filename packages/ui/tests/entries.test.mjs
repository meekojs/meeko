import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

// A virtual module exists only inside a Meeko build: a public entry that imports one statically
// breaks any tool that loads the package in plain Node. `app/plugins/modal.ts` may import one: it
// is not a public entry, and only reaches a build through `addPlugin`.
for (const entry of Object.keys(manifest.exports).filter((name) => !name.endsWith('.css'))) {
	test(`${manifest.name}${entry.slice(1)} loads in plain Node`, async () => {
		const specifier = manifest.name + entry.slice(1)
		assert.equal(typeof (await import(specifier)), 'object')
	})
}

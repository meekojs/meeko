import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import test from 'node:test'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

// A virtual module exists only inside a Meeko build: a public entry that imports one statically
// breaks any tool that loads the package in plain Node. `app/plugins/modal.ts` may import one: it
// is not a public entry, and only reaches a build through `addPlugin`. A stylesheet, such as
// `@meekojs/ui/hues`, is for the `@import` of a CSS file, not for Node, and the manifest is data.
const data = (name) => name.endsWith('.css') || name.endsWith('.json') || String(manifest.exports[name]).endsWith('.css')
for (const entry of Object.keys(manifest.exports).filter((name) => !data(name))) {
	test(`${manifest.name}${entry.slice(1)} loads in plain Node`, async () => {
		const specifier = manifest.name + entry.slice(1)
		assert.equal(typeof (await import(specifier)), 'object')
	})
}

// Tools that resolve the CSS entry by hand read the manifest: `@meekojs/ui/package.json` must be
// exported, and its `style` condition must name the sheet.
test(`${manifest.name}/package.json is exported, and its style condition names the CSS entry`, async () => {
	const require = createRequire(import.meta.url)
	const path = require.resolve(`${manifest.name}/package.json`)
	const exported = JSON.parse(await readFile(path, 'utf8'))
	assert.equal(exported.name, manifest.name)
	const style = exported.exports['.'].style
	assert.equal(typeof style, 'string')
	const sheet = join(dirname(path), style)
	assert.ok(sheet.endsWith('.css') && existsSync(sheet), sheet)
	assert.match(await readFile(sheet, 'utf8'), /@source/)
})

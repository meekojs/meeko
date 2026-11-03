import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

interface Manifest {
	contributes: {
		grammars: Array<{ path: string }>
		languages: Array<{ configuration?: string }>
		snippets: Array<{ path: string }>
	}
}

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest
const script = readFileSync(join(root, 'package-vsix.ps1'), 'utf8')

/** The names that `package-vsix.ps1` copies into the folder it packages. vsce only sees that folder. */
function stagedNames(): string[] {
	const lists = [...script.matchAll(/foreach \(\$name in @\(([^)]*)\)\) \{\s*Copy-Item/g)]
	assert.ok(lists.length > 0, 'package-vsix.ps1 no longer copies its files with this loop')
	return lists.flatMap((list) => [...list[1]!.matchAll(/'([^']+)'/g)].map((name) => name[1]!))
}

test('every file that contributes declares is copied into the VSIX', () => {
	const { grammars, languages, snippets } = manifest.contributes
	const paths = [...grammars.map((item) => item.path), ...snippets.map((item) => item.path), ...languages.flatMap((item) => item.configuration ?? [])]
	assert.ok(paths.length >= 4, `Expected the grammar, the two snippet files and the language configuration: ${paths.join(', ')}`)
	const staged = stagedNames()
	for (const path of paths) {
		const first = path.replace(/^\.\//, '').split('/')[0]!
		assert.ok(staged.includes(first), `${path} is declared in contributes but package-vsix.ps1 does not copy ${first}`)
	}
})

test('the packaging fails if a contributed file is missing from the VSIX', () => {
	assert.match(script, /contributes\.snippets\.path/)
	assert.match(script, /que declara contributes/)
})

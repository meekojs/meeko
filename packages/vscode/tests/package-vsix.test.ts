import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import { stagedFiles, stagedFolders } from '../package-vsix.mjs'
import { resolveManifestVersions } from '../scripts/resolve-manifest-versions.mjs'
import { setExecutable, zipEntries, zipEntry } from '../scripts/vsix-archive.mjs'

interface Manifest {
	contributes: {
		grammars: Array<{ path: string }>
		languages: Array<{ configuration?: string }>
		snippets: Array<{ path: string }>
	}
}

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest
const script = readFileSync(join(root, 'package-vsix.mjs'), 'utf8')

/** A ZIP with one stored entry, as vsce writes them: local header, data and central directory. */
function storedZip(name: string, content: string): Buffer {
	const data = Buffer.from(content)
	const fileName = Buffer.from(name)
	const local = Buffer.alloc(30)
	local.writeUInt32LE(0x04034b50, 0)
	local.writeUInt32LE(data.length, 18)
	local.writeUInt32LE(data.length, 22)
	local.writeUInt16LE(fileName.length, 26)
	const directory = Buffer.alloc(46)
	directory.writeUInt32LE(0x02014b50, 0)
	directory.writeUInt32LE(data.length, 20)
	directory.writeUInt32LE(data.length, 24)
	directory.writeUInt16LE(fileName.length, 28)
	directory.writeUInt32LE((0o100644 << 16) >>> 0, 38)
	const directoryOffset = local.length + fileName.length + data.length
	const end = Buffer.alloc(22)
	end.writeUInt32LE(0x06054b50, 0)
	end.writeUInt16LE(1, 8)
	end.writeUInt16LE(1, 10)
	end.writeUInt32LE(directory.length + fileName.length, 12)
	end.writeUInt32LE(directoryOffset, 16)
	return Buffer.concat([local, fileName, data, directory, fileName, end])
}

test('every file that contributes declares is copied into the VSIX', () => {
	const { grammars, languages, snippets } = manifest.contributes
	const paths = [...grammars.map((item) => item.path), ...snippets.map((item) => item.path), ...languages.flatMap((item) => item.configuration ?? [])]
	assert.ok(paths.length >= 4, `Expected the grammar, the two snippet files and the language configuration: ${paths.join(', ')}`)
	const staged = [...stagedFiles, ...stagedFolders]
	for (const path of paths) {
		const first = path.replace(/^\.\//, '').split('/')[0]!
		assert.ok(staged.includes(first), `${path} is declared in contributes but package-vsix.mjs does not copy ${first}`)
	}
})

test('the manifest translations and the l10n bundles are copied into the VSIX', () => {
	const translations = readdirSync(root).filter((name) => /^package\.nls(?:\.[\w-]+)?\.json$/.test(name))
	assert.deepEqual(translations.sort(), ['package.nls.es.json', 'package.nls.json'])
	for (const name of translations) assert.ok(stagedFiles.includes(name), `package-vsix.mjs does not copy ${name}`)
	const bundles = (manifest as unknown as { l10n?: string }).l10n
	assert.equal(bundles, './l10n')
	assert.ok(stagedFolders.includes('l10n'), 'package-vsix.mjs does not copy l10n')
	assert.ok(readdirSync(join(root, 'l10n')).includes('bundle.l10n.es.json'))
	// .vscodeignore excludes sources and tests, never the translations.
	const ignored = readFileSync(join(root, '.vscodeignore'), 'utf8').split(/\r?\n/)
	assert.deepEqual(
		ignored.filter((line) => /^(?:l10n|package\.nls)/.test(line)),
		[],
	)
	assert.match(script, /que necesita la localización/)
})

test('the staged manifest has no pnpm protocols that npm and vsce reject', () => {
	assert.match(script, /scripts\/resolve-manifest-versions\.mjs/)
	// npm would resolve the development dependencies too, and none of them ships in the VSIX.
	assert.match(script, /delete staged\.devDependencies/)
	const staged = structuredClone(manifest) as unknown as Record<string, unknown>
	const resolved = resolveManifestVersions(staged, (name) => `0.0.0-${name}`)
	assert.ok(resolved.includes('typescript'), 'typescript should come from the pnpm catalog')
	assert.doesNotMatch(JSON.stringify(staged), /"(?:catalog|workspace):/)
	assert.equal((staged['dependencies'] as Record<string, string>)['typescript'], '0.0.0-typescript')
})

test('the packaging fails if a contributed file is missing from the VSIX', () => {
	assert.match(script, /manifest\.contributes/)
	assert.match(script, /que declara contributes/)
})

test('the VSIX reader lists entries, reads their content and marks the TypeScript binary executable', () => {
	const archive = storedZip('extension/node_modules/@typescript/typescript-linux-x64/lib/tsc', 'binary')
	const [entry] = zipEntries(archive)
	assert.equal(entry?.mode, 0o644)
	assert.equal(zipEntry(archive, entry!.name)?.toString(), 'binary')
	assert.equal(zipEntry(archive, 'missing'), undefined)
	setExecutable(archive, entry!.name)
	assert.equal(zipEntries(archive)[0]?.mode, 0o755)
	assert.throws(() => setExecutable(archive, 'missing'), /se esperaba una/)
})

test('the PowerShell entry points forward to the Node scripts that CI and the README use', () => {
	const packageScripts = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts
	assert.equal(packageScripts['package:vsix'], 'node package-vsix.mjs')
	assert.equal(packageScripts['install:local'], 'node install-local.mjs')
	assert.match(readFileSync(join(root, 'package-vsix.ps1'), 'utf8'), /package-vsix\.mjs[\s\S]*--skip-build/)
	assert.match(readFileSync(join(root, 'install-local.ps1'), 'utf8'), /install-local\.mjs[\s\S]*--use-existing-vsix/)
})

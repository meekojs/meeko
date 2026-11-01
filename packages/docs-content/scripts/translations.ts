// The translations of the documentation from Git, without the database: their status and the
// `source-hash` that a translator writes.
//
//   pnpm -F meeko-docs-content translations                    status of every page (translated, outdated, missing)
//   pnpm -F meeko-docs-content translations -- --status missing  only the pages in that status
//   pnpm -F meeko-docs-content translations -- stamp docs/en/framework.md [...]
//                                                              writes the hash of the original now
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { TranslationStatus } from '../src/locale'

import { originalFile, readTranslation, stampTranslation, translationFile } from '../src/content/i18n'
import { taxonomyPath } from '../src/content/reference-taxonomy'
import { gitFileExists, readGitFile, repositoryRoot } from '../src/content/repository'
import { translationStatus, translationStatuses } from '../src/locale'
import { guideSources, referenceSources } from '../src/sources/discover'
import { contentHash, normalizeSourcePath } from '../src/sources/overlay'

/** A JSON translation (the taxonomy) declares its hash as a `source-hash` property. */
function jsonSourceHash(text: string): string | null {
	try {
		const value = (JSON.parse(text) as Record<string, unknown>)['source-hash']
		return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : null
	} catch {
		return null
	}
}

function status(filter: string | undefined): void {
	if (filter !== undefined && !translationStatuses.includes(filter as TranslationStatus)) throw new Error(`--status is one of ${translationStatuses.join(', ')}`)
	const originals = [...guideSources(), ...referenceSources()].map((source) => source.file!)
	originals.push(taxonomyPath)
	const counts: Record<TranslationStatus, number> = { translated: 0, outdated: 0, missing: 0 }
	const rows: string[] = []
	for (const original of originals) {
		const file = translationFile(original, 'en')
		if (file === null) continue
		const exists = gitFileExists(file)
		const text = exists ? readGitFile(file) : ''
		const sourceHash = exists ? (file.endsWith('.json') ? jsonSourceHash(text) : readTranslation(text).sourceHash) : null
		const state = translationStatus(exists ? { sourceHash } : null, contentHash(readGitFile(original)))
		counts[state]++
		// A NUL byte is never text: the site shows it as U+FFFD.
		const nul = text.includes('\0') ? '  (contains a NUL byte)' : ''
		if (filter === undefined || filter === state || nul) rows.push(`${state.padEnd(10)} ${file}  ←  ${original}${nul}`)
	}
	console.log(rows.join('\n'))
	console.log(`\n${counts.translated} translated, ${counts.outdated} outdated, ${counts.missing} missing of ${originals.length}`)
}

function stamp(files: readonly string[]): void {
	if (!files.length) throw new Error('stamp needs the translation files, such as docs/en/framework.md')
	for (const given of files) {
		const file = normalizeSourcePath(given)
		const original = originalFile(file)
		if (original === null) throw new Error(`${file} is not a translation: they live in docs/en/`)
		if (!gitFileExists(original)) throw new Error(`${file}: its original ${original} does not exist`)
		const hash = contentHash(readGitFile(original))
		const path = join(repositoryRoot(), ...file.split('/'))
		const text = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n')
		const stamped = file.endsWith('.json') ? `${JSON.stringify({ ...(JSON.parse(text) as Record<string, unknown>), 'source-hash': hash }, null, '\t')}\n` : stampTranslation(text, hash)
		writeFileSync(path, stamped)
		console.log(`${file}: source-hash ${hash} (${original})`)
	}
}

const args = process.argv.slice(2).filter((arg) => arg !== '--')
try {
	if (args[0] === 'stamp') stamp(args.slice(1))
	else {
		const at = args.indexOf('--status')
		status(at < 0 ? undefined : args[at + 1])
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error))
	process.exitCode = 1
}

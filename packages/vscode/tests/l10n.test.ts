import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { afterEach, test } from 'node:test'

import { format, setTranslator, t } from '../src/l10n'
import { serverStatus } from '../src/status'

const root = resolve(import.meta.dirname, '..')
const json = (name: string): Record<string, string> => JSON.parse(readFileSync(join(root, name), 'utf8')) as Record<string, string>

/** Every `%key%` of the manifest, wherever it is. */
function manifestKeys(value: unknown, found = new Set<string>()): Set<string> {
	if (typeof value === 'string') {
		const key = /^%(.+)%$/.exec(value)?.[1]
		if (key) found.add(key)
	} else if (value && typeof value === 'object') {
		for (const item of Object.values(value)) manifestKeys(item, found)
	}
	return found
}

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? sourceFiles(join(directory, entry.name)) : entry.name.endsWith('.ts') ? [join(directory, entry.name)] : []))
}

/** A call of `t`: not a method, nor the end of a longer identifier. */
const call = /(?<![\w$.])t\(/g
/** The same call with its message: a single- or double-quoted literal on the same line. */
const literalCall = /(?<![\w$.])t\(\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")\s*[,)]/g

/** Value of a quoted literal with the escapes that the messages use. */
function literalValue(literal: string): string {
	return literal.slice(1, -1).replace(/\\(.)/g, (_, char: string) => (char === 'n' ? '\n' : char))
}

/** Messages passed to `t` in `src/**`, with the files that use them. */
function sourceMessages(): Map<string, string[]> {
	const messages = new Map<string, string[]>()
	for (const file of sourceFiles(join(root, 'src'))) {
		const name = relative(root, file).replaceAll('\\', '/')
		if (name === 'src/l10n.ts') continue
		const source = readFileSync(file, 'utf8')
		assert.doesNotMatch(source, /\bl10n\.t\(/, `${name} calls vscode.l10n.t directly; use t from src/l10n.ts`)
		const literals = [...source.matchAll(literalCall)].map((match) => literalValue(match[1]!))
		assert.equal(literals.length, [...source.matchAll(call)].length, `${name}: every t(...) takes a quoted string literal as its first argument`)
		for (const message of literals) messages.set(message, [...(messages.get(message) ?? []), name])
	}
	return messages
}

const placeholders = (message: string): string[] => [...new Set(message.match(/\{\d+\}/g))].sort()

afterEach(() => setTranslator())

test('every %key% of the manifest is translated to English and Spanish, with no unused keys', () => {
	const keys = [...manifestKeys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')))].sort()
	assert.ok(keys.length > 30, `Expected the commands, settings, colors, modifiers and capabilities: ${keys.length}`)
	for (const name of ['package.nls.json', 'package.nls.es.json']) {
		const texts = json(name)
		assert.deepEqual(Object.keys(texts).sort(), keys, name)
		for (const [key, text] of Object.entries(texts)) assert.ok(text.trim(), `${name}: ${key} is empty`)
	}
})

test('no visible text of the manifest is left untranslated', () => {
	const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
		description: string
		contributes: {
			colors: Array<{ description: string }>
			commands: Array<{ title: string }>
			configuration: { properties: Record<string, { description: string }> }
			semanticTokenModifiers: Array<{ description: string }>
		}
		capabilities: Record<string, { description: string }>
	}
	const { colors, commands, configuration, semanticTokenModifiers } = manifest.contributes
	const texts = [
		manifest.description,
		...colors.map((item) => item.description),
		...commands.map((item) => item.title),
		...Object.values(configuration.properties).map((item) => item.description),
		...semanticTokenModifiers.map((item) => item.description),
		...Object.values(manifest.capabilities).map((item) => item.description),
	]
	for (const text of texts) assert.match(text, /^%[\w.]+%$/)
})

test('every message passed to t(...) has a Spanish translation, with no unused entries', () => {
	const messages = sourceMessages()
	const spanish = json('l10n/bundle.l10n.es.json')
	assert.ok(messages.size > 40, `Expected the messages of the commands, the status and the live values: ${messages.size}`)
	for (const [message, files] of messages) assert.ok(message in spanish, `${files.join(', ')}: ${JSON.stringify(message)} lacks a translation in l10n/bundle.l10n.es.json`)
	for (const [message, translation] of Object.entries(spanish)) {
		assert.ok(messages.has(message), `l10n/bundle.l10n.es.json translates ${JSON.stringify(message)}, which src does not use`)
		assert.ok(translation.trim(), `${JSON.stringify(message)} has an empty translation`)
		assert.deepEqual(placeholders(translation), placeholders(message), `${JSON.stringify(message)}: the translation uses other placeholders`)
	}
})

test('no user text of the language servers skips t(...)', () => {
	// The state shown by the status item is built from these fields: a literal would stay untranslated.
	assert.doesNotMatch(readFileSync(join(root, 'src', 'language-servers.ts'), 'utf8'), /\.error = ['"`]/)
})

test('the pure modules stay free of vscode and translate through src/l10n.ts', () => {
	for (const name of ['l10n', 'scaffold', 'status', 'server-resolution', 'folder-plan', 'deadline', 'diagnostic-owners', 'zone-ranges', 'auto-close-trigger', 'live/model', 'live/client', 'live/workspace']) {
		assert.doesNotMatch(readFileSync(join(root, 'src', `${name}.ts`), 'utf8'), /from 'vscode'/, name)
	}
	assert.match(readFileSync(join(root, 'src', 'extension.ts'), 'utf8'), /setTranslator\(vscode\.l10n\.t\)/)
})

test('without a translator the message is the English text with its placeholders replaced', () => {
	assert.equal(t('{0} already exports a schema for {1} {2}', 'shared/schemas/users.ts', 'GET', '/users'), 'shared/schemas/users.ts already exports a schema for GET /users')
	assert.equal(format('{1} {0} {1} {2}', 'a', 3), '3 a 3 {2}')
	assert.equal(format('{0}', '$& {0}'), '$& {0}')
})

test('the installed translator, like vscode.l10n.t, receives the English message and its arguments', () => {
	const spanish = json('l10n/bundle.l10n.es.json')
	setTranslator((message, ...args) => format(spanish[message] ?? message, ...args))
	assert.equal(serverStatus(undefined).text, 'Meeko: sin servidor')
	const failed = serverStatus({ state: 'failed', resolution: { module: '/extension/dist/server.js', source: 'bundled' }, folder: 'site', error: 'spawn ENOENT' })
	assert.deepEqual([failed.text, failed.detail, failed.command.title], ['Meeko: error (incluido)', 'El servidor de «site» no arrancó: spawn ENOENT', 'Mostrar salida'])
	assert.equal(serverStatus({ state: 'stopped', resolution: { module: '/extension/dist/server.js', source: 'bundled' }, folder: 'site' }).detail, 'El servidor de «site» se detuvo de forma inesperada')
	setTranslator()
	assert.equal(serverStatus(undefined).text, 'Meeko: no server')
})

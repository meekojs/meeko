import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

interface Manifest {
	contributes: {
		configuration: { properties: Record<string, { type: string; default: unknown }> }
		configurationDefaults: Record<string, Record<string, unknown>>
		semanticTokenModifiers: Array<{ id: string }>
		semanticTokenScopes: Array<{ language: string; scopes: Record<string, string[]> }>
		colors: Array<{ id: string; defaults: Record<string, string> }>
	}
}

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest
/** Token types and modifiers that VS Code defines; the extension declares the rest. */
const standardTypes = new Set(['namespace', 'class', 'enum', 'interface', 'struct', 'typeParameter', 'type', 'parameter', 'variable', 'property', 'enumMember', 'decorator', 'event', 'function', 'method', 'macro', 'label', 'comment', 'string', 'keyword', 'number', 'regexp', 'operator'])
const standardModifiers = new Set(['declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract', 'async', 'modification', 'documentation', 'defaultLibrary'])

async function legend(): Promise<{ tokenTypes: string[]; tokenModifiers: string[] }> {
	// The legend of the language server that the extension bundles.
	const features = pathToFileURL(resolve(root, '../meeko/src/language-server/features.ts')).href
	return ((await import(features)) as { semanticTokensLegend: { tokenTypes: string[]; tokenModifiers: string[] } }).semanticTokensLegend
}

test('every custom modifier of the server legend is declared and colored for .meeko', async () => {
	const { tokenTypes, tokenModifiers } = await legend()
	const declared = new Set(manifest.contributes.semanticTokenModifiers.map((modifier) => modifier.id))
	for (const modifier of tokenModifiers) {
		assert.ok(standardModifiers.has(modifier) || declared.has(modifier), `semanticTokenModifiers lacks ${modifier}`)
	}
	for (const type of tokenTypes) assert.ok(standardTypes.has(type), `custom token type ${type} needs semanticTokenTypes`)
	const scopes = manifest.contributes.semanticTokenScopes.find((entry) => entry.language === 'meeko')?.scopes ?? {}
	for (const selector of Object.keys(scopes)) {
		const [type, ...modifiers] = selector.split('.')
		assert.ok(tokenTypes.includes(type!), `${selector}: unknown type`)
		for (const modifier of modifiers) assert.ok(tokenModifiers.includes(modifier), `${selector}: unknown modifier ${modifier}`)
	}
	for (const modifier of ['signal', 'computed', 'resource', 'modification', 'reactive']) {
		assert.ok(
			Object.keys(scopes).some((selector) => selector.split('.').includes(modifier)),
			`${modifier} has a default scope`,
		)
	}
	// Themes render markup.italic in italics; reactive code keeps the font style of its type.
	assert.deepEqual(
		Object.values(scopes)
			.flat()
			.filter((scope) => scope.startsWith('markup.italic')),
		[],
	)
})

test('tags close and rename together in .meeko files', () => {
	const setting = manifest.contributes.configuration.properties['meeko.autoClosingTags']
	assert.deepEqual([setting?.type, setting?.default], ['boolean', true])
	assert.equal(manifest.contributes.configurationDefaults['[meeko]']?.['editor.linkedEditing'], true)
})

test('angle brackets stay paired without recoloring TypeScript arrows', () => {
	const language = JSON.parse(readFileSync(join(root, 'language-configuration.json'), 'utf8')) as {
		brackets: string[][]
		colorizedBracketPairs: string[][]
	}
	assert.ok(language.brackets.some(([open, close]) => open === '<' && close === '>'))
	assert.ok(!language.colorizedBracketPairs.some(([open, close]) => open === '<' || close === '>'))
	assert.deepEqual(language.colorizedBracketPairs, [
		['{', '}'],
		['(', ')'],
		['[', ']'],
	])
})

test('a second brace before an auto-closed one does not open another pair', () => {
	// `{{` in the template's text would become `{{}}`: Meeko interpolates with a single brace.
	const language = JSON.parse(readFileSync(join(root, 'language-configuration.json'), 'utf8')) as { autoCloseBefore: string }
	assert.ok(!language.autoCloseBefore.includes('}'), language.autoCloseBefore)
	for (const next of [' ', '\n', '<', ')', ']']) assert.ok(language.autoCloseBefore.includes(next), JSON.stringify(next))
})

test("bracket colors are disabled for Meeko's embedded TypeScript by default", () => {
	assert.equal(manifest.contributes.configurationDefaults['[meeko]']?.['editor.bracketPairColorization.enabled'], false)
})

test('execution zones have a setting, theme colors and gutter icons', () => {
	const setting = manifest.contributes.configuration.properties['meeko.editor.executionZones']
	assert.deepEqual([setting?.type, setting?.default], ['boolean', true])
	for (const kind of ['server', 'shared', 'browser']) {
		const color = manifest.contributes.colors.find((entry) => entry.id === `meeko.executionZone.${kind}Background`)
		assert.ok(color, kind)
		for (const theme of ['dark', 'light', 'highContrast', 'highContrastLight']) assert.match(color.defaults[theme] ?? '', /^#[0-9A-Fa-f]{8}$/)
		for (const theme of ['dark', 'light']) assert.ok(existsSync(join(root, 'icons', 'zones', `${kind}-${theme}.svg`)), `${kind}-${theme}.svg`)
	}
})

test('Tailwind defaults support Meeko attributes without changing user settings', () => {
	assert.deepEqual(manifest.contributes.configurationDefaults['tailwindCSS.includeLanguages'], { meeko: 'html' })
	// Every key: a language default replaces the whole object, and attribute names are "other".
	assert.deepEqual(manifest.contributes.configurationDefaults['[meeko]']?.['editor.quickSuggestions'], { other: 'on', comments: 'off', strings: 'on' })
	assert.equal(manifest.contributes.configuration.properties['meeko.classes.completion']?.default, 'auto')
})

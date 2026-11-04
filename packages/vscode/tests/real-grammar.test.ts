import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import oniguruma from 'vscode-oniguruma'
import textmate from 'vscode-textmate'

const { createOnigScanner, createOnigString, loadWASM } = oniguruma
const { parseRawGrammar, Registry } = textmate
const directory = fileURLToPath(new URL('..', import.meta.url))

/** Installed Code builds can keep their resources under a versioned directory. */
function editorRoot(): string | undefined {
	const local = process.env.LOCALAPPDATA
	const installation = local && join(local, 'Programs', 'Microsoft VS Code')
	const candidates = [
		process.env.MEEKO_VSCODE_APP_ROOT,
		installation && join(installation, 'resources', 'app'),
		...(installation && existsSync(installation)
			? readdirSync(installation, { withFileTypes: true })
					.filter((item) => item.isDirectory())
					.map((item) => join(installation, item.name, 'resources', 'app'))
			: []),
		'/usr/share/code/resources/app',
		'/Applications/Visual Studio Code.app/Contents/Resources/app',
	]
	return candidates.find((candidate) => candidate && existsSync(join(candidate, 'extensions', 'typescript-basics', 'syntaxes', 'TypeScript.tmLanguage.json')))
}

const app = editorRoot()
test('the installed VS Code grammar keeps arrows and nested template expressions in TypeScript', { skip: !app }, async () => {
	const require = createRequire(import.meta.url)
	await loadWASM(readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')))
	const files: Record<string, string> = {
		'source.meeko': join(directory, 'syntaxes', 'meeko.tmLanguage.json'),
		'source.ts': join(app!, 'extensions', 'typescript-basics', 'syntaxes', 'TypeScript.tmLanguage.json'),
		'text.html.basic': join(app!, 'extensions', 'html', 'syntaxes', 'html.tmLanguage.json'),
		'source.css': join(app!, 'extensions', 'css', 'syntaxes', 'css.tmLanguage.json'),
	}
	const registry = new Registry({
		onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
		loadGrammar: async (scope) => (files[scope] ? parseRawGrammar(readFileSync(files[scope], 'utf8'), files[scope]) : null),
	})
	const grammar = await registry.loadGrammarWithConfiguration('source.meeko', 1, {
		embeddedLanguages: { 'meta.embedded.block.typescript': 2, 'meta.embedded.inline.typescript': 2, 'meta.embedded.block.html': 3, 'meta.embedded.block.css': 4 },
	})
	assert.ok(grammar)
	const lines = [
		'<script lang="ts">',
		'const f = () => props.value;',
		"const nested = { value: { name: 'Ada' } };",
		'</script>',
		'<template>',
		'<pre>{{nested.value.name}}</pre>',
		'<p>{({ id: 1 }).id}</p>',
		'</template>',
	]
	let state = null
	const tokens: { text: string; scopes: readonly string[] }[] = []
	for (const line of lines) {
		const result = grammar.tokenizeLine(line, state)
		state = result.ruleStack
		tokens.push(...result.tokens.map((token) => ({ text: line.slice(token.startIndex, token.endIndex), scopes: token.scopes })))
	}
	const arrow = tokens.find((token) => token.text === '=>')
	assert.ok(arrow, `=> must be one token: ${JSON.stringify(tokens.filter((token) => token.text.includes('=')))}`)
	assert.ok(arrow.scopes.includes('meta.embedded.block.typescript'))
	assert.ok(
		arrow.scopes.some((scope) => scope === 'keyword.operator.assignment.ts' || scope === 'storage.type.function.arrow.ts'),
		JSON.stringify(arrow.scopes),
	)
	assert.ok(tokens.some((token) => token.text.includes('nested') && token.scopes.includes('meta.embedded.inline.typescript')))
	assert.ok(tokens.some((token) => token.text.includes('id') && token.scopes.includes('meta.embedded.inline.typescript')))
})

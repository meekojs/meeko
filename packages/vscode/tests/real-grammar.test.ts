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
	// From WSL the editor is the Windows installation, under /mnt/c/Users/<user>/AppData/Local.
	const windowsUsers = process.platform === 'linux' && existsSync('/mnt/c/Users') ? readdirSync('/mnt/c/Users').map((user) => join('/mnt/c/Users', user, 'AppData', 'Local')) : []
	const installations = [local, ...windowsUsers].flatMap((folder) => (folder ? [join(folder, 'Programs', 'Microsoft VS Code')] : []))
	const candidates = [
		process.env.MEEKO_VSCODE_APP_ROOT,
		...installations.flatMap((installation) => [
			join(installation, 'resources', 'app'),
			...(existsSync(installation)
				? readdirSync(installation, { withFileTypes: true })
						.filter((item) => item.isDirectory())
						.map((item) => join(installation, item.name, 'resources', 'app'))
				: []),
		]),
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

test('with the installed VS Code grammar, reactive declarations keep the rest of the TypeScript statement', { skip: !app }, async () => {
	const require = createRequire(import.meta.url)
	await loadWASM(readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')))
	const files: Record<string, string> = {
		'source.meeko': join(directory, 'syntaxes', 'meeko.tmLanguage.json'),
		'source.ts': join(app!, 'extensions', 'typescript-basics', 'syntaxes', 'TypeScript.tmLanguage.json'),
		'text.html.basic': join(app!, 'extensions', 'html', 'syntaxes', 'html.tmLanguage.json'),
	}
	const registry = new Registry({
		onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
		loadGrammar: async (scope) => (files[scope] ? parseRawGrammar(readFileSync(files[scope], 'utf8'), files[scope]) : null),
	})
	const grammar = await registry.loadGrammarWithConfiguration('source.meeko', 1, {
		embeddedLanguages: { 'meta.embedded.block.typescript': 2, 'meta.embedded.inline.typescript': 2, 'meta.embedded.block.html': 3 },
	})
	assert.ok(grammar)
	const lines = ['<script lang="ts">', 'const count = signal<number>(0);', 'const typed: Signal<number> = signal(1);', 'function reset() { count.value = 0 }', '</script>']
	let state = null
	const tokens: { text: string; scopes: readonly string[] }[] = []
	for (const line of lines) {
		const result = grammar.tokenizeLine(line, state)
		state = result.ruleStack
		tokens.push(...result.tokens.map((token) => ({ text: line.slice(token.startIndex, token.endIndex), scopes: token.scopes })))
	}
	const scopesOf = (text: string) => tokens.find((token) => token.text === text)?.scopes ?? []
	assert.ok(scopesOf('count').includes('support.class.component.signal.meeko'), JSON.stringify(scopesOf('count')))
	assert.ok(scopesOf('signal').includes('entity.name.function.ts'), 'the call keeps its TypeScript scope')
	assert.ok(scopesOf('number').includes('support.type.primitive.ts'), 'the type argument keeps its TypeScript scope')
	// With a type annotation the name is left to TypeScript, so the type is not read as the variable.
	assert.ok(!scopesOf('typed').includes('support.class.component.signal.meeko'))
	assert.ok(scopesOf('Signal').includes('entity.name.type.ts'), JSON.stringify(scopesOf('Signal')))
	assert.ok(tokens.some((token) => token.text === 'value' && token.scopes.includes('keyword.control.write.meeko')))
	assert.ok(scopesOf('reset').includes('entity.name.function.ts'), 'the statements after the declarations keep their scopes')
})

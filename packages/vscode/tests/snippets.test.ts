import ts from '@typescript/typescript6'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

import { compile } from '../../meeko/src/compiler'

interface Snippet {
	prefix: string | string[]
	body: string[]
	description: string
}

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
	contributes: { snippets: { language: string; path: string }[] }
}

function read(path: string): Record<string, Snippet> {
	return JSON.parse(readFileSync(join(root, path), 'utf8')) as Record<string, Snippet>
}

function snippets(language: string): Record<string, Snippet> {
	const contribution = manifest.contributes.snippets.find((entry) => entry.language === language)
	assert.ok(contribution, `Missing ${language} snippets contribution`)
	return read(contribution.path)
}

// What the completion provider offers in each block: declared for no language, one definition each.
const scriptSnippets = read('snippets/meeko-script.json')
const templateSnippets = read('snippets/meeko-template.json')
const prefixesOf = (group: Record<string, Snippet>): string[] => Object.values(group).flatMap((snippet) => snippet.prefix)

// These snippets deliberately use only tabstops, linked placeholders and filename variables.
function expand(snippet: Snippet): string {
	const values = new Map<string, string>()
	const result = snippet.body
		.join('\n')
		.replace(/\$\{TM_FILENAME_BASE\}|\$TM_FILENAME_BASE/g, 'Example')
		.replace(/\$\{(\d+):([^{}]*)\}/g, (_, index: string, value: string) => {
			values.set(index, value)
			return value
		})
		.replace(/\$\{(\d+)\}|\$(\d+)/g, (_, braced: string | undefined, plain: string | undefined) => {
			const index = braced ?? plain!
			assert.ok(index === '0' || values.has(index), `Undefined tabstop ${index}`)
			return values.get(index) ?? ''
		})
	assert.doesNotMatch(result, /\$\{|\$\w/, 'Unexpanded snippet syntax')
	return result
}

test('snippet contributions contain valid JSON, unique m-prefixed shortcuts and descriptions', () => {
	assert.deepEqual(manifest.contributes.snippets.map((entry) => entry.language).sort(), ['meeko', 'typescript'])
	const prefixes = new Set<string>()
	for (const group of [snippets('meeko'), scriptSnippets, templateSnippets, snippets('typescript')]) {
		for (const snippet of Object.values(group)) {
			assert.ok(snippet.description.trim())
			assert.ok(Array.isArray(snippet.body) && snippet.body.length > 0)
			for (const prefix of [snippet.prefix].flat()) {
				assert.match(prefix, /^m[a-z]+$/)
				assert.ok(!prefixes.has(prefix), `Duplicate prefix: ${prefix}`)
				prefixes.add(prefix)
			}
			expand(snippet)
		}
	}
	assert.equal(prefixes.size, 25)
})

test('only the skeletons of the file are declared for the language meeko', () => {
	assert.deepEqual(prefixesOf(snippets('meeko')).sort(), ['mcomp', 'meeko', 'mform', 'mlayout', 'mpage'])
	assert.deepEqual(prefixesOf(scriptSnippets).sort(), ['mcomputed', 'meffect', 'memits', 'mexpose', 'mmodel', 'mmounted', 'mprops', 'mpropsd', 'mref', 'msignal', 'msnippets'])
	assert.deepEqual(prefixesOf(templateSnippets).sort(), ['meach', 'mif', 'mis', 'mrender', 'msnippet'])
	for (const { path } of manifest.contributes.snippets) assert.ok(!/meeko-(script|template)/.test(path), `${path}: VS Code would offer it at the root`)
})

test('every expanded Meeko snippet compiles in its insertion context', () => {
	const templatePrefixes = new Set(prefixesOf(templateSnippets))
	for (const snippet of [...Object.values(snippets('meeko')), ...Object.values(scriptSnippets), ...Object.values(templateSnippets)]) {
		const prefix = [snippet.prefix].flat()[0]!
		const expanded = expand(snippet)
		let source = expanded
		if (templatePrefixes.has(prefix)) {
			const setup = `const visible = signal(true)\nconst items = signal([{ id: 1, label: 'Example' }])\nconst label = 'Example'\nconst tag = 'section' as const\nconst snippets = defineSnippets<{ default: [label: string] }>()`
			const template = prefix === 'msnippet' ? `<Panel>\n${expanded}\n</Panel>` : expanded
			source = `<script lang="ts">\nimport Panel from './Panel.meeko'\nimport { signal } from '@meekojs/meeko'\n${setup}\n</script>\n<template>\n${template}\n</template>`
		} else if (!expanded.includes('<script')) {
			const setup = ['mexpose', 'mcomputed', 'meffect'].includes(prefix) ? `const value = 'Example'\nconst count = { value: 1 }\n` : ''
			const template = prefix === 'mref' ? '<input ref:input />' : '<div />'
			source = `<script lang="ts">\n${setup}${expanded}\n</script>\n<template>${template}</template>`
		}
		assert.doesNotThrow(() => {
			const result = compile(source, join(root, 'app', prefix === 'mlayout' ? 'layouts' : 'pages', `${prefix}.meeko`))
			assert.ok(result.code.length > 0)
		}, prefix)
	}
})

test('expanded TypeScript snippets typecheck against the current Meeko API', { timeout: 60_000 }, async () => {
	const directory = await mkdtemp(join(tmpdir(), 'meeko-vscode-snippets-'))
	try {
		const schema = join(directory, 'shared', 'schemas', 'example.ts')
		await mkdir(dirname(schema), { recursive: true })
		await writeFile(schema, `export const inputSchema = { '~standard': { version: 1 as const, vendor: 'snippet-test', validate: (input: unknown) => ({ value: String(input) }) } }\nexport const outputSchema = inputSchema\n`)
		const files: string[] = []
		for (const snippet of Object.values(snippets('typescript'))) {
			const prefix = snippet.prefix as string
			const file = join(directory, prefix === 'mrpc' ? 'server/rpc/example.ts' : `${prefix}.ts`)
			await mkdir(dirname(file), { recursive: true })
			await writeFile(file, expand(snippet))
			files.push(file)
		}
		const program = ts.createProgram(files, {
			strict: true,
			noEmit: true,
			skipLibCheck: true,
			target: ts.ScriptTarget.ESNext,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			types: [],
			paths: {
				'@meekojs/meeko': [join(root, '../meeko/src/index.ts')],
				'@meekojs/meeko/server': [join(root, '../meeko/src/framework-server.ts')],
				'@meekojs/meeko/framework': [join(root, '../meeko/src/framework.ts')],
			},
		})
		for (const file of files) {
			const source = program.getSourceFile(file)!
			const diagnostics = [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)]
			assert.deepEqual(
				diagnostics.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, '\n')),
				[],
				file,
			)
		}
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

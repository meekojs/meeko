import ts from '@typescript/typescript6'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { CompileDiagnostic } from '../compiler/parser/sfc'

import { discoverServerManifest } from '../server/api/manifest-discovery'
import { keyMatches } from '../shared/invalidation'
import { conventionDataKeys } from './contracts-generate'

/**
 * A key written in the source: a literal, or the text before the first `${` of a template, which
 * stands for every key that starts with it (`` `orders.${id}` `` is `orders.` and anything after).
 */
interface WrittenKey {
	readonly text: string
	readonly prefix: boolean
	readonly start: number
}

function writtenKey(node: ts.Node, file: ts.SourceFile): WrittenKey | undefined {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { text: node.text, prefix: false, start: node.getStart(file) }
	if (ts.isTemplateExpression(node)) return { text: node.head.text, prefix: true, start: node.getStart(file) }
	return undefined
}

function calledName(node: ts.CallExpression): string | undefined {
	const callee = node.expression
	if (ts.isIdentifier(callee)) return callee.text
	if (ts.isPropertyAccessExpression(callee)) return callee.name.text
	return undefined
}

/** Keys of `property: [...]` array literals and of `call(...)` arguments in a TypeScript text. */
function keysIn(text: string, filename: string, property: string, call: string): { file: ts.SourceFile; keys: WrittenKey[] } {
	const file = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
	const keys: WrittenKey[] = []
	const visit = (node: ts.Node): void => {
		if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === property && ts.isArrayLiteralExpression(node.initializer)) {
			for (const element of node.initializer.elements) {
				const key = writtenKey(element, file)
				if (key) keys.push(key)
			}
		}
		if (ts.isCallExpression(node) && calledName(node) === call) {
			for (const argument of node.arguments) {
				const key = writtenKey(argument, file)
				if (key) keys.push(key)
			}
		}
		ts.forEachChild(node, visit)
	}
	visit(file)
	return { file, keys }
}

/** The scripts of a `.meeko` file: `<script>` and `<script server>`. */
function meekoScripts(source: string): string[] {
	return [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]!)
}

async function sourceFiles(directory: string, pattern: RegExp): Promise<string[]> {
	let entries
	try {
		entries = await readdir(directory, { withFileTypes: true })
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
		throw error
	}
	const files: string[] = []
	for (const entry of entries) {
		const path = join(directory, entry.name)
		if (entry.isDirectory()) {
			if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) files.push(...(await sourceFiles(path, pattern)))
		} else if (entry.isFile() && pattern.test(entry.name) && !/\.d\.[cm]?ts$/.test(entry.name)) files.push(path)
	}
	return files
}

/** Whether invalidating `changed` can refresh a read written as `read`. */
function reaches(changed: WrittenKey, read: WrittenKey): boolean {
	if (!changed.prefix && !read.prefix) return keyMatches(changed.text, read.text)
	// A template stands for many keys: only a key that can never meet it is unused.
	if (!changed.prefix) return changed.text.startsWith(read.text) || keyMatches(changed.text, read.text) || read.text.startsWith(`${changed.text}.`)
	if (!read.prefix) return read.text.startsWith(changed.text) || keyMatches(read.text, changed.text)
	return read.text.startsWith(changed.text) || changed.text.startsWith(read.text)
}

/**
 * `MEEK141`: a key of `invalidates` or `invalidate()` in `server/api` or `server/rpc` that no read
 * can depend on: neither the key by convention of a `useApi` or `useRpcQuery` (each GET endpoint
 * and each procedure, with the keys above them) nor a `keys` or `depends()` written in `app/`. Such
 * a write refreshes nothing, which is usually a typo or a key that is too narrow (`orders.42` does
 * not refresh a list that depends on `orders`). It is a warning: a key built from a variable in a
 * read cannot be seen here.
 */
export async function unusedInvalidations(projectRoot: string, sourceRoots: readonly string[]): Promise<CompileDiagnostic[]> {
	const manifest = await discoverServerManifest(projectRoot)
	const writes = [...manifest.api.filter((endpoint) => endpoint.method !== 'GET'), ...manifest.rpc].map((endpoint) => endpoint.file)
	if (writes.length === 0) return []
	const reads: WrittenKey[] = conventionDataKeys(manifest.api, manifest.rpc).map((text) => ({ text, prefix: false, start: 0 }))
	for (const root of sourceRoots) {
		for (const file of await sourceFiles(join(root, 'app'), /\.(?:meeko|[cm]?ts)$/)) {
			const source = await readFile(file, 'utf8')
			if (!source.includes('keys') && !source.includes('depends')) continue
			for (const text of file.endsWith('.meeko') ? meekoScripts(source) : [source]) reads.push(...keysIn(text, file, 'keys', 'depends').keys)
		}
	}
	const diagnostics: CompileDiagnostic[] = []
	for (const filename of writes) {
		const text = await readFile(filename, 'utf8')
		if (!text.includes('invalidate')) continue
		const { file, keys } = keysIn(text, filename, 'invalidates', 'invalidate')
		for (const key of keys) {
			if (!key.text || reads.some((read) => reaches(key, read))) continue
			const position = file.getLineAndCharacterOfPosition(key.start)
			const shown = key.prefix ? `${key.text}…` : key.text
			diagnostics.push({
				code: 'MEEK141',
				filename,
				location: { offset: key.start, line: position.line + 1, column: position.character + 1 },
				severity: 'warning',
				message: `La clave de datos "${shown}" no refresca nada: ningún useApi, useRpcQuery ni loader depende de ella ni de una clave por debajo. Una clave cubre las que empiezan por ella y un punto ("orders" cubre "orders.list", no al revés). Corrige la clave, invalida una más amplia o declárala en keys o depends; si la lectura la construye con una variable, ignora el aviso`,
			})
		}
	}
	return diagnostics
}

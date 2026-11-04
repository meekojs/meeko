import ts from '@typescript/typescript6'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import test from 'node:test'

const sourceRoot = resolve(import.meta.dirname, '../src')
const layers = new Set(['core', 'shared', 'app', 'server', 'compiler', 'modules', 'formatters'])
const allowed = new Map<string, Set<string>>([
	['core', new Set(['core'])],
	['shared', new Set(['core', 'shared'])],
	['app', new Set(['core', 'shared', 'app'])],
	['server', new Set(['core', 'shared', 'app', 'server'])],
	['compiler', new Set(['core', 'shared', 'app', 'compiler'])],
	['formatters', new Set(['core', 'shared', 'app', 'compiler', 'formatters'])],
	['modules', new Set(['core', 'shared', 'app', 'server', 'compiler', 'modules'])],
])

function files(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name)
		return entry.isDirectory() ? files(path) : entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path] : []
	})
}

function typeOnly(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
	if (ts.isImportDeclaration(node)) {
		const clause = node.importClause
		if (!clause) return false
		if (clause.isTypeOnly) return true
		return !clause.name && !!clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.every((element) => element.isTypeOnly)
	}
	return node.isTypeOnly || (!!node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.every((element) => element.isTypeOnly))
}

interface Dependency {
	readonly target: string
	readonly runtime: boolean
}

function imports(file: string): Dependency[] {
	const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
	return source.statements.flatMap((node) => {
		if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return []
		if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) return []
		const specifier = node.moduleSpecifier.text
		if (!specifier.startsWith('.')) return []
		const path = resolve(dirname(file), specifier).replace(/\.js$/, '.ts')
		const target = [path, `${path}.ts`, join(path, 'index.ts')].find((candidate) => candidate.endsWith('.ts') && existsSync(candidate)) ?? path
		return [{ target, runtime: !typeOnly(node) }]
	})
}

test('source layers point downward and runtime imports remain acyclic', () => {
	const all = files(sourceRoot)
	const known = new Set(all)
	const dependencies = new Map(all.map((file) => [file, imports(file)]))
	const graph = new Map(
		all.map((file) => [
			file,
			dependencies
				.get(file)!
				.filter((edge) => edge.runtime)
				.map((edge) => edge.target),
		]),
	)
	for (const [file, edges] of dependencies) {
		const sourceLayer = relative(sourceRoot, file).split(sep)[0]!
		for (const { target } of edges) {
			assert.ok(existsSync(target), `${relative(sourceRoot, file)} imports a missing file: ${relative(sourceRoot, target)}`)
			const targetLayer = relative(sourceRoot, target).split(sep)[0]!
			if (layers.has(sourceLayer) && layers.has(targetLayer)) {
				assert.ok(allowed.get(sourceLayer)?.has(targetLayer), `${sourceLayer} must not import ${targetLayer}: ${relative(sourceRoot, file)} -> ${relative(sourceRoot, target)}`)
				if (sourceLayer === 'compiler' && targetLayer === 'app') {
					assert.ok(relative(sourceRoot, target).startsWith(`app${sep}definitions${sep}`), `compiler imports app runtime: ${relative(sourceRoot, file)} -> ${relative(sourceRoot, target)}`)
				}
			}
			if (sourceLayer === 'core') assert.equal(targetLayer, 'core', `core imports ${targetLayer}: ${relative(sourceRoot, file)}`)
		}
	}
	const visiting = new Set<string>()
	const visited = new Set<string>()
	const visit = (file: string, path: string[]): void => {
		assert.ok(!visiting.has(file), `runtime import cycle: ${[...path, file].map((part) => relative(sourceRoot, part)).join(' -> ')}`)
		if (visited.has(file)) return
		visiting.add(file)
		for (const target of graph.get(file) ?? []) if (known.has(target)) visit(target, [...path, file])
		visiting.delete(file)
		visited.add(file)
	}
	for (const file of all) visit(file, [])
})

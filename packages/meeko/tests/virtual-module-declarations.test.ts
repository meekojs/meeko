// A source file that imports a `virtual:` module brings the declaration of that module with it, so it type-checks in
// any program that reaches it: tsconfig.json lists all of src, but tsconfig.test.json only lists the tests, and a test
// that imported such a file broke `tsc -p tsconfig.test.json` with a TS2307 that `pnpm test` never sees.
import ts from '@typescript/typescript6'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const sourceRoot = join(packageRoot, 'src')
const outputRoot = join(packageRoot, 'dist')

const filesIn = (directory: string, suffix: string): string[] =>
	readdirSync(directory, { recursive: true, encoding: 'utf8' })
		.filter((file) => file.endsWith(suffix))
		.map((file) => join(directory, file))

/** The `virtual:` modules a file really imports: its syntax tree, not the templates it holds in strings. */
function virtualImports(file: string): string[] {
	const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest)
	return source.statements.flatMap((statement) => (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text.startsWith('virtual:') ? [statement.moduleSpecifier.text] : []))
}

const importers = filesIn(sourceRoot, '.ts').filter((file) => !file.endsWith('.d.ts') && virtualImports(file).length > 0)

test('a source file that imports a virtual module type-checks in a program that only lists that file', () => {
	assert.ok(
		importers.some((file) => file.endsWith(join('modules', 'i18n', 'plugin.ts'))),
		'the plugin of @meekojs/meeko/i18n imports its manifest',
	)
	const config = ts.parseJsonConfigFileContent(ts.readConfigFile(join(packageRoot, 'tsconfig.json'), (path) => ts.sys.readFile(path)).config, ts.sys, packageRoot)
	for (const file of importers) {
		const program = ts.createProgram({ rootNames: [file], options: { ...config.options, noEmit: true } })
		const unresolved = program
			.getSemanticDiagnostics(program.getSourceFile(file))
			.filter((diagnostic) => diagnostic.code === 2307)
			.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
		assert.deepEqual(unresolved, [], `${relative(packageRoot, file)} must reference the declaration of its virtual modules`)
	}
})

test('no published declaration references a file that is not published', () => {
	// virtual.d.ts stays out of dist: a consumer would get a TS6053 that skipLibCheck does not silence.
	const missing = filesIn(outputRoot, '.d.ts').flatMap((file) =>
		[...readFileSync(file, 'utf8').matchAll(/^\/\/\/\s*<reference\s+path="([^"]+)"/gm)]
			.map((match) => resolve(dirname(file), match[1]!))
			.filter((target) => !existsSync(target))
			.map((target) => `${relative(outputRoot, file)} -> ${relative(outputRoot, target)}`),
	)
	assert.deepEqual(missing, [])
})

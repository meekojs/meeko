import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { importsOf, mapChanged, parseArguments, parseRunner, resolveImport } from './test-changed.mjs'

/** Árbol temporal con un paquete `alpha` (runner tsx), uno `beta` (node --test) y uno `gamma` sin runner. */
async function withTree(files, action) {
	const root = await mkdtemp(join(tmpdir(), 'meeko-test-changed-'))
	try {
		const manifests = {
			'packages/alpha/package.json': { name: '@x/alpha', scripts: { test: 'pnpm run build && tsx --test --test-concurrency=1 tests/*.test.ts' } },
			'packages/beta/package.json': { name: '@x/beta', scripts: { test: 'node --test tests/*.test.mjs' } },
			'packages/gamma/package.json': { name: '@x/gamma', scripts: {} },
		}
		for (const [path, content] of Object.entries({ ...manifests, ...files })) {
			await mkdir(dirname(join(root, path)), { recursive: true })
			await writeFile(join(root, path), typeof content === 'string' ? content : JSON.stringify(content))
		}
		await action(root)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
}

const testsOf = (result, name) => [...(result.runs.get(result.packages.find((pkg) => pkg.name === name)) ?? [])].map(([file]) => file).sort()

test('reads the runner of a test script', () => {
	assert.deepEqual(parseRunner('pnpm run build && tsx --test --test-concurrency=1 tests/*.test.ts'), ['tsx', '--test', '--test-concurrency=1'])
	assert.deepEqual(parseRunner('node --import tsx --test tests/*.test.ts'), ['node', '--import', 'tsx', '--test'])
	assert.equal(parseRunner('vitest run'), undefined)
})

test('extracts static relative imports only', () => {
	const text = "import a from './a'\nimport type { B } from '../b.js'\nexport * from './c'\nimport './d'\nconst e = await import('./e.ts')\nimport x from 'pkg'\nimport y from '@scope/pkg/sub'"
	assert.deepEqual(importsOf(text).sort(), ['../b.js', './a', './c', './d', './e.ts'])
})

test('resolves extensions and index files', () => {
	const files = new Set(['p/src/a.ts', 'p/src/dir/index.ts', 'p/src/m.mjs'])
	assert.equal(resolveImport('./a', 'p/src/x.ts', files), 'p/src/a.ts')
	assert.equal(resolveImport('./a.js', 'p/src/x.ts', files), 'p/src/a.ts')
	assert.equal(resolveImport('./dir', 'p/src/x.ts', files), 'p/src/dir/index.ts')
	assert.equal(resolveImport('./m.mjs', 'p/src/x.ts', files), 'p/src/m.mjs')
	assert.equal(resolveImport('./missing', 'p/src/x.ts', files), undefined)
})

test('a changed test file runs itself', async () => {
	await withTree({ 'packages/alpha/tests/one.test.ts': '', 'packages/alpha/tests/two.test.ts': '' }, (root) => {
		const result = mapChanged(root, ['packages/alpha/tests/one.test.ts'])
		assert.deepEqual(testsOf(result, '@x/alpha'), ['packages/alpha/tests/one.test.ts'])
	})
})

test('maps a source file to the tests that import it, transitively', async () => {
	await withTree(
		{
			'packages/alpha/src/leaf.ts': 'export const leaf = 1',
			'packages/alpha/src/mid.ts': "export { leaf } from './leaf'",
			'packages/alpha/tests/uses-mid.test.ts': "import { leaf } from '../src/mid'",
			'packages/alpha/tests/uses-helper.test.ts': "import './helper'",
			'packages/alpha/tests/helper.ts': "import '../src/leaf'",
			'packages/alpha/tests/unrelated.test.ts': 'export {}',
		},
		(root) => {
			const result = mapChanged(root, ['packages/alpha/src/leaf.ts'])
			assert.deepEqual(testsOf(result, '@x/alpha'), ['packages/alpha/tests/uses-helper.test.ts', 'packages/alpha/tests/uses-mid.test.ts'])
			assert.deepEqual(result.unmatched, [])
		},
	)
})

test('caps transitive dependents but never the direct ones', async () => {
	await withTree(
		{
			'packages/alpha/src/leaf.ts': '',
			'packages/alpha/src/mid.ts': "import './leaf'",
			'packages/alpha/tests/direct.test.ts': "import '../src/leaf'",
			'packages/alpha/tests/far.test.ts': "import '../src/mid'",
		},
		(root) => {
			const result = mapChanged(root, ['packages/alpha/src/leaf.ts'], { maxTransitive: 0 })
			assert.deepEqual(testsOf(result, '@x/alpha'), ['packages/alpha/tests/direct.test.ts'])
			assert.deepEqual(result.capped, [{ file: 'packages/alpha/src/leaf.ts', count: 1 }])
		},
	)
})

test('falls back to the name of the file, then of its folder, when tests run dist instead of src', async () => {
	await withTree(
		{
			'packages/alpha/src/framework/dev-portless.ts': '',
			'packages/alpha/src/framework/other-thing.ts': '',
			'packages/alpha/tests/dev-portless-cli.test.ts': "spawn('dist/cli.js')",
			'packages/alpha/tests/framework-routes.test.ts': '',
			'packages/alpha/tests/unrelated.test.ts': '',
		},
		(root) => {
			const byName = mapChanged(root, ['packages/alpha/src/framework/dev-portless.ts'])
			assert.deepEqual(testsOf(byName, '@x/alpha'), ['packages/alpha/tests/dev-portless-cli.test.ts'])
			const byFolder = mapChanged(root, ['packages/alpha/src/framework/other-thing.ts'])
			assert.deepEqual(testsOf(byFolder, '@x/alpha'), ['packages/alpha/tests/framework-routes.test.ts'])
		},
	)
})

test('never schedules e2e files and does not run the full suite for unmatched files', async () => {
	await withTree(
		{
			'packages/beta/src/zzz.ts': '',
			'packages/beta/tests/zzz.e2e.mjs': '',
			'packages/beta/tests/other.test.mjs': '',
			'packages/gamma/src/qqqq.ts': '',
			'docs/readme.md': '',
		},
		(root) => {
			const result = mapChanged(root, ['packages/beta/tests/zzz.e2e.mjs', 'packages/beta/src/zzz.ts', 'packages/gamma/src/qqqq.ts', 'docs/readme.md', 'packages/beta/src/gone.ts'])
			assert.deepEqual(testsOf(result, '@x/beta'), [])
			assert.deepEqual(
				result.skipped.map(({ file }) => file),
				['packages/beta/tests/zzz.e2e.mjs'],
			)
			assert.deepEqual(result.unmatched.map(({ file }) => file).sort(), ['docs/readme.md', 'packages/beta/src/gone.ts', 'packages/beta/src/zzz.ts', 'packages/gamma/src/qqqq.ts'])
			assert.equal(result.runs.size, 0)
		},
	)
})

test('parses the command line', () => {
	assert.deepEqual(parseArguments(['--list', '--no-build', '--base', 'main', '--timeout', '30', 'a.ts']), { base: 'main', list: true, build: false, timeout: 30, maxTransitive: 25, paths: ['a.ts'] })
	assert.throws(() => parseArguments(['--nope']), /desconocida/)
	assert.throws(() => parseArguments(['--timeout', 'x']), /timeout/)
})

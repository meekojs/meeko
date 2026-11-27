import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { childEnv, commandSpec, lastLine, leafName, legacyArguments, nodeOptions, removeTemporaryDirectory, run, runMain, shellArgument, StepError, withTemporaryDirectory } from './process-utils.mjs'

test('quotes only the arguments cmd.exe would split or interpret', () => {
	assert.equal(shellArgument('plain'), 'plain')
	assert.equal(shellArgument('C:\\Program Files\\code.cmd'), '"C:\\Program Files\\code.cmd"')
	assert.equal(shellArgument('a&b'), '"a&b"')
	assert.equal(shellArgument('say "hi"'), '"say ""hi"""')
})

test('runs pnpm, npm and .cmd files through the shell only on Windows', () => {
	assert.deepEqual(commandSpec('pnpm', ['-C', 'C:\\My Folder', 'pack'], 'win32'), { command: 'pnpm -C "C:\\My Folder" pack', args: [], shell: true })
	assert.deepEqual(commandSpec('C:\\app\\node_modules\\.bin\\meeko.cmd', ['check', '.'], 'win32'), { command: 'C:\\app\\node_modules\\.bin\\meeko.cmd check .', args: [], shell: true })
	assert.deepEqual(commandSpec('C:\\Program Files\\nodejs\\node.exe', ['a b.mjs'], 'win32'), { command: 'C:\\Program Files\\nodejs\\node.exe', args: ['a b.mjs'], shell: false })
	assert.deepEqual(commandSpec('pnpm', ['pack'], 'linux'), { command: 'pnpm', args: ['pack'], shell: false })
	assert.deepEqual(commandSpec('npm', ['install'], 'darwin'), { command: 'npm', args: ['install'], shell: false })
})

test('limits the heap of child Node processes unless the environment already does', () => {
	assert.equal(childEnv({}, {}).NODE_OPTIONS, nodeOptions)
	assert.equal(childEnv({}, { NODE_OPTIONS: '--no-warnings' }).NODE_OPTIONS, `--no-warnings ${nodeOptions}`)
	assert.equal(childEnv({}, { NODE_OPTIONS: '--max-old-space-size=512' }).NODE_OPTIONS, '--max-old-space-size=512')
	assert.equal(childEnv({}, {}, false).NODE_OPTIONS, undefined)
})

test('removes a variable whose extra value is undefined', () => {
	assert.equal('MEEKO_HOST_VSCODE' in childEnv({ MEEKO_HOST_VSCODE: undefined }, { MEEKO_HOST_VSCODE: '/old' }), false)
	assert.equal(childEnv({ MEEKO_HOST_DATA: '/data' }, {}).MEEKO_HOST_DATA, '/data')
})

test('reads the last non-empty line and the leaf of paths from any system', () => {
	assert.equal(lastLine('first\r\n  /tmp/meeko-1.0.0.tgz  \r\n\r\n'), '/tmp/meeko-1.0.0.tgz')
	assert.equal(lastLine('\n'), undefined)
	assert.equal(leafName('C:\\Users\\dev\\meeko-1.0.0.tgz'), 'meeko-1.0.0.tgz')
	assert.equal(leafName('/tmp/meeko-1.0.0.tgz'), 'meeko-1.0.0.tgz')
})

test('translates PowerShell parameters without touching other arguments', () => {
	const aliases = { Offline: '--offline', VSCodeExecutable: '--vscode-executable' }
	assert.deepEqual(legacyArguments(['-Offline'], aliases), ['--offline'])
	assert.deepEqual(legacyArguments(['-vscodeexecutable', '/usr/bin/code'], aliases), ['--vscode-executable', '/usr/bin/code'])
	assert.deepEqual(legacyArguments(['--offline', '-Unknown', '/-Offline'], aliases), ['--offline', '-Unknown', '/-Offline'])
})

test('fails with the step message when a process exits with an error', () => {
	assert.throws(() => run(process.execPath, ['-e', 'process.exit(3)'], { failure: 'Falló el paso.' }), { name: 'StepError', message: 'Falló el paso.' })
})

test('returns the standard output of a successful process when asked to capture it', () => {
	assert.equal(lastLine(run(process.execPath, ['-e', 'console.log("uno\\ndos")'], { failure: 'x', capture: true })), 'dos')
})

test('kills a process that exceeds its timeout and says so', () => {
	assert.throws(() => run(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { failure: 'Se colgó.', timeout: 300 }), /Se colgó\. \(tiempo agotado tras \d+ s\)/)
})

test('fails when the executable does not exist', () => {
	assert.throws(() => run('meeko-command-that-does-not-exist', [], { failure: 'No arrancó.' }), /No arrancó\. \(/)
})

test('removes the temporary directory when the work succeeds and when it fails', async () => {
	const base = mkdtempSync(join(tmpdir(), 'meeko-utils-test-'))
	try {
		let created
		const result = await withTemporaryDirectory({ prefix: 'ok-', base }, (directory) => {
			created = directory
			writeFileSync(join(directory, 'file.txt'), 'x')
			return 'done'
		})
		assert.equal(result, 'done')
		assert.equal(existsSync(created), false)
		await assert.rejects(
			withTemporaryDirectory({ prefix: 'fail-', base }, (directory) => {
				created = directory
				writeFileSync(join(directory, 'file.txt'), 'x')
				throw new StepError('Falló.')
			}),
			/Falló\./,
		)
		assert.equal(existsSync(created), false)
		assert.deepEqual(readdirSync(base), [])
	} finally {
		rmSync(base, { recursive: true, force: true })
	}
})

test('keeps the temporary directory on request', async () => {
	const base = mkdtempSync(join(tmpdir(), 'meeko-utils-test-'))
	try {
		const kept = await withTemporaryDirectory({ prefix: 'keep-', base, keep: true }, (directory) => directory)
		assert.equal(existsSync(kept), true)
	} finally {
		rmSync(base, { recursive: true, force: true })
	}
})

test('refuses to remove a directory outside its base', () => {
	const base = mkdtempSync(join(tmpdir(), 'meeko-utils-test-'))
	try {
		assert.throws(() => removeTemporaryDirectory(tmpdir(), base), /Se niega a borrar/)
		assert.throws(() => removeTemporaryDirectory(base, base), /Se niega a borrar/)
	} finally {
		rmSync(base, { recursive: true, force: true })
	}
})

test('the entry point reports a failed step on stderr and sets exit code 1', async (context) => {
	const previous = process.exitCode
	const messages = []
	context.mock.method(console, 'error', (message) => messages.push(message))
	await runMain(() => {
		throw new StepError('Falló el paso.')
	})
	assert.deepEqual(messages, ['Falló el paso.'])
	assert.equal(process.exitCode, 1)
	process.exitCode = previous
})

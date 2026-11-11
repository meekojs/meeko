import assert from 'node:assert/strict'
import { access, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { startDevServer } from './dev-server.ts'
import { createFixture } from './fixture.ts'

const parent = fileURLToPath(new URL('./.meeko/', import.meta.url))

test('fixture writes inside its root and removes links before the directory', async () => {
	const fixture = await createFixture(null, parent, 'fixture-', { files: { 'app/page.txt': 'ready' }, links: { shared: parent } })
	assert.equal(await readFile(join(fixture.root, 'app/page.txt'), 'utf8'), 'ready')
	await assert.rejects(fixture.write('../outside.txt', 'bad'), /leaves its root/)
	await fixture.cleanup()
	await assert.rejects(access(fixture.root), { code: 'ENOENT' })
	await access(parent)
})

test('fixture removes its root when initialization fails', async () => {
	const before = (await readdir(parent)).filter((name) => name.startsWith('failure-init-'))
	await assert.rejects(createFixture(null, parent, 'failure-init-', { files: { '../outside.txt': 'bad' } }), /leaves its root/)
	const after = (await readdir(parent)).filter((name) => name.startsWith('failure-init-'))
	assert.deepEqual(after, before)
	await assert.rejects(createFixture(null, parent, '../escape-', {}), /Invalid fixture prefix/)
})

test('dev server readiness accepts ANSI and CRLF, then closes its own process', { timeout: 20_000 }, async () => {
	const fixture = await createFixture(null, parent, 'server-', {
		files: {
			'cli.mjs': "import { createServer } from 'node:http'; const port = Number(process.env.PORT); createServer((_, res) => res.end('ready')).listen(port, '127.0.0.1', () => process.stdout.write(`\\x1b[32mhttp://localhost:${port}\\x1b[0m\\r\\n`));",
		},
	})
	try {
		const server = await startDevServer({ root: fixture.root, cli: join(fixture.root, 'cli.mjs'), startupTimeout: 5_000 })
		assert.equal(await (await fetch(server.origin)).text(), 'ready')
		await server.stop()
		await assert.rejects(fetch(server.origin, { signal: AbortSignal.timeout(1_000) }))
	} finally {
		await fixture.cleanup()
	}
})

test('dev server cleanup closes a descendant listener', { timeout: 20_000 }, async () => {
	const fixture = await createFixture(null, parent, 'tree-', {
		files: {
			'cli.mjs': `import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
const port = Number(process.env.PORT)
const childPort = Number(process.env.MEEKO_HMR_PORT)
spawn(process.execPath, ['-e', "require('node:http').createServer((_, res) => res.end('child')).listen(Number(process.env.MEEKO_HMR_PORT), '127.0.0.1')"], { stdio: 'ignore' })
writeFileSync('child-port.txt', String(childPort))
createServer((_, res) => res.end('parent')).listen(port, '127.0.0.1', () => process.stdout.write('http://localhost:' + port + '\\n'))`,
		},
	})
	try {
		const server = await startDevServer({ root: fixture.root, cli: join(fixture.root, 'cli.mjs'), startupTimeout: 5_000 })
		const childPort = Number(await readFile(join(fixture.root, 'child-port.txt'), 'utf8'))
		const childOrigin = `http://127.0.0.1:${childPort}`
		let ready = false
		for (let attempt = 0; attempt < 50 && !ready; attempt++) {
			try {
				ready = (await (await fetch(childOrigin, { signal: AbortSignal.timeout(500) })).text()) === 'child'
			} catch {
				await new Promise((done) => setTimeout(done, 50))
			}
		}
		assert.equal(ready, true)
		await server.stop()
		await assert.rejects(fetch(childOrigin, { signal: AbortSignal.timeout(1_000) }))
	} finally {
		await fixture.cleanup()
	}
})

test('dev server reports a child failure and its logs', { timeout: 20_000 }, async () => {
	const fixture = await createFixture(null, parent, 'failed-', { files: { 'cli.mjs': "process.stderr.write('fixture failed\\n'); process.exit(2)" } })
	try {
		await assert.rejects(startDevServer({ root: fixture.root, cli: join(fixture.root, 'cli.mjs'), startupTimeout: 5_000 }), /fixture failed/)
	} finally {
		await fixture.cleanup()
	}
})

test('dev server reports spawn errors from an invalid working directory', { timeout: 20_000 }, async () => {
	const missingRoot = join(parent, 'missing-spawn-root')
	await assert.rejects(startDevServer({ root: missingRoot, cli: join(missingRoot, 'cli.mjs'), startupTimeout: 5_000 }), /could not start:.*ENOENT/s)
})

test('dev server times out and cleans its child', { timeout: 20_000 }, async () => {
	const fixture = await createFixture(null, parent, 'timeout-', { files: { 'cli.mjs': 'setInterval(() => {}, 1000)' } })
	try {
		await assert.rejects(startDevServer({ root: fixture.root, cli: join(fixture.root, 'cli.mjs'), startupTimeout: 300 }), /timed out/)
	} finally {
		await fixture.cleanup()
	}
})

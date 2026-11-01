import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { test } from 'node:test'

import { createLivenessChecker, livenessPath, livenessResponse } from '../src/liveness'

/** A TCP port on loopback that refuses connections: it was free a moment ago and nothing listens. */
async function closedPort(): Promise<number> {
	const server = createServer()
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const address = server.address()
	await new Promise<void>((resolve) => server.close(() => resolve()))
	assert.ok(address && typeof address === 'object')
	return address.port
}

test('livenessResponse only answers GET and HEAD of /healthz', async () => {
	const checker = createLivenessChecker({ connectionString: '' })
	assert.equal(livenessResponse(new Request('http://localhost/'), checker), undefined)
	assert.equal(livenessResponse(new Request('http://localhost/healthz/extra'), checker), undefined)
	assert.equal(livenessResponse(new Request(`http://localhost${livenessPath}`, { method: 'POST' }), checker), undefined)
	const head = await livenessResponse(new Request(`http://localhost${livenessPath}`, { method: 'HEAD' }), checker)
	assert.equal(head?.status, 200)
	assert.equal(await head?.text(), '')
	await checker.close()
})

test('without a database the process is healthy and says unconfigured, without caching', async () => {
	const checker = createLivenessChecker({ connectionString: '' })
	const response = await livenessResponse(new Request('http://localhost/healthz?x=1'), checker)
	assert.equal(response?.status, 200)
	assert.equal(response?.headers.get('cache-control'), 'no-store')
	assert.deepEqual(await response?.json(), { status: 'ok', database: 'unconfigured' })
	await checker.close()
})

test('a database that refuses connections is down, logged once, and never leaks the URL', async () => {
	const port = await closedPort()
	const logs: string[] = []
	const checker = createLivenessChecker({ connectionString: `postgresql://user:secret@127.0.0.1:${port}/db`, ttlMs: 0, timeoutMs: 1000, log: (message) => logs.push(message) })
	const first = await livenessResponse(new Request('http://localhost/healthz'), checker)
	assert.equal(first?.status, 200)
	const body = await first!.text()
	assert.deepEqual(JSON.parse(body), { status: 'ok', database: 'down' })
	assert.ok(!body.includes('secret') && !body.includes(String(port)))
	await checker.check()
	assert.equal(logs.length, 1)
	assert.ok(!logs[0]!.includes('secret'))
	await checker.close()
})

test('concurrent checks share one probe and the result is reused within the TTL', async () => {
	const port = await closedPort()
	let logged = 0
	const checker = createLivenessChecker({ connectionString: `postgresql://u:p@127.0.0.1:${port}/db`, ttlMs: 60_000, timeoutMs: 1000, log: () => logged++ })
	const [a, b] = await Promise.all([checker.check(), checker.check()])
	assert.equal(a, b)
	assert.equal(await checker.check(), a)
	assert.equal(logged, 1)
	await checker.close()
})

test('with DATABASE_URL the development database is up', { skip: !process.env.DATABASE_URL?.trim() && 'DATABASE_URL is not set' }, async () => {
	const checker = createLivenessChecker()
	assert.deepEqual(await checker.check(), { status: 'ok', database: 'up' })
	await checker.close()
})

import assert from 'node:assert/strict'
import test from 'node:test'

import i18nHealth from '../../../apps/i18n/server/middleware/00-healthz'
import uiHealth from '../../../apps/ui/server/middleware/00-healthz'
import health from '../src/health'

test('both sites use the same health policy and pass through other routes and methods', async () => {
	assert.equal(uiHealth, health)
	assert.equal(i18nHealth, health)
	let continued = 0
	const next = async () => {
		continued++
		return new Response('next', { status: 202 })
	}
	for (const request of [new Request('http://localhost/else'), new Request('http://localhost/healthz', { method: 'POST' })]) {
		assert.equal((await health(request, next)).status, 202)
	}
	assert.equal(continued, 2)
})

test('health reports an unconfigured database without exposing connection details', async () => {
	const previous = process.env.DATABASE_URL
	delete process.env.DATABASE_URL
	try {
		const next = async () => new Response('unexpected', { status: 500 })
		const response = await health(new Request('http://localhost/healthz'), next)
		assert.equal(response.status, 200)
		assert.deepEqual(await response.json(), { status: 'ok', database: 'unconfigured' })
		assert.equal(response.headers.get('cache-control'), 'no-store')
		assert.equal(response.headers.get('x-robots-tag'), 'noindex')
		const head = await health(new Request('http://localhost/healthz', { method: 'HEAD' }), next)
		assert.equal(head.status, 200)
		assert.equal(await head.text(), '')
	} finally {
		if (previous === undefined) delete process.env.DATABASE_URL
		else process.env.DATABASE_URL = previous
	}
})

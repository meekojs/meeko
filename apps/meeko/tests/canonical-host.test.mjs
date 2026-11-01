// The redirect of www.meekojs.com to https://meekojs.com (server/middleware/00-canonical-host.ts),
// loaded with Node's type stripping: the middleware imports only `@meekojs/meeko/server`.
import assert from 'node:assert/strict'
import test from 'node:test'

import middleware, { canonicalHostRedirect } from '../server/middleware/00-canonical-host.ts'

const env = { SITE_CANONICAL_ORIGIN: 'https://meekojs.com' }

/** A request to `url` with `headers`; `Host` is the URL's host unless `headers` sets it. */
function request(url, headers = {}) {
	return new Request(url, { headers: { host: new URL(url).host, ...headers } })
}

test('www answers 301 to the canonical origin with the same path and query', () => {
	const response = canonicalHostRedirect(request('https://www.meekojs.com/docs/api?q=signal&x=1'), env)
	assert.equal(response?.status, 301)
	assert.equal(response.headers.get('location'), 'https://meekojs.com/docs/api?q=signal&x=1')
	assert.equal(canonicalHostRedirect(request('https://www.meekojs.com/'), env)?.headers.get('location'), 'https://meekojs.com/')
})

test('the Host header decides, with any case, port or final dot, not the rebased request.url', () => {
	// With MEEKO_PUBLIC_ORIGIN, Meeko rebases the URL on that origin and keeps the client's Host.
	const rebased = request('https://meekojs.com/docs?a=b', { host: 'WWW.MeekoJS.com.:443' })
	assert.equal(canonicalHostRedirect(rebased, env)?.headers.get('location'), 'https://meekojs.com/docs?a=b')
	assert.equal(canonicalHostRedirect(request('https://meekojs.com/docs'), env), undefined)
	assert.equal(canonicalHostRedirect(request('https://ui.meekojs.com/'), env), undefined)
	assert.equal(canonicalHostRedirect(request('https://www.meekojs.com.evil.example/'), env), undefined)
})

test('a path that starts with // stays on the canonical origin', () => {
	const location = canonicalHostRedirect(request('https://www.meekojs.com//evil.example/x'), env)?.headers.get('location')
	assert.equal(new URL(location).origin, 'https://meekojs.com')
	assert.equal(location, 'https://meekojs.com//evil.example/x')
})

test('without SITE_CANONICAL_ORIGIN, as in local development, nothing redirects', () => {
	assert.equal(canonicalHostRedirect(request('https://www.meekojs.com/docs'), {}), undefined)
	assert.equal(canonicalHostRedirect(request('https://www.meekojs.com/docs'), { SITE_CANONICAL_ORIGIN: '  ' }), undefined)
	assert.equal(canonicalHostRedirect(request('http://127.0.0.1:4173/'), env), undefined)
})

test('an origin with a path, query or another protocol is an error', () => {
	for (const value of ['meekojs.com', 'https://meekojs.com/docs', 'https://meekojs.com?x=1', 'ftp://meekojs.com', 'https://user@meekojs.com']) {
		assert.throws(() => canonicalHostRedirect(request('https://www.meekojs.com/'), { SITE_CANONICAL_ORIGIN: value }), /SITE_CANONICAL_ORIGIN/, value)
	}
	assert.equal(canonicalHostRedirect(request('https://www.meekojs.com/a'), { SITE_CANONICAL_ORIGIN: 'https://meekojs.com/' })?.status, 301)
})

test('X-Forwarded-Host counts only with MEEKO_TRUST_PROXY, from the outermost trusted proxy', () => {
	const forwarded = (value, trust) =>
		canonicalHostRedirect(request('http://meeko-site:4173/docs', { host: 'meeko-site:4173', 'x-forwarded-host': value }), {
			...env,
			...(trust === undefined ? {} : { MEEKO_TRUST_PROXY: trust }),
		})?.status
	// Any client can send it: without trust it is ignored, also for the apex.
	assert.equal(forwarded('www.meekojs.com', undefined), undefined)
	assert.equal(forwarded('www.meekojs.com', 'false'), undefined)
	assert.equal(forwarded('www.meekojs.com', '0'), undefined)
	assert.equal(canonicalHostRedirect(request('https://www.meekojs.com/', { 'x-forwarded-host': 'meekojs.com' }), env)?.status, 301)
	assert.equal(forwarded('www.meekojs.com', '1'), 301)
	assert.equal(forwarded('www.meekojs.com', 'true'), 301)
	// With one trusted proxy, the last entry is the one it wrote; a client-sent entry before it does not count.
	assert.equal(forwarded('www.meekojs.com, meekojs.com', '1'), undefined)
	assert.equal(forwarded('meekojs.com, www.meekojs.com', '1'), 301)
	assert.equal(forwarded('www.meekojs.com, meekojs.com', '2'), 301)
	assert.equal(forwarded('www.meekojs.com, meekojs.com', 'true'), 301)
	// A mistyped trust (Meeko stops at startup on it) trusts nothing.
	assert.equal(forwarded('www.meekojs.com', 'yes'), undefined)
})

test('the middleware passes every other request on to next()', async () => {
	const previous = process.env.SITE_CANONICAL_ORIGIN
	process.env.SITE_CANONICAL_ORIGIN = 'https://meekojs.com'
	try {
		const next = async () => new Response('page')
		assert.equal((await middleware(request('https://www.meekojs.com/docs?x=1'), next)).headers.get('location'), 'https://meekojs.com/docs?x=1')
		assert.equal(await (await middleware(request('https://meekojs.com/docs'), next)).text(), 'page')
	} finally {
		if (previous === undefined) delete process.env.SITE_CANONICAL_ORIGIN
		else process.env.SITE_CANONICAL_ORIGIN = previous
	}
})

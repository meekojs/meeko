import assert from 'node:assert/strict'
import { test } from 'node:test'

import { allowedHost } from '../server/dashboard/host'

// portless names `meeko dev` with `dev.portless`: `dashboard.meeko` is served at https://dashboard.meeko.localhost.
const portless = ['dashboard.meeko.localhost', 'dashboard.meeko.localhost:443', 'Dashboard.Meeko.LocalHost:1355', 'dashboard-2.localhost', 'a.b.c.localhost:4310']

test('in development a *.localhost name reaches the dashboard, which is how portless names meeko dev', () => {
	for (const host of portless) assert.equal(allowedHost(host, '', true), true, host)
	// The loopback names keep passing, and so do the ones DASHBOARD_ALLOWED_HOSTS lists.
	for (const host of ['127.0.0.1:4310', 'localhost', '[::1]:4310']) assert.equal(allowedHost(host, '', true), true, host)
	assert.equal(allowedHost('dashboard.lan', 'dashboard.lan', true), true)
})

test('in production a *.localhost name is refused, unless DASHBOARD_ALLOWED_HOSTS lists it', () => {
	for (const host of portless) assert.equal(allowedHost(host, '', false), false, host)
	assert.equal(allowedHost('dashboard.meeko.localhost', 'dashboard.meeko.localhost', false), true)
	// What the dashboard decides without being told: only NODE_ENV=development counts as development.
	const before = process.env.NODE_ENV
	try {
		for (const [value, expected] of [
			['production', false],
			['test', false],
			['', false],
			[undefined, false],
			['development', true],
		] as const) {
			if (value === undefined) delete process.env.NODE_ENV
			else process.env.NODE_ENV = value
			assert.equal(allowedHost('dashboard.meeko.localhost', ''), expected, String(value))
		}
	} finally {
		if (before === undefined) delete process.env.NODE_ENV
		else process.env.NODE_ENV = before
	}
})

test('only a whole name under .localhost passes in development: look-alikes and other hosts do not', () => {
	for (const host of [
		'localhost.evil.example',
		'dashboard.meeko.localhost.evil.example',
		'evil-localhost',
		'xlocalhost',
		'evil.example',
		'dashboard.localhost.',
		'.localhost',
		'a..localhost',
		'-a.localhost',
		'a-.localhost',
		'a b.localhost',
		'a@b.localhost',
		'a/b.localhost',
		'127.0.0.1.evil.example',
		'',
		null,
	]) {
		assert.equal(allowedHost(host, '', true), false, String(host))
	}
})

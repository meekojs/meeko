// The session driver of the dashboard with Meeko's SqlSessionStore and SessionManager, against
// PostgreSQL. Every table lives in a temporary schema that the test drops at the end, so it never
// touches the tables of the database it connects to. Skipped without DATABASE_URL.
import { SessionManager, SqlSessionStore } from '@meekojs/meeko/server'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import type { Database } from '../src/db/pool'

import { migrate } from '../src/db/migrations'
import { createDatabase } from '../src/db/pool'
import { dashboardSessionDriver, pruneDashboardSessions } from '../src/db/sessions'

const url = process.env.DATABASE_URL
const schema = `docs_sessions_${process.pid}_${randomBytes(4).toString('hex')}`
const minute = 60_000

describe('dashboard sessions', { skip: url ? false : 'DATABASE_URL is not set' }, () => {
	let admin: Database
	let db: Database
	// A clock the test moves, shared by the driver and the checks.
	let now = Date.now()
	const clock = () => now

	before(async () => {
		admin = createDatabase({ connectionString: url! })
		await admin.query(`CREATE SCHEMA ${schema}`)
		db = createDatabase({ connectionString: url!, searchPath: schema })
		await migrate(db)
	})

	after(async () => {
		await db?.end()
		await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
		await admin?.end()
	})

	test('the store keeps, rotates and revokes a session by family', async () => {
		const store = new SqlSessionStore<{ user: string }>(dashboardSessionDriver(db, { idleMs: 30 * minute, now: clock }))
		const created = { id: 'a1', familyId: 'f1', csrfToken: 't1', data: { user: 'ada' }, createdAt: Date.now(), expiresAt: Date.now() + 60 * minute }
		await store.set(created)
		assert.deepEqual((await store.get('a1'))?.data, { user: 'ada' })

		// Rotation: the new ID replaces the old one in the same family; the old one is gone.
		const rotated = { ...created, id: 'a2', csrfToken: 't2' }
		assert.equal(await store.replace('a1', rotated), true)
		assert.equal(await store.get('a1'), undefined)
		assert.equal((await store.get('a2'))?.csrfToken, 't2')
		assert.equal(await store.replace('a1', { ...created, id: 'a3' }), false, 'an old ID cannot rotate again')

		// A second family cannot take an ID of another family.
		await store.set({ ...created, id: 'a2', familyId: 'f2', csrfToken: 'stolen' })
		assert.equal((await store.get('a2'))?.csrfToken, 't2')
		await assert.rejects(store.set({ ...created, id: 'b1', familyId: 'f1' }), /duplicate key/, 'one active ID per family')

		await store.revokeFamily('f1')
		assert.equal(await store.get('a2'), undefined)
	})

	test('a session idle for the limit reads as missing and is deleted; a read keeps it alive', async () => {
		const store = new SqlSessionStore(dashboardSessionDriver(db, { idleMs: 10 * minute, now: clock }))
		const start = Date.now()
		now = start
		await store.set({ id: 'idle', familyId: 'idle', csrfToken: 't', data: {}, createdAt: start, expiresAt: start + 120 * minute })
		await store.set({ id: 'busy', familyId: 'busy', csrfToken: 't', data: {}, createdAt: start, expiresAt: start + 120 * minute })
		now = start + 6 * minute
		assert.ok(await store.get('busy'))
		now = start + 11 * minute
		assert.ok(await store.get('busy'), 'read 5 minutes ago: still active')
		assert.equal(await store.get('idle'), undefined, 'not read for 11 minutes: gone')
		const left = await db.query<{ id: string }>('SELECT id FROM dashboard_sessions WHERE id IN ($1, $2) ORDER BY id', ['busy', 'idle'])
		assert.deepEqual(
			left.rows.map((row) => row.id),
			['busy'],
		)
		// An idle session cannot rotate either.
		now = start + 30 * minute
		assert.equal(await store.replace('busy', { id: 'busy2', familyId: 'busy', csrfToken: 't', data: {}, createdAt: now, expiresAt: now + minute }), false)
		now = Date.now()
	})

	test('the absolute expiry ends a session that is still in use', async () => {
		const store = new SqlSessionStore(dashboardSessionDriver(db, { idleMs: 30 * minute }))
		const manager = new SessionManager({ store, production: true, ttlMs: 2_000 })
		const handle = await manager.load(new Request('http://127.0.0.1/'))
		const record = await handle.create({ user: 'ada' })
		const cookie = `__Host-meeko.sid=${record.id}`
		const request = () => new Request('http://127.0.0.1/', { headers: { cookie } })
		assert.equal((await manager.load(request())).current?.id, record.id)
		await new Promise((done) => setTimeout(done, 2_100))
		assert.equal((await manager.load(request())).current, undefined)
	})

	test('rate limit windows are counted atomically and pruned when they end', async () => {
		const store = new SqlSessionStore(dashboardSessionDriver(db, { idleMs: 30 * minute }))
		const hits = await Promise.all(Array.from({ length: 8 }, () => store.rateLimit!('login:ip:203.0.113.7', 60_000)))
		assert.deepEqual(
			hits.map((hit) => hit.count).sort((a, b) => a - b),
			[1, 2, 3, 4, 5, 6, 7, 8],
		)
		assert.ok(hits.every((hit) => hit.resetInMs > 0 && hit.resetInMs <= 60_000))
		const stored = await db.query<{ key: Buffer }>('SELECT key FROM dashboard_rate_limits')
		assert.ok(
			stored.rows.every((row) => row.key.length === 32 && !row.key.toString('latin1').includes('203.0.113.7')),
			'only a digest of the key is stored',
		)
		const pruned = await pruneDashboardSessions(db, 30 * minute, Date.now() + 61_000)
		assert.ok(pruned.rateLimits >= 1)
		assert.equal((await db.query('SELECT 1 FROM dashboard_rate_limits')).rowCount, 0)
		assert.throws(() => dashboardSessionDriver(db, { idleMs: 0 }), RangeError)
	})
})

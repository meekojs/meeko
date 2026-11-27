import assert from 'node:assert/strict'
import { test } from 'node:test'

import { withDeadline } from '../src/deadline'

const never = new Promise<never>(() => undefined)

test('work that ends in time keeps its result or its own failure', async () => {
	assert.equal(await withDeadline(Promise.resolve('started'), 1000, () => new Error('late')), 'started')
	await assert.rejects(
		withDeadline(Promise.reject(new Error('spawn ENOENT')), 1000, () => new Error('late')),
		/spawn ENOENT/,
	)
})

test('work that hangs rejects at the deadline with the given error', async () => {
	const before = Date.now()
	await assert.rejects(
		withDeadline(never, 20, () => new Error('it did not answer')),
		/it did not answer/,
	)
	assert.ok(Date.now() - before < 1000)
})

test('the deadline leaves no timer behind and builds no error when the work ends first', async () => {
	let built = 0
	// A pending timer would keep this test file alive well past the suite.
	await withDeadline(Promise.resolve(), 60_000, () => {
		built++
		return new Error('late')
	})
	await new Promise((resolve) => setTimeout(resolve, 30))
	assert.equal(built, 0)
})

test('work that fails after the deadline is not an unhandled rejection', async () => {
	let fail: (error: Error) => void = () => undefined
	const work = new Promise<void>((_, reject) => {
		fail = reject
	})
	await assert.rejects(
		withDeadline(work, 10, () => new Error('late')),
		/late/,
	)
	fail(new Error('killed'))
	await new Promise((resolve) => setTimeout(resolve, 10))
})

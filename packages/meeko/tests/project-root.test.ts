import assert from 'node:assert/strict'
import test from 'node:test'

import { onceByRoot } from '../src/compiler/project-root'

test('onceByRoot loads each project root once, also when the load throws', async () => {
	const calls: string[] = []
	const load = onceByRoot((root: string) => {
		calls.push(root)
		if (root === '/broken') throw new Error('broken')
		return [root]
	})
	const [first, second] = await Promise.all([load('/app'), load('/app')])
	assert.equal(first, second)
	assert.deepEqual(await load('/other'), ['/other'])
	await assert.rejects(load('/broken'), /broken/)
	await assert.rejects(load('/broken'), /broken/)
	assert.deepEqual(calls, ['/app', '/other', '/broken'])
})

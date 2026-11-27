import assert from 'node:assert/strict'
import { test } from 'node:test'

import { LooseDiagnostics, routeDiagnostics } from '../src/diagnostic-owner'
import { globalKey } from '../src/folder-plan'

const outer = 'file:///work/repo'
const inner = 'file:///work/repo/apps/site'

test('a file of a folder is published only by the client of that folder', () => {
	assert.equal(routeDiagnostics({ client: inner, owner: inner, globalActive: true }), 'publish')
	assert.equal(routeDiagnostics({ client: outer, owner: inner, globalActive: true }), 'drop')
	assert.equal(routeDiagnostics({ client: globalKey, owner: inner, globalActive: true }), 'drop')
	assert.equal(routeDiagnostics({ client: outer, owner: outer, globalActive: false }), 'publish')
})

test('a loose file is published only by the global client once it exists', () => {
	assert.equal(routeDiagnostics({ client: globalKey, owner: globalKey, globalActive: true }), 'publish')
	assert.equal(routeDiagnostics({ client: outer, owner: globalKey, globalActive: true }), 'drop')
	assert.equal(routeDiagnostics({ client: inner, owner: globalKey, globalActive: true }), 'drop')
})

test('without the global client a folder server keeps the diagnostics of a loose file, recorded', () => {
	assert.equal(routeDiagnostics({ client: outer, owner: globalKey, globalActive: false }), 'publish-loose')
	assert.equal(routeDiagnostics({ client: globalKey, owner: globalKey, globalActive: false }), 'publish')
})

test('the recorded loose files are taken once, per client', () => {
	const loose = new LooseDiagnostics()
	loose.record(outer, 'file:///tmp/A.meeko')
	loose.record(outer, 'file:///tmp/A.meeko')
	loose.record(outer, 'file:///tmp/B.meeko')
	loose.record(inner, 'file:///tmp/A.meeko')
	assert.deepEqual(
		[...loose.takeAll()],
		[
			[outer, ['file:///tmp/A.meeko', 'file:///tmp/B.meeko']],
			[inner, ['file:///tmp/A.meeko']],
		],
	)
	assert.equal(loose.takeAll().size, 0)
})

test('a stopped client leaves nothing recorded', () => {
	const loose = new LooseDiagnostics()
	loose.record(outer, 'file:///tmp/A.meeko')
	loose.forget(outer)
	assert.equal(loose.takeAll().size, 0)
})

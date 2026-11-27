import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DiagnosticOwners } from '../src/diagnostic-owners'
import { globalKey } from '../src/folder-plan'

const outer = 'file:///work/repo'
const inner = 'file:///work/repo/apps/site'
const config = 'file:///work/meeko.config.ts'
const loose = 'file:///tmp/Loose.meeko'

test('a document of a folder takes diagnostics only from the client of that folder', () => {
	const owners = new DiagnosticOwners()
	const uri = `${inner}/App.meeko`
	assert.deepEqual(owners.route(inner, inner, uri, 2), { accept: true })
	assert.deepEqual(owners.route(outer, inner, uri, 1), { accept: false })
	assert.deepEqual(owners.route(globalKey, inner, uri, 1), { accept: false })
	assert.deepEqual(owners.route(outer, inner, uri, 0), { accept: false })
})

test('a file outside the folders is shown by the first client that reports it, not by two', () => {
	const owners = new DiagnosticOwners()
	assert.deepEqual(owners.route(outer, globalKey, config, 1), { accept: true })
	assert.deepEqual(owners.route(inner, globalKey, config, 1), { accept: false })
	assert.deepEqual(owners.route(outer, globalKey, config, 3), { accept: true }, 'the same client updates its own')
})

test('the global client takes over the documents it owns and the previous client withdraws its own', () => {
	const owners = new DiagnosticOwners()
	owners.route(outer, globalKey, loose, 1)
	assert.deepEqual(owners.route(globalKey, globalKey, loose, 2), { accept: true, evict: outer })
	assert.deepEqual(owners.route(outer, globalKey, loose, 1), { accept: false }, 'the folder client does not take it back')
	assert.deepEqual(owners.route(globalKey, globalKey, loose, 1), { accept: true })
})

test('clearing frees the document for another client', () => {
	const owners = new DiagnosticOwners()
	owners.route(outer, globalKey, config, 1)
	assert.deepEqual(owners.route(inner, globalKey, config, 0), { accept: true }, 'clearing what is not shown changes nothing')
	assert.deepEqual(owners.route(inner, globalKey, config, 1), { accept: false })
	assert.deepEqual(owners.route(outer, globalKey, config, 0), { accept: true })
	assert.deepEqual(owners.route(inner, globalKey, config, 1), { accept: true })
})

test('a stopped client frees the documents it showed', () => {
	const owners = new DiagnosticOwners()
	owners.route(globalKey, globalKey, loose, 1)
	owners.route(outer, globalKey, config, 1)
	owners.forget(globalKey)
	assert.deepEqual(owners.route(outer, globalKey, loose, 1), { accept: true })
	assert.deepEqual(owners.route(inner, globalKey, config, 1), { accept: false }, 'the other documents keep their client')
})

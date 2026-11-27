import assert from 'node:assert/strict'
import { test } from 'node:test'

import { freeSlot, globalKey, innermostFolder, insideFolder, ownerKey, planClients, reconcileClients } from '../src/folder-plan'

const outer = 'file:///work/repo'
const inner = 'file:///work/repo/apps/site'
const sibling = 'file:///work/repository'

test('a document belongs to its innermost workspace folder', () => {
	const folders = [outer, inner, sibling]
	assert.equal(innermostFolder(folders, `${inner}/app/pages/index.meeko`), inner)
	assert.equal(innermostFolder([inner, outer], `${inner}/app/pages/index.meeko`), inner, 'the order of the folders does not matter')
	assert.equal(innermostFolder(folders, `${outer}/apps/other/App.meeko`), outer)
	assert.equal(innermostFolder(folders, `${outer}/apps/site-two/App.meeko`), outer, 'a name that only starts like the nested folder')
	assert.equal(innermostFolder(folders, `${sibling}/App.meeko`), sibling, 'a folder whose name starts like another is not inside it')
	assert.equal(innermostFolder(folders, 'file:///tmp/Loose.meeko'), undefined)
})

test('a folder contains itself with or without the final slash', () => {
	assert.ok(insideFolder(outer, outer))
	assert.ok(insideFolder(`${outer}/`, outer))
	assert.ok(insideFolder(outer, `${outer}/`))
	assert.ok(!insideFolder(outer, sibling))
	assert.ok(!insideFolder(inner, outer))
})

test('documents outside every folder belong to the global client', () => {
	assert.equal(ownerKey([outer, inner], 'file:///tmp/Loose.meeko'), globalKey)
	assert.equal(ownerKey([outer, inner], 'untitled:Untitled-1'), globalKey)
	assert.equal(ownerKey([outer, inner], `${inner}/App.meeko`), inner)
	assert.equal(ownerKey([], `${inner}/App.meeko`), globalKey)
})

test('without folders the only client is the global one', () => {
	assert.deepEqual(planClients({ folders: [], looseDocuments: false }), [{ key: globalKey, excluded: [] }])
})

test('the global client exists only while documents outside the folders are open', () => {
	const keys = (looseDocuments: boolean): string[] => planClients({ folders: [outer], looseDocuments }).map((client) => client.key)
	assert.deepEqual(keys(false), [outer])
	assert.deepEqual(keys(true), [outer, globalKey])
})

test('an outer folder excludes the folders nested in it and the global client excludes them all', () => {
	const deepest = `${inner}/packages/ui`
	const planned = planClients({ folders: [outer, inner, sibling, deepest], looseDocuments: true })
	assert.deepEqual(planned, [
		{ key: outer, folder: outer, excluded: [inner, deepest] },
		{ key: inner, folder: inner, excluded: [deepest] },
		{ key: sibling, folder: sibling, excluded: [] },
		{ key: deepest, folder: deepest, excluded: [] },
		{ key: globalKey, excluded: [outer, inner, sibling, deepest] },
	])
})

test('reconciling keeps the clients whose folder and signature did not change', () => {
	const running = new Map([
		[outer, 'bundled'],
		[inner, 'workspace 1.8.0'],
		[sibling, 'bundled'],
	])
	const wanted = new Map([
		[outer, 'bundled'],
		[inner, 'workspace 1.9.0'],
		['file:///work/new', 'bundled'],
	])
	assert.deepEqual(reconcileClients(running, wanted), {
		stop: [inner, sibling],
		start: [inner, 'file:///work/new'],
		keep: [outer],
	})
})

test('reconciling without changes does nothing, also for a client that failed to start', () => {
	// The failed client keeps its signature: it is retried when its options change or on demand.
	const clients = new Map([
		[outer, 'bundled'],
		[inner, 'workspace 1.8.0'],
	])
	assert.deepEqual(reconcileClients(clients, new Map(clients)), { stop: [], start: [], keep: [outer, inner] })
})

test('a forced reconciliation restarts every wanted client and stops the rest', () => {
	const running = new Map([
		[outer, 'bundled'],
		[sibling, 'bundled'],
	])
	const wanted = new Map([
		[outer, 'bundled'],
		[inner, 'bundled'],
	])
	assert.deepEqual(reconcileClients(running, wanted, true), { stop: [outer, sibling], start: [outer, inner], keep: [] })
})

test('the first start of every folder is a start without stops', () => {
	assert.deepEqual(reconcileClients(new Map(), new Map([[outer, 'bundled']])), { stop: [], start: [outer], keep: [] })
})

test('each client takes the lowest free debug slot', () => {
	assert.equal(freeSlot([]), 0)
	assert.equal(freeSlot([0, 1, 2]), 3)
	assert.equal(freeSlot([0, 2]), 1)
	assert.equal(freeSlot([1, 2]), 0)
})

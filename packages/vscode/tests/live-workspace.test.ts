import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import { localWorkspacePath, reconcileWatchedFolders } from '../src/live/workspace'

test('accepts only descendants of a local workspace root', () => {
	const root = resolve('workspace')
	assert.equal(localWorkspacePath(root, resolve(root, '.meeko/dev/server.json')), join('.meeko', 'dev', 'server.json'))
	assert.equal(localWorkspacePath(root, root), undefined)
	assert.equal(localWorkspacePath(root, resolve(root, '..', 'outside', '.meeko/dev/server.json')), undefined)
	assert.equal(localWorkspacePath(root, resolve(root, '..', 'workspace-copy', 'server.json')), undefined)
})

test('reconciles local roots without duplicate watchers and disposes removed roots', () => {
	const folder = (name: string, scheme = 'file') => ({ uri: { scheme, toString: () => `${scheme}:///${name}` } })
	const a = folder('a')
	const b = folder('b')
	const virtual = folder('virtual', 'vscode-vfs')
	const watched = new Map<string, { dispose(): void }[]>()
	const created: string[] = []
	const disposed: string[] = []
	const subscribe = (root: typeof a) => {
		const key = root.uri.toString()
		created.push(key)
		return [0, 1].map(() => ({
			dispose: () => {
				disposed.push(key)
			},
		}))
	}

	assert.deepEqual(reconcileWatchedFolders([a, virtual], watched, subscribe), [a])
	assert.deepEqual(reconcileWatchedFolders([a, b, virtual], watched, subscribe), [b])
	assert.deepEqual(created, ['file:///a', 'file:///b'])
	assert.equal(watched.size, 2)
	assert.deepEqual(reconcileWatchedFolders([b, virtual], watched, subscribe), [])
	assert.deepEqual(disposed, ['file:///a', 'file:///a'])
	assert.deepEqual(reconcileWatchedFolders([a, b], watched, subscribe), [a])
	assert.equal(watched.size, 2)
	assert.deepEqual(reconcileWatchedFolders([], watched, subscribe), [])
	assert.equal(watched.size, 0)
	assert.equal(disposed.length, 6)
})

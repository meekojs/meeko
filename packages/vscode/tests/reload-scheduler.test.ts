import assert from 'node:assert/strict'
import { matchesGlob } from 'node:path'
import { test } from 'node:test'

import { createReloadScheduler, reloadPattern } from '../src/dev/reload-scheduler'

test('watches the files VS Code reads only on reload and skips dependencies', () => {
	for (const path of ['package.json', 'language-configuration.json', 'syntaxes/meeko.tmLanguage.json', 'snippets/meeko.json', 'dist/extension.js', 'dist/server.js']) {
		assert.equal(matchesGlob(path, reloadPattern), true, path)
	}
	for (const path of ['node_modules/vscode-languageclient/package.json', 'dist/extension.js.map', 'src/extension.ts', 'tests/fixtures/package.json']) {
		assert.equal(matchesGlob(path, reloadPattern), false, path)
	}
})

test('collapses a burst of changes into a single reload', (context) => {
	context.mock.timers.enable({ apis: ['setTimeout'] })
	let reloads = 0
	const scheduler = createReloadScheduler(() => reloads++, 300)

	scheduler.schedule()
	context.mock.timers.tick(200)
	scheduler.schedule()
	context.mock.timers.tick(299)
	assert.equal(reloads, 0)
	context.mock.timers.tick(1)
	assert.equal(reloads, 1)

	scheduler.schedule()
	context.mock.timers.tick(300)
	assert.equal(reloads, 2)
})

test('cancels the pending reload and ignores changes after dispose', (context) => {
	context.mock.timers.enable({ apis: ['setTimeout'] })
	let reloads = 0
	const scheduler = createReloadScheduler(() => reloads++, 300)

	scheduler.schedule()
	scheduler.dispose()
	scheduler.schedule()
	context.mock.timers.tick(1000)
	assert.equal(reloads, 0)
})

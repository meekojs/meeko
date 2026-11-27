import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type { ResolvedLanguageServer } from '../src/server-resolution'

import { restartCommand, serverLabel, serverStatus, showOutputCommand } from '../src/status'

const workspace: ResolvedLanguageServer = { module: '/repo/node_modules/@meekojs/meeko/dist/language-server/main.js', source: 'workspace', version: '1.8.0' }
const bundled: ResolvedLanguageServer = { module: '/extension/dist/server.js', source: 'bundled', reason: 'the @meekojs/meeko package was not found in the workspace' }

test('the label names the workspace version or the bundled server', () => {
	assert.equal(serverLabel(workspace), 'workspace 1.8.0')
	assert.equal(serverLabel({ module: workspace.module, source: 'workspace' }), 'workspace')
	assert.equal(serverLabel(bundled), 'bundled')
})

test('a running workspace server shows its version and restarts on click', () => {
	assert.deepEqual(serverStatus({ state: 'running', resolution: workspace, folder: 'site' }), {
		text: 'Meeko: workspace 1.8.0',
		detail: '@meekojs/meeko server of the "site" project',
		severity: 'information',
		busy: false,
		command: { command: restartCommand, title: 'Restart' },
	})
})

test('the bundled server explains why the workspace one is not used', () => {
	const status = serverStatus({ state: 'running', resolution: bundled, folder: 'site' })
	assert.equal(status.text, 'Meeko: bundled')
	assert.equal(status.detail, bundled.reason)
	assert.equal(status.severity, 'information')
})

test('a starting server is busy', () => {
	const status = serverStatus({ state: 'starting', resolution: workspace, folder: 'site' })
	assert.equal(status.text, 'Meeko: workspace 1.8.0')
	assert.equal(status.busy, true)
})

test('a server that did not start is an error that opens the output', () => {
	assert.deepEqual(serverStatus({ state: 'failed', resolution: bundled, folder: 'site', error: 'spawn ENOENT' }), {
		text: 'Meeko: error (bundled)',
		detail: 'The language server for "site" failed to start: spawn ENOENT',
		severity: 'error',
		busy: false,
		command: { command: showOutputCommand, title: 'Show Output' },
	})
	assert.equal(serverStatus({ state: 'failed', resolution: bundled, folder: 'site' }).detail, 'The language server for "site" failed to start')
})

test('a document without a server says so', () => {
	const status = serverStatus(undefined)
	assert.equal(status.text, 'Meeko: no server')
	assert.equal(status.severity, 'information')
	assert.equal(status.command.command, restartCommand)
})

test('the commands of the status are contributed in the Meeko category', () => {
	const root = resolve(import.meta.dirname, '..')
	const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { contributes: { commands: Array<{ command: string; title: string; category?: string }> } }
	const english = JSON.parse(readFileSync(join(root, 'package.nls.json'), 'utf8')) as Record<string, string>
	const spanish = JSON.parse(readFileSync(join(root, 'package.nls.es.json'), 'utf8')) as Record<string, string>
	const titles = (texts: Record<string, string>): Map<string, string> => new Map(manifest.contributes.commands.map((command) => [command.command, `${command.category}: ${texts[command.title.slice(1, -1)]}`]))
	assert.equal(titles(english).get(restartCommand), 'Meeko: Restart Language Server')
	assert.equal(titles(english).get(showOutputCommand), 'Meeko: Show Output')
	assert.equal(titles(spanish).get(restartCommand), 'Meeko: Reiniciar servidor de lenguaje')
	assert.equal(titles(spanish).get(showOutputCommand), 'Meeko: Mostrar salida')
})

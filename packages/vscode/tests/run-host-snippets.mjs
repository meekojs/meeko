import { runTests } from '@vscode/test-electron'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const data = await mkdtemp(join(tmpdir(), 'meeko-snippets-host-'))
if (!resolve(data).startsWith(resolve(tmpdir(), 'meeko-snippets-host-'))) throw new Error('Unexpected test directory')
const workspace = join(data, 'workspace')
const userData = join(data, 'user-data')
try {
	await mkdir(workspace)
	await mkdir(join(userData, 'User', 'snippets'), { recursive: true })
	await writeFile(join(userData, 'User', 'settings.json'), JSON.stringify({ 'editor.snippetSuggestions': 'inline', 'editor.tabCompletion': 'off' }))
	// A user's own snippets for the language, with prefixes close to those of the extension.
	await writeFile(
		join(userData, 'User', 'snippets', 'meeko.json'),
		JSON.stringify({
			'User component': { prefix: 'mc', body: ['<template>user</template>'] },
			'User signal': { prefix: 'ms', body: ['user-signal'] },
		}),
	)
	await writeFile(join(userData, 'User', 'snippets', 'script.code-snippets'), JSON.stringify({ 'User script snippet': { scope: 'typescript', prefix: 'muser', body: ['user-script'] } }))
	await runTests({
		...(process.env.MEEKO_HOST_VSCODE ? { vscodeExecutablePath: process.env.MEEKO_HOST_VSCODE } : { version: 'stable' }),
		// test:host:isolated points this at the extracted VSIX.
		extensionDevelopmentPath: process.env.MEEKO_HOST_EXTENSION ?? resolve(import.meta.dirname, '..'),
		extensionTestsPath: join(import.meta.dirname, 'host-snippets-index.cjs'),
		launchArgs: [workspace, '--skip-welcome', '--disable-extensions', '--disable-workspace-trust', '--user-data-dir', userData],
	})
} finally {
	await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}

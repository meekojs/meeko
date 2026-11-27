import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { codeCli, pickCodeCli } from '../install-local.mjs'

const windowsCode = '/mnt/c/Users/Dev/AppData/Local/Programs/Microsoft VS Code/bin/code'
const serverCli = '/home/dev/.vscode-server/bin/abc123/bin/code-server'
const wsl = { WSL_DISTRO_NAME: 'Ubuntu' }

test('prefers the VS Code server over the Windows CLI inside WSL', () => {
	// The Windows CLI installs into WSL but --locate-extension answers with the Windows extensions.
	assert.equal(pickCodeCli(windowsCode, serverCli, wsl), serverCli)
	assert.equal(pickCodeCli(windowsCode, undefined, wsl), windowsCode)
})

test('keeps code from PATH outside WSL and for a Linux CLI inside WSL', () => {
	assert.equal(pickCodeCli(windowsCode, serverCli, {}), windowsCode)
	const remoteCli = '/home/dev/.vscode-server/bin/abc123/bin/remote-cli/code'
	assert.equal(pickCodeCli(remoteCli, serverCli, wsl), remoteCli)
})

test('falls back to the newest VS Code server when code is not on PATH', (context) => {
	const home = mkdtempSync(join(tmpdir(), 'meeko-install-local-'))
	context.after(() => rmSync(home, { force: true, recursive: true }))
	const server = join(home, '.vscode-server', 'bin', 'abc123', 'bin', 'code-server')
	mkdirSync(join(server, '..'), { recursive: true })
	writeFileSync(server, '')
	assert.equal(codeCli(undefined, { PATH: '' }, home), server)
	assert.equal(codeCli(undefined, { PATH: '' }, join(home, 'missing')), undefined)
})

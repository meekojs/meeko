import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

test('release asset inventory, checksums and packaging failures preserve their contracts', { timeout: 30_000 }, () => {
	const result = spawnSync('pwsh', ['-NoProfile', '-File', fileURLToPath(new URL('./release-assets.test.ps1', import.meta.url))], {
		cwd: fileURLToPath(new URL('../', import.meta.url)),
		encoding: 'utf8',
		timeout: 25_000,
		windowsHide: true,
	})
	if (result.error) throw result.error
	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})

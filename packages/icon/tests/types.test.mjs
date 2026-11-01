import { execFile } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

test('consumer types: generated names, an invalid name and the typed icon key of the configuration', async () => {
	const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
	// Every @ts-expect-error must be used: an unused one fails the check (TS2578).
	// `--types node` resolves from the cwd, so run from the package even when the suite starts at the root.
	await promisify(execFile)(process.execPath, [tsc, '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--module', 'nodenext', '--target', 'es2022', '--types', 'node', fileURLToPath(new URL('./types/consumer.ts', import.meta.url))], { cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true })
})

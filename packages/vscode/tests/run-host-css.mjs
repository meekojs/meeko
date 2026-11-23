import { runTests } from '@vscode/test-electron'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

// Todo queda en un directorio temporal del repositorio; no instala extensiones ni toca el perfil real.
const base = resolve(import.meta.dirname, '../../..', '.meeko')
await mkdir(base, { recursive: true })
const root = await mkdtemp(join(base, 'vscode-css-'))
const previous = process.env.MEEKO_HOST_CONSUMER
try {
	const consumer = join(root, 'consumer')
	await mkdir(join(consumer, 'app/styles/utilities'), { recursive: true })
	await mkdir(join(consumer, 'app/components'), { recursive: true })
	await mkdir(join(consumer, '.vscode'), { recursive: true })
	await writeFile(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n')
	await writeFile(join(consumer, 'meeko.config.ts'), 'throw new Error("CSS must not execute config"); export default {}\n')
	await writeFile(join(consumer, '.vscode/settings.json'), JSON.stringify({ 'meeko.languageServer.preferWorkspace': false, 'meeko.classes.completion': 'off' }))
	await writeFile(join(consumer, 'app/styles/main.css'), '@import "./tokens.css"; @import "./utilities/variant.css";\n')
	await writeFile(join(consumer, 'app/styles/tokens.css'), '@theme { --meeko-host-inverted: #123456; }\n')
	await writeFile(join(consumer, 'app/styles/utilities/variant.css'), '@utility inverted { color: var(--meeko-host-inverted); }\n')
	await writeFile(join(consumer, 'app/components/Example.meeko'), '<template><p style="color: var(--meeko-host-inverted)">Example</p></template><style>.example { color: var(--meeko-host-inverted); }</style>\n')
	process.env.MEEKO_HOST_CONSUMER = consumer
	const executable = process.env.MEEKO_HOST_VSCODE ?? (process.platform === 'win32' ? join(process.env.LOCALAPPDATA, 'Programs/Microsoft VS Code/Code.exe') : undefined)
	await runTests({
		...(executable ? { vscodeExecutablePath: executable } : {}),
		extensionDevelopmentPath: resolve(import.meta.dirname, '..'),
		extensionTestsPath: join(import.meta.dirname, 'host-css.cjs'),
		launchArgs: [consumer, '--skip-welcome', '--disable-extensions', '--disable-workspace-trust', '--user-data-dir', join(root, 'user-data'), '--extensions-dir', join(root, 'extensions')],
	})
} finally {
	if (previous === undefined) delete process.env.MEEKO_HOST_CONSUMER
	else process.env.MEEKO_HOST_CONSUMER = previous
	assert.ok(resolve(root).startsWith(base + sep))
	await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}

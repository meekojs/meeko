import { spawnSync } from 'node:child_process'

const suites = [
	'browser',
	'conditional-chains',
	'create-id',
	'editor-bridge',
	'devtools-config',
	'teleport',
	'popover-select',
	'model-props',
	'scoped-styles',
	'document-html',
	'scroll-restoration',
	'hydration-errors',
]

const requested = process.argv.slice(2)
const selection = [...new Set(requested.map((name) => name.replace(/^tests\//, '').replace(/\.e2e\.ts$/, '')))]
const unknown = selection.filter((name) => !suites.includes(name))
if (unknown.length > 0) {
	console.error(`Suites E2E desconocidas: ${unknown.join(', ')}\nDisponibles: ${suites.join(', ')}`)
	process.exit(1)
}

const selected = selection.length > 0 ? selection : suites
const env = { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=8192' }

function run(command: string, args: string[], shell = false): void {
	const result = spawnSync(command, args, { env, shell, stdio: 'inherit', windowsHide: true, timeout: 60 * 60 * 1000 })
	if (result.error) throw result.error
	if (result.status !== 0) process.exit(result.status ?? 1)
}

if (selected.includes('browser')) {
	const windows = process.platform === 'win32'
	run('pnpm', ['run', 'example:bundle:prepared'], windows)
	run('pnpm', ['run', 'vite:build'], windows)
}
run(process.execPath, ['--import', 'tsx', '--test', ...selected.map((name) => `tests/${name}.e2e.ts`)])

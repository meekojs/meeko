// Runs locally the jobs of .github/workflows/ci.yml, and the gates only publish.yml adds, in sequence, without stopping at the first failure: a failing step
// in CI hides the ones after it in the same job, and each push then uncovers one more. Usage:
//
//   pnpm ci:local                       every job
//   pnpm ci:local --only checks,verify  some jobs (see --list)
//   pnpm ci:local --skip performance    every job but some
//   pnpm ci:local --no-build            reuse the current build
//   pnpm ci:local --install             pnpm install --frozen-lockfile first, as CI
//
// A step that needs a tool this machine lacks (pwsh, bun, deno, Redis) or another OS is skipped and listed at the end. Logs go to
// .meeko/ci-local/. Windows and macOS runners remain CI's: timing and paths may still differ there.
import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const minutes = (value) => value * 60_000

/** Whether `command` runs on this machine. */
function available(command) {
	return spawnSync(command, ['--version'], { shell: process.platform === 'win32', stdio: 'ignore' }).status === 0
}

/** Chromium of the Playwright that a package uses, as CI passes it in MEEKO_CHROME_PATH. */
function chromiumOf(folder) {
	try {
		return createRequire(join(root, folder, 'package.json'))('playwright-core').chromium.executablePath()
	} catch {
		return undefined
	}
}

const requirements = {
	bun: () => available('bun') || 'bun no está instalado',
	deno: () => available('deno') || 'deno no está instalado',
	pwsh: () => available('pwsh') || 'pwsh (PowerShell 7) no está instalado',
	redis: () => Boolean(process.env.MEEKO_REDIS_URL) || 'MEEKO_REDIS_URL no está definido (p. ej. redis://127.0.0.1:6379)',
	windows: () => process.platform === 'win32' || 'sólo funciona en Windows (Start-Process -WindowStyle)',
	xvfb: () => process.platform !== 'linux' || available('xvfb-run') || 'xvfb-run no está instalado',
}

const pnpm = (...args) => ['pnpm', ...args]
const uiChrome = () => ({ MEEKO_CHROME_PATH: chromiumOf('packages/ui') })
const i18nChrome = () => ({ MEEKO_CHROME_PATH: chromiumOf('apps/i18n') })
const ciArtifacts = join(root, 'packages/meeko/.meeko/ci-artifacts')

/**
 * Jobs of ci.yml (their ids) and their steps, in the order of the workflow. `needs` names requirements; `timeout` is in
 * minutes; `once` marks a build that another job also needs and only runs once per invocation.
 */
export const jobs = [
	{
		id: 'checks',
		steps: [
			{ name: 'lint', command: pnpm('lint') },
			{ name: 'check', command: pnpm('run', 'check') },
			{ name: 'check:apps', command: pnpm('run', 'check:apps') },
		],
	},
	{
		id: 'test-support',
		steps: [
			{ name: 'contratos de fixtures y procesos', command: ['node', '--test', 'scripts/test-support/test-support.test.ts'] },
			{ name: 'contratos de los assets de release', command: ['pwsh', '-NoProfile', '-File', 'scripts/release-assets.test.ps1'], needs: ['pwsh'] },
		],
	},
	{
		id: 'core-tests',
		steps: [
			{ name: 'UI, i18n, icon, ESLint y Prettier', command: pnpm('run', 'test:packages'), timeout: 45 },
			{ name: 'web pública', command: pnpm('-F', 'meeko-site', 'run', 'test') },
			{ name: 'contenido de la documentación', command: pnpm('-F', 'meeko-docs-content', 'run', 'test') },
			{ name: 'módulo de documentación', command: pnpm('-F', 'meeko-docs', 'run', 'test') },
			{ name: 'dashboard: check', command: pnpm('-F', 'meeko-dashboard', 'run', 'check') },
			{ name: 'dashboard: test', command: pnpm('-F', 'meeko-dashboard', 'run', 'test') },
			{ name: 'conformidad del adaptador Node', command: pnpm('run', 'conformance:node') },
			{ name: 'build del sitio i18n', command: pnpm('-F', 'meeko-i18n-site', 'run', 'build'), once: 'i18n-site-build' },
			{ name: 'E2E del sitio i18n', command: pnpm('-F', 'meeko-i18n-site', 'run', 'test:e2e'), env: i18nChrome, timeout: 45 },
			{ name: 'E2E de navegador del núcleo', command: pnpm('-F', '@meekojs/meeko', 'run', 'e2e:prepared'), timeout: 60 },
			{ name: 'E2E multimotor (pilot)', command: pnpm('run', 'pilot:e2e'), timeout: 45 },
			{ name: 'consumidor del tarball (package:smoke)', command: pnpm('run', 'package:smoke'), needs: ['pwsh'], timeout: 45 },
			{ name: 'consumidor de los paquetes del workspace', command: pnpm('run', 'package:workspace-smoke'), needs: ['pwsh'], timeout: 45 },
			{ name: 'empaquetar @meekojs/meeko', command: pnpm('pack', '--pack-destination', ciArtifacts), cwd: 'packages/meeko', before: () => rm(ciArtifacts, { force: true, recursive: true }) },
			{
				name: 'consumidor full-stack y navegador',
				command: () => ['pwsh', '-NoProfile', '-File', 'packages/meeko/tests/fullstack-consumer.ps1', '-Tarball', join(ciArtifacts, (existsSync(ciArtifacts) ? readdirSync(ciArtifacts) : []).find((file) => file.endsWith('.tgz')) ?? 'missing.tgz')],
				env: () => ({ MEEKO_BROWSER_CHANNEL: 'chromium' }),
				needs: ['pwsh', 'windows'],
				timeout: 45,
			},
		],
	},
	{
		id: 'verify',
		steps: [{ name: 'verify:prepared (los tres shards)', command: pnpm('run', 'verify:prepared'), timeout: 90 }],
	},
	{
		id: 'ui-browser',
		steps: [
			{ name: 'build del sitio UI', command: pnpm('-F', 'meeko-ui-site', 'run', 'build') },
			{ name: 'build del sitio i18n', command: pnpm('-F', 'meeko-i18n-site', 'run', 'build'), once: 'i18n-site-build' },
			{ name: 'E2E de UI e icon', command: ['node', '--test', '--test-concurrency=1', 'packages/ui/tests/*.e2e.mjs', 'packages/icon/tests/*.e2e.mjs'], env: uiChrome, timeout: 90 },
		],
	},
	{
		id: 'performance',
		steps: [{ name: 'presupuestos de rendimiento', command: pnpm('-F', '@meekojs/meeko', 'run', 'benchmark:budget'), env: () => ({ MEEKO_BROWSER_CHANNEL: 'chromium' }), timeout: 30 }],
	},
	{
		id: 'redis-integration',
		steps: [{ name: 'sesiones reales en Redis', command: pnpm('-F', '@meekojs/meeko', 'exec', 'tsx', '--test', 'tests/redis.integration.ts'), needs: ['redis'] }],
	},
	{ id: 'bun', steps: [{ name: 'conformidad Bun', command: pnpm('run', 'conformance:bun'), env: () => ({ MEEKO_CONFORMANCE_REQUIRE: 'bun' }), needs: ['bun'] }] },
	{ id: 'deno', steps: [{ name: 'conformidad Deno', command: pnpm('run', 'conformance:deno'), env: () => ({ MEEKO_CONFORMANCE_REQUIRE: 'deno' }), needs: ['deno'] }] },
	{ id: 'workerd', steps: [{ name: 'conformidad workerd', command: pnpm('run', 'conformance:workerd'), env: () => ({ MEEKO_CONFORMANCE_REQUIRE: 'workerd', WRANGLER_SEND_METRICS: 'false' }) }] },
	{
		id: 'vscode-extension',
		steps: [
			{ name: 'empaquetar el VSIX', command: pnpm('run', 'package:vsix'), cwd: 'packages/vscode' },
			{ name: 'host de VS Code', command: [...(process.platform === 'linux' ? ['xvfb-run', '-a'] : []), ...pnpm('run', 'test:host:isolated')], cwd: 'packages/vscode', needs: ['pwsh', 'xvfb'], timeout: 30 },
		],
	},
	{
		// The publication rehearsal of ci.yml (`package-gates`, only in a PR that touches the publication chain) and
		// publish.yml run these, so the rest of CI passes without them and the release stops on them. The rest of
		// the gates of publish.yml are the jobs above; `--only package-gates` runs these two before tagging.
		// The `changes` job of ci.yml (which jobs a PR needs) has no local job: locally everything runs.
		id: 'package-gates',
		steps: [
			{ name: 'formato (format:check)', command: pnpm('run', 'format:check') },
			{
				name: 'empaquetar y comprobar los seis tarballs',
				command: () => ['pwsh', '-NoProfile', '-File', 'scripts/publish-packages.ps1', '-PackOnly', '-ArtifactDirectory', join(root, '.meeko/ci-local-tarballs')],
				before: () => rm(join(root, '.meeko/ci-local-tarballs'), { force: true, recursive: true }),
				needs: ['pwsh'],
			},
		],
	},
]

/** Kills `child` and everything it started. */
function killTree(child) {
	if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
	else {
		try {
			process.kill(-child.pid, 'SIGKILL')
		} catch {
			child.kill('SIGKILL')
		}
	}
}

/** Runs one step with its output in `log`; resolves to `'passed'`, `'failed'` or `'timeout'`. */
function run(step, log) {
	const [command, ...args] = typeof step.command === 'function' ? step.command() : step.command
	const env = { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS ?? '--max-old-space-size=8192', ...step.env?.() }
	const out = createWriteStream(log)
	out.write(`$ ${[command, ...args].join(' ')}\n\n`)
	return new Promise((resolve) => {
		const child = spawn(command, args, { cwd: join(root, step.cwd ?? ''), detached: process.platform !== 'win32', env, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
		child.stdout.pipe(out, { end: false })
		child.stderr.pipe(out, { end: false })
		let timedOut = false
		const timer = setTimeout(
			() => {
				timedOut = true
				killTree(child)
			},
			minutes(step.timeout ?? 30),
		)
		const finish = (result) => {
			clearTimeout(timer)
			out.end(`\n[ci-local] ${result}\n`, () => resolve(result))
		}
		child.on('error', (error) => {
			out.write(`\n${error.stack ?? error}\n`)
			finish('failed')
		})
		child.on('close', (code) => finish(timedOut ? 'timeout' : code === 0 ? 'passed' : 'failed'))
	})
}

/** The last lines of `log`, for the summary. */
function tail(log) {
	return readFileSync(log, 'utf8').trimEnd().split('\n').slice(-25).join('\n')
}

function parse(argv) {
	const options = { build: true, install: false, list: false, only: undefined, skip: new Set() }
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index]
		const value = () => (argv[++index] ?? '').split(',').filter(Boolean)
		if (argument === '--only') options.only = new Set(value())
		else if (argument === '--skip') for (const id of value()) options.skip.add(id)
		else if (argument === '--no-build') options.build = false
		else if (argument === '--install') options.install = true
		else if (argument === '--list') options.list = true
		else throw new Error(`Opción desconocida: ${argument}`)
	}
	for (const id of [...(options.only ?? []), ...options.skip]) if (!jobs.some((job) => job.id === id)) throw new Error(`No hay un job ${id}; véase --list`)
	return options
}

const format = (milliseconds) => `${Math.floor(milliseconds / 60_000)}m${String(Math.round((milliseconds % 60_000) / 1000)).padStart(2, '0')}s`

async function main() {
	const options = parse(process.argv.slice(2))
	if (options.list) {
		for (const job of jobs) console.log(`${job.id}\n${job.steps.map((step) => `  - ${step.name}${step.needs ? ` (necesita ${step.needs.join(', ')})` : ''}`).join('\n')}`)
		return
	}
	const selected = jobs.filter((job) => (!options.only || options.only.has(job.id)) && !options.skip.has(job.id))
	const logs = join(root, '.meeko/ci-local')
	await rm(logs, { force: true, recursive: true })
	await mkdir(logs, { recursive: true })
	const setup = [...(options.install ? [{ name: 'pnpm install --frozen-lockfile', command: pnpm('install', '--frozen-lockfile') }] : []), ...(options.build ? [{ name: 'pnpm build:packages', command: pnpm('build:packages'), timeout: 30 }] : [])]
	const plan = [...setup.map((step) => ({ job: 'setup', step })), ...selected.flatMap((job) => job.steps.map((step) => ({ job: job.id, step })))]
	const results = []
	const done = new Set()
	const started = Date.now()
	for (const [index, { job, step }] of plan.entries()) {
		const label = `${job} › ${step.name}`
		const missing = (step.needs ?? []).map((need) => requirements[need]()).filter((value) => value !== true)
		if (step.once && done.has(step.once)) continue
		if (missing.length) {
			results.push({ label, status: 'skipped', reason: missing.join('; ') })
			console.log(`○ ${label}: omitido (${missing.join('; ')})`)
			continue
		}
		const failedSetup = results.some((result) => result.setup && result.status !== 'passed')
		if (failedSetup) {
			results.push({ label, status: 'skipped', reason: 'falló la preparación' })
			continue
		}
		const log = join(logs, `${String(index + 1).padStart(2, '0')}-${job}-${step.name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '')}.log`)
		process.stdout.write(`▶ ${label} … `)
		const start = Date.now()
		await step.before?.()
		const status = await run(step, log)
		if (step.once && status === 'passed') done.add(step.once)
		results.push({ label, log, setup: job === 'setup', status, time: Date.now() - start })
		console.log(`${status === 'passed' ? '✔' : '✖'} ${status === 'passed' ? '' : status + ' '}(${format(Date.now() - start)})`)
	}
	const failed = results.filter((result) => result.status === 'failed' || result.status === 'timeout')
	const skipped = results.filter((result) => result.status === 'skipped')
	console.log(`\n${results.length - failed.length - skipped.length} correctos, ${failed.length} fallidos, ${skipped.length} omitidos en ${format(Date.now() - started)}. Registros: ${logs}`)
	for (const result of failed) console.log(`\n✖ ${result.label} (${result.status}) — ${result.log}\n${tail(result.log)}`)
	if (skipped.length) console.log(`\nOmitidos (la CI sí los ejecuta):\n${skipped.map((result) => `  ○ ${result.label}: ${result.reason}`).join('\n')}`)
	process.exitCode = failed.length ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()

// Exercises the release scripts for real under PowerShell 7, with `npm` and `pnpm` replaced by mocks
// on the PATH and the registry by a local server. Nothing here can reach npmjs.com: the mock npm
// refuses any registry that is not this machine.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const scripts = fileURLToPath(new URL('./', import.meta.url))
const order = ['meeko', 'i18n', 'icon', 'ui', 'eslint-plugin', 'prettier-plugin']
const newPackages = order.slice(1)
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { timeout: 60_000 }).status === 0

const mockNpm = `import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
const registry = args[args.indexOf('--registry') + 1] ?? ''
appendFileSync(process.env.MOCK_LOG, JSON.stringify(['npm', ...args]) + '\\n')
const fail = (code) => { console.error('npm error code ' + code); process.exit(1) }
if (args[0] === '--version') { console.log(process.env.MOCK_NPM_VERSION ?? '11.19.0'); process.exit(0) }
if (args.includes('--registry') && !registry.startsWith('http://127.0.0.1:')) fail('MOCK_REFUSES_REAL_REGISTRY')
if (args[0] === 'whoami') {
  if (process.env.MOCK_WHOAMI) fail(process.env.MOCK_WHOAMI)
  console.log('maintainer')
  process.exit(0)
}
if (args[0] === 'publish') {
  const short = args[1].match(/meekojs-(.+)-\\d+\\.\\d+\\.\\d+[^\\\\/]*\\.tgz$/)[1]
  if (args.includes('--dry-run')) process.exit(0)
  if (process.env.MOCK_PUBLISH_FAIL_PACKAGE === short) fail(process.env.MOCK_PUBLISH_FAIL_CODE)
  await fetch(registry + '__mock/publish/' + short, { method: 'POST' })
  process.exit(0)
}
fail('MOCK_UNKNOWN_COMMAND')
`

const mockPnpm = `import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const args = process.argv.slice(2)
appendFileSync(process.env.MOCK_LOG, JSON.stringify(['pnpm', ...args]) + '\\n')
const directory = args[args.indexOf('--dir') + 1]
const destination = args[args.indexOf('--pack-destination') + 1]
const short = directory.split('/').pop()
if (process.env.MOCK_PACK_FAIL === short) process.exit(1)
const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
if (process.env.MOCK_PACK_WORKSPACE === short) manifest.dependencies = { '@meekojs/meeko': 'workspace:*' }
if (process.env.MOCK_PACK_WRONG_VERSION === short) manifest.version = '0.0.1'
const work = mkdtempSync(join(resolve(destination), 'pack-'))
mkdirSync(join(work, 'package'))
writeFileSync(join(work, 'package/package.json'), JSON.stringify(manifest))
const out = 'meekojs-' + short + '-' + JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).version + '.tgz'
const tar = spawnSync('tar', ['-czf', join('..', out), 'package'], { cwd: work })
rmSync(work, { force: true, recursive: true })
process.exit(tar.status ?? 1)
`

function writeShim(bin, name) {
	writeFileSync(join(bin, `${name}.mjs`), name === 'npm' ? mockNpm : mockPnpm)
	writeFileSync(join(bin, `${name}.cmd`), `@node "%~dp0${name}.mjs" %*\r\n`)
	writeFileSync(join(bin, name), `#!/bin/sh\nexec node "$(dirname "$0")/${name}.mjs" "$@"\n`)
	chmodSync(join(bin, name), 0o755)
}

/** Registro npm mínimo: 404 real para lo que no existe y respuestas forzadas para simular fallos. */
function startRegistry() {
	const versions = new Map([['@meekojs/meeko', new Set(['1.7.1'])]])
	const state = { forcedStatus: 0 }
	const server = createServer((request, response) => {
		const parts = request.url.split('/').filter(Boolean).map(decodeURIComponent)
		if (parts[0] === '__mock') {
			add(`@meekojs/${parts[2]}`, process.env.MOCK_VERSION ?? '1.8.0')
			response.end('{}')
			return
		}
		if (state.forcedStatus) {
			response.statusCode = state.forcedStatus
			response.end('{}')
			return
		}
		const [name, version] = parts
		const known = versions.get(name)
		const resolved = version === 'latest' ? [...(known ?? [])].at(-1) : version
		if (!known || !known.has(resolved)) {
			response.statusCode = 404
			response.end('{"error":"not found"}')
			return
		}
		response.setHeader('content-type', 'application/json')
		response.end(JSON.stringify({ name, version: resolved }))
	})
	function add(name, version) {
		if (!versions.has(name)) versions.set(name, new Set())
		versions.get(name).add(version)
	}
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => resolve({ add, has: (name, version) => versions.get(name)?.has(version) ?? false, server, state, url: `http://127.0.0.1:${server.address().port}/` }))
	})
}

function git(cwd, ...args) {
	const result = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' })
	assert.equal(result.status, 0, result.stderr)
}

const root = mkdtempSync(join(tmpdir(), 'meeko-publish-'))
const bin = join(root, 'bin')
let fixtureId = 0
let registry

/** Un monorepo mínimo y limpio en git, con los scripts reales y `origin/main` en su commit. */
function createRepo(version = '1.8.0') {
	const repo = join(root, `repo-${fixtureId++}`)
	mkdirSync(join(repo, 'scripts'), { recursive: true })
	for (const file of ['publish-first.ps1', 'publish-packages.ps1']) copyFileSync(join(scripts, file), join(repo, 'scripts', file))
	for (const short of order) {
		mkdirSync(join(repo, 'packages', short), { recursive: true })
		writeFileSync(join(repo, 'packages', short, 'package.json'), JSON.stringify({ name: `@meekojs/${short}`, version }))
	}
	git(repo, 'init', '-q', '-b', 'main')
	git(repo, 'add', '.')
	git(repo, 'commit', '-q', '-m', 'release')
	git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
	return repo
}

/** Ejecuta un script sin bloquear el registro simulado, que vive en este mismo proceso. */
function run(repo, script, args = [], env = {}) {
	const log = join(repo, '..', `log-${fixtureId++}.jsonl`)
	writeFileSync(log, '')
	const childEnv = { ...process.env, MOCK_LOG: log, NO_COLOR: '1', PATH: `${bin}${delimiter}${process.env.PATH}`, ...env }
	for (const key of ['GITHUB_ACTIONS', 'GITHUB_REF_TYPE', 'GITHUB_REF_NAME']) if (!(key in env)) delete childEnv[key]
	if (process.platform === 'win32') childEnv.Path = childEnv.PATH
	return new Promise((resolve, reject) => {
		const child = spawn('pwsh', ['-NoProfile', '-File', join(repo, 'scripts', script), ...args], { cwd: repo, env: childEnv, timeout: 90_000 })
		let output = ''
		child.stdout.on('data', (chunk) => (output += chunk))
		child.stderr.on('data', (chunk) => (output += chunk))
		child.on('error', reject)
		child.on('close', (status) => {
			const calls = readFileSync(log, 'utf8')
				.split('\n')
				.filter(Boolean)
				.map((line) => JSON.parse(line))
			const publishes = calls.filter((call) => call[0] === 'npm' && call[1] === 'publish')
			resolve({
				calls,
				// PowerShell wraps long error messages at the console width.
				output: output.replace(/\r?\n\s*\|\s+/g, ' '),
				packs: calls.filter((call) => call[0] === 'pnpm'),
				published: publishes.map((call) => call[2].match(/meekojs-(.+)-\d+\.\d+\.\d+[^\\/]*\.tgz$/)[1]),
				publishes,
				status,
			})
		})
	})
}

const registryArgs = () => ['-Registry', registry.url]

describe('scripts de publicación', { skip: !hasPwsh && 'requiere pwsh' }, () => {
	before(async () => {
		mkdirSync(bin)
		writeShim(bin, 'npm')
		writeShim(bin, 'pnpm')
	})
	after(() => rmSync(root, { force: true, recursive: true }))

	// Each test starts from core at 1.7.1 and the five new packages missing, as npm is today.
	async function withRegistry(body) {
		registry = await startRegistry()
		try {
			await body()
		} finally {
			registry.server.close()
		}
	}
	const scenario = (name, body, options = {}) => test(name, options, () => withRegistry(body))

	scenario('el dry-run no publica nada y deja core al flujo confiable', async () => {
		const result = await run(createRepo(), 'publish-first.ps1', registryArgs())
		assert.equal(result.status, 0, result.output)
		assert.deepEqual(result.published, newPackages)
		for (const call of result.publishes) {
			assert.ok(call.includes('--dry-run'), call.join(' '))
			assert.ok(call.includes('--provenance=false'))
			assert.equal(call[call.indexOf('--tag') + 1], 'latest')
			assert.equal(call[call.indexOf('--access') + 1], 'public')
		}
		assert.match(result.output, /Left to the trusted workflow.*@meekojs\/meeko@1\.8\.0/)
		for (const short of newPackages) assert.equal(registry.has(`@meekojs/${short}`, '1.8.0'), false)
	})

	scenario('-Execute publica los cinco nuevos en orden y nunca core', async () => {
		const result = await run(createRepo(), 'publish-first.ps1', ['-Execute', ...registryArgs()])
		assert.equal(result.status, 0, result.output)
		assert.deepEqual(result.published, newPackages)
		assert.ok(result.publishes.every((call) => !call.includes('--dry-run')))
		assert.equal(registry.has('@meekojs/meeko', '1.8.0'), false)
		assert.equal(registry.has('@meekojs/prettier-plugin', '1.8.0'), true)
	})

	for (const code of ['E401', 'ENEEDAUTH']) {
		scenario(`sin sesión de npm (${code}) para con un mensaje claro y -Execute no publica`, async () => {
			const result = await run(createRepo(), 'publish-first.ps1', ['-Execute', ...registryArgs()], { MOCK_WHOAMI: code })
			assert.notEqual(result.status, 0)
			assert.match(result.output, /npm login/)
			assert.deepEqual(result.packs, [])
			assert.deepEqual(result.publishes, [])
		})
	}

	scenario('un fallo de red en whoami no se presenta como falta de sesión', async () => {
		const result = await run(createRepo(), 'publish-first.ps1', registryArgs(), { MOCK_WHOAMI: 'ENOTFOUND' })
		assert.notEqual(result.status, 0)
		assert.match(result.output, /Could not verify the npm session.*ENOTFOUND/s)
		assert.deepEqual(result.publishes, [])
	})

	scenario('una versión ya existente detiene la primera publicación antes de empaquetar', async () => {
		registry.add('@meekojs/ui', '1.8.0')
		const result = await run(createRepo(), 'publish-first.ps1', ['-Execute', ...registryArgs()])
		assert.notEqual(result.status, 0)
		assert.match(result.output, /@meekojs\/ui@1\.8\.0 already exists.*-Resume/s)
		assert.deepEqual(result.packs, [])
		assert.deepEqual(result.publishes, [])
	})

	for (const status of [500, 403, 429]) {
		scenario(`un HTTP ${status} del registro no equivale a un 404`, async () => {
			registry.state.forcedStatus = status
			const result = await run(createRepo(), 'publish-first.ps1', ['-Execute', ...registryArgs()])
			assert.notEqual(result.status, 0)
			assert.doesNotMatch(result.output, /Completed/)
			assert.deepEqual(result.packs, [])
			assert.deepEqual(result.publishes, [])
		})
	}

	scenario('un registro inalcanzable no equivale a un 404', async () => {
		const closed = createServer()
		await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve))
		const url = `http://127.0.0.1:${closed.address().port}/`
		await new Promise((resolve) => closed.close(resolve))
		const result = await run(createRepo(), 'publish-first.ps1', ['-Execute', '-Registry', url])
		assert.notEqual(result.status, 0)
		assert.deepEqual(result.packs, [])
		assert.deepEqual(result.publishes, [])
	})

	for (const code of ['E403', 'ENOTFOUND', 'EOTP']) {
		scenario(`${code} a mitad detiene el resto, muestra el estado y -Resume sólo publica lo que falta`, async () => {
			const repo = createRepo()
			const failed = await run(repo, 'publish-first.ps1', ['-Execute', ...registryArgs()], { MOCK_PUBLISH_FAIL_CODE: code, MOCK_PUBLISH_FAIL_PACKAGE: 'ui' })
			assert.notEqual(failed.status, 0)
			assert.deepEqual(failed.published, ['i18n', 'icon', 'ui'])
			assert.match(failed.output, /@meekojs\/icon@1\.8\.0: published/)
			assert.match(failed.output, /@meekojs\/ui@1\.8\.0: new-package/)
			assert.match(failed.output, /Publication failed: @meekojs\/ui@1\.8\.0.*-Resume/s)
			assert.equal(registry.has('@meekojs/eslint-plugin', '1.8.0'), false)

			const blocked = await run(repo, 'publish-first.ps1', ['-Execute', ...registryArgs()])
			assert.notEqual(blocked.status, 0)
			assert.deepEqual(blocked.publishes, [])

			const resumed = await run(repo, 'publish-first.ps1', ['-Execute', '-Resume', ...registryArgs()])
			assert.equal(resumed.status, 0, resumed.output)
			assert.deepEqual(resumed.published, ['ui', 'eslint-plugin', 'prettier-plugin'])
			assert.match(resumed.output, /Already published; skipping @meekojs\/i18n@1\.8\.0/)
			assert.equal(registry.has('@meekojs/meeko', '1.8.0'), false)
		})
	}

	scenario('un árbol sucio detiene incluso el dry-run antes de consultar npm', async () => {
		const repo = createRepo()
		writeFileSync(join(repo, 'stray.txt'), 'x')
		const result = await run(repo, 'publish-first.ps1', registryArgs())
		assert.notEqual(result.status, 0)
		assert.match(result.output, /working tree must be clean/)
		assert.deepEqual(result.calls, [])
	})

	scenario('-Execute exige un commit de origin/main; el dry-run no', async () => {
		const repo = createRepo()
		git(repo, 'commit', '-q', '--allow-empty', '-m', 'unapproved')
		const execute = await run(repo, 'publish-first.ps1', ['-Execute', ...registryArgs()])
		assert.notEqual(execute.status, 0)
		assert.match(execute.output, /not on origin\/main/)
		assert.deepEqual(execute.publishes, [])
		const dryRun = await run(repo, 'publish-first.ps1', registryArgs())
		assert.equal(dryRun.status, 0, dryRun.output)
	})

	for (const [label, env, message] of [
		['un fallo de empaquetado', { MOCK_PACK_FAIL: 'ui' }, /Packing failed: ui/],
		['un rango workspace sin resolver', { MOCK_PACK_WORKSPACE: 'eslint-plugin' }, /unresolved workspace/],
		['un tarball con otra versión', { MOCK_PACK_WRONG_VERSION: 'icon' }, /contains @meekojs\/icon@0\.0\.1/],
		['un npm antiguo', { MOCK_NPM_VERSION: '11.4.0' }, /npm >=11\.5\.1/],
	]) {
		scenario(`${label} no deja ninguna publicación`, async () => {
			const result = await run(createRepo(), 'publish-first.ps1', ['-Execute', ...registryArgs()], env)
			assert.notEqual(result.status, 0)
			assert.match(result.output, message)
			assert.deepEqual(result.publishes, [])
		})
	}

	scenario('versiones desalineadas entre manifiestos detienen la release', async () => {
		const repo = createRepo()
		writeFileSync(join(repo, 'packages/ui/package.json'), JSON.stringify({ name: '@meekojs/ui', version: '1.8.1' }))
		git(repo, 'commit', '-q', '-am', 'mismatch')
		git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
		const result = await run(repo, 'publish-first.ps1', ['-Execute', ...registryArgs()])
		assert.notEqual(result.status, 0)
		assert.match(result.output, /Release version mismatch: @meekojs\/ui \(1\.8\.1\)/)
		assert.deepEqual(result.publishes, [])
	})

	const actions = (tag = 'v1.8.0') => ({ GITHUB_ACTIONS: 'true', GITHUB_REF_NAME: tag, GITHUB_REF_TYPE: 'tag' })

	scenario('-PackOnly empaqueta los seis sin tocar npm ni el registro', async () => {
		registry.state.forcedStatus = 500
		const directory = join(root, `artifacts-${fixtureId++}`)
		const result = await run(createRepo(), 'publish-packages.ps1', ['-PackOnly', '-ExpectedVersion', '1.8.0', '-ArtifactDirectory', directory])
		assert.equal(result.status, 0, result.output)
		assert.deepEqual(
			result.packs.map((call) => call[2].split('/').pop()),
			order,
		)
		assert.ok(result.calls.every((call) => call[0] !== 'npm'))
	})

	scenario('-PackOnly rechaza -Execute', async () => {
		const result = await run(createRepo(), 'publish-packages.ps1', ['-PackOnly', '-Execute'])
		assert.notEqual(result.status, 0)
		assert.deepEqual(result.calls, [])
	})

	/** Lo que hace el workflow: empaqueta en el job de gates y publica en otro job, sin pnpm. */
	async function packForWorkflow(version = '1.8.0') {
		const repo = createRepo(version)
		const directory = join(root, `artifacts-${fixtureId++}`)
		const packed = await run(repo, 'publish-packages.ps1', ['-PackOnly', '-ExpectedVersion', version, '-ArtifactDirectory', directory])
		assert.equal(packed.status, 0, packed.output)
		return { directory, repo, trusted: ['-Trusted', '-Execute', '-ExpectedVersion', version, '-ArtifactDirectory', directory, ...registryArgs()] }
	}

	scenario('-Trusted omite lo publicado y publica core con procedencia, sin empaquetar', async () => {
		for (const short of newPackages) registry.add(`@meekojs/${short}`, '1.8.0')
		const { repo, trusted } = await packForWorkflow()
		const result = await run(repo, 'publish-packages.ps1', trusted, actions())
		assert.equal(result.status, 0, result.output)
		assert.deepEqual(result.published, ['meeko'])
		assert.ok(result.publishes[0].includes('--provenance'))
		assert.ok(!result.publishes[0].includes('--dry-run'))
		assert.deepEqual(result.packs, [])
		assert.ok(!result.calls.some((call) => call[1] === 'whoami'))
		assert.equal(registry.has('@meekojs/meeko', '1.8.0'), true)
	})

	scenario('-Trusted se reejecuta sin publicar dos veces', async () => {
		for (const short of newPackages) registry.add(`@meekojs/${short}`, '1.8.0')
		const { repo, trusted } = await packForWorkflow()
		await run(repo, 'publish-packages.ps1', trusted, actions())
		const again = await run(repo, 'publish-packages.ps1', trusted, actions())
		assert.equal(again.status, 0, again.output)
		assert.deepEqual(again.publishes, [])
	})

	scenario('-Trusted no empieza si un paquete nuevo aún no existe en npm', async () => {
		const { repo, trusted } = await packForWorkflow()
		const result = await run(repo, 'publish-packages.ps1', trusted, actions())
		assert.notEqual(result.status, 0)
		assert.match(result.output, /@meekojs\/i18n does not exist on npm.*Nothing was published/s)
		assert.deepEqual(result.publishes, [])
	})

	scenario('-Trusted no empieza si falta un tarball', async () => {
		for (const short of newPackages) registry.add(`@meekojs/${short}`, '1.8.0')
		const { directory, repo, trusted } = await packForWorkflow()
		rmSync(join(directory, 'meekojs-meeko-1.8.0.tgz'))
		const result = await run(repo, 'publish-packages.ps1', trusted, actions())
		assert.notEqual(result.status, 0)
		assert.match(result.output, /Missing tarball/)
		assert.deepEqual(result.publishes, [])
	})

	scenario('-Trusted falla al primer error y conserva el estado para reejecutar', async () => {
		registry.add('@meekojs/i18n', '1.8.0')
		for (const short of newPackages) registry.add(`@meekojs/${short}`, '0.9.0')
		const { repo, trusted } = await packForWorkflow()
		const result = await run(repo, 'publish-packages.ps1', trusted, { ...actions(), MOCK_PUBLISH_FAIL_CODE: 'E404', MOCK_PUBLISH_FAIL_PACKAGE: 'icon' })
		assert.notEqual(result.status, 0)
		assert.deepEqual(result.published, ['meeko', 'icon'])
		assert.match(result.output, /rerun this workflow/)
	})

	for (const [label, env] of [
		['fuera de GitHub Actions', {}],
		['con otra etiqueta', actions('v1.8.1')],
		['en una rama', { GITHUB_ACTIONS: 'true', GITHUB_REF_NAME: 'v1.8.0', GITHUB_REF_TYPE: 'branch' }],
	]) {
		scenario(`-Trusted se niega ${label}`, async () => {
			const { repo, trusted } = await packForWorkflow()
			const result = await run(repo, 'publish-packages.ps1', trusted, env)
			assert.notEqual(result.status, 0)
			assert.match(result.output, /Trusted publishing requires GitHub Actions/)
			assert.deepEqual(result.publishes, [])
		})
	}

	scenario('una prerelease se publica en next y no mueve latest', async () => {
		for (const short of order) registry.add(`@meekojs/${short}`, '1.7.0')
		const { repo, trusted } = await packForWorkflow('1.9.0-rc.1')
		const result = await run(repo, 'publish-packages.ps1', trusted, { ...actions('v1.9.0-rc.1'), MOCK_VERSION: '1.9.0-rc.1' })
		assert.equal(result.status, 0, result.output)
		assert.deepEqual(result.published, order)
		for (const call of result.publishes) assert.equal(call[call.indexOf('--tag') + 1], 'next')
	})
})

describe('workflow de publicación', () => {
	const workflow = readFileSync(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n')
	const job = (name) => {
		const start = workflow.indexOf(`\n  ${name}:\n`)
		assert.notEqual(start, -1, name)
		const end = workflow.slice(start + 1).search(/\n {2}[\w-]+:\n/)
		return workflow.slice(start, end === -1 ? undefined : start + 1 + end)
	}

	test('sólo el job sin código del proyecto recibe el token OIDC', () => {
		assert.equal(workflow.match(/^\s+id-token: write$/gm).length, 1)
		const publish = job('publish')
		assert.match(publish, /id-token: write/)
		assert.match(publish, /environment: npm/)
		assert.match(publish, /needs: package-gates/)
		assert.doesNotMatch(publish, /pnpm|upload-artifact/)
		assert.match(publish, /publish-packages\.ps1 -Trusted -Execute/)
	})

	test('los gates dependen de la matriz previa y comprueban que la etiqueta está en main', () => {
		const gates = job('package-gates')
		assert.match(gates, /needs: \[redis-integration, bun, deno, workerd, vscode-extension\]/)
		assert.match(gates, /fetch-depth: 0/)
		assert.match(gates, /merge-base --is-ancestor \$env:GITHUB_SHA origin\/main/)
		assert.ok(gates.indexOf('package:workspace-smoke') < gates.indexOf('-PackOnly'))
		assert.ok(gates.indexOf('Browser E2E') < gates.indexOf('-PackOnly'))
		assert.doesNotMatch(gates, /environment:|npm publish|-Trusted/)
	})

	test('la etiqueta nunca se interpola en un script de PowerShell', () => {
		assert.doesNotMatch(workflow, /\$\{\{\s*github\.ref/)
	})

	test('la release de GitHub sólo sale después de publicar', () => {
		assert.match(job('github-release'), /needs: publish/)
	})
})

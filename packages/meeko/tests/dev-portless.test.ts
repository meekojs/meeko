import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { normalizePortlessName, parsePortlessUrl, portlessAliasArgs, portlessAllowedHost, portlessBinaryCandidates, portlessConfigError, portlessGetArgs, portlessNameFromPackage, portlessRemoveArgs, type PortlessResult, type PortlessRunner, resolvePortlessName, startPortless } from '../src/framework/dev-portless.ts'

test('normalizePortlessName accepts DNS labels and subdomains and explains the rest', () => {
	assert.deepEqual(normalizePortlessName('ui.meeko'), { value: 'ui.meeko' })
	assert.deepEqual(normalizePortlessName('  Mi-App '), { value: 'mi-app' })
	for (const bad of ['', '  ', 42, 'a_b', '-a', 'a-', 'a..b', 'a b', 'x'.repeat(64), 'http://a']) {
		const result = normalizePortlessName(bad)
		assert.ok('error' in result, String(bad))
	}
})

test('portlessNameFromPackage drops the scope and sanitizes as a DNS label', () => {
	assert.equal(portlessNameFromPackage('meeko-ui-site'), 'meeko-ui-site')
	assert.equal(portlessNameFromPackage('@acme/Web_App'), 'web-app')
	assert.equal(portlessNameFromPackage('--x.y--'), 'x-y')
	assert.equal(portlessNameFromPackage('@acme/'), undefined)
	assert.equal(portlessNameFromPackage('___'), undefined)
	assert.equal(portlessNameFromPackage(undefined), undefined)
	assert.equal(portlessNameFromPackage('a'.repeat(80))?.length, 63)
})

test('resolvePortlessName covers false, true and { name }', () => {
	assert.equal(resolvePortlessName(undefined, 'x'), undefined)
	assert.equal(resolvePortlessName(false, 'x'), undefined)
	assert.deepEqual(resolvePortlessName(true, '@acme/site'), { name: 'site' })
	const noName = resolvePortlessName(true, undefined)
	assert.ok(noName && 'error' in noName && /package\.json/.test(noName.error))
	assert.deepEqual(resolvePortlessName({ name: 'UI.Meeko' }, undefined), { name: 'ui.meeko' })
})

test('portlessConfigError validates dev.portless in Spanish', () => {
	assert.equal(portlessConfigError(undefined, 'c: dev.portless'), undefined)
	assert.equal(portlessConfigError(true, 'c: dev.portless'), undefined)
	assert.equal(portlessConfigError({ name: 'ui.meeko' }, 'c: dev.portless'), undefined)
	assert.match(portlessConfigError('ui', 'c: dev.portless') ?? '', /c: dev\.portless debe ser un booleano o un objeto/)
	assert.match(portlessConfigError([], 'c: dev.portless') ?? '', /debe ser un booleano o un objeto/)
	assert.match(portlessConfigError({}, 'c: dev.portless') ?? '', /dev\.portless\.name debe ser una cadena no vacía/)
	assert.match(portlessConfigError({ name: 'a_b' }, 'c: dev.portless') ?? '', /dev\.portless\.name "a_b" no es un nombre válido/)
	assert.match(portlessConfigError({ name: 'a', tld: 'x' }, 'c: dev.portless') ?? '', /dev\.portless\.tld no es una opción/)
})

test('portless commands, URL parsing and allowed host', () => {
	assert.deepEqual(portlessAliasArgs('ui.meeko', 4174), ['alias', 'ui.meeko', '4174'])
	assert.deepEqual(portlessRemoveArgs('ui.meeko'), ['alias', '--remove', 'ui.meeko'])
	assert.deepEqual(portlessGetArgs('ui.meeko'), ['get', 'ui.meeko'])
	assert.equal(parsePortlessUrl('aviso\nhttps://ui.meeko.localhost\n')?.origin, 'https://ui.meeko.localhost')
	assert.equal(portlessAllowedHost(new URL('http://UI.Meeko.test:1355')), 'ui.meeko.test')
	assert.equal(parsePortlessUrl('nada'), undefined)
})

test('portlessBinaryCandidates walks up from the project root', () => {
	const root = resolve('/work/repo/apps/site')
	assert.deepEqual(portlessBinaryCandidates(root, 'linux').slice(0, 3), [join(root, 'node_modules', '.bin', 'portless'), resolve('/work/repo/apps/node_modules/.bin/portless'), resolve('/work/repo/node_modules/.bin/portless')])
	assert.ok(portlessBinaryCandidates(root, 'win32')[0]?.endsWith('portless.cmd'))
})

interface Call {
	readonly command: string
	readonly args: readonly string[]
	readonly prefix?: string | undefined
}

function fakeRunner(results: Record<string, PortlessResult>, calls: Call[]): PortlessRunner {
	return async (command, args, env) => {
		calls.push({ command, args, ...(args[0] === 'get' ? { prefix: env.PORTLESS_PREFIX } : {}) })
		return results[args[0] === 'alias' && args[1] === '--remove' ? 'remove' : (args[0] ?? '')] ?? { code: 0, stdout: '', stderr: '' }
	}
}

const ok = (stdout = ''): PortlessResult => ({ code: 0, stdout, stderr: '' })

const base = { root: resolve('/work/app'), packageName: '@acme/site', port: 4180, listening: async () => true }

test('startPortless registers the alias with the real port, reports the host and removes the route once', async () => {
	const calls: Call[] = []
	const warnings: string[] = []
	const command = resolve('/work/node_modules/.bin/portless')
	const session = await startPortless({ ...base, option: true, env: {}, warn: (message) => warnings.push(message), exists: (file) => file === command, run: fakeRunner({ get: ok('https://site.localhost\n') }, calls) })
	assert.ok(session)
	assert.equal(session.url, 'https://site.localhost')
	assert.equal(session.host, 'site.localhost')
	assert.deepEqual(calls, [
		{ command, args: ['alias', 'site', '4180'] },
		{ command, args: ['get', 'site'], prefix: '' }, // sin el prefijo de worktree, que `alias` no aplica
	])
	await Promise.all([session.release(), session.release()])
	assert.deepEqual(calls.slice(2), [{ command, args: ['alias', '--remove', 'site'] }])
	assert.deepEqual(warnings, [])
})

test('startPortless uses an explicit name and the PATH binary when the project has none', async () => {
	const calls: Call[] = []
	const session = await startPortless({ ...base, option: { name: 'ui.meeko' }, env: {}, warn: () => undefined, exists: () => false, run: fakeRunner({ get: ok('http://ui.meeko.test:1355') }, calls) })
	assert.equal(session?.host, 'ui.meeko.test')
	assert.deepEqual(calls[0], { command: 'portless', args: ['alias', 'ui.meeko', '4180'] })
})

test('startPortless does nothing when disabled, with PORTLESS=0 or without a derivable name', async () => {
	const calls: Call[] = []
	const warnings: string[] = []
	const common = { ...base, warn: (message: string) => warnings.push(message), run: fakeRunner({}, calls) }
	assert.equal(await startPortless({ ...common, option: undefined, env: {} }), undefined)
	assert.equal(await startPortless({ ...common, option: false, env: {} }), undefined)
	assert.equal(await startPortless({ ...common, option: true, env: { PORTLESS: '0' } }), undefined)
	assert.deepEqual(calls, [])
	assert.deepEqual(warnings, [])
	assert.equal(await startPortless({ ...common, option: true, packageName: undefined, env: {} }), undefined)
	assert.match(warnings[0] ?? '', /necesita un "name" en el package\.json.*meeko dev sigue en su puerto/)
	assert.deepEqual(calls, [])
})

test('startPortless only accepts the host when meeko dev already runs inside portless', async () => {
	const calls: Call[] = []
	const session = await startPortless({ ...base, option: undefined, env: { PORTLESS_URL: 'https://site.dev.test' }, warn: () => undefined, run: fakeRunner({}, calls) })
	assert.equal(session?.host, 'site.dev.test')
	await session?.release()
	assert.deepEqual(calls, [])
})

test('startPortless warns how to install portless and keeps going when the binary is missing', async () => {
	const warnings: string[] = []
	const run: PortlessRunner = async () => ({ code: null, stdout: '', stderr: 'spawn portless ENOENT', errorCode: 'ENOENT' })
	assert.equal(await startPortless({ ...base, option: true, env: {}, warn: (message) => warnings.push(message), run }), undefined)
	assert.equal(warnings.length, 1)
	assert.match(warnings[0] ?? '', /portless no está instalado.*pnpm add -D portless.*PATH.*sigue en su puerto/)
})

test('startPortless survives a failing or throwing portless and cleans the alias when get fails', async () => {
	const warnings: string[] = []
	const calls: Call[] = []
	const failing = fakeRunner({ alias: { code: 1, stdout: '', stderr: 'Error: boom\nmás' } }, calls)
	assert.equal(await startPortless({ ...base, option: true, env: {}, warn: (message) => warnings.push(message), run: failing }), undefined)
	assert.match(warnings[0] ?? '', /portless alias site falló \(código 1\): Error: boom; meeko dev sigue/)

	calls.length = 0
	const noUrl = fakeRunner({ get: ok('sin url') }, calls)
	assert.equal(await startPortless({ ...base, option: true, env: {}, warn: (message) => warnings.push(message), run: noUrl }), undefined)
	assert.deepEqual(
		calls.map((call) => call.args[0] === 'alias' && call.args[1] === '--remove'),
		[false, false, true],
	)

	const throwing: PortlessRunner = async () => {
		throw new Error('explotó')
	}
	assert.equal(await startPortless({ ...base, option: true, env: {}, warn: (message) => warnings.push(message), run: throwing }), undefined)
	assert.match(warnings.at(-1) ?? '', /portless falló: explotó/)
})

test('startPortless warns when the proxy is not listening but keeps the route', async () => {
	const warnings: string[] = []
	const session = await startPortless({ ...base, option: true, env: {}, listening: async (port) => port !== 1355, warn: (message) => warnings.push(message), run: fakeRunner({ get: ok('http://site.localhost:1355') }, []) })
	assert.ok(session)
	assert.match(warnings[0] ?? '', /no escucha en el puerto 1355.*portless proxy start/)
})

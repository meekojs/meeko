import assert from 'node:assert/strict'
import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { createServer } from 'node:net'
import { join } from 'node:path'
import test from 'node:test'

import { initFrameworkProject } from '../src/framework/init.ts'
import { repositoryRoot, stopChild, tempProject } from './helpers/temp-project.ts'

// A real `meeko dev` with `dev.portless` and a fake `portless` in the project's node_modules/.bin:
// it records every call, so the test sees the alias with the real port and its removal on close.

const host = 'fake-app.localhost'

async function freePort(): Promise<number> {
	const server = createServer()
	server.listen(0, '127.0.0.1')
	await once(server, 'listening')
	const address = server.address()
	assert.ok(address && typeof address !== 'string')
	server.close()
	await once(server, 'close')
	return address.port
}

function status(port: number, hostHeader: string): Promise<number> {
	return new Promise((done, fail) => {
		const outgoing = httpRequest({ host: '127.0.0.1', port, path: '/', headers: { host: hostHeader, accept: 'text/html' } }, (response) => {
			response.resume()
			response.on('end', () => done(response.statusCode ?? 0))
		})
		outgoing.on('error', fail)
		outgoing.end()
	})
}

async function portlessApp(root: string, dev: string, fake: 'ok' | 'fail' | 'none'): Promise<string> {
	await initFrameworkProject(root)
	await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@acme/fake-app', private: true, type: 'module' }))
	await writeFile(join(root, 'meeko.config.ts'), `import { defineMeekoConfig } from "@meekojs/meeko/framework";\nexport default defineMeekoConfig({ dev: ${dev} });\n`)
	await mkdir(join(root, 'node_modules', '@meekojs'), { recursive: true })
	await symlink(repositoryRoot, join(root, 'node_modules', '@meekojs', 'meeko'), 'junction')
	await symlink(join(repositoryRoot, 'node_modules', 'vite'), join(root, 'node_modules', 'vite'), 'junction')
	const log = join(root, 'portless.log')
	if (fake !== 'none') {
		await mkdir(join(root, 'node_modules', '.bin'), { recursive: true })
		const script = join(root, 'node_modules', '.bin', 'portless')
		const body = fake === 'fail' ? 'process.stderr.write("Error: no hay proxy\\n"); process.exit(3)' : `require("node:fs").appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(" ") + "\\n"); if (process.argv[2] === "get") console.log("http://${host}:1355")`
		await writeFile(script, `#!/usr/bin/env node\n${body}\n`)
		await chmod(script, 0o755)
	}
	return log
}

async function startDev(root: string, env: Record<string, string>): Promise<{ child: ChildProcess; port: number; output(): string }> {
	const port = await freePort()
	const hmrPort = await freePort()
	const child = spawn(process.execPath, [join(repositoryRoot, 'dist', 'cli.js'), 'dev', root], {
		cwd: root,
		env: { ...process.env, PORT: String(port), MEEKO_HMR_PORT: String(hmrPort), MEEKO_LINK_WATCH: '0', MEEKO_EDITOR_BRIDGE: '0', PATH: `${process.env.PATH ?? ''}`, ...env },
		stdio: ['ignore', 'pipe', 'pipe'],
		windowsHide: true,
	})
	let output = ''
	child.stdout?.on('data', (chunk: Buffer) => {
		output += chunk.toString()
	})
	child.stderr?.on('data', (chunk: Buffer) => {
		output += chunk.toString()
	})
	const start = Date.now()
	while (!output.includes(`http://localhost:${port}\n`)) {
		if (child.exitCode !== null || Date.now() - start > 30_000) throw new Error(`meeko dev did not listen: ${output}`)
		await new Promise((done) => setTimeout(done, 25))
	}
	return { child, port, output: () => output }
}

const skip = process.platform === 'win32' ? 'el portless falso es un script de shebang' : false

test('meeko dev registers the portless alias with its port, shows the URL and removes it on close', { timeout: 120_000, skip }, async (context) => {
	let child: ChildProcess | undefined
	const root = await tempProject(context, 'dev-portless', () => stopChild(child))
	const log = await portlessApp(root, '{ portless: true }', 'ok')
	const running = await startDev(root, {})
	child = running.child
	assert.match(running.output(), new RegExp(`Portless: http://${host}:1355`))
	// The derived name is the package name without its scope, with the port meeko dev listens on.
	assert.deepEqual((await readFile(log, 'utf8')).trim().split('\n'), [`alias fake-app ${running.port}`, 'get fake-app'])
	// The portless host is served although it is not in dev.allowedHosts.
	assert.equal(await status(running.port, `${host}:1355`), 200)
	assert.equal(await status(running.port, 'otro.example'), 403)

	running.child.kill('SIGINT')
	await once(running.child, 'exit')
	assert.equal((await readFile(log, 'utf8')).trim().split('\n').at(-1), 'alias --remove fake-app')
})

test('meeko dev keeps running on its port when portless fails or is not installed', { timeout: 120_000, skip }, async (context) => {
	let failing: ChildProcess | undefined
	const root = await tempProject(context, 'dev-portless-fail', () => stopChild(failing))
	await portlessApp(root, '{ portless: { name: "ui.fake" } }', 'fail')
	const running = await startDev(root, {})
	failing = running.child
	assert.match(running.output(), /portless alias ui\.fake falló \(código 3\): Error: no hay proxy; meeko dev sigue en su puerto/)
	assert.equal(await status(running.port, `127.0.0.1:${running.port}`), 200)
	await stopChild(failing)

	let missing: ChildProcess | undefined
	const bare = await tempProject(context, 'dev-portless-missing', () => stopChild(missing))
	await portlessApp(bare, '{ portless: true }', 'none')
	// An empty PATH hides any portless of the machine.
	const without = await startDev(bare, { PATH: '' })
	missing = without.child
	assert.match(without.output(), /portless no está instalado.*pnpm add -D portless/)
	assert.equal(await status(without.port, `127.0.0.1:${without.port}`), 200)
})

test('meeko dev does not touch portless with PORTLESS=0', { timeout: 120_000, skip }, async (context) => {
	let child: ChildProcess | undefined
	const root = await tempProject(context, 'dev-portless-off', () => stopChild(child))
	const log = await portlessApp(root, '{ portless: true }', 'ok')
	const running = await startDev(root, { PORTLESS: '0' })
	child = running.child
	assert.doesNotMatch(running.output(), /Portless:/)
	await stopChild(child)
	await assert.rejects(readFile(log, 'utf8'), { code: 'ENOENT' })
})

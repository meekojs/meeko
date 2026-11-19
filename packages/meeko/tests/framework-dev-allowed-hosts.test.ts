import assert from 'node:assert/strict'
import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { createServer } from 'node:net'
import { join } from 'node:path'
import test from 'node:test'

import { initFrameworkProject } from '../src/framework/init.ts'
import { repositoryRoot, stopChild, tempProject } from './helpers/temp-project.ts'

// A real `meeko dev` behind a tunnel that terminates TLS: the browser is at https://box…, and
// the proxy forwards http with `Host: box…`. Vite's host check and the Origin checks both
// follow `dev.allowedHosts` and MEEKO_ALLOWED_HOSTS, and say which option to set when they refuse.

const tunnel = 'box.tailnet.ts.net'

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

interface Reply {
	readonly status: number
	readonly body: string
}

/** A request to 127.0.0.1 with any `Host` header, which `fetch` does not let set. */
function send(port: number, path: string, options: { host: string; method?: string; headers?: Record<string, string>; body?: string }): Promise<Reply> {
	return new Promise((done, fail) => {
		const outgoing = httpRequest({ host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: { host: options.host, ...options.headers } }, (response) => {
			let body = ''
			response.setEncoding('utf8')
			response.on('data', (chunk: string) => {
				body += chunk
			})
			response.on('end', () => done({ status: response.statusCode ?? 0, body }))
		})
		outgoing.on('error', fail)
		outgoing.end(options.body)
	})
}

async function startDev(root: string, env: Record<string, string>): Promise<{ child: ChildProcess; port: number; output(): string }> {
	const port = await freePort()
	const hmrPort = await freePort()
	const child = spawn(process.execPath, [join(repositoryRoot, 'dist', 'cli.js'), 'dev', root], {
		cwd: root,
		env: { ...process.env, PORT: String(port), MEEKO_HMR_PORT: String(hmrPort), MEEKO_LINK_WATCH: '0', MEEKO_EDITOR_BRIDGE: '0', ...env },
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

async function tunnelApp(root: string): Promise<void> {
	await initFrameworkProject(root)
	await mkdir(join(root, 'server', 'rpc'), { recursive: true })
	await mkdir(join(root, 'shared', 'schemas'), { recursive: true })
	await writeFile(join(root, 'shared', 'schemas', 'echo.ts'), `type Echo = { text: string };\nexport const echoSchema = { "~standard": { version: 1 as const, vendor: "test", types: undefined as unknown as { input: Echo; output: Echo }, validate: (value: unknown) => ({ value: value as Echo }) } };\n`)
	await writeFile(join(root, 'server', 'rpc', 'echo.ts'), `import { defineRpc } from "@meekojs/meeko/server";\nimport { echoSchema } from "../../shared/schemas/echo.js";\nexport default defineRpc({ input: echoSchema, output: echoSchema, handler: ({ input }) => input });\n`)
	await writeFile(join(root, 'meeko.config.ts'), `import { defineMeekoConfig } from "@meekojs/meeko/framework";\nexport default defineMeekoConfig({ dev: { allowedHosts: ["${tunnel}"] } });\n`)
	await mkdir(join(root, 'node_modules', '@meekojs'), { recursive: true })
	await symlink(repositoryRoot, join(root, 'node_modules', '@meekojs', 'meeko'), 'junction')
	await symlink(join(repositoryRoot, 'node_modules', 'vite'), join(root, 'node_modules', 'vite'), 'junction')
}

const rpc = (origin: string) => ({ method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ text: 'hola' }) })

test('meeko dev serves the hosts of dev.allowedHosts and MEEKO_ALLOWED_HOSTS and names the option when it refuses', { timeout: 120_000 }, async (context) => {
	let child: ChildProcess | undefined
	const root = await tempProject(context, 'dev-allowed-hosts', () => stopChild(child))
	await tunnelApp(root)
	const running = await startDev(root, { MEEKO_ALLOWED_HOSTS: 'lan-pc.home.arpa' })
	child = running.child
	const { port } = running

	// An unknown host is refused before Vite, with Meeko's option instead of vite.config.js.
	const blocked = await send(port, '/', { host: 'unknown.example' })
	assert.equal(blocked.status, 403)
	assert.match(blocked.body, /el host "unknown\.example"/)
	assert.match(blocked.body, /dev\.allowedHosts en meeko\.config\.ts/)
	assert.match(blocked.body, /MEEKO_ALLOWED_HOSTS/)
	assert.doesNotMatch(blocked.body, /vite\.config/)
	assert.match(running.output(), /meeko dev bloqueó una petición con el host "unknown\.example"/)

	// The page and Vite's own modules answer through the tunnel and the LAN name of the variable.
	for (const host of [tunnel, `${tunnel}:443`, 'lan-pc.home.arpa:4173', `127.0.0.1:${port}`, `localhost:${port}`]) {
		const page = await send(port, '/', { host, headers: { accept: 'text/html' } })
		assert.equal(page.status, 200, `${host}: ${page.body.slice(0, 300)}`)
	}
	assert.equal((await send(port, '/@vite/client', { host: tunnel })).status, 200)

	// The RPC accepts the https origin of the tunnel although Meeko sees http://box…
	const accepted = await send(port, '/_meeko/rpc/echo', { host: tunnel, ...rpc(`https://${tunnel}`) })
	assert.equal(accepted.status, 200, accepted.body)
	assert.deepEqual(JSON.parse(accepted.body), { text: 'hola' })
	assert.equal((await send(port, '/_meeko/rpc/echo', { host: 'lan-pc.home.arpa', ...rpc('http://lan-pc.home.arpa:4173') })).status, 200)

	// Another site is still refused, and the terminal says which option would allow a tunnel.
	const refused = await send(port, '/_meeko/rpc/echo', { host: tunnel, ...rpc('https://evil.example') })
	assert.equal(refused.status, 403)
	assert.equal((JSON.parse(refused.body) as { code?: string }).code, 'INVALID_ORIGIN')
	const start = Date.now()
	while (!/rechazó una petición con Origin "https:\/\/evil\.example"/.test(running.output()) && Date.now() - start < 5_000) await new Promise((done) => setTimeout(done, 25))
	assert.match(running.output(), /añada "evil\.example" a dev\.allowedHosts en meeko\.config\.ts o a la variable MEEKO_ALLOWED_HOSTS/)
})

import type { ChildProcess } from 'node:child_process'

import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { stripVTControlCharacters } from 'node:util'

const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

async function availablePort(exclude = new Set<number>()) {
	for (;;) {
		const listener = createServer()
		listener.listen(0, '127.0.0.1')
		await once(listener, 'listening')
		const address = listener.address()
		if (!address || typeof address === 'string') throw new Error('Expected a TCP address')
		const port = address.port
		await new Promise((done) => listener.close(done))
		if (!exclude.has(port)) return port
	}
}

/** Detiene únicamente el árbol del proceso iniciado por este helper. */
export async function stopProcess(child: ChildProcess) {
	if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
	const closed = once(child, 'close').catch(() => undefined)
	if (process.platform === 'win32') {
		await new Promise<void>((done) => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 }, () => done()))
		if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
	} else {
		try {
			process.kill(-child.pid, 'SIGKILL')
		} catch (error) {
			if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ESRCH') throw error
		}
	}
	let timer: NodeJS.Timeout | undefined
	try {
		await Promise.race([
			closed,
			new Promise((done) => {
				timer = setTimeout(done, 10_000)
				timer.unref()
			}),
		])
	} finally {
		clearTimeout(timer)
	}
}

interface DevServerOptions {
	root: string
	cli: string
	path?: string
	port?: number
	timeout?: number
	startupTimeout?: number
}

/** Inicia meeko dev y confirma su puerto. Los wrappers pueden fijar timeout según su prueba. */
export async function startDevServer({ root, cli, path = '/', port, timeout = 360_000, startupTimeout = 60_000 }: DevServerOptions) {
	for (let attempt = 0; attempt < (port ? 1 : 3); attempt++) {
		const httpPort = port ?? (await availablePort())
		const hmrPort = await availablePort(new Set([httpPort]))
		const origin = `http://127.0.0.1:${httpPort}`
		const child = spawn(process.execPath, [cli, 'dev', root], {
			cwd: root,
			detached: process.platform !== 'win32',
			env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192', PORT: String(httpPort), MEEKO_HMR_PORT: String(hmrPort), MEEKO_EDITOR_BRIDGE: '0' },
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'pipe'],
		})
		let logs = ''
		let spawnError: Error | undefined
		child.once('error', (error) => {
			spawnError = error
			logs += `\nmeeko dev could not start: ${error.message}`
		})
		child.stdout.on('data', (chunk) => (logs += chunk))
		child.stderr.on('data', (chunk) => (logs += chunk))
		const lifetime = setTimeout(() => {
			logs += `\nmeeko dev exceeded ${timeout} ms`
			void stopProcess(child)
		}, timeout)
		lifetime.unref()
		child.once('close', () => clearTimeout(lifetime))
		const stop = async () => {
			clearTimeout(lifetime)
			await stopProcess(child)
		}
		const started = Date.now()
		try {
			while (Date.now() - started < startupTimeout) {
				if (spawnError) throw new Error(`meeko dev could not start: ${logs}`, { cause: spawnError })
				if (child.exitCode !== null || child.signalCode !== null) throw new Error(`meeko dev exited: ${logs}`)
				// A response alone could belong to another process that won the port race.
				const output = stripVTControlCharacters(logs).replace(/\r\n/g, '\n')
				if (output.includes(`http://localhost:${httpPort}\n`) || output.includes(`${origin}\n`)) {
					try {
						if ((await fetch(new URL(path, origin), { signal: AbortSignal.timeout(2_000) })).ok) return { origin, child, logs: () => logs, stop }
					} catch {
						/* Listening precedes route readiness. */
					}
				}
				await delay(100)
			}
			throw new Error(`meeko dev startup timed out: ${logs}`)
		} catch (error) {
			await stop()
			if (!port && attempt < 2 && /EADDRINUSE|ya est.n en uso/.test(logs)) continue
			throw error
		}
	}
	throw new Error('meeko dev could not start after all attempts')
}

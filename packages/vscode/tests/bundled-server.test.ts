import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { before, test } from 'node:test'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')

before(() => {
	execFileSync(process.execPath, [join(root, 'build.mjs')], { cwd: root, stdio: 'pipe', windowsHide: true })
})

/** Sends `initialize` over stdio and resolves with its result. */
function initialize(server: string): Promise<{ serverInfo?: { name?: string }; capabilities?: Record<string, unknown> }> {
	return new Promise((done, fail) => {
		const child = spawn(process.execPath, [server, '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
		let output = Buffer.alloc(0)
		let errors = ''
		const timer = setTimeout(() => {
			child.kill()
			fail(new Error(`No answer to initialize: ${errors}`))
		}, 30_000)
		child.stderr.on('data', (chunk: Buffer) => {
			errors += chunk.toString()
		})
		child.once('exit', (code) => {
			clearTimeout(timer)
			fail(new Error(`The server exited with ${code}: ${errors}`))
		})
		child.stdout.on('data', (chunk: Buffer) => {
			output = Buffer.concat([output, chunk])
			const header = output.indexOf('\r\n\r\n')
			const length = Number(/Content-Length: (\d+)/i.exec(output.subarray(0, Math.max(header, 0)).toString())?.[1])
			if (header < 0 || output.length < header + 4 + length) return
			clearTimeout(timer)
			child.removeAllListeners('exit')
			child.kill()
			done((JSON.parse(output.subarray(header + 4, header + 4 + length).toString()) as { result: never }).result)
		})
		const message = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: process.pid, rootUri: null, capabilities: {} } })
		child.stdin.write(`Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`)
	})
}

test('the language server bundled in the VSIX starts and answers initialize', { timeout: 120_000 }, async () => {
	// The bundle is what the VSIX ships when the workspace has no @meekojs/meeko; it once failed to
	// load because two bundled modules declared `createRequire` at the top level.
	const result = await initialize(join(root, 'dist', 'server.js'))
	assert.equal(result.serverInfo?.name, 'meeko-language-server')
	assert.ok(result.capabilities?.['completionProvider'])
})

test('the bundled server checks a project with modules without reading a manifest outside the extension', { timeout: 60_000 }, async () => {
	const workspace = await mkdtemp(join(tmpdir(), 'meeko-bundled-modules-'))
	const text = '<script lang="ts">const count: number = "bad";</script><template><p>{count}</p></template>'
	try {
		await mkdir(join(workspace, 'app'), { recursive: true })
		await mkdir(join(workspace, 'layer', 'app', 'pages'), { recursive: true })
		await writeFile(join(workspace, 'package.json'), '{"private":true,"type":"module"}')
		await writeFile(join(workspace, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', types: [], skipLibCheck: true } }))
		await writeFile(join(workspace, 'meeko.config.mjs'), 'export default { modules: ["./layer"] };')
		const file = join(workspace, 'app', 'App.meeko')
		await writeFile(file, text)
		const uri = pathToFileURL(file).href
		const diagnostics = await new Promise<Array<{ code?: string | number; message: string }>>((done, fail) => {
			const child = spawn(process.execPath, [join(root, 'dist', 'server.js'), '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
			let output = Buffer.alloc(0)
			let errors = ''
			const finish = (error?: Error, result?: Array<{ code?: string | number; message: string }>) => {
				clearTimeout(timer)
				child.removeAllListeners('exit')
				child.kill()
				if (error) fail(error)
				else done(result ?? [])
			}
			const timer = setTimeout(() => finish(new Error(`No diagnostics: ${errors}`)), 45_000)
			const send = (message: object) => {
				const json = JSON.stringify(message)
				child.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`)
			}
			child.once('error', (error) => finish(error))
			child.once('exit', (code) => finish(new Error(`Server exited ${code}: ${errors}`)))
			child.stderr.on('data', (chunk: Buffer) => {
				errors += chunk.toString()
			})
			child.stdout.on('data', (chunk: Buffer) => {
				output = Buffer.concat([output, chunk])
				for (;;) {
					const header = output.indexOf('\r\n\r\n')
					if (header < 0) return
					const length = Number(/Content-Length: (\d+)/i.exec(output.subarray(0, header).toString())?.[1])
					if (output.length < header + 4 + length) return
					const message = JSON.parse(output.subarray(header + 4, header + 4 + length).toString())
					output = output.subarray(header + 4 + length)
					if (message.id === 1) {
						send({ jsonrpc: '2.0', method: 'initialized', params: {} })
						send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'meeko', version: 1, text } } })
					}
					if (message.method === 'textDocument/publishDiagnostics' && message.params.uri === uri) finish(undefined, message.params.diagnostics)
				}
			})
			send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: process.pid, rootUri: pathToFileURL(workspace).href, capabilities: {}, initializationOptions: { trusted: true, projectContracts: false } } })
		})
		assert.ok(
			diagnostics.some((item) => item.code === 'TS2322'),
			JSON.stringify(diagnostics),
		)
		assert.ok(!diagnostics.some((item) => item.code === 'MEEK_CHECK'), JSON.stringify(diagnostics))
	} finally {
		await rm(workspace, { recursive: true, force: true })
	}
})

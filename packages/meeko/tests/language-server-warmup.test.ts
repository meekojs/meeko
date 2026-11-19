import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { after, before, describe, test } from 'node:test'

import { MeekoWorkspace } from '../src/language-server/project.ts'
import { applicationRoots } from '../src/language-server/server.ts'

describe('language server: warm-up of the workspace applications', () => {
	let root: string

	before(async () => {
		await mkdir(resolve('.meeko'), { recursive: true })
		root = await mkdtemp(resolve('.meeko', 'lsp-warmup-'))
		const files: Record<string, string> = {
			'apps/web/meeko.config.ts': 'export default {}\n',
			'apps/web/package.json': '{"private":true,"type":"module"}\n',
			'apps/web/app/pages/index.meeko': '<template><p>Hola</p></template>\n',
			'apps/docs/meeko.config.mjs': 'export default {}\n',
			'packages/ui/package.json': '{"private":true}\n',
			'node_modules/other/meeko.config.ts': 'export default {}\n',
			'.hidden/app/meeko.config.ts': 'export default {}\n',
		}
		for (const [name, content] of Object.entries(files)) {
			await mkdir(join(root, name, '..'), { recursive: true })
			await writeFile(join(root, name), content)
		}
	})

	after(async () => {
		await rm(root, { recursive: true, force: true })
	})

	test('finds the applications two levels below a folder, skipping dependencies and hidden folders', () => {
		assert.deepEqual(applicationRoots([root]), [join(root, 'apps/docs'), join(root, 'apps/web')])
		// A folder that is itself an application is not searched below.
		assert.deepEqual(applicationRoots([join(root, 'apps/web')]), [join(root, 'apps/web')])
		assert.deepEqual(applicationRoots([join(root, 'packages')]), [])
	})

	test('a warmed project has its TypeScript program before a component opens', async () => {
		const workspace = new MeekoWorkspace({ trusted: false })
		try {
			const project = workspace.projectFor(join(root, 'apps/web/app/app.meeko'))
			await project.warm()
			const program = project.service.getProgram()
			assert.ok(
				program?.getSourceFiles().some((file) => file.fileName.includes('index.meeko')),
				'the components are in the program',
			)
		} finally {
			workspace.dispose()
		}
	})

	test('a spawned server prepares the projects of the open tabs first and sends semantic token deltas', async () => {
		const { createProtocolConnection, StreamMessageReader, StreamMessageWriter } = await import('vscode-languageserver/node')
		const { spawn } = await import('node:child_process')
		const { pathToFileURL } = await import('node:url')
		const child = spawn(process.execPath, ['--import', 'tsx', resolve('src/language-server/main.ts'), '--stdio'], { stdio: ['pipe', 'pipe', 'ignore'] })
		const connection = createProtocolConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin))
		const logs: string[] = []
		const prepared = new Promise<void>((done) => {
			connection.onNotification('window/logMessage', ({ message }: { message: string }) => {
				logs.push(message)
				if (/proyecto preparado/.test(message)) done()
			})
		})
		connection.onRequest(() => null)
		connection.listen()
		try {
			await connection.sendRequest('initialize', { processId: process.pid, rootUri: pathToFileURL(root).href, workspaceFolders: [{ uri: pathToFileURL(root).href, name: 'w' }], initializationOptions: { trusted: false, warmupFiles: [join(root, 'apps/web/app/pages/index.meeko')] }, capabilities: {} })
			connection.sendNotification('initialized', {})
			await prepared
			// After the warm-up the open tab gets its tokens, and an edit only its delta.
			const uri = pathToFileURL(join(root, 'apps/web/app/pages/index.meeko')).href
			const text = '<script lang="ts">\nconst count = signal(0)\n</script>\n<template><p>{count.value}</p></template>\n'
			connection.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'meeko', version: 1, text } })
			const full = (await connection.sendRequest('textDocument/semanticTokens/full', { textDocument: { uri } })) as { resultId?: string; data: number[] }
			assert.ok(full.resultId && full.data.length > 0, JSON.stringify(full))
			connection.sendNotification('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: text.replace('</template>', '<b>{count.value}</b></template>') }] })
			const delta = (await connection.sendRequest('textDocument/semanticTokens/full/delta', { textDocument: { uri }, previousResultId: full.resultId })) as { resultId?: string; edits?: Array<{ start: number; data?: number[] }> }
			assert.ok(delta.edits && delta.edits.length === 1 && delta.resultId !== full.resultId, JSON.stringify(delta))
			const stale = (await connection.sendRequest('textDocument/semanticTokens/full/delta', { textDocument: { uri }, previousResultId: 'unknown' })) as { data?: number[] }
			assert.ok(stale.data && stale.data.length > full.data.length, 'an unknown result gets the whole document')
			// apps/docs comes first by name: the open tab wins.
			assert.match(logs.find((message) => /proyecto preparado/.test(message)) ?? '', /apps[\\/]web: proyecto preparado/)
		} finally {
			connection.dispose()
			child.kill()
		}
	})
})

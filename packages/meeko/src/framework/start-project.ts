import type { Server } from 'node:http'

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { MeekoAdapterName } from '../modules/define-meeko-config'

import { meekoEnv } from '../server/runtime/env'
import { adapterEntry, adapterOutput, cloudflareAdapter, nodeOutput } from './build-outputs'
import { resolveWrangler } from './cloudflare-build'
import { loadMeekoConfig } from './config'
import { startDevelopment } from './dev-server'
import { previewStatic } from './static-adapter'

const runtimes = {
	bun: { command: 'bun', args: (entry: string) => [entry], name: 'Bun', install: 'https://bun.sh' },
	deno: { command: 'deno', args: (entry: string) => ['run', '-A', entry], name: 'Deno', install: 'https://deno.com' },
} as const

/**
 * Runs a build output in its real runtime. Node runs in this process; Bun and
 * Deno run as a child process whose exit code becomes this process's.
 */
export async function previewProject(projectRoot: string, adapter?: MeekoAdapterName): Promise<void> {
	const root = resolve(projectRoot)
	const target = adapter ?? (await loadMeekoConfig(root)).server?.adapter ?? 'node'
	if (target === 'node') {
		await startProject(root, true)
		return
	}
	// A static site needs no runtime: a small server answers like a static host.
	if (target === 'static') {
		await previewStatic(root)
		return
	}
	let command: string
	let args: string[]
	let runtime: { readonly name: string; readonly install: string }
	if (target === 'cloudflare') {
		const config = resolve(root, adapterOutput(target), cloudflareAdapter.config)
		if (!existsSync(config)) throw new Error(`No hay build de producción en ${config}; ejecuta meeko build --adapter cloudflare`)
		const wrangler = resolveWrangler(root)
		if (!wrangler) throw new Error('Wrangler no está instalado; añádelo con pnpm add -D wrangler para previsualizar el build de cloudflare')
		// wrangler dev runs the bundled Worker in workerd with local bindings.
		command = process.execPath
		const port = meekoEnv(process.env, 'PORT')
		const host = meekoEnv(process.env, 'HOST')
		args = [wrangler, 'dev', '--config', config, ...(port ? ['--port', port] : []), ...(host ? ['--ip', host] : [])]
		runtime = { name: 'Wrangler', install: 'https://developers.cloudflare.com/workers/wrangler/install-and-update/' }
	} else {
		const entry = resolve(root, adapterEntry(target))
		if (!existsSync(entry)) throw new Error(`No hay build de producción en ${entry}; ejecuta meeko build --adapter ${target}`)
		runtime = runtimes[target]
		command = runtimes[target].command
		args = runtimes[target].args(entry)
	}
	const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true })
	const forward = (signal: NodeJS.Signals): void => {
		child.kill(signal)
	}
	process.on('SIGINT', forward)
	process.on('SIGTERM', forward)
	try {
		await new Promise<void>((done, fail) => {
			child.once('error', (error: NodeJS.ErrnoException) => {
				fail(error.code === 'ENOENT' ? new Error(`${runtime.name} no está instalado o no está en el PATH; instálalo desde ${runtime.install} para previsualizar el build de ${target}`) : error)
			})
			child.once('exit', (code, signal) => {
				process.exitCode = code ?? (signal ? 1 : 0)
				done()
			})
		})
	} finally {
		process.off('SIGINT', forward)
		process.off('SIGTERM', forward)
	}
}

interface NodeStartModule {
	start(): Promise<{ readonly server: Server }>
}

/** Starts the package-owned Node 24 HTTP host for development or the built Node output. */
export async function startProject(projectRoot: string, production: boolean): Promise<Server> {
	const root = resolve(projectRoot)
	if (production) {
		const entry = resolve(root, nodeOutput, 'index.mjs')
		if (!existsSync(entry)) {
			if ((await loadMeekoConfig(root)).server?.adapter === 'static') throw new Error('meeko start sirve el build de Node; el adaptador static genera archivos para un hosting estático: usa meeko preview')
			throw new Error(`No hay build de producción en ${entry}; ejecuta meeko build`)
		}
		const output = (await import(pathToFileURL(entry).href)) as Partial<NodeStartModule>
		if (typeof output.start !== 'function') throw new Error(`${entry} no es un build de Node de Meeko; ejecuta meeko build`)
		return (await output.start()).server
	}
	return startDevelopment(root)
}

import { build, version as esbuildVersion, transform } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { arch, cpus, platform } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { Worker } from 'node:worker_threads'
import { gzipSync } from 'node:zlib'
import { chromium } from 'playwright-core'
import { TextDocument } from 'vscode-languageserver-textdocument'

import type { FeatureContext } from '../src/language-server/features'
import type { PerformanceMetric, PerformanceReport } from './performance-budget'

import { completionList } from '../src/language-server/features'
import { MeekoProject } from '../src/language-server/project'
import { summarizePerformance } from './performance-budget'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({
	options: {
		output: { type: 'string', default: join(root, '.meeko/performance/current.json') },
		rounds: { type: 'string', default: '7' },
		warmups: { type: 'string', default: '2' },
		'cold-rounds': { type: 'string', default: '3' },
	},
})
const count = (value: string, name: string, minimum: number): number => {
	const parsed = Number(value)
	if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > 100) throw new TypeError(`${name} must be an integer between ${minimum} and 100`)
	return parsed
}
const rounds = count(values.rounds, 'rounds', 3)
const coldRounds = count(values['cold-rounds'], 'cold-rounds', 3)
const warmups = count(values.warmups, 'warmups', 0)
const source = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const count = signal(0);
const rows = Array.from({ length: 30 }, (_, id) => ({ id, label: "Row " + id }));
</script>
<template><main><button on:click="() => count.value++">Count {count.value}</button><ul><li each:of="rows" each:as="row" each:key="row.id">{row.label}</li></ul></main></template>`
const fixtureFilename = 'PerformanceFixture.meeko'
const completionSource = '<script lang="ts">\nconst count = signal(0);\nconst value = ;\n</script>\n<template><p>{count.value}{value}</p></template>'
const metrics: Record<string, PerformanceMetric> = {}

async function repeated(run: () => unknown | Promise<unknown>, iterations = 1): Promise<PerformanceMetric> {
	const samples: number[] = []
	for (let round = 0; round < rounds + warmups; round++) {
		const start = performance.now()
		for (let index = 0; index < iterations; index++) await run()
		if (round >= warmups) samples.push((performance.now() - start) / iterations)
	}
	return summarizePerformance(samples)
}

function coldCompile(): Promise<number> {
	const code = `const { parentPort, workerData } = require("node:worker_threads");
(async () => { const { compile } = await import(workerData.compiler); const start = performance.now(); compile(workerData.source, workerData.filename); parentPort.postMessage(performance.now() - start); })().catch(error => { throw error; });`
	return new Promise((resolveSample, reject) => {
		let received = false
		const worker = new Worker(code, { eval: true, workerData: { compiler: pathToFileURL(join(root, 'dist/compiler.js')).href, source, filename: fixtureFilename } })
		worker.once('message', (value: number) => {
			received = true
			resolveSample(value)
		})
		worker.once('error', reject)
		worker.once('exit', (code) => {
			if (code !== 0 || !received) reject(new Error(`Compiler worker exited ${code} without a result`))
		})
	})
}

async function measureCompletions(directory: string): Promise<void> {
	const workspace = join(directory, 'workspace')
	await mkdir(join(workspace, 'app/pages'), { recursive: true })
	await writeFile(join(workspace, 'package.json'), '{"private":true,"type":"module"}')
	await writeFile(
		join(workspace, 'tsconfig.json'),
		JSON.stringify({
			compilerOptions: {
				strict: true,
				module: 'esnext',
				moduleResolution: 'bundler',
				target: 'es2023',
				types: [],
				noEmit: true,
				paths: {
					'@meekojs/meeko': [join(root, 'dist/index.d.ts')],
					'@meekojs/meeko/framework': [join(root, 'dist/framework.d.ts')],
					'@meekojs/meeko/internal': [join(root, 'dist/internal.d.ts')],
				},
			},
		}),
	)
	const text = completionSource
	const filename = join(workspace, 'app/pages/index.meeko')
	await writeFile(filename, text)
	const cold: number[] = []
	for (let round = 0; round < coldRounds; round++) {
		const project = new MeekoProject(workspace, { trusted: false })
		try {
			await project.ready()
			const component = project.setDocument(filename, text)
			if (!component) throw new Error(`LSP fixture failed: ${String(project.componentError(filename))}`)
			const document = TextDocument.create(pathToFileURL(filename).href, 'meeko', 1, text)
			const context: FeatureContext = {
				project,
				component,
				document,
				locate(file) {
					try {
						const uri = pathToFileURL(file).href
						return { uri, document: TextDocument.create(uri, 'typescript', 0, readFileSync(file, 'utf8')) }
					} catch {
						return undefined
					}
				},
			}
			const position = document.positionAt(text.indexOf('const value = ') + 'const value = '.length)
			const complete = () => {
				const items = completionList(context, position)?.items
				if (!items?.some((item) => item.label === 'signal')) throw new Error('LSP benchmark lost signal completion')
			}
			const start = performance.now()
			complete()
			cold.push(performance.now() - start)
			if (round === coldRounds - 1) metrics['lsp.completion.warm'] = await repeated(complete)
		} finally {
			project.dispose()
		}
	}
	metrics['lsp.completion.cold'] = summarizePerformance(cold)
}

await mkdir(join(root, '.meeko/performance'), { recursive: true })
const directory = await mkdtemp(join(root, '.meeko/performance/run-'))
const inside = relative(join(root, '.meeko/performance'), directory)
if (inside.startsWith('..') || !inside.startsWith('run-')) throw new Error('Refusing to remove a benchmark directory outside its workspace')
try {
	const compiler = (await import(pathToFileURL(join(root, 'dist/compiler.js')).href)) as { compile(source: string, filename: string): { code: string } }
	const cold: number[] = []
	for (let index = 0; index < coldRounds; index++) cold.push(await coldCompile())
	metrics['compile.cold'] = summarizePerformance(cold)
	let edit = 0
	metrics['compile.warm'] = await repeated(() => compiler.compile(source.replace('signal(0)', `signal(${edit++})`), fixtureFilename), 30)
	const code = compiler.compile(source, fixtureFilename).code
	const transformed = await transform(code, { loader: 'ts', format: 'esm', target: 'es2022' })
	const modulePath = join(directory, 'fixture.mjs')
	await writeFile(modulePath, transformed.code)
	const fixture = (await import(pathToFileURL(modulePath).href)) as { renderWithState(props: Record<string, unknown>): { html: string; state: unknown } }
	const rendered = fixture.renderWithState({})
	if (!rendered.html.replaceAll(/<!--[\s\S]*?-->/g, '').includes('Count 0') || [...rendered.html.matchAll(/<li\b/g)].length !== 30) throw new Error('Incorrect benchmark SSR output')
	metrics['ssr.render'] = await repeated(() => fixture.renderWithState({}), 100)
	const client = await build({
		stdin: {
			contents: code + `\nconst start = performance.now(); hydrate(document.getElementById("app"), {}, ${JSON.stringify(rendered.state)}); globalThis.__meekoPerformance = { hydrationMs: performance.now() - start };`,
			loader: 'ts',
			resolveDir: root,
			sourcefile: fixtureFilename + '.ts',
		},
		bundle: true,
		write: false,
		format: 'esm',
		platform: 'browser',
		target: 'es2022',
		minify: true,
		legalComments: 'none',
	})
	const bundle = client.outputFiles[0]?.contents
	if (!bundle) throw new Error('Missing benchmark client bundle')
	metrics['bundle.raw'] = summarizePerformance([bundle.byteLength], 'bytes')
	metrics['bundle.gzip'] = summarizePerformance([gzipSync(bundle).byteLength], 'bytes')
	const html = `<!doctype html><html><head><title>Meeko performance fixture</title></head><body><div id="app">${rendered.html}</div><script type="module" src="/app.js"></script></body></html>`
	const server = createServer((request, response) => {
		response.setHeader('content-type', request.url === '/app.js' ? 'text/javascript' : 'text/html')
		response.end(request.url === '/app.js' ? bundle : html)
	})
	await new Promise<void>((done, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', done)
	})
	let browser
	let browserVersion = 'unknown'
	try {
		browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : process.env.MEEKO_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true })
		browserVersion = browser.version()
		const page = await browser.newPage()
		const errors: string[] = []
		page.on('pageerror', (error) => errors.push(error.message))
		const address = server.address()
		if (!address || typeof address === 'string') throw new Error('Missing benchmark server address')
		const hydration: number[] = []
		for (let round = 0; round < rounds + warmups; round++) {
			await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'load' })
			await page.waitForFunction(() => (globalThis as typeof globalThis & { __meekoPerformance?: unknown }).__meekoPerformance !== undefined)
			const duration = await page.evaluate(() => (globalThis as typeof globalThis & { __meekoPerformance: { hydrationMs: number } }).__meekoPerformance.hydrationMs)
			await page.getByRole('button', { name: 'Count 0', exact: true }).click()
			if ((await page.locator('button').innerText()) !== 'Count 1') throw new Error('Benchmark hydration did not preserve event bindings')
			if (round >= warmups) hydration.push(duration)
		}
		if (errors.length) throw new Error(errors.join('\n'))
		metrics['client.hydration'] = summarizePerformance(hydration)
	} finally {
		await browser?.close()
		await new Promise<void>((done) => server.close(() => done()))
	}
	await measureCompletions(directory)
	const report: PerformanceReport = {
		schema: 1,
		fixture: createHash('sha256')
			.update('Meeko-performance-v1\n' + source + '\n' + completionSource)
			.digest('hex'),
		environment: {
			node: process.version,
			platform: platform(),
			arch: arch(),
			cpu: cpus()[0]?.model ?? 'unknown',
			browser: browserVersion,
			esbuild: esbuildVersion,
			revision: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
			dirty: String(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim().length > 0),
			measuredAt: new Date().toISOString(),
			rounds: String(rounds),
			coldRounds: String(coldRounds),
			warmups: String(warmups),
		},
		metrics,
	}
	await mkdir(dirname(resolve(values.output)), { recursive: true })
	await writeFile(values.output, JSON.stringify(report, null, 2) + '\n')
	console.log(`Performance report: ${resolve(values.output)}`)
	for (const [name, metric] of Object.entries(metrics)) console.log(`${name}: median ${metric.median.toFixed(3)}, p95 ${metric.p95.toFixed(3)} ${metric.unit}`)
} finally {
	await rm(directory, { recursive: true, force: true })
}

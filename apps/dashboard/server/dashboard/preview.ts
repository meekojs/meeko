// Previews of a draft run in a worker process (scripts/preview-worker.mjs): the render compiles the
// package with TypeScript and grows by hundreds of megabytes, so the dashboard's server never loads
// it. One worker renders one preview at a time; while one renders, a newer request replaces the one
// that waits, since only the last text of the editor matters. The worker is retired when its memory
// grows past a limit or after a number of renders, and stopped after a while without previews.
import type { ChildProcess } from 'node:child_process'

import { ApiError } from '@meekojs/meeko/server'
import { fork } from 'node:child_process'

import type { Preview } from '../../shared/schemas/dashboard'

/** What the worker renders: a guide or a written reference page with the draft's Markdown. */
export interface PreviewRequest {
	readonly file: string
	readonly kind: 'guide' | 'reference'
	readonly markdown: string
}

/** Options of {@link PreviewRunner}. */
export interface PreviewRunnerOptions {
	/** The worker script: `node <script>` with an IPC channel. */
	readonly script: string
	readonly cwd: string
	readonly env: Readonly<Record<string, string | undefined>>
	/** A render that takes longer kills the worker; 60 s by default. */
	readonly timeoutMs?: number
	/** The worker stops after this long without previews; 5 min by default. */
	readonly idleMs?: number
	/** Renders before the worker is replaced; 40 by default. */
	readonly maxRenders?: number
	/** Resident memory, in bytes, after which the worker is replaced; 1.5 GB by default. */
	readonly maxRssBytes?: number
	/** Starts the worker instead of `fork`, for tests. */
	readonly forkWorker?: (env: Record<string, string>) => ChildProcess
}

interface Pending {
	readonly id: number
	readonly request: PreviewRequest
	readonly resolve: (preview: Preview) => void
	readonly reject: (error: unknown) => void
}

interface Worker {
	readonly child: ChildProcess
	renders: number
	retire: boolean
	stderr: string[]
}

type Reply = { readonly id: number; readonly ok: true; readonly result: Preview; readonly rss: number } | { readonly id: number; readonly ok: false; readonly error: string; readonly rss: number }

/** Renders previews in one worker process at a time. */
export class PreviewRunner {
	readonly #options: PreviewRunnerOptions
	#worker: Worker | null = null
	#running: (Pending & { readonly worker: Worker; readonly timer: ReturnType<typeof setTimeout> }) | null = null
	#waiting: Pending | null = null
	#idle: ReturnType<typeof setTimeout> | undefined
	#nextId = 1
	#closed = false
	/** Workers started since the dashboard started, for tests and the logs. */
	started = 0

	constructor(options: PreviewRunnerOptions) {
		this.#options = options
	}

	/** The process id of the worker, or `null` when none runs. */
	get pid(): number | null {
		return this.#worker?.child.pid ?? null
	}

	/**
	 * Renders a preview. A request that waits behind a running one is replaced by a newer request
	 * and fails with `409 PREVIEW_SUPERSEDED`; the editor ignores that failure.
	 */
	render(request: PreviewRequest): Promise<Preview> {
		if (this.#closed) return Promise.reject(new ApiError('PREVIEW_CLOSED', 503, 'The dashboard is shutting down'))
		return new Promise<Preview>((resolve, reject) => {
			const pending: Pending = { id: this.#nextId++, request, resolve, reject }
			if (this.#waiting) this.#waiting.reject(new ApiError('PREVIEW_SUPERSEDED', 409, 'A newer preview replaced this one'))
			this.#waiting = pending
			this.#next()
		})
	}

	/** Stops the worker; previews in flight fail. */
	async close(): Promise<void> {
		this.#closed = true
		clearTimeout(this.#idle)
		this.#waiting?.reject(new ApiError('PREVIEW_CLOSED', 503, 'The dashboard is shutting down'))
		this.#waiting = null
		const worker = this.#worker
		if (worker) await this.#stop(worker)
	}

	#next(): void {
		if (this.#running || !this.#waiting || this.#closed) return
		const pending = this.#waiting
		this.#waiting = null
		clearTimeout(this.#idle)
		const worker = this.#worker ?? this.#start()
		const timer = setTimeout(() => {
			if (this.#running?.id !== pending.id) return
			this.#running = null
			pending.reject(new ApiError('PREVIEW_TIMEOUT', 504, 'The preview took too long'))
			void this.#stop(worker).then(() => this.#next())
		}, this.#options.timeoutMs ?? 60_000)
		timer.unref()
		this.#running = { ...pending, worker, timer }
		worker.child.send({ id: pending.id, ...pending.request })
	}

	#start(): Worker {
		const env: Record<string, string> = {}
		for (const [key, value] of Object.entries(this.#options.env)) if (value !== undefined) env[key] = value
		env.NODE_OPTIONS = '--max-old-space-size=8192'
		const child = this.#options.forkWorker?.(env) ?? fork(this.#options.script, [], { cwd: this.#options.cwd, env, execArgv: ['--expose-gc'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'json', windowsHide: true })
		const worker: Worker = { child, renders: 0, retire: false, stderr: [] }
		this.#worker = worker
		this.started++
		child.stderr?.on('data', (chunk: Buffer | string) => {
			worker.stderr.push(...String(chunk).split(/\r?\n/).filter(Boolean))
			if (worker.stderr.length > 40) worker.stderr.splice(0, worker.stderr.length - 40)
		})
		child.stdout?.resume()
		child.on('message', (message: Reply | { ready: true }) => {
			if (!('id' in message)) return
			this.#reply(worker, message)
		})
		child.once('exit', (code) => {
			if (this.#worker === worker) this.#worker = null
			// Only the request this worker was rendering: a retired worker exits while the next one renders.
			const running = this.#running
			if (running?.worker === worker) {
				clearTimeout(running.timer)
				this.#running = null
				const detail = worker.stderr.slice(-5).join('\n')
				running.reject(new ApiError('PREVIEW_FAILED', 500, { message: `The preview worker exited with code ${code}${detail ? `: ${detail}` : ''}` }))
				this.#next()
			}
		})
		return worker
	}

	#reply(worker: Worker, reply: Reply): void {
		const running = this.#running
		if (!running || running.worker !== worker || running.id !== reply.id) return
		clearTimeout(running.timer)
		this.#running = null
		worker.renders++
		if (reply.rss > (this.#options.maxRssBytes ?? 1_500_000_000) || worker.renders >= (this.#options.maxRenders ?? 40)) worker.retire = true
		if (reply.ok) running.resolve(reply.result)
		// The render refused the input, such as a file that is not a source of its kind.
		else running.reject(new ApiError('PREVIEW_FAILED', 422, { message: reply.error, issues: [{ path: '', message: reply.error }] }))
		if (worker.retire) void this.#stop(worker)
		if (this.#waiting) this.#next()
		else this.#scheduleIdle()
	}

	#scheduleIdle(): void {
		clearTimeout(this.#idle)
		const worker = this.#worker
		if (!worker) return
		this.#idle = setTimeout(() => void this.#stop(worker), this.#options.idleMs ?? 300_000)
		this.#idle.unref()
	}

	#stop(worker: Worker): Promise<void> {
		if (this.#worker === worker) this.#worker = null
		const { child } = worker
		if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
		return new Promise((resolve) => {
			child.once('exit', () => resolve())
			child.kill()
		})
	}
}

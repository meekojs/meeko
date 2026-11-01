// Imports, publications and health checks run in a child process (scripts/content-job.mjs): the
// render keeps the overlay of revisions and its caches in module state, and it compiles the package
// with TypeScript, so a long-lived dashboard never loads it. One import or publication runs at a
// time, and one health check.
import type { ChildProcess } from 'node:child_process'

import { ApiError } from '@meekojs/meeko/server'
import { spawn } from 'node:child_process'

import type { HealthReport, Job, JobKind, Jobs, StartJob } from '../../shared/schemas/dashboard'

/** A job to start: what the screen sends, and who publishes for a publication. */
export type JobRequest = Exclude<StartJob, { kind: 'publish' }> | (Extract<StartJob, { kind: 'publish' }> & { readonly publishedBy: string })

/** Prefix of the last line a job prints: its result as JSON. */
export const resultMarker = '@@dashboard-result '

/** What a job reports on its last line. */
export interface JobResult {
	readonly summary: string
	readonly health?: HealthReport
	/** The publication lost to another change of the active snapshot. */
	readonly conflict?: boolean
}

/** Options of {@link JobRunner}. */
export interface JobRunnerOptions {
	/** The script that runs a job: `node <script> <kind>`. */
	readonly script: string
	readonly cwd: string
	/** Environment of the child, such as `DATABASE_URL` and `DASHBOARD_DATABASE_SCHEMA`. */
	readonly env: Readonly<Record<string, string | undefined>>
	/** A job that runs longer is killed and fails; 10 minutes by default. */
	readonly timeoutMs?: number
	/** Lines of output kept per job; 400 by default. */
	readonly maxLines?: number
	/** Runs a job's command instead of `node`, for tests. */
	readonly spawnJob?: (kind: JobKind, env: Record<string, string>) => ChildProcess
}

interface Running {
	readonly job: MutableJob
	readonly child: ChildProcess
	readonly done: Promise<void>
}

type MutableJob = { -readonly [K in keyof Job]: K extends 'output' ? string[] : Job[K] }

const slotOf = (kind: JobKind): 'content' | 'health' => (kind === 'health' ? 'health' : 'content')

/** Runs the jobs of the dashboard and keeps the last one of each slot. */
export class JobRunner {
	readonly #options: JobRunnerOptions
	readonly #last: { content: MutableJob | null; health: MutableJob | null } = { content: null, health: null }
	readonly #running = new Map<'content' | 'health', Running>()
	#nextId = 1
	#health: HealthReport | null = null
	#closed = false

	constructor(options: JobRunnerOptions) {
		this.#options = options
	}

	/** The last job of each slot, running or finished. */
	status(): Jobs {
		return { content: this.#last.content && { ...this.#last.content, output: [...this.#last.content.output] }, health: this.#last.health && { ...this.#last.health, output: [...this.#last.health.output] } }
	}

	/** The report of the last health check that succeeded in this process. */
	healthReport(): HealthReport | null {
		return this.#health
	}

	/**
	 * Starts a job. Throws `409 JOB_RUNNING` while another of its slot runs: an import and a
	 * publication never overlap. A publication is signed by `publishedBy`, the user of the session.
	 */
	start(input: JobRequest): Job {
		if (this.#closed) throw new ApiError('JOBS_CLOSED', 503, 'The dashboard is shutting down')
		const slot = slotOf(input.kind)
		if (this.#running.has(slot)) throw new ApiError('JOB_RUNNING', 409, `A ${slot} job is already running`)
		const env: Record<string, string> = {}
		for (const [key, value] of Object.entries(this.#options.env)) if (value !== undefined) env[key] = value
		env.NODE_OPTIONS = '--max-old-space-size=8192'
		if (input.kind === 'publish') {
			env.DASHBOARD_PUBLISHED_BY = input.publishedBy
			if (input.note) env.DASHBOARD_PUBLISH_NOTE = input.note
			else delete env.DASHBOARD_PUBLISH_NOTE
		}
		const publication = input.kind === 'publish' ? { publishedBy: input.publishedBy, note: input.note || null } : { publishedBy: null, note: null }
		const job: MutableJob = { id: this.#nextId++, kind: input.kind, status: 'running', startedAt: new Date().toISOString(), finishedAt: null, exitCode: null, output: [], dropped: 0, summary: null, conflict: false, ...publication }
		// The IPC channel ties the child to this process: the child ends when it closes, so a crash or
		// a kill of the dashboard never leaves an import or a publication running (scripts/parent-guard.mjs).
		const child = this.#options.spawnJob?.(input.kind, env) ?? spawn(process.execPath, [this.#options.script, input.kind], { cwd: this.#options.cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
		this.#last[slot] = job
		const done = this.#watch(slot, job, child)
		this.#running.set(slot, { job, child, done })
		return { ...job, output: [...job.output] }
	}

	/** Resolves when the running job of `kind`'s slot ends, at once if none runs. */
	async settled(kind: JobKind): Promise<void> {
		await this.#running.get(slotOf(kind))?.done
	}

	/** Kills the running jobs and waits for them, as the server does when it stops. */
	async close(): Promise<void> {
		this.#closed = true
		const running = [...this.#running.values()]
		for (const { child } of running) child.kill()
		await Promise.all(running.map(({ done }) => done))
	}

	#append(job: MutableJob, text: string): void {
		const max = this.#options.maxLines ?? 400
		for (const line of text.split(/\r?\n/)) {
			if (!line) continue
			if (line.startsWith(resultMarker)) {
				try {
					const result = JSON.parse(line.slice(resultMarker.length)) as JobResult
					job.summary = typeof result.summary === 'string' ? result.summary : null
					if (result.health) this.#health = result.health
					if (result.conflict === true) job.conflict = true
				} catch {
					job.output.push(line)
				}
				continue
			}
			job.output.push(line.length > 2000 ? `${line.slice(0, 2000)}…` : line)
		}
		if (job.output.length > max) {
			job.dropped += job.output.length - max
			job.output.splice(0, job.output.length - max)
		}
	}

	#watch(slot: 'content' | 'health', job: MutableJob, child: ChildProcess): Promise<void> {
		return new Promise((resolve) => {
			const buffers = { stdout: '', stderr: '' }
			const read = (stream: 'stdout' | 'stderr') => (chunk: Buffer | string) => {
				buffers[stream] += String(chunk)
				const end = buffers[stream].lastIndexOf('\n')
				if (end < 0) return
				this.#append(job, buffers[stream].slice(0, end))
				buffers[stream] = buffers[stream].slice(end + 1)
			}
			child.stdout?.on('data', read('stdout'))
			child.stderr?.on('data', read('stderr'))
			let timedOut = false
			const timer = setTimeout(() => {
				timedOut = true
				child.kill()
			}, this.#options.timeoutMs ?? 600_000)
			timer.unref()
			let finished = false
			const finish = (code: number | null, failure?: Error) => {
				if (finished) return
				finished = true
				clearTimeout(timer)
				this.#append(job, `${buffers.stdout}\n${buffers.stderr}`)
				if (failure) this.#append(job, `No se pudo iniciar el proceso: ${failure.message}`)
				if (timedOut) this.#append(job, 'Tiempo agotado: el proceso se detuvo.')
				job.exitCode = code
				job.status = code === 0 && !timedOut && !failure ? 'succeeded' : 'failed'
				job.finishedAt = new Date().toISOString()
				this.#running.delete(slot)
				resolve()
			}
			child.once('error', (error) => finish(null, error))
			child.once('close', (code) => finish(code))
		})
	}
}

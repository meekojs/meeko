import { onCleanup, onMounted, signal } from '@meekojs/meeko'

import type { Job, JobKind, Jobs, StartJob } from '../../shared/schemas/dashboard'
import type { Failure } from '../utils/errors'

import { describeError } from '../utils/errors'

/** Options of {@link useJobs}. */
export interface UseJobsOptions {
	/** Runs when a job that this page saw running ends. */
	readonly onFinish?: (job: Job) => void
	/** Milliseconds between two reads while a job runs; 1000 by default. */
	readonly interval?: number
}

const slotOf = (kind: JobKind): keyof Jobs => (kind === 'health' ? 'health' : 'content')

/**
 * The jobs of the dashboard, read again every second while one runs, and how to start one. The
 * initial state comes from the page's server data, so the first paint already shows a running job.
 */
export function useJobs(initial: Jobs, options: UseJobsOptions = {}) {
	const jobs = signal<Jobs>(initial)
	const failure = signal<Failure | null>(null)
	const starting = signal<JobKind | null>(null)
	let timer: ReturnType<typeof setTimeout> | undefined
	let disposed = false

	const running = (value: Jobs) => value.content?.status === 'running' || value.health?.status === 'running'

	async function refresh(): Promise<void> {
		const before = jobs.value
		try {
			const next = await rpc.jobs.status({})
			jobs.value = next
			failure.value = null
			for (const slot of ['content', 'health'] as const) {
				const previous = before[slot]
				const current = next[slot]
				if (previous?.status === 'running' && current && current.id === previous.id && current.status !== 'running') options.onFinish?.(current)
			}
		} catch (error) {
			failure.value = describeError(error)
		}
		schedule()
	}

	function schedule(): void {
		clearTimeout(timer)
		if (disposed || !running(jobs.value)) return
		timer = setTimeout(() => void refresh(), options.interval ?? 1000)
	}

	/** Starts a job; `false` when the server refused it, with the reason in `failure`. */
	async function start(input: StartJob): Promise<boolean> {
		starting.value = input.kind
		try {
			const job = await rpc.jobs.start(input)
			jobs.value = { ...jobs.value, [slotOf(input.kind)]: job }
			failure.value = null
			schedule()
			return true
		} catch (error) {
			failure.value = describeError(error)
			return false
		} finally {
			starting.value = null
		}
	}

	onMounted(() => schedule())
	onCleanup(() => {
		disposed = true
		clearTimeout(timer)
	})

	return { jobs, failure, starting, start, refresh }
}

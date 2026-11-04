// The preview runner with a worker that echoes instead of rendering, and the children of the
// dashboard when it dies without closing them. No database and no render: milliseconds per test.
import assert from 'node:assert/strict'
import { fork, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { PreviewRunner } from '../server/dashboard/preview'

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url))
const worker = `${fixtures}echo-worker.mjs`

function runner(options: { readonly timeoutMs?: number; readonly maxRenders?: number; readonly maxRssBytes?: number; readonly rss?: number } = {}) {
	const spawned: Record<string, string>[] = []
	const preview = new PreviewRunner({
		script: worker,
		cwd: fixtures,
		env: { FAKE_RSS: String(options.rss ?? 1) },
		...options,
		forkWorker: (env) => {
			spawned.push(env)
			return fork(worker, [], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true })
		},
	})
	return { preview, spawned }
}

const request = (markdown: string) => ({ file: 'docs/doctor.md', kind: 'guide' as const, markdown })
const code = (expected: string) => (error: Error & { code?: string }) => error.code === expected

test('a preview renders in one worker, reused for the next ones', async () => {
	const { preview, spawned } = runner()
	try {
		assert.equal((await preview.render(request('uno'))).title, 'uno')
		const pid = preview.pid
		assert.equal((await preview.render(request('dos'))).html, '<p>dos</p>')
		assert.equal(preview.pid, pid)
		assert.equal(preview.started, 1)
		assert.equal(spawned[0]?.NODE_OPTIONS, '--max-old-space-size=8192')
	} finally {
		await preview.close()
	}
	assert.equal(preview.pid, null)
})

test('a newer request replaces the one that waits, and the running one finishes', async () => {
	const { preview } = runner()
	try {
		const slow = preview.render(request('slow'))
		const replaced = preview.render(request('segunda'))
		const last = preview.render(request('tercera'))
		await assert.rejects(replaced, code('PREVIEW_SUPERSEDED'))
		assert.equal((await slow).title, 'slow')
		assert.equal((await last).title, 'tercera')
	} finally {
		await preview.close()
	}
})

test('a render the worker refuses is a 422, and a crash or a timeout starts a new worker', async () => {
	const { preview } = runner({ timeoutMs: 500 })
	try {
		await assert.rejects(preview.render(request('fail')), (error: Error & { code?: string; status?: number }) => error.code === 'PREVIEW_FAILED' && error.status === 422)
		await assert.rejects(preview.render(request('crash')), (error: Error & { code?: string; status?: number }) => error.code === 'PREVIEW_FAILED' && error.status === 500)
		assert.equal((await preview.render(request('tras el fallo'))).title, 'tras el fallo')
		await assert.rejects(preview.render(request('slow')), code('PREVIEW_TIMEOUT'))
		assert.equal((await preview.render(request('tras el plazo'))).title, 'tras el plazo')
		assert.equal(preview.started, 3)
	} finally {
		await preview.close()
	}
	await assert.rejects(preview.render(request('cerrado')), code('PREVIEW_CLOSED'))
})

test('the worker is replaced after its renders or when its memory grows', async () => {
	const counted = runner({ maxRenders: 2 })
	try {
		for (const text of ['a', 'b', 'c']) await counted.preview.render(request(text))
		assert.equal(counted.preview.started, 2)
	} finally {
		await counted.preview.close()
	}
	const heavy = runner({ rss: 2_000_000_000 })
	try {
		await heavy.preview.render(request('a'))
		await heavy.preview.render(request('b'))
		assert.equal(heavy.preview.started, 2, 'a worker past maxRssBytes is replaced')
	} finally {
		await heavy.preview.close()
	}
})

/** Whether a process is alive. */
const alive = (pid: number) => {
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

/** Starts the fixture dashboard, kills it without closing anything and reports its children. */
async function killDashboard(mode: 'guarded' | 'unguarded') {
	const dashboard = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), `${fixtures}fake-dashboard.ts`, mode], { cwd: fixtures, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' } })
	let output = ''
	dashboard.stdout.on('data', (chunk) => (output += chunk))
	dashboard.stderr.on('data', (chunk) => (output += chunk))
	const deadline = Date.now() + 30_000
	while (!/PREVIEW \d+/.test(output)) {
		if (dashboard.exitCode !== null || Date.now() > deadline) throw new Error(output)
		await new Promise((resolve) => setTimeout(resolve, 50))
	}
	const job = Number(/JOB (\d+)/.exec(output)![1])
	const preview = Number(/PREVIEW (\d+)/.exec(output)![1])
	assert.ok(alive(job) && alive(preview))
	// No close(): the dashboard dies as in a crash or `taskkill /F`.
	dashboard.kill('SIGKILL')
	await new Promise((resolve) => dashboard.once('exit', resolve))
	const until = Date.now() + 5000
	while ((alive(job) || alive(preview)) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 100))
	return { job: alive(job) ? job : null, preview: alive(preview) ? preview : null }
}

test('the job and the preview worker end when the dashboard dies without closing them', { timeout: 60_000 }, async () => {
	const survivors = await killDashboard('guarded')
	assert.deepEqual(survivors, { job: null, preview: null })
})

// Without the guard, what happens depends on the platform. On Windows libuv puts every child in a
// job object that is killed with its parent, so the job ends anyway. On Linux and macOS it keeps
// running (checked in a node:24-alpine container: alive after a SIGKILL of its parent, with or
// without the IPC channel), which is what the guard prevents.
test('without the guard a job outlives a killed dashboard, except on Windows', { timeout: 60_000 }, async () => {
	const survivors = await killDashboard('unguarded')
	try {
		if (process.platform === 'win32') assert.equal(survivors.job, null, 'the job object of libuv ends it')
		else assert.notEqual(survivors.job, null, 'the unguarded job is still running')
		assert.equal(survivors.preview, null)
	} finally {
		if (survivors.job) process.kill(survivors.job)
	}
})

test('the real job and worker scripts use the guard', () => {
	for (const script of ['content-job.mjs', 'preview-worker.mjs']) assert.match(readFileSync(new URL(`../scripts/${script}`, import.meta.url), 'utf8'), /exitWithParent\(/, script)
})

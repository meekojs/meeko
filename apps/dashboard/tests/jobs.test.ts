// The job runner without the real script: each test starts a small Node child that prints what a
// job prints, so slots, output, results, failures and timeouts are checked in milliseconds.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { test } from 'node:test'

import type { JobKind } from '../shared/schemas/dashboard'

import { allowedHost, hostName } from '../server/dashboard/host'
import { JobRunner, resultMarker } from '../server/dashboard/jobs'

/** A runner whose jobs run `code` in `node -e`, with the job's kind in `process.argv[1]`. */
function runner(code: string, options: { readonly timeoutMs?: number; readonly maxLines?: number } = {}) {
	const seen: { kind: JobKind; env: Record<string, string> }[] = []
	const jobs = new JobRunner({
		script: 'unused',
		cwd: process.cwd(),
		env: { DATABASE_URL: 'postgresql://example/db' },
		...options,
		spawnJob: (kind, env) => {
			seen.push({ kind, env })
			return spawn(process.execPath, ['-e', code, kind], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
		},
	})
	return { jobs, seen }
}

test('a job keeps its output and its result, and an import and a publication never overlap', async () => {
	const { jobs, seen } = runner(`setTimeout(() => { console.log('line one'); console.error('warning'); console.log(${JSON.stringify(resultMarker)} + JSON.stringify({ summary: 'done ' + process.argv[1] })) }, 150)`)
	const started = jobs.start({ kind: 'import' })
	assert.equal(started.status, 'running')
	assert.throws(
		() => jobs.start({ kind: 'publish', publishedBy: 'ana' }),
		(error: Error & { code?: string; status?: number }) => error.code === 'JOB_RUNNING' && error.status === 409,
	)
	// The health check has its own slot.
	assert.equal(jobs.start({ kind: 'health' }).kind, 'health')
	await jobs.settled('import')
	await jobs.settled('health')
	const { content, health } = jobs.status()
	assert.equal(content?.status, 'succeeded')
	assert.equal(content?.exitCode, 0)
	assert.equal(content?.summary, 'done import')
	assert.deepEqual([...(content?.output ?? [])].sort(), ['line one', 'warning'])
	assert.ok(content?.finishedAt)
	assert.equal(health?.summary, 'done health')
	assert.equal(seen[0]?.env.NODE_OPTIONS, '--max-old-space-size=8192')
	assert.equal(seen[0]?.env.DATABASE_URL, 'postgresql://example/db')
	await jobs.close()
})

test('a publication passes who publishes and the note to the child', async () => {
	const { jobs, seen } = runner(`console.log(process.env.DASHBOARD_PUBLISHED_BY + '|' + (process.env.DASHBOARD_PUBLISH_NOTE ?? '-'))`)
	jobs.start({ kind: 'publish', publishedBy: 'ana', note: 'tono' })
	await jobs.settled('publish')
	assert.deepEqual(jobs.status().content?.output, ['ana|tono'])
	jobs.start({ kind: 'publish', publishedBy: 'luis' })
	await jobs.settled('publish')
	assert.deepEqual(jobs.status().content?.output, ['luis|-'])
	assert.equal(seen.length, 2)
	await jobs.close()
})

test('a health check keeps its report for the page', async () => {
	const report = { checkedAt: '2026-10-31T00:00:00.000Z', pendingReferences: [], undocumentedExports: [], brokenLinks: [], checked: { guides: 1, references: 2, links: 3 } }
	const { jobs } = runner(`console.log(${JSON.stringify(resultMarker + JSON.stringify({ summary: 'ok', health: report }))})`)
	assert.equal(jobs.healthReport(), null)
	jobs.start({ kind: 'health' })
	await jobs.settled('health')
	assert.deepEqual(jobs.healthReport(), report)
	await jobs.close()
})

test('a publication that lost to a rollback fails as a conflict', async () => {
	const { jobs } = runner(`console.log(${JSON.stringify(resultMarker + JSON.stringify({ summary: 'Conflicto', conflict: true }))}); process.exit(3)`)
	jobs.start({ kind: 'publish', publishedBy: 'ana', note: 'tono' })
	await jobs.settled('publish')
	const job = jobs.status().content!
	assert.equal(job.status, 'failed')
	assert.equal(job.conflict, true)
	assert.equal(job.summary, 'Conflicto')
	// «Volver a publicar» after a reload sends the same author and note again.
	assert.deepEqual([job.publishedBy, job.note], ['ana', 'tono'])
	jobs.start({ kind: 'import' })
	assert.equal(jobs.status().content?.conflict, false, 'a new job starts without the conflict')
	assert.equal(jobs.status().content?.publishedBy, null)
	await jobs.close()
})

test('a failing job, a timeout and a long output are reported', async () => {
	const failing = runner(`console.error('boom'); process.exit(3)`)
	failing.jobs.start({ kind: 'import' })
	await failing.jobs.settled('import')
	assert.equal(failing.jobs.status().content?.status, 'failed')
	assert.equal(failing.jobs.status().content?.exitCode, 3)
	assert.deepEqual(failing.jobs.status().content?.output, ['boom'])

	const slow = runner('setTimeout(() => {}, 60_000)', { timeoutMs: 200 })
	slow.jobs.start({ kind: 'import' })
	await slow.jobs.settled('import')
	assert.equal(slow.jobs.status().content?.status, 'failed')
	assert.match(slow.jobs.status().content?.output.at(-1) ?? '', /Timed out/)

	const long = runner(`for (let i = 0; i < 50; i++) console.log('line ' + i)`, { maxLines: 10 })
	long.jobs.start({ kind: 'import' })
	await long.jobs.settled('import')
	const job = long.jobs.status().content!
	assert.equal(job.output.length, 10)
	assert.equal(job.dropped, 40)
	assert.equal(job.output.at(-1), 'line 49')
	await Promise.all([failing.jobs.close(), slow.jobs.close(), long.jobs.close()])
})

test('closing the runner kills the running job and refuses new ones', async () => {
	const { jobs } = runner('setTimeout(() => {}, 60_000)')
	jobs.start({ kind: 'import' })
	await jobs.close()
	assert.equal(jobs.status().content?.status, 'failed')
	assert.throws(
		() => jobs.start({ kind: 'health' }),
		(error: Error & { code?: string }) => error.code === 'JOBS_CLOSED',
	)
})

test('only loopback hosts reach the dashboard, unless DASHBOARD_ALLOWED_HOSTS names another', () => {
	assert.equal(hostName('127.0.0.1:4310'), '127.0.0.1')
	assert.equal(hostName('[::1]:4310'), '[::1]')
	assert.equal(hostName('LocalHost'), 'localhost')
	for (const host of ['127.0.0.1:4310', 'localhost:4310', '[::1]:4310', 'localhost']) assert.equal(allowedHost(host, ''), true, host)
	for (const host of ['evil.example', 'evil.example:4310', '127.0.0.1.evil.example', '', null]) assert.equal(allowedHost(host, ''), false, String(host))
	assert.equal(allowedHost('dashboard.lan:4310', 'dashboard.lan, other'), true)
})

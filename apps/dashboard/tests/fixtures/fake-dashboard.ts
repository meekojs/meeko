// A dashboard process with the real JobRunner and PreviewRunner, whose children are the fixtures:
// it starts a job and a preview, prints both pids and waits for the test to kill it. With
// `unguarded`, the job does not use scripts/parent-guard.mjs, to show what the guard prevents.
import { fileURLToPath } from 'node:url'

import { JobRunner } from '../../server/dashboard/jobs'
import { PreviewRunner } from '../../server/dashboard/preview'

const fixtures = fileURLToPath(new URL('./', import.meta.url))
const env = process.argv.includes('unguarded') ? { FIXTURE_UNGUARDED: '1' } : {}
const jobs = new JobRunner({ script: `${fixtures}sleepy-job.mjs`, cwd: fixtures, env })
const preview = new PreviewRunner({ script: `${fixtures}echo-worker.mjs`, cwd: fixtures, env })

jobs.start({ kind: 'import' })
await preview.render({ file: 'docs/doctor.md', kind: 'guide', markdown: 'hola' })
const deadline = Date.now() + 10_000
const pidLine = () => jobs.status().content?.output.find((line) => line.startsWith('pid:'))
while (!pidLine()) {
	if (Date.now() > deadline) throw new Error('the job did not start')
	await new Promise((resolve) => setTimeout(resolve, 50))
}
console.log(`JOB ${pidLine()!.slice(4)}`)
console.log(`PREVIEW ${preview.pid}`)
setTimeout(() => {}, 120_000)

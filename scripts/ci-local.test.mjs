// pnpm ci:local is only useful while it runs what CI runs: a job or a script added to ci.yml must be added there too.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { jobs } from './ci-local.mjs'

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n')

/** `package:script` of a pnpm invocation (`pnpm lint`, `pnpm run check`, `pnpm -F name run test`, `pnpm -F name exec`). */
function scriptOf(words) {
	const filter = words[0] === '-F' ? words[1] : ''
	const rest = filter ? words.slice(2) : words
	return `${filter}:${rest[0] === 'run' ? rest[1] : rest[0]}`
}

test('every job of ci.yml has a local job, except the aggregate check and the path filter', () => {
	// `changes` only decides which jobs a PR runs; locally every job runs.
	const ids = [...workflow.slice(workflow.indexOf('\njobs:\n')).matchAll(/^ {2}([\w-]+):\n/gm)].map((match) => match[1]).filter((id) => id !== 'test' && id !== 'changes')
	assert.ok(ids.length > 5, 'the jobs of ci.yml are found')
	assert.deepEqual(
		ids.filter((id) => !jobs.some((job) => job.id === id)),
		[],
	)
})

test('every pnpm script that ci.yml runs is run locally too', () => {
	const remote = new Set([...workflow.matchAll(/\bpnpm ((?:-F \S+ )?[\w:-]+(?: [\w:-]+)?)/g)].map((match) => scriptOf(match[1].split(' '))))
	const local = new Set(
		jobs
			.flatMap((job) => job.steps)
			.map((step) => (typeof step.command === 'function' ? step.command() : step.command))
			.map((command) => command.slice(command.indexOf('pnpm')))
			.filter((command) => command[0] === 'pnpm')
			.map((command) => scriptOf(command.slice(1))),
	)
	assert.ok(remote.has('meeko-i18n-site:test:e2e'), 'the scripts of ci.yml are found')
	assert.deepEqual(
		[...remote].filter((script) => !local.has(script)),
		[],
	)
})

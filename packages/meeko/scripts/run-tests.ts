import { spawnSync } from 'node:child_process'
import { globSync, readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'

// Each test file runs in its own process (node --test), so files without shared resources run in
// parallel. Those that bind fixed ports, launch Chrome or start development servers run one after
// another, as before: they compete for ports, memory and CPU.

// Cada shard vive en su propio runner: las pruebas conservan su aislamiento por archivo.
const shard = process.env.MEEKO_TEST_SHARD
if (shard && (!/^[1-9]\d*\/[1-9]\d*$/.test(shard) || Number(shard.split('/')[0]) > Number(shard.split('/')[1]))) {
	throw new Error('MEEKO_TEST_SHARD must have the form index/total, with 1 <= index <= total')
}

/** Parallel processes; `MEEKO_TEST_CONCURRENCY=1` runs every file in series. */
const concurrency = Number(process.env.MEEKO_TEST_CONCURRENCY ?? Math.max(1, Math.min(4, Math.floor(availableParallelism() / 4))))
if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('MEEKO_TEST_CONCURRENCY must be a positive integer')

const files = globSync('tests/*.test.ts').sort()
if (files.length === 0) throw new Error('No core test files found')

/** What makes a file share resources with others: a fixed port, Chrome, or a development or production server. */
const shared = /\b(?:port|PORT)\b[^\n]{0,40}\b\d{4,5}\b|localhost:\d{4,5}|chromium\.launch|startDevelopmentServer|createDevServer|meeko dev\b|\bspawn\(/
const serial = files.filter((file) => shared.test(readFileSync(file, 'utf8')))
const parallel = files.filter((file) => !serial.includes(file))

function run(list: readonly string[], processes: number): number {
	if (list.length === 0) return 0
	const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', `--test-concurrency=${processes}`, ...(shard ? [`--test-shard=${shard}`] : []), ...list], {
		stdio: 'inherit',
		windowsHide: true,
		timeout: 60 * 60 * 1000,
	})
	if (result.error) throw result.error
	return result.status ?? 1
}

// Both groups run even when the first fails, so one run reports every failure.
const statuses = [run(parallel, concurrency), run(serial, 1)]
process.exit(statuses.find((status) => status !== 0) ?? 0)

import { spawnSync } from 'node:child_process'
import { globSync } from 'node:fs'

// Cada shard vive en su propio runner: las pruebas conservan su aislamiento por archivo.
const shard = process.env.MEEKO_TEST_SHARD
if (shard && (!/^[1-9]\d*\/[1-9]\d*$/.test(shard) || Number(shard.split('/')[0]) > Number(shard.split('/')[1]))) {
	throw new Error('MEEKO_TEST_SHARD must have the form index/total, with 1 <= index <= total')
}
const files = globSync('tests/*.test.ts').sort()
if (files.length === 0) throw new Error('No core test files found')
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...(shard ? [`--test-shard=${shard}`] : []), ...files], {
	stdio: 'inherit',
	windowsHide: true,
	timeout: 60 * 60 * 1000,
})
if (result.error) throw result.error
process.exit(result.status ?? 1)

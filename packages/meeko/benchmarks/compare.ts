import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { comparePerformance, performanceBudgets, performanceReport } from './performance-budget'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({
	options: {
		baseline: { type: 'string', default: resolve(root, 'benchmarks/performance-baseline.json') },
		current: { type: 'string', default: resolve(root, '.meeko/performance/current.json') },
		budgets: { type: 'string', default: resolve(root, 'benchmarks/performance-budgets.json') },
		output: { type: 'string', default: resolve(root, '.meeko/performance/comparison.json') },
		'fail-on-regression': { type: 'boolean', default: false },
	},
})
const baseline = performanceReport(JSON.parse(await readFile(values.baseline, 'utf8')))
const current = performanceReport(JSON.parse(await readFile(values.current, 'utf8')))
const budgets = performanceBudgets(JSON.parse(await readFile(values.budgets, 'utf8')))
const results = comparePerformance(baseline, current, budgets)
await mkdir(dirname(resolve(values.output)), { recursive: true })
await writeFile(values.output, JSON.stringify({ schema: 1, baseline: values.baseline, current: values.current, results }, null, 2) + '\n')
for (const result of results) console.log(`${result.status}: ${result.metric} ${result.baseline.toFixed(3)} -> ${result.current.toFixed(3)} ${result.unit}`)
if (values['fail-on-regression'] && results.some((result) => result.status === 'regression')) process.exitCode = 1

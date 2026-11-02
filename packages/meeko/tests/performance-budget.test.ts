import assert from 'node:assert/strict'
import test from 'node:test'

import type { PerformanceReport } from '../benchmarks/performance-budget.ts'

import { comparePerformance, performanceBudgets, performanceReport, summarizePerformance } from '../benchmarks/performance-budget.ts'

const environment = { node: 'v24', platform: 'win32', arch: 'x64', cpu: 'same-cpu', browser: 'same-browser' }
const budgets = performanceBudgets({ defaults: { ms: { increasePercent: 35, minimumIncrease: 0.05 }, bytes: { increasePercent: 5, minimumIncrease: 256 } } })
function report(times: number[], bytes = 10_000, cpu = environment.cpu): PerformanceReport {
	return performanceReport({
		schema: 1,
		fixture: 'same-fixture',
		environment: { ...environment, cpu },
		metrics: {
			compile: summarizePerformance(times),
			bundle: summarizePerformance([bytes], 'bytes'),
		},
	})
}

test('performance gates require both median and p95 regressions outside the absolute noise floor', () => {
	const baseline = report([10, 10, 10, 10, 20])
	const medianOnly = report([15, 15, 15, 15, 19])
	assert.equal(comparePerformance(baseline, medianOnly, budgets)[0]!.status, 'within-budget')
	const regression = report([15, 15, 15, 15, 30])
	assert.equal(comparePerformance(baseline, regression, budgets)[0]!.status, 'regression')
	assert.equal(comparePerformance(report([0.01]), report([0.02]), budgets)[0]!.status, 'within-budget')
})

test('a different CPU skips timing gates while deterministic bundle growth still fails', () => {
	const result = comparePerformance(report([10]), report([30], 11_000, 'different-cpu'), budgets)
	assert.equal(result[0]!.status, 'different-environment')
	assert.equal(result[1]!.status, 'regression')
})

test('comparison refuses missing work, changed units and a changed scenario', () => {
	const baseline = report([10])
	assert.throws(() => comparePerformance(baseline, { ...baseline, fixture: 'other-fixture' }, budgets), /fixtures differ/)
	assert.throws(() => comparePerformance(baseline, { ...baseline, metrics: {} }, budgets), /Missing or changed/)
	assert.throws(() => comparePerformance(baseline, { ...baseline, metrics: { ...baseline.metrics, compile: summarizePerformance([10], 'bytes') } }, budgets), /Missing or changed/)
})

test('performance reports reject corrupt or empty samples and invalid budgets', () => {
	assert.equal(summarizePerformance([4, 1, 3, 2]).median, 2.5, 'even round counts retain the statistical median')
	assert.throws(() => summarizePerformance([]), /samples/)
	assert.throws(() => summarizePerformance([Number.NaN]), /samples/)
	assert.throws(() => performanceReport({}), /report/)
	const valid = report([10])
	assert.throws(() => performanceReport({ ...valid, metrics: { compile: { ...valid.metrics.compile, median: Number.POSITIVE_INFINITY } } }), /metric/)
	assert.throws(() => performanceReport({ ...valid, metrics: { compile: { ...valid.metrics.compile, minimum: 20 } } }), /Unordered/)
	assert.throws(() => performanceBudgets({ defaults: { ms: { increasePercent: -1, minimumIncrease: 0 }, bytes: { increasePercent: 5, minimumIncrease: 0 } } }), /budget/)
})

export interface PerformanceMetric {
	readonly unit: 'ms' | 'bytes'
	readonly samples: number
	readonly median: number
	readonly p95: number
	readonly minimum: number
	readonly maximum: number
}

export interface PerformanceReport {
	readonly schema: 1
	readonly fixture: string
	readonly environment: Readonly<Record<string, string>>
	readonly metrics: Readonly<Record<string, PerformanceMetric>>
}

export interface PerformanceBudget {
	readonly increasePercent: number
	readonly minimumIncrease: number
}

export interface PerformanceBudgets {
	readonly defaults: { readonly ms: PerformanceBudget; readonly bytes: PerformanceBudget }
	readonly metrics?: Readonly<Record<string, PerformanceBudget>>
}

export interface PerformanceComparison {
	readonly metric: string
	readonly unit: PerformanceMetric['unit']
	readonly baseline: number
	readonly current: number
	readonly increasePercent: number | null
	readonly status: 'within-budget' | 'regression' | 'different-environment'
	readonly budget: PerformanceBudget
}

/** Resume todas las muestras, sin descartar extremos ni mezclar unidades. */
export function summarizePerformance(values: readonly number[], unit: PerformanceMetric['unit'] = 'ms'): PerformanceMetric {
	if (!values.length || values.some((value) => !Number.isFinite(value) || value < 0)) throw new TypeError('Performance samples must be finite non-negative numbers')
	const sorted = [...values].sort((a, b) => a - b)
	const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!
	const middle = Math.floor(sorted.length / 2)
	const median = sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
	return { unit, samples: values.length, median, p95: percentile(0.95), minimum: sorted[0]!, maximum: sorted.at(-1)! }
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Rechaza informes truncados, NaN, unidades mezcladas y muestras sin escenario identificable. */
export function performanceReport(value: unknown): PerformanceReport {
	if (!record(value) || value.schema !== 1 || typeof value.fixture !== 'string' || !value.fixture || !record(value.environment) || !record(value.metrics)) throw new TypeError('Invalid performance report')
	for (const key of ['node', 'platform', 'arch', 'cpu', 'browser']) if (typeof value.environment[key] !== 'string') throw new TypeError(`Missing performance environment ${key}`)
	if (!Object.keys(value.metrics).length) throw new TypeError('Missing performance metrics')
	for (const [name, metric] of Object.entries(value.metrics)) {
		if (!record(metric) || (metric.unit !== 'ms' && metric.unit !== 'bytes') || !Number.isSafeInteger(metric.samples) || Number(metric.samples) < 1) throw new TypeError(`Invalid performance metric ${name}`)
		for (const key of ['median', 'p95', 'minimum', 'maximum']) if (typeof metric[key] !== 'number' || !Number.isFinite(metric[key]) || metric[key] < 0) throw new TypeError(`Invalid performance metric ${name}.${key}`)
		if (Number(metric.minimum) > Number(metric.median) || Number(metric.median) > Number(metric.p95) || Number(metric.p95) > Number(metric.maximum)) throw new TypeError(`Unordered performance metric ${name}`)
	}
	return value as unknown as PerformanceReport
}

export function performanceBudgets(value: unknown): PerformanceBudgets {
	if (!record(value) || !record(value.defaults) || !record(value.defaults.ms) || !record(value.defaults.bytes) || (value.metrics !== undefined && !record(value.metrics))) throw new TypeError('Invalid performance budgets')
	const entries = [...Object.entries(value.defaults), ...Object.entries(value.metrics ?? {})]
	for (const [name, budget] of entries) {
		if (!record(budget) || typeof budget.increasePercent !== 'number' || !Number.isFinite(budget.increasePercent) || budget.increasePercent < 0 || typeof budget.minimumIncrease !== 'number' || !Number.isFinite(budget.minimumIncrease) || budget.minimumIncrease < 0) throw new TypeError(`Invalid performance budget ${name}`)
	}
	return value as unknown as PerformanceBudgets
}

/** Compara bytes siempre; los tiempos sólo entre el mismo motor y máquina. Mediana y p95 deben exceder el presupuesto. */
export function comparePerformance(baseline: PerformanceReport, current: PerformanceReport, budgets: PerformanceBudgets): PerformanceComparison[] {
	if (baseline.fixture !== current.fixture) throw new TypeError('Performance fixtures differ; capture a matching baseline instead of comparing different work')
	const sameEnvironment = ['node', 'platform', 'arch', 'cpu', 'browser'].every((key) => baseline.environment[key] === current.environment[key])
	return Object.entries(baseline.metrics).map(([name, previous]) => {
		const next = current.metrics[name]
		if (!next || previous.unit !== next.unit) throw new TypeError(`Missing or changed performance metric ${name}`)
		const budget = budgets.metrics?.[name] ?? budgets.defaults[previous.unit]
		const increase = (old: number, now: number) => (old === 0 ? (now === 0 ? 0 : Number.POSITIVE_INFINITY) : ((now - old) / old) * 100)
		const percent = increase(previous.median, next.median)
		const exceeded = next.median - previous.median > budget.minimumIncrease && percent > budget.increasePercent && next.p95 - previous.p95 > budget.minimumIncrease && increase(previous.p95, next.p95) > budget.increasePercent
		return {
			metric: name,
			unit: previous.unit,
			baseline: previous.median,
			current: next.median,
			increasePercent: Number.isFinite(percent) ? percent : null,
			budget,
			status: previous.unit === 'ms' && !sameEnvironment ? 'different-environment' : exceeded ? 'regression' : 'within-budget',
		}
	})
}

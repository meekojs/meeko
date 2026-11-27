import assert from 'node:assert/strict'
import test from 'node:test'

import type { EffectResult } from '../src/index.ts'

import { bindingEffect, computed, createContext, createRoot, effect, inject, onCleanup, provide, runDry, signal, untrack } from '../src/core/reactivity.ts'

void (() => {
	// A cleanup returned from an effect is accepted, with or without an annotation.
	effect(() => () => undefined)
	effect((): EffectResult => undefined)
	effect((): void | (() => void) => () => undefined)
	// Effects that only read keep compiling: other return values are ignored.
	effect(() => 1)
	// @ts-expect-error a returned cleanup must be synchronous
	effect(() => async () => undefined)
})

/** Captures `console.warn` while `work` runs, with `NODE_ENV` set to `mode`. */
async function withWarnings(mode: string | undefined, work: () => unknown): Promise<unknown[][]> {
	const warnings: unknown[][] = []
	const original = console.warn
	const previous = process.env.NODE_ENV
	console.warn = (...args: unknown[]) => {
		warnings.push(args)
	}
	if (mode === undefined) delete process.env.NODE_ENV
	else process.env.NODE_ENV = mode
	try {
		await work()
	} finally {
		console.warn = original
		if (previous === undefined) delete process.env.NODE_ENV
		else process.env.NODE_ENV = previous
	}
	return warnings
}

test('the cleanup an effect returns runs before each new run and when it stops', () => {
	const delay = signal(1)
	const log: string[] = []
	const stop = effect(() => {
		const ms = delay.value
		log.push(`start:${ms}`)
		return () => log.push(`clear:${ms}`)
	})
	assert.deepEqual(log.splice(0), ['start:1'])
	delay.value = 2
	assert.deepEqual(log.splice(0), ['clear:1', 'start:2'])
	delay.value = 3
	assert.deepEqual(log.splice(0), ['clear:2', 'start:3'])
	stop()
	assert.deepEqual(log.splice(0), ['clear:3'])
	delay.value = 4
	stop()
	assert.deepEqual(log, [], 'a stopped effect neither runs nor cleans up again')
})

test('onCleanup inside an effect belongs to that run, not to the root', () => {
	const source = signal(0)
	const log: string[] = []
	const dispose = createRoot((dispose) => {
		effect(() => {
			const value = source.value
			onCleanup(() => log.push(`onCleanup:${value}`))
			return () => log.push(`returned:${value}`)
		})
		return dispose
	})
	source.value = 1
	source.value = 2
	assert.deepEqual(log.splice(0), ['onCleanup:0', 'returned:0', 'onCleanup:1', 'returned:1'], 'registration order, before every run')
	dispose()
	assert.deepEqual(log.splice(0), ['onCleanup:2', 'returned:2'], 'only the last run is still pending at release')
	dispose()
	assert.deepEqual(log, [])
})

test('what a run creates is released before the next run instead of piling up', () => {
	const outer = signal(0)
	const inner = signal(0)
	let innerRuns = 0
	const nested: string[] = []
	const dispose = createRoot((dispose) => {
		effect(() => {
			void outer.value
			effect(() => {
				void inner.value
				innerRuns++
			})
			createRoot(() => onCleanup(() => nested.push('root')))
			const doubled = computed(() => inner.value * 2)
			untrack(() => doubled.value)
		})
		return dispose
	})
	outer.value = 1
	outer.value = 2
	assert.deepEqual(nested, ['root', 'root'])
	innerRuns = 0
	inner.value = 1
	assert.equal(innerRuns, 1, 'only the nested effect of the last run is alive')
	dispose()
	inner.value = 2
	assert.equal(innerRuns, 1)
	assert.deepEqual(nested, ['root', 'root', 'root'])
})

test('context provided by the root stays visible inside a run', () => {
	const key = createContext<string>('effect context')
	const seen: string[] = []
	const source = signal(0)
	const dispose = createRoot((dispose) => {
		provide(key, 'root')
		effect(() => {
			void source.value
			seen.push(inject(key))
		})
		return dispose
	})
	source.value = 1
	assert.deepEqual(seen, ['root', 'root'])
	dispose()
})

test('a returned value that is not a function is ignored', () => {
	const source = signal(1)
	assert.doesNotThrow(() => {
		effect(() => source.value)
		source.value = 2
	})
})

test('a failing cleanup reaches the writer, the effect still runs and keeps tracking', () => {
	const source = signal(0)
	const failure = new Error('cleanup failed')
	const runs: number[] = []
	effect(() => {
		const value = source.value
		runs.push(value)
		if (value === 0)
			return () => {
				throw failure
			}
		return undefined
	})
	assert.throws(
		() => {
			source.value = 1
		},
		(error: unknown) => error === failure,
	)
	source.value = 2
	assert.deepEqual(runs, [0, 1, 2])
})

test('a failing run and its failing cleanup are both kept', () => {
	const source = signal(0)
	const cleanup = new Error('cleanup failed')
	const run = new Error('run failed')
	effect(() => {
		if (source.value === 1) throw run
		return () => {
			throw cleanup
		}
	})
	assert.throws(
		() => {
			source.value = 1
		},
		(error: unknown) => error instanceof AggregateError && error.errors[0] === cleanup && error.errors[1] === run,
	)
})

test('an effect whose first run fails releases what it registered', () => {
	const failure = new Error('setup failed')
	const log: string[] = []
	assert.throws(
		() =>
			effect(() => {
				onCleanup(() => log.push('released'))
				throw failure
			}),
		(error: unknown) => error === failure,
	)
	assert.deepEqual(log, ['released'])
})

test('an asynchronous cleanup returned by an effect is rejected when it runs', () => {
	const source = signal(0)
	effect((() => {
		void source.value
		return () => Promise.resolve()
	}) as () => void)
	assert.throws(() => {
		source.value = 1
	}, /cleanup callbacks must be synchronous/)
})

test('an effect that stops itself during its run releases its cleanups', () => {
	const log: string[] = []
	const source = signal(0)
	let stop = (): void => {}
	stop = effect(() => {
		if (source.value === 1) {
			stop()
			onCleanup(() => log.push('late'))
			return () => log.push('returned')
		}
		return () => log.push('first')
	})
	source.value = 1
	assert.deepEqual(log, ['first', 'late', 'returned'])
	source.value = 2
	assert.deepEqual(log, ['first', 'late', 'returned'])
})

test('an effect in a dry render never runs and never cleans up', () => {
	const log: string[] = []
	runDry(() => {
		const stop = effect(() => {
			log.push('run')
			return () => log.push('cleanup')
		})
		stop()
	})
	assert.deepEqual(log, [])
})

test('the internal binding effect keeps ignoring a returned function', () => {
	const source = signal(0)
	let called = 0
	const stop = bindingEffect(() => {
		void source.value
		return () => {
			called++
		}
	})
	source.value = 1
	stop()
	assert.equal(called, 0)
})

test('onCleanup without a root says what to use, and warns in development', async () => {
	const warnings = await withWarnings('development', () => {
		assert.throws(
			() => onCleanup(() => undefined),
			(error: unknown) => {
				assert.match(String(error), /requires an active component root/)
				assert.match(String(error), /before the first await/)
				assert.match(String(error), /return it from onMounted or from an effect/)
				return true
			},
		)
	})
	assert.equal(warnings.length, 1)
	assert.match(String(warnings[0]?.[0]), /^\[meeko\] onCleanup\(\) requires an active component root/)
	const production = await withWarnings('production', () => assert.throws(() => onCleanup(() => undefined), /active component root/))
	assert.deepEqual(production, [], 'production only throws')
	const unknown = await withWarnings(undefined, () => assert.throws(() => onCleanup(() => undefined), /active component root/))
	assert.deepEqual(unknown, [], 'without NODE_ENV nor a bundler, it is not development')
})

test('onCleanup after an await is not registered anywhere and warns in development', async () => {
	let rejection: unknown
	const log: string[] = []
	const warnings = await withWarnings('development', async () => {
		const dispose = createRoot((dispose) => {
			void (async () => {
				await Promise.resolve()
				onCleanup(() => log.push('late'))
			})().catch((error: unknown) => {
				rejection = error
			})
			return dispose
		})
		await new Promise<void>((done) => setImmediate(done))
		dispose()
	})
	assert.match(String(rejection), /After an await there is no active root/)
	assert.equal(warnings.length, 1)
	assert.deepEqual(log, [])
})

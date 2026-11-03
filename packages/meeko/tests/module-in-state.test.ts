import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { StateStore } from '../src/app/runtime/state.ts'
import { checkSource } from '../src/check.ts'
import { compile } from '../src/compiler.ts'

const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href)

interface RuntimeModule {
	renderWithState(props: Record<string, unknown>): { html: string; state: Record<string, unknown> }
}

/** Compiles components inside the repository; the runtime is imported by file URL, as one instance. */
async function load(components: Record<string, string>, entry: string): Promise<{ component: RuntimeModule; cleanup: () => Promise<void> }> {
	const parent = resolve('.meeko')
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(join(parent, 'module-state-test-'))
	for (const [name, source] of Object.entries(components)) {
		let code = compile(source, join(directory, `${name}.meeko`))
			.code.replace(`from "@meekojs/meeko/internal"`, `from ${runtime('src/internal.ts')}`)
			.replaceAll(`from "@meekojs/meeko"`, `from ${runtime('src/index.ts')}`)
		for (const other of Object.keys(components)) code = code.replace(`from "./${other}.meeko"`, `from "./${other}.ts"`)
		await writeFile(join(directory, `${name}.ts`), code)
	}
	const component = (await import(pathToFileURL(join(directory, `${entry}.ts`)).href)) as RuntimeModule
	return { component, cleanup: () => rm(directory, { recursive: true, force: true }) }
}

const card = `<script lang="ts">
const props = defineProps<{ title: string }>();
</script>
<template><h2>{props.title}</h2></template>`

const generic = `<script lang="ts" generic="T">
const props = defineProps<{ items: T[]; label?: (item: T) => string }>();
</script>
<template><ul><li each:of="props.items" each:as="item">{props.label ? props.label(item) : String(item)}</li></ul></template>`

const page = (script: string, template = '<p>x</p>'): string => `<script lang="ts">
import { computed, signal } from "@meekojs/meeko";
import { useState } from "@meekojs/meeko/framework";
import type { Component } from "@meekojs/meeko";
import * as Card from "./Card.meeko";
void computed;
void signal;
void useState;
void Card;
export type CardComponent = Component<{ title: string }>;
${script}
</script>
<template>${template}</template>`

async function withProject(run: (check: (script: string, template?: string) => Promise<{ code: string; message: string; offset: number; source: string }[]>) => Promise<void>): Promise<void> {
	const parent = resolve('.meeko')
	await mkdir(parent, { recursive: true })
	const root = await mkdtemp(join(parent, 'module-state-check-'))
	let count = 0
	try {
		await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}\n')
		await writeFile(
			join(root, 'tsconfig.json'),
			`${JSON.stringify({
				compilerOptions: {
					types: ['node'],
					paths: { '@meekojs/meeko/internal': ['../../src/internal.ts'], '@meekojs/meeko/framework': ['../../src/framework.ts'], '@meekojs/meeko': ['../../src/index.ts'] },
				},
			})}\n`,
		)
		await writeFile(join(root, 'Card.meeko'), card)
		await writeFile(join(root, 'Generic.meeko'), generic)
		await run(async (script, template) => {
			const source = page(script, template)
			const file = join(root, `Case${count++}.meeko`)
			await writeFile(file, source)
			return (await checkSource(source, file)).map((item) => ({ code: item.code, message: item.message, offset: item.location.offset, source }))
		})
	} finally {
		await rm(root, { recursive: true, force: true })
	}
}

test('meeko check marks a component module that a signal or useState starts with, where it is written', { timeout: 300_000 }, async () => {
	await withProject(async (check) => {
		const wrong: Array<[string, string]> = [
			['const field = signal(Card);', 'Card'],
			['const list = signal([Card]);', '[Card]'],
			['const options = signal([{ id: "a", component: Card, props: { title: "x" } }]);', '[{ id: "a", component: Card, props: { title: "x" } }]'],
			['const holder = signal({ deep: { list: [{ component: Card }] } });', '{ deep: { list: [{ component: Card }] } }'],
			['const typed = signal<{ component: typeof Card }[]>([{ component: Card }]);', '[{ component: Card }]'],
			['const wide = signal<CardComponent>(Card);', 'Card'],
			['const shared = useState("field", () => Card);', '() => Card'],
			['const shared = useState("list", () => [{ component: Card }]);', '() => [{ component: Card }]'],
			['const asserted = signal(Card) as unknown;', 'Card'],
		]
		for (const [script, value] of wrong) {
			const found = await check(script)
			assert.equal(found.length, 1, `${script}: ${JSON.stringify(found.map((item) => item.message))}`)
			const [item] = found
			assert.equal(item!.code, 'MEEK136', script)
			assert.match(item!.message, /^un módulo de componente no puede viajar con el estado: .*computed/, script)
			assert.equal(item!.offset, item!.source.indexOf(script) + script.lastIndexOf(value), script)
		}
	})
})

test('what never holds a module in the server render stays valid, with its types untouched', { timeout: 300_000 }, async () => {
	await withProject(async (check) => {
		const valid = [
			// The initial value decides, not the type: the browser fills these later.
			'const selected = signal<typeof Card | undefined>(undefined);\nfunction choose(): void { selected.value = Card; }\nvoid choose;',
			'const wide = signal<CardComponent | null>(null);',
			'const list = signal<{ component: typeof Card }[]>([]);',
			'const later = useState<typeof Card | undefined>("later", () => undefined);',
			// May be undefined in the server render, which fails nothing.
			'function maybe(): typeof Card | undefined { return undefined; }\nconst field = signal(maybe());',
			// A computed and a constant do not travel; a signal in a function neither.
			'const field = computed(() => Card);\nconst entries = { a: Card };\nconst pick = () => signal(Card);\nvoid entries;\nvoid pick;',
			// A signal of another module is not Meeko's.
			'const own = (value: unknown) => value;\nconst field = own(Card);',
			// Inference does not change behind the check: literals widen, contexts reach handlers.
			'const count = signal(0);\ncount.value = 1;\nconst on = signal(false);\non.value = true;\nconst word = signal("a");\nword.value = "b";\nconst kind = signal<"a" | "b">("a");\nkind.value = "b";\nconst none = signal(null as string | null);\nnone.value = "x";\nconst run = signal<{ cb: (value: number) => number }>({ cb: (value) => value + 1 });\nvoid run;\nconst list = signal<string[]>([]);\nlist.value = ["x"];\nconst shared = useState("n", () => 0);\nshared.value = 1;',
		]
		for (const script of valid) assert.deepEqual(await check(script), [], script)
		// A wrong use of those types is still an error: the wrapper does not turn them into any.
		const wide = await check('const count = signal(0);\ncount.value = "x";')
		assert.ok(
			wide.some((item) => item.code === 'TS2322'),
			JSON.stringify(wide),
		)
	})
})

test('a signal with a module fails the server render with what happened, and the rest of the state keeps its message', async () => {
	const { component, cleanup } = await load(
		{
			Card: card,
			Field: `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as Card from "./Card.meeko";
const options = signal([{ id: "a", component: Card }]);
</script>
<template><p>{options.value.length}</p></template>`,
		},
		'Field',
	)
	try {
		assert.throws(() => component.renderWithState({}), /MEEK136: la señal "options" guarda un módulo de componente en options\[0\]\.component.*computed/)
	} finally {
		await cleanup()
	}
	const dated = await load({ Dated: `<script lang="ts">\nimport { signal } from "@meekojs/meeko";\nconst when = signal(new Date(0));\n</script>\n<template><p>{when.value.getTime()}</p></template>` }, 'Dated')
	try {
		assert.throws(() => dated.component.renderWithState({}), /the signal "when" cannot be sent to the browser/)
	} finally {
		await dated.cleanup()
	}
	// Starting with undefined, the server render fails nothing: the state lists it as undefined.
	const empty = await load({ Card: card, Empty: `<script lang="ts">\nimport { signal } from "@meekojs/meeko";\nimport * as Card from "./Card.meeko";\nconst selected = signal<typeof Card | undefined>(undefined);\n</script>\n<template><component if:when="selected.value" is="selected.value!" title="x" /><p>vacío</p></template>` }, 'Empty')
	try {
		const { html, state } = empty.component.renderWithState({})
		assert.match(html, /<p>vacío<\/p>/)
		assert.deepEqual(state, { 'meeko:undefined': ['selected'] })
	} finally {
		await empty.cleanup()
	}
})

test('useState with a module fails the transfer with what happened', () => {
	const store = new StateStore()
	const module = { renderToString: () => '' }
	store.get('fields', () => [{ component: module }])
	assert.throws(() => store.snapshot(), /MEEK136: useState\("fields"\) guarda un módulo de componente en fields\[0\]\.component/)
	const other = new StateStore()
	other.get('when', () => new Date(0))
	assert.throws(() => other.snapshot(), /Non-plain object|Custom toJSON/)
})

test('a type that reads a declaration of the setup says why, instead of TS2304 and an any behind', { timeout: 300_000 }, async () => {
	await withProject(async (check) => {
		const usage = `<p each:of="names" each:as="name">{name.length}</p>`
		const cases: Array<[string, string]> = [
			['const entries = { a: 1, b: 2 };\ntype EntryName = keyof typeof entries;\nconst names: EntryName[] = ["a"];', 'entries;'],
			['function helper(): number { return 1; }\ntype Result = ReturnType<typeof helper>;\nconst names: Result[] = [];', 'helper>'],
			['const value = { a: { b: 1 } };\ninterface Holder { field: typeof value.a }\nconst names: Holder[] = [];', 'value.a'],
		]
		for (const [script, at] of cases) {
			const found = await check(script, usage)
			assert.equal(found.length, 1, `${script}: ${JSON.stringify(found.map((item) => item.message))}`)
			assert.equal(found[0]!.code, 'MEEK137', script)
			assert.match(found[0]!.message, /los tipos del script se declaran a nivel de módulo.*mueve/, script)
			assert.equal(found[0]!.offset, found[0]!.source.indexOf(at, found[0]!.source.indexOf(script)), script)
		}
		// An import is at module level, and a parameter with that name is its own.
		assert.deepEqual(await check('type Module = typeof Card;\nconst names: Module[] = [];\nvoid names;'), [])
		assert.deepEqual(await check('const entries = 1;\ntype Pick2 = (entries: string) => typeof entries;\nvoid entries;\nconst names: Pick2[] = [];\nvoid names;'), [])
		// In the build it stays valid: types are erased, and only TypeScript fails on it.
		assert.doesNotThrow(() => compile(page('const entries = { a: 1 };\ntype EntryName = keyof typeof entries;\nconst name: EntryName = "a";\nvoid name;'), 'Built.meeko'))
	})
})

test('the code that runs has no state check', () => {
	const { code } = compile(page('const count = signal(0);\nconst shared = useState("n", () => 0);\nvoid count;\nvoid shared;'), 'Runs.meeko')
	assert.doesNotMatch(code, /checkSignalState|checkStateFactory/)
	const { code: checked } = compile(page('const count = signal(0);\nconst shared = useState("n", () => 0);\nvoid count;\nvoid shared;'), 'Runs.meeko', { typeCheck: true })
	assert.match(checked, /signal\(__meeko\.checkSignalState\(0, true\)\)/)
	assert.match(checked, /useState\("n", __meeko\.checkStateFactory\(\(\) => 0, true\)\)/)
})

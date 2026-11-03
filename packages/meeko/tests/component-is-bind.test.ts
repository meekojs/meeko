import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { TextDocument } from 'vscode-languageserver-textdocument'

import { checkSource } from '../src/check.ts'
import { checkApp } from '../src/framework/check-app.ts'
import { prepareFrameworkTypeDeclarations } from '../src/framework/type-declarations.ts'
import { componentDiagnostics } from '../src/language-server/diagnostics.ts'
import { componentIsListFiles } from './helpers/component-is-list.ts'
import { createTempProject } from './helpers/temp-project.ts'
import { languageProject } from './language-server-workspace.ts'

async function typeProject(files: Record<string, string>): Promise<{ root: string; cleanup: () => Promise<void> }> {
	const parentDirectory = resolve('.meeko')
	await mkdir(parentDirectory, { recursive: true })
	const root = await mkdtemp(join(parentDirectory, 'is-bind-check-'))
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
	for (const [name, source] of Object.entries(files)) await writeFile(join(root, name), source)
	return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}

const appSelect = `<script lang="ts">
const props = defineProps<{ label: string; options: string[] }>();
const emit = defineEmits<{ change: [value: string] }>();
void emit;
</script>
<template><label>{props.label}<select><option each:of="props.options" each:as="o" each:key="o">{o}</option></select></label></template>`

const appInput = `<script lang="ts">
const props = defineProps<{ placeholder: string; size?: number }>();
const snippets = defineSnippets<{ default?: [] }>();
</script>
<template><input bind:placeholder="props.placeholder" /><render snippet="snippets.default" /></template>`

/** A child that passes a list entry to the snippet of its parent. */
const rows = (entry: string): string => `<script lang="ts">
import * as AppInput from "./AppInput.meeko";
import * as AppSelect from "./AppSelect.meeko";
export type Entry = ${entry};
const snippets = defineSnippets<{ row: [entry: Entry] }>();
const entry: Entry = { component: AppInput, props: { placeholder: "x" } };
void AppSelect;
</script>
<template><render snippet="snippets.row" args="entry" /></template>`

const page = (script: string, template: string): string => `<script lang="ts">
import { computed, signal } from "@meekojs/meeko";
import * as AppInput from "./AppInput.meeko";
import * as AppSelect from "./AppSelect.meeko";
import * as MixedRows from "./MixedRows.meeko";
import * as Rows from "./Rows.meeko";
void computed;
void signal;
void AppInput;
void AppSelect;
void MixedRows;
void Rows;
${script}
</script>
<template>${template}</template>`

const row = '<component each:of="options" each:as="option" each:key="option.id" is="option.component" bind="option.props" />'
const select = `{ id: "role", component: AppSelect, props: { label: "Rol", options: ["admin", "user"] } }`
const input = `{ id: "name", component: AppInput, props: { placeholder: "Nombre" } }`

/** Literal names in `is`, narrowed by the condition of each branch. */
const literalOption = `type Option = { id: string; component: "AppSelect"; props: { label: string; options: string[] } } | { id: string; component: "AppInput"; props: { placeholder: string } };
const options: Option[] = [{ id: "role", component: "AppSelect", props: { label: "Rol", options: ["admin"] } }, { id: "name", component: "AppInput", props: { placeholder: "Nombre" } }];`

async function withProject(run: (check: (script: string, template: string) => Promise<string[]>) => Promise<void>): Promise<void> {
	const { root, cleanup } = await typeProject({
		'AppInput.meeko': appInput,
		'AppSelect.meeko': appSelect,
		'Rows.meeko': rows('{ component: typeof AppInput; props: { placeholder: string } }'),
		'MixedRows.meeko': rows('{ component: typeof AppSelect; props: { label: string; options: string[] } } | { component: typeof AppInput; props: { placeholder: string } }'),
	})
	let count = 0
	try {
		await run(async (script, template) => {
			const source = page(script, template)
			const file = join(root, `Case${count++}.meeko`)
			await writeFile(file, source)
			return (await checkSource(source, file)).map((item) => `${item.code}: ${item.message}`)
		})
	} finally {
		await cleanup()
	}
}

const expectOne = (diagnostics: readonly string[], pattern: RegExp): void => {
	assert.ok(
		diagnostics.some((item) => pattern.test(item)),
		`${pattern}: ${JSON.stringify(diagnostics)}`,
	)
}

test('bind on a module read from data is checked against its props, not as attributes of a tag', { timeout: 300_000 }, async () => {
	await withProject(async (check) => {
		const same = `const options = [{ id: "a", component: AppInput, props: { placeholder: "Uno" } }, { id: "b", component: AppInput, props: { placeholder: "Dos", size: 2 } }];`
		assert.deepEqual(await check(same, row), [])
		// The same expression out of each:: a prop, a signal, a table of views and a snippet parameter.
		const direct = `const props = defineProps<{ field: typeof AppInput; attrs: { placeholder: string } }>();`
		assert.deepEqual(await check(direct, '<component is="props.field" bind="props.attrs" />'), [])
		const held = `const field = computed(() => AppInput);\nconst attrs = signal({ placeholder: "x" });`
		assert.deepEqual(await check(held, '<component is="field.value" bind="attrs.value" />'), [])
		const table = `const views = { a: AppInput, b: AppInput };\nconst mode = signal<"a" | "b">("a");\nconst attrs = { placeholder: "x" };`
		assert.deepEqual(await check(table, '<component is="views[mode.value]" bind="attrs" />'), [])
		assert.deepEqual(await check('', '<Rows><snippet name="row" params="entry"><component is="entry.component" bind="entry.props" /></snippet></Rows>'), [])
		// A key that is no prop, a missing prop and a wrong value are still errors.
		expectOne(await check(`const options = [{ id: "a", component: AppInput, props: { placeholder: "Uno", nope: 1 } }];`, row), /^MEEK113: nope no es una prop del componente/)
		expectOne(await check(`const options = [{ id: "a", component: AppInput, props: { size: 1 } }];`, row), /^TS2345:.*placeholder/s)
		expectOne(await check(`const options = [{ id: "a", component: AppInput, props: { placeholder: 1 } }];`, row), /^TS2345:/)
	})
})

test('a list of different modules checks the props of each entry against its own component', { timeout: 300_000 }, async () => {
	await withProject(async (check) => {
		assert.deepEqual(await check(`const options = [${select}, ${input}];`, row), [])
		// The wrong props in the list: a key of the other component, one left out and a wrong value.
		const wrong = await check(`const options = [${select}, { id: "name", component: AppInput, props: { label: "Nombre" } }];`, row)
		expectOne(wrong, /^MEEK113: (?:label no es una prop del componente de esa entrada|falta la prop obligatoria placeholder del componente de esa entrada)/)
		expectOne(await check(`const options = [{ id: "role", component: AppSelect, props: { label: "Rol" } }, ${input}];`, row), /^MEEK113: falta la prop obligatoria options/)
		expectOne(await check(`const options = [${select}, { id: "name", component: AppInput, props: { placeholder: 1 } }];`, row), /^MEEK113: placeholder no tiene el tipo/)
		// A prop written next to bind gives what the object leaves out.
		assert.deepEqual(await check(`const options = [{ id: "role", component: AppSelect, props: { label: "Rol" } }, { id: "name", component: AppInput, props: { size: 1 } }];`, row.replace(' />', ` bind:placeholder="'x'" bind:options="['a']" bind:label="'y'" />`)), [])
		// With on: and snippets.
		assert.deepEqual(await check(`const options = [${select}, ${input}];`, row.replace(' />', ` on:change="(value: string) => { void value; }" />`)), [])
		expectOne(await check(`const options = [${select}, ${input}];`, row.replace(' />', ` on:nope="() => {}" />`)), /onNope/)
		assert.deepEqual(await check(`const options = [${select}, ${input}];`, row.replace(' />', `><b>x</b></component>`)), [])
		// A snippet parameter keeps the relation too.
		assert.deepEqual(await check('', '<MixedRows><snippet name="row" params="entry"><component is="entry.component" bind="entry.props" /></snippet></MixedRows>'), [])
		// So does a row behind if:when, narrowed to one of its members.
		assert.deepEqual(await check(`const options = [${select}, ${input}];`, `<template each:of="options" each:as="option" each:key="option.id"><component if:when="option.id !== ''" is="option.component" bind="option.props" /></template>`), [])
		// The value of a computed, a prop and a written union keep the relation.
		const entries = `type Entry = { component: typeof AppSelect; props: { label: string; options: string[] } } | { component: typeof AppInput; props: { placeholder: string } };`
		assert.deepEqual(await check(`${entries}\nconst current = computed((): Entry => ({ component: AppInput, props: { placeholder: "x" } }));`, '<component is="current.value.component" bind="current.value.props" />'), [])
		assert.deepEqual(await check(`${entries}\nconst props = defineProps<{ entry: Entry }>();`, '<component is="props.entry.component" bind="props.entry.props" />'), [])
		// With a tag: each entry takes the attributes of its own.
		const tags = `const options = [{ id: "a", component: "a" as const, props: { href: "/x" } }, ${input}];`
		assert.deepEqual(await check(tags, row), [])
		expectOne(await check(`const options = [{ id: "a", component: "button" as const, props: { href: "/x" } }, ${input}];`, row), /^MEEK113: href no es/)
		// Two values read from different objects cannot relate: the props of every possible component.
		const apart = `const views = { a: AppInput, b: AppSelect };\nconst mode = signal<"a" | "b">("a");\nconst attrs = { placeholder: "x" };`
		expectOne(await check(apart, '<component is="views[mode.value]" bind="attrs" />'), /^TS2345:/)
	})
})

test('a union of a module and tags takes the keys that any of them accepts', { timeout: 300_000 }, async () => {
	await withProject(async (check) => {
		const both = `const props = defineProps<{ as: typeof AppInput | "a" | "button"; attrs: { placeholder: string; href: string } }>();`
		assert.deepEqual(await check(both, '<component is="props.as" bind="props.attrs" />'), [])
		const nope = `const props = defineProps<{ as: typeof AppInput | "a"; attrs: { placeholder: string; nope: string } }>();`
		expectOne(await check(nope, '<component is="props.as" bind="props.attrs" />'), /^MEEK113: nope no es una prop del componente ni un atributo de la etiqueta/)
		const tag = `const props = defineProps<{ as: "a" | "button"; attrs: { nope: string } }>();`
		expectOne(await check(tag, '<component is="props.as" bind="props.attrs" />'), /^MEEK113: nope no es un atributo de la etiqueta/)
	})
})

test('literal names in is narrow each branch and do not compare the condition with itself', { timeout: 300_000 }, async () => {
	await withProject(async (check) => {
		const branches = `<component each:of="options" each:as="option" each:key="option.id" is="option.component === 'AppSelect' ? 'AppSelect' : 'AppInput'" bind="option.props" />`
		assert.deepEqual(await check(literalOption, branches), [])
		// They still narrow: the branches swapped give each component the props of the other.
		const swapped = await check(literalOption, branches.replace(`'AppSelect' : 'AppInput'`, `'AppInput' : 'AppSelect'`))
		expectOne(swapped, /^MEEK113: (?:label|placeholder) no es una prop del componente/)
		// Three branches, and a name after a tag.
		const three = `const props = defineProps<{ kind: "a" | "b" | "c" }>();`
		assert.deepEqual(await check(three, `<component is="props.kind === 'a' ? 'AppInput' : props.kind === 'b' ? 'AppInput' : 'AppInput'" placeholder="x" />`), [])
		assert.deepEqual(await check(three, `<component is="props.kind === 'a' ? 'section' : 'AppInput'" placeholder="x" />`), [])
		assert.deepEqual(await check(three, `<component is="props.kind === 'a' ? 'AppInput' : 'AppSelect'" placeholder="x" label="y" bind:options="['z']" />`), [])
	})
})

test('a component name that only exists at run time says what to do, and keeps the check', { timeout: 300_000 }, async () => {
	await withProject(async (check) => {
		const literal = await check(`const options = [{ id: "role", component: "AppSelect", props: { label: "Rol", options: ["admin"] } }] as const;`, row)
		assert.equal(literal.length, 1, JSON.stringify(literal))
		assert.match(literal[0]!, /^MEEK112: <AppSelect> no es una etiqueta que <component is> pueda renderizar: is nunca convierte un texto en un componente/)
		assert.match(literal[0]!, /is="cond \? 'AppSelect' : 'section'"/)
		assert.match(literal[0]!, /import \* as AppSelect from/)
		assert.match(literal[0]!, /await resolveComponent\('AppSelect'\)/)
		// Without `as const`, the same list gives a `string`.
		const text = await check(`const options = [{ id: "role", component: "AppSelect", props: { label: "Rol", options: ["admin"] } }];`, row)
		assert.equal(text.length, 1, JSON.stringify(text))
		assert.match(text[0]!, /^MEEK112: is es un string cualquiera; usa una unión de etiquetas/)
		assert.match(text[0]!, /resolveComponent/)
		// A tag that cannot render keeps its message.
		const frame = await check(`const options = [{ id: "x", component: "iframe", props: {} }] as const;`, row)
		assert.ok(
			frame.some((item) => item === 'MEEK112: <iframe> no es una etiqueta que <component is> pueda renderizar'),
			JSON.stringify(frame),
		)
		// A key of a handler, without ComponentProps around: the message of always.
		const typed = await check(`const options: { id: string; component: typeof AppSelect; props: { label: string; options: string[]; onChange?: (value: string) => void } }[] = [];`, row)
		assert.ok(typed.includes('MEEK113: bind no admite claves on*; usa on:evento'), JSON.stringify(typed))
	})
})

/** The application of the e2e in a temporary project, with the page replaced by `script` and `template` when given. */
async function withApp(run: (root: string, check: (page?: string) => Promise<string[]>) => Promise<void>): Promise<void> {
	const project = await createTempProject('is-bind-app')
	const root = project.root
	try {
		for (const [file, contents] of Object.entries(componentIsListFiles)) {
			await mkdir(dirname(join(root, file)), { recursive: true })
			await writeFile(join(root, file), contents)
		}
		await mkdir(join(root, 'node_modules', '@meekojs'), { recursive: true })
		await symlink(resolve('.'), join(root, 'node_modules', '@meekojs', 'meeko'), 'junction')
		await prepareFrameworkTypeDeclarations(root)
		await run(root, async (page) => {
			if (page !== undefined) await writeFile(join(root, 'app', 'pages', 'index.meeko'), page)
			return (await checkApp(root)).map((item) => `${item.code}: ${item.message}`)
		})
	} finally {
		await project.remove()
	}
}

test('in a project: the list of the e2e checks, and the aliases and names of the project behave', { timeout: 300_000 }, async () => {
	await withApp(async (_root, check) => {
		assert.deepEqual(await check(), [])
		const list = (type: string, entries = '{ id: "a", component: AppSelect, props: { label: "Rol", options: ["x"] } }, { id: "b", component: AppInput, props: { placeholder: "y" } }'): string => `<script lang="ts">
import * as AppInput from "../components/AppInput.meeko";
import * as AppSelect from "../components/AppSelect.meeko";
const options: ({ id: string; component: typeof AppSelect; props: ${type.replaceAll('X', 'AppSelect')} } | { id: string; component: typeof AppInput; props: ${type.replaceAll('X', 'AppInput')} })[] = [${entries}];
</script>
<template><component each:of="options" each:as="option" each:key="option.id" is="option.component" bind="option.props" /></template>
`
		// `AppInputProps` has only the props: the list of the documentation.
		assert.deepEqual(await check(list('XProps')), [])
		// `ComponentProps` also has the callbacks of defineEmits, and the message says what to write.
		const typed = await check(list("ComponentProps<'X'>"))
		assert.ok(
			typed.some((item) => /^MEEK113: bind no admite claves on\*; usa on:evento\. ComponentProps<'AppSelect'> incluye los eventos de defineEmits: tipa el objeto con el alias AppSelectProps/.test(item)),
			JSON.stringify(typed),
		)
		// A name of the project that arrives as text: the same MEEK112, with the way out.
		const named = await check(`<script lang="ts">
const options = [{ id: "a", component: "AppSelect" as const, props: { label: "Rol", options: ["x"] } }];
</script>
<template><component each:of="options" each:as="option" each:key="option.id" is="option.component" bind="option.props" /></template>
`)
		assert.equal(named.length, 1, JSON.stringify(named))
		assert.match(named[0]!, /^MEEK112: <AppSelect> no es una etiqueta.*resolveComponent\('AppSelect'\)/)
		// One branch per component still passes, and the names of the project narrow with `ComponentProps` too.
		assert.deepEqual(
			await check(`<script lang="ts">
type Option = { id: string; component: "AppSelect"; props: AppSelectProps } | { id: string; component: "AppInput"; props: AppInputProps };
const options: Option[] = [{ id: "a", component: "AppSelect", props: { label: "Rol", options: ["x"] } }, { id: "b", component: "AppInput", props: { placeholder: "y" } }];
</script>
<template><template each:of="options" each:as="option" each:key="option.id"><AppSelect if:when="option.component === 'AppSelect'" bind="option.props" /><AppInput if:when="option.component === 'AppInput'" bind="option.props" /><component is="option.component === 'AppSelect' ? 'AppSelect' : 'AppInput'" bind="option.props" /></template></template>
`),
			[],
		)
	})
})

test('the language server reports the same as meeko check', { timeout: 300_000 }, async () => {
	const good = page(`const options = [${select}, ${input}];`, row)
	const wrong = page(`const options = [${select}, { id: "name", component: AppInput, props: { label: "Nombre" } }];`, row)
	const named = page(`const options = [{ id: "role", component: "AppSelect", props: { label: "Rol", options: ["admin"] } }] as const;`, row)
	const branches = page(literalOption, `<component each:of="options" each:as="option" each:key="option.id" is="option.component === 'AppSelect' ? 'AppSelect' : 'AppInput'" bind="option.props" />`)
	const workspace = await languageProject('lsp-is-bind-', { 'AppInput.meeko': appInput, 'AppSelect.meeko': appSelect, 'Rows.meeko': rows('{ component: typeof AppInput; props: { placeholder: string } }'), 'MixedRows.meeko': rows('{ component: typeof AppSelect; props: { label: string; options: string[] } } | { component: typeof AppInput; props: { placeholder: string } }'), 'Good.meeko': good, 'Wrong.meeko': wrong, 'Named.meeko': named, 'Branches.meeko': branches })
	try {
		const report = async (name: string, source: string): Promise<{ code: unknown; message: string; start: number; end: number }[]> => {
			const opened = await workspace.open(name)
			const document = TextDocument.create(opened.document.uri, 'meeko', 2, source)
			const found = await componentDiagnostics(workspace.project, document, opened.component.filename, () => undefined)
			const template = source.indexOf('<template>')
			return found.map((item) => ({ code: item.code, message: String(item.message), start: document.offsetAt(item.range.start), end: document.offsetAt(item.range.end) })).filter((item) => item.start >= template)
		}
		assert.deepEqual(await report('Good.meeko', good), [])
		assert.deepEqual(await report('Branches.meeko', branches), [])
		const value = 'option.props'
		const invalid = await report('Wrong.meeko', wrong)
		assert.equal(invalid.length, 1, JSON.stringify(invalid))
		assert.equal(invalid[0]!.code, 'MEEK113')
		assert.match(invalid[0]!.message, /de esa entrada$/)
		// The whole value of bind is marked.
		assert.equal(wrong.slice(invalid[0]!.start, invalid[0]!.end), value)
		const text = await report('Named.meeko', named)
		assert.equal(text.length, 1, JSON.stringify(text))
		assert.equal(text[0]!.code, 'MEEK112')
		assert.match(text[0]!.message, /is nunca convierte un texto en un componente.*resolveComponent\('AppSelect'\)/)
		assert.equal(named.slice(text[0]!.start, text[0]!.end), 'option.component')
	} finally {
		await workspace.dispose()
	}
})

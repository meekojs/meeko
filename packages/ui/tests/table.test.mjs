import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { checkSource } from '../../meeko/dist/check.js'

test('table public types correlate row keys, column keys and formatter values', () => {
	const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
	execFileSync(process.execPath, [tsc, '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--module', 'nodenext', '--target', 'es2022', fileURLToPath(new URL('./types/table.ts', import.meta.url))], { stdio: 'pipe' })
})

test('table infers rows in templates and checks props and snippet parameters', async (context) => {
	const parent = fileURLToPath(new URL('../.meeko/', import.meta.url))
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(parent + 'table-types-')
	context.after(() => rm(directory, { recursive: true, force: true }))
	const filename = directory + '/Consumer.meeko'
	const table = relative(dirname(filename), fileURLToPath(new URL('../dist/app/components/Table.meeko', import.meta.url))).replaceAll('\\', '/')
	const source = `<script lang="ts">
import * as UITable from '${table}';
const rows = [{ id: 1, name: 'Ana', age: 20 }];
const columns = [{ key: 'name' as const, label: 'Name' }];
</script>
<template><UITable bind:rows="rows" bind:columns="columns" rowKey="id"><snippet name="cell" params="row, column, value, index"><span>{row.name.toUpperCase()} {column.label} {String(value)} {index.toFixed(0)}</span></snippet></UITable></template>`
	const errors = (diagnostics) => diagnostics.filter((item) => item.severity !== 'warning')
	assert.deepEqual(errors(await checkSource(source, filename)), [])
	for (const broken of [source.replace('rowKey="id"', 'rowKey="missing"'), source.replace("key: 'name'", "key: 'missing'"), source.replace('row.name.toUpperCase()', 'row.age.toUpperCase()')]) {
		const diagnostics = errors(await checkSource(broken, filename))
		assert.ok(diagnostics.length > 0, 'invalid template must produce a type error')
		assert.ok(
			diagnostics.some((item) => /missing|toUpperCase/.test(item.message)),
			JSON.stringify(diagnostics),
		)
	}
	// `cell-<clave>` y `header-<clave>`: el valor tiene el tipo de su columna y la clave debe existir.
	const columnSnippets = source.replace(/<snippet name="cell".*<\/snippet>/, '<snippet name="cell-name" params="row, value"><b>{value.toUpperCase()} {row.age.toFixed(0)}</b></snippet><snippet name="cell-age" params="row, value"><i>{value.toFixed(1)}</i></snippet><snippet name="header-name" params="column"><em>{column.label}</em></snippet>')
	assert.deepEqual(errors(await checkSource(columnSnippets, filename)), [])
	for (const [broken, pattern] of [
		[columnSnippets.replace('name="cell-age"', 'name="cell-email"'), /cell-email/],
		[columnSnippets.replace('{value.toFixed(1)}', '{value.toUpperCase()}'), /toUpperCase/],
		[columnSnippets.replace('params="row, value"><b>', 'params="row, value, extra"><b>'), /argument|Expected|arguments/i],
	]) {
		const diagnostics = errors(await checkSource(broken, filename))
		assert.ok(
			diagnostics.some((item) => pattern.test(item.message)),
			JSON.stringify(diagnostics),
		)
	}
})

/** Compiles Table.meeko and a page that uses it, and renders the page in SSR. */
async function renderTablePage(context, pageSource) {
	const { compile } = await import('../../meeko/dist/compiler.js')
	const parent = fileURLToPath(new URL('../.meeko/', import.meta.url))
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(parent + 'table-render-')
	context.after(() => rm(directory, { recursive: true, force: true }))
	const runtime = (path) => JSON.stringify(pathToFileURL(fileURLToPath(new URL(`../../meeko/dist/${path}`, import.meta.url))).href)
	const write = async (name, source) => {
		const code = compile(source, `${directory}/${name}.meeko`)
			.code.replace(`from "@meekojs/meeko/internal"`, `from ${runtime('internal.js')}`)
			.replaceAll(`from "@meekojs/meeko"`, `from ${runtime('index.js')}`)
			.replace(`from "./Table.meeko"`, `from "./Table.ts"`)
			.replace(/from ["']\.\.\/(utils|variants)\/([\w-]+)["']/g, (_, folder, file) => `from ${JSON.stringify(new URL(`../dist/app/${folder}/${file}.js`, import.meta.url).href)}`)
		await writeFile(`${directory}/${name}.ts`, code)
	}
	const table = await readFile(new URL('../src/app/components/Table.meeko', import.meta.url), 'utf8')
	// useId is an auto-import of the app; this compilation has no app, so it imports it.
	await write('Table', table.replace("import type { Snippet } from '@meekojs/meeko'", "import type { Snippet } from '@meekojs/meeko'\n\timport { useId } from '@meekojs/meeko'"))
	await write('Page', pageSource)
	const page = await import(pathToFileURL(`${directory}/Page.ts`).href)
	return page.renderToString({}).replace(/<!--.*?-->/g, '')
}

test('table renders cell-<key> before cell, header-<key> before header, then the default text', async (context) => {
	const html = await renderTablePage(
		context,
		`<script lang="ts">
import * as UITable from "./Table.meeko";
const rows = [{ id: 1, name: "Ana", age: 20 }];
const columns = [{ key: "name" as const, label: "Name" }, { key: "age" as const, label: "Age" }, { key: "id" as const, label: "Id" }];
</script>
<template><UITable bind:rows="rows" bind:columns="columns" rowKey="id"><snippet name="cell-name" params="row, value"><b>{value}/{row.age}</b></snippet><snippet name="cell" params="row, column, value"><i>{column.key}:{String(value)}</i></snippet><snippet name="header-age" params="column"><u>{column.label}!</u></snippet></UITable></template>`,
	)
	const text = (pattern) => [...html.matchAll(pattern)].map((match) => match[1])
	assert.deepEqual(text(/<b>(.*?)<\/b>/g), ['Ana/20'])
	assert.deepEqual(text(/<i>(.*?)<\/i>/g), ['age:20', 'id:1'])
	assert.deepEqual(text(/<u>(.*?)<\/u>/g), ['Age!'])
	assert.match(html, /<span>Name<\/span>/)
	assert.match(html, /<span>Id<\/span>/)
})

test('a numeric column never breaks, nowrap keeps a code whole and minWidth sizes a column', async (context) => {
	const page = (layout) => `<script lang="ts">
import * as UITable from "./Table.meeko";
const rows = [{ id: 1, code: "P-1048", total: "Bs 18.500", notes: "Entrega en la puerta trasera" }];
const columns = [
	{ key: "code" as const, label: "Code", rowHeader: true, nowrap: true },
	{ key: "total" as const, label: "Total", numeric: true },
	{ key: "id" as const, label: "Id", numeric: true, nowrap: false },
	{ key: "notes" as const, label: "Notes", minWidth: "20rem" },
];
</script>
<template><UITable bind:rows="rows" bind:columns="columns" rowKey="id" layout="${layout}" /></template>`
	const html = await renderTablePage(context, page('native'))
	const cell = (text) => html.match(new RegExp(`<t[dh][^>]*class="([^"]*)"[^>]*>\\s*<span>${text}</span>`))?.[1] ?? ''
	assert.match(cell('P-1048'), /(?:^| )ui:whitespace-nowrap(?: |$)/, 'nowrap keeps a code whole')
	assert.match(cell('Bs 18.500'), /(?:^| )ui:whitespace-nowrap(?: |$)/, 'a numeric column is nowrap by default')
	assert.doesNotMatch(cell('1'), /ui:whitespace-nowrap/, 'nowrap: false wins over numeric')
	assert.doesNotMatch(cell('Entrega en la puerta trasera'), /ui:whitespace-nowrap/)
	assert.match(html, /<th[^>]*style="min-inline-size: 20rem"[^>]*>(?:(?!<\/th>)[\s\S])*Notes/, 'minWidth sizes the header of its column')
	const grid = await renderTablePage(context, page('grid'))
	assert.match(grid, /--table-columns: minmax\(var\(--ui-table-column-min\), 1fr\) minmax\(var\(--ui-table-column-min\), 1fr\) minmax\(var\(--ui-table-column-min\), 1fr\) minmax\(20rem, 1fr\)/)
})

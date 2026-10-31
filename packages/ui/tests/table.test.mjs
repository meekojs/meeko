import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

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
})

import ts from '@typescript/typescript6'
import assert from 'node:assert/strict'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { generateComponentRegistry } from '../src/autoimports/components'
import { generateAppTypes } from '../src/framework/check-app.ts'
import { prepareFrameworkTypes } from '../src/framework/check-project'
import { generateComponentRegistryTypes } from '../src/framework/type-declarations.ts'
import { MeekoProject } from '../src/language-server/project.ts'
import { linkRepositoryPackages, tempProject } from './helpers/temp-project.ts'

test('editor program completes registry names and refreshes diagnostics after a rename', { timeout: 120_000 }, async (context) => {
	const root = await tempProject(context, 'lsp-component-registry')
	await linkRepositoryPackages(root)
	await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}\n')
	await mkdir(join(root, 'app', 'components'), { recursive: true })
	await mkdir(join(root, 'app', 'pages'), { recursive: true })
	const oldFile = join(root, 'app', 'components', 'Button.meeko')
	const nextFile = join(root, 'app', 'components', 'Card.meeko')
	const page = join(root, 'app', 'pages', 'index.meeko')
	const component = '<template><button>Go</button></template>\n'
	const source = `<script lang="ts">
import type { ComponentName } from "@meekojs/meeko";
const selected: ComponentName = "";
</script>
<template><p>Ready</p></template>
`
	await writeFile(oldFile, component)
	await writeFile(page, source)
	await generateAppTypes(root)
	const declaration = await generateComponentRegistryTypes(root)
	const project = new MeekoProject(root, { trusted: true })
	context.after(() => project.dispose())
	await project.ready()

	const completions = (): string[] => {
		const virtual = project.setDocument(page, source)
		assert.ok(virtual)
		const at = virtual.code.indexOf('selected: ComponentName = ""')
		assert.ok(at >= 0)
		const cursor = at + 'selected: ComponentName = "'.length
		return project.service.getCompletionsAtPosition(virtual.virtualFilename, cursor, {})?.entries.map((entry) => entry.name) ?? []
	}
	assert.ok(completions().includes('Button'))
	await rename(oldFile, nextFile)
	await generateAppTypes(root)
	await generateComponentRegistryTypes(root)
	project.filesChanged([oldFile, nextFile, declaration])
	await project.ready()
	const names = completions()
	assert.ok(names.includes('Card'))
	assert.ok(!names.includes('Button'))
	const invalid = source.replace('ComponentName = ""', 'ComponentName = "Button"')
	const virtual = project.setDocument(page, invalid)
	assert.ok(virtual)
	assert.ok(project.service.getSemanticDiagnostics(virtual.virtualFilename).some((diagnostic) => diagnostic.code === 2322))
})

test('editor checks bound resolver props and preserves component event payloads', async (context) => {
	const root = await tempProject(context, 'lsp-bound-component-registry')
	await linkRepositoryPackages(root)
	await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}')
	await mkdir(join(root, 'app', 'components'), { recursive: true })
	await mkdir(join(root, 'app', 'pages'), { recursive: true })
	await writeFile(
		join(root, 'app', 'components', 'Button.meeko'),
		`<script lang="ts">
const props = defineProps<{ label: string; tone?: "primary" | "quiet" }>();
const emit = defineEmits<{ save: [value: number] }>();
</script><template><button type="button" on:click="() => emit('save', 1)">{props.label}</button></template>`,
	)
	const page = join(root, 'app', 'pages', 'index.meeko')
	const source = `<script lang="ts">
const form = signal<ResolvedComponent<"Button"> | undefined>(undefined);
async function open() { form.value = await resolveComponent("Button", { label: "Go", tone: "primary" }); }
</script><template><button type="button" on:click="open">Open</button><component if:when="form.value" is="form.value!" on:save="(payload) => payload.toFixed()" /></template>`
	await writeFile(page, source)
	await generateAppTypes(root)
	await generateComponentRegistryTypes(root)
	await generateComponentRegistry(root)
	await prepareFrameworkTypes(root)
	const project = new MeekoProject(root, { trusted: true })
	context.after(() => project.dispose())
	await project.ready()
	const virtual = project.setDocument(page, source)
	assert.ok(virtual)
	const diagnostics = project.service.getSemanticDiagnostics(virtual.virtualFilename)
	assert.deepEqual(
		diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, ' ')),
		[],
	)
	const invalid = project.setDocument(page, source.replace('label: "Go"', 'label: 123'))
	assert.ok(invalid)
	const invalidDiagnostics = project.service.getSemanticDiagnostics(invalid.virtualFilename)
	assert.ok(
		invalidDiagnostics.some((item) => [2322, 2345, 2769].includes(item.code)),
		invalidDiagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, ' ')).join('\n'),
	)
	const completionSource = source.replace('tone: "primary"', 'tone: ""')
	const completion = project.setDocument(page, completionSource)
	assert.ok(completion)
	const offset = completion.code.indexOf('tone: ""') + 'tone: "'.length
	const names = project.service.getCompletionsAtPosition(completion.virtualFilename, offset, {})?.entries.map((item) => item.name) ?? []
	assert.ok(names.includes('primary') && names.includes('quiet'), names.join(', '))
})

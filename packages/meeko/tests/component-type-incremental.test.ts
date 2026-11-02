import assert from 'node:assert/strict'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { generateAppTypeForFile, generateAppTypes } from '../src/framework/check-app.ts'
import { linkRepositoryPackages, tempProject } from './helpers/temp-project.ts'

test('a component edit generates only its declaration and records newly imported components', async (context) => {
	const root = await tempProject(context, 'incremental-component-types')
	await linkRepositoryPackages(root)
	await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}\n')
	await writeFile(join(root, 'meeko.config.ts'), 'export default {};\n')
	await mkdir(join(root, 'app', 'components'), { recursive: true })
	await mkdir(join(root, 'app', 'fragments'), { recursive: true })
	const edited = join(root, 'app', 'components', 'Edited.meeko')
	const other = join(root, 'app', 'components', 'Other.meeko')
	const fragment = join(root, 'app', 'fragments', 'Fragment.meeko')
	const otherType = join(root, '.meeko', 'types', 'app', 'components', 'Other.d.meeko.ts')
	const fragmentType = join(root, '.meeko', 'types', 'app', 'fragments', 'Fragment.d.meeko.ts')
	const manifest = join(root, '.meeko', 'manifests', 'component-types.json')
	await writeFile(edited, '<template><p>initial</p></template>\n')
	await writeFile(other, '<template><p>other</p></template>\n')
	await generateAppTypes(root)
	const unchangedTime = (await stat(otherType)).mtimeMs

	// A full app scan would visit this temporarily invalid sibling.
	await writeFile(other, '<script lang="ts">const props = defineProps<</script>\n')
	await writeFile(fragment, '<template><span>fragment</span></template>\n')
	await writeFile(edited, '<script lang="ts">import * as Fragment from "../fragments/Fragment.meeko";\nvoid Fragment;\nconst props = defineProps<{ label: string }>();</script>\n<template><p>{props.label}</p></template>\n')
	const errors: string[] = []
	const outputs = await generateAppTypeForFile(root, edited, { onError: (file) => errors.push(file) })
	assert.deepEqual(errors, [])
	assert.equal((await stat(otherType)).mtimeMs, unchangedTime)
	assert.ok(outputs.includes(fragmentType))
	assert.match(await readFile(fragmentType, 'utf8'), /component-declaration/)
	assert.match(await readFile(manifest, 'utf8'), /Fragment\.d\.meeko\.ts/)

	// Structural reconciliation prunes declarations no longer reachable from the app.
	await writeFile(edited, '<template><p>edited</p></template>\n')
	await generateAppTypes(root, { onError: () => undefined })
	await assert.rejects(readFile(fragmentType, 'utf8'), /ENOENT/)
})

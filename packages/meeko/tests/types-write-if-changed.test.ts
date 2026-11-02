import assert from 'node:assert/strict'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { componentTypesPath, generateTypes } from '../src/types.ts'
import { tempProject } from './helpers/temp-project.ts'

test('unchanged component declarations keep their modification time', async (context) => {
	const root = await tempProject(context, 'types-write-if-changed')
	await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}\n')
	const file = join(root, 'app', 'components', 'Button.meeko')
	await mkdir(join(root, 'app', 'components'), { recursive: true })
	const source = '<script lang="ts">const props = defineProps<{ label: string }>();</script><template><p>{props.label}</p></template>'
	await writeFile(file, source)
	await generateTypes(source, file)
	const output = componentTypesPath(root, file)
	const before = await stat(output)
	const original = await readFile(output, 'utf8')
	await new Promise((done) => setTimeout(done, 30))
	await generateTypes(source, file)
	assert.equal((await stat(output)).mtimeMs, before.mtimeMs)
	await generateTypes(source.replace('label: string', 'label: number'), file)
	assert.notEqual(await readFile(output, 'utf8'), original)
})

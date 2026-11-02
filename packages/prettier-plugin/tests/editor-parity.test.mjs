import corePlugin from '@meekojs/meeko/prettier'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { format } from 'prettier'

import { formatWithPrettier } from '../../meeko/dist/formatters/prettier/editor.js'
import plugin from '../dist/index.js'

// Saving in the editor formats with the plugin of the core, and `prettier --check` with this one:
// they must agree, or the check fails right after saving.
const fixture = fileURLToPath(new URL('../../meeko/tests/fixtures/tailwind-app/', import.meta.url))
const pluginFile = fileURLToPath(new URL('../dist/index.js', import.meta.url))

const component = `<script lang="ts">
const a = tv({ base: "z-b a-a", variants: { "z y": { x: ["d-d c-c"] } } });
</script>

<script server lang="ts">
const b = cn("b-b a-a");
</script>

<template>
<p class="d-d  c-c d-d"></p>
<p bind:class="on ? 'b-b a-a' : cn('f-f e-e')"></p>
<p bind:class="\`b-b a-a \${size} d-d c-c\`"></p>
<p bind:title="on ? 'b a' : 'd c'"></p>
<Card class="b-b  a-a b-b" />
<Card bind:class="{ 'z y': on }" />
<component is="Card" class="b-b a-a"></component>
<x-card class="b-b a-a"></x-card>
</template>

<style>
.local-b {
  color: red;
}
.local-a {
  color: blue;
}
</style>
`

const classFunctions = ['tv', 'cn']

/** The three ways to reach the same options, and that the result is stable in each of them. */
async function assertSameEverywhere(source, options) {
	const cli = await format(source, { ...options, plugins: [plugin] })
	assert.equal(await format(source, { ...options, plugins: [corePlugin] }), cli, 'the plugin of the core alone')
	// The order of the language server: the plugins of the project, then the core.
	assert.equal(await format(source, { ...options, plugins: [plugin, corePlugin] }), cli, 'both, with the core last')
	assert.equal(await format(source, { ...options, plugins: [corePlugin, plugin] }), cli, 'both, with the core first')
	assert.equal(await format(cli, { ...options, plugins: [corePlugin] }), cli, 'stable')
	return cli
}

for (const [mode, expected] of [
	['alphabetical', /<Card class="a-a b-b" \/>/],
	['off', /<Card class="b-b {2}a-a b-b" \/>/],
]) {
	test(`the core and the plugin give the same result with meekoSortClasses "${mode}"`, async () => {
		const cli = await assertSameEverywhere(component, { filepath: 'Component.meeko', meekoClassFunctions: classFunctions, meekoSortClasses: mode })
		assert.match(cli, expected)
	})
}

test('the core and the plugin agree on a < inside an interpolation, which only the core hides from the HTML parser', async () => {
	for (const source of ['<template><p>{a < b}</p></template>\n', `<template><p>{'<b>'}</p></template>\n`, '<template><p>{a<b ? 1 : 2} text</p></template>\n', '<template><section><p>{list.length < 3 && "few"}</p></section></template>\n']) {
		await assertSameEverywhere(source, { filepath: 'Component.meeko' })
	}
})

test('the core and the plugin keep the same adjacent inline content with htmlWhitespaceSensitivity "ignore"', async () => {
	const source = '<template>\n<p>Usa <code>x</code>. Texto <strong>fuerte</strong><em>junto</em> y {valor}<a href="/x">enlace</a>.</p>\n</template>\n'
	const cli = await assertSameEverywhere(source, { filepath: 'Component.meeko', htmlWhitespaceSensitivity: 'ignore', printWidth: 30 })
	assert.doesNotMatch(cli, /<\/code>\s+\./)
})

test('the core and the plugin give the same result with the design system of the project', async () => {
	const source = `<script lang="ts">\nconst a = tv({ base: "text-white custom bg-brand flex" });\n</script>\n\n<template>\n<Card class="text-white flex" />\n<p bind:class="on ? 'text-white flex' : ''"></p>\n</template>\n`
	const cli = await assertSameEverywhere(source, { filepath: `${fixture}app/components/Probe.meeko`, meekoClassFunctions: classFunctions, meekoSortClasses: 'tailwind', printWidth: 200 })
	assert.match(cli, /<Card class="flex text-white" \/>/)
	assert.match(cli, /bind:class="on \? 'flex text-white' : ''"/)
	assert.match(cli, /tv\(\{ base: "custom flex bg-brand text-white" \}\)/)
})

test('saving in the editor gives what prettier --check expects, with or without this plugin in the configuration', async () => {
	const root = await mkdtemp(join(tmpdir(), 'meeko-editor-parity-'))
	try {
		await mkdir(join(root, 'app', 'styles'), { recursive: true })
		await writeFile(join(root, 'meeko.config.ts'), 'export default {}\n')
		await writeFile(join(root, 'app', 'styles', 'main.css'), '.z-b { color: red; }\n.a-a { color: blue; }\n.c-c { color: red; }\n.d-d { color: blue; }\n')
		const filename = join(root, 'app', 'Component.meeko')
		for (const mode of ['alphabetical', 'stylesheet']) {
			for (const plugins of [[pluginFile], []]) {
				const options = { meekoClassFunctions: classFunctions, meekoSortClasses: mode }
				await writeFile(join(root, '.prettierrc.json'), JSON.stringify({ ...options, plugins }))
				const saved = await formatWithPrettier({ text: component, filename, tabSize: 2, insertSpaces: true, trusted: true })
				const label = `${mode}, ${plugins.length ? 'with' : 'without'} the plugin`
				assert.equal(saved.text, await format(component, { ...options, filepath: filename, plugins: [plugin] }), label)
				// `prettier --check` after saving: nothing left to change.
				assert.equal(await format(saved.text, { ...options, filepath: filename, plugins: [plugin] }), saved.text, label)
			}
		}
		// An untrusted workspace reads no configuration and runs nothing of the project: nothing is sorted.
		const untrusted = await formatWithPrettier({ text: component, filename, tabSize: 2, insertSpaces: true, trusted: false })
		assert.match(untrusted.text, /<Card class="b-b {2}a-a b-b" \/>/)
		assert.match(untrusted.text, /tv\(\{ base: "z-b a-a"/)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('the core and the plugin declare the same options', () => {
	assert.deepEqual(Object.keys(corePlugin.options).sort(), Object.keys(plugin.options).sort())
	assert.deepEqual(corePlugin.options.meekoClassFunctions, plugin.options.meekoClassFunctions)
})

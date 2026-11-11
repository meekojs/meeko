import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { createFixture } from '../../../scripts/test-support/fixture.ts'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.js', import.meta.resolve('@meekojs/meeko')))

/** A consumer project with @meekojs/icon linked and Lucide as a dependency (resolved from this package). */
async function consumer(context) {
	const temporary = join(packageRoot, '.meeko', 'tests')
	const { root, write: put } = await createFixture(context, temporary, 'consumer-', { links: { '@meekojs/icon': packageRoot } })
	const run = (command) => promisify(execFile)(process.execPath, [cli, command, root], { cwd: packageRoot, windowsHide: true, maxBuffer: 1 << 26, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' } })
	await put('package.json', JSON.stringify({ type: 'module', private: true, devDependencies: { '@iconify-json/lucide': '*', '@meekojs/icon': '*' } }))
	return { put, root, run }
}

const config = (icon, extra = '') => `import { defineMeekoConfig } from '@meekojs/meeko/framework'\n\nexport default defineMeekoConfig({\n\tmodules: ['@meekojs/icon'],\n\ticon: ${icon},${extra}\n})\n`

/** Every file of a folder, recursively. */
async function files(directory) {
	const entries = await readdir(directory, { withFileTypes: true })
	return (await Promise.all(entries.map((entry) => (entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)])))).flat()
}

test('meeko check types icon names in templates and in icon.include, and reports a missing collection', { timeout: 240_000 }, async (context) => {
	const { put, root, run } = await consumer(context)
	await put('meeko.config.ts', config(`{ collections: ['lucide'], include: ['lucide:check'] }`))
	await put('app/icons/logo.svg', '<svg viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>')
	await put('app/pages/index.meeko', '<template><p><UIIcon name="lucide:search" /><UIIcon name="local:logo" label="Meeko" /></p></template>\n')
	await run('check')
	const generated = join(root, '.meeko', 'types', 'modules', '%40meekojs%2Ficon')
	assert.match(await readFile(join(generated, 'names-lucide.d.ts'), 'utf8'), /"lucide:search": true/)
	assert.match(await readFile(join(generated, 'names-local.d.ts'), 'utf8'), /"local:logo": true/)
	assert.match(await readFile(join(generated, 'collections.d.ts'), 'utf8'), /"lucide": true/)
	// A name outside the union is a type error of the template.
	await put('app/pages/index.meeko', '<template><p><UIIcon name="lucide:serch" /></p></template>\n')
	await assert.rejects(run('check'), /index\.meeko:1:\d+ TS2820: Type '"lucide:serch"' is not assignable to type 'keyof GeneratedIconNames'\. Did you mean '"lucide:search"'\?/)
	await put('app/pages/index.meeko', '<template><p><UIIcon name="lucide:search" /></p></template>\n')
	// icon.include is typed with the generated names in meeko.config.ts.
	await put('meeko.config.ts', config(`{ collections: ['lucide'], include: ['lucide:chek'] }`))
	await assert.rejects(run('check'), /meeko\.config\.ts:5:\d+ TS2820: Type '"lucide:chek"' is not assignable to type 'IconInclude'\. Did you mean '"lucide:check"'\?\n.*unknown icon "lucide:chek"/)
	// A configured collection that is not installed.
	await put('meeko.config.ts', config(`{ collections: ['lucide', 'no-such-set'] }`))
	await assert.rejects(run('check'), /the collection "no-such-set" of icon\.collections is not installed .*pnpm add -D @iconify-json\/no-such-set/s)
	// Without the module, its declarations are removed.
	await put('meeko.config.ts', "import { defineMeekoConfig } from '@meekojs/meeko/framework'\n\nexport default defineMeekoConfig({})\n")
	await put('app/pages/index.meeko', '<template><p>Sin iconos</p></template>\n')
	await run('check')
	await assert.rejects(readFile(join(generated, 'names-lucide.d.ts')), { code: 'ENOENT' })
})

test('meeko build embeds the SVG at build time, accessible and without inline styles, and bundles only the icons used', { timeout: 240_000 }, async (context) => {
	const { put, root, run } = await consumer(context)
	await put('meeko.config.ts', config(`{ collections: ['lucide'], include: ['lucide:check'] }`, "\n\tserver: { adapter: 'static' },"))
	await put('app/icons/logo.svg', '<svg viewBox="0 0 20 10" onload="alert(1)"><script>alert(1)</script><path d="M0 0h20v10z" fill="#ff0000" style="opacity:.5"/></svg>')
	await put(
		'app/pages/index.meeko',
		`<script server lang="ts">
export const route = definePage({ render: 'prerender' })
</script>
<script lang="ts">
const open = signal(false)
const dynamic = signal<'lucide:check' | 'lucide:search'>('lucide:check')
</script>
<template>
	<main>
		<h1><UIIcon name="lucide:search" /> Buscar</h1>
		<button type="button"><UIIcon name="lucide:trash-2" label="Eliminar" size="20px" /></button>
		<UIIcon bind:name="open.value ? 'lucide:x' : 'lucide:menu'" />
		<UIIcon bind:name="dynamic.value" />
		<UIIcon name="local:logo" />
	</main>
</template>
`,
	)
	await run('build')
	const output = join(root, '.meeko', 'output', 'static')
	const all = await files(output)
	const html = await readFile(
		all.find((file) => file.endsWith('index.html')),
		'utf8',
	)
	const svgs = html.match(/<svg\b[^>]*>/g)
	assert.equal(svgs.length, 5, html)
	const search = svgs.find((tag) => tag.includes('data-icon="lucide:search"'))
	for (const attribute of ['aria-hidden="true"', 'focusable="false"', 'fill="currentColor"', 'width="1em"', 'height="1em"', 'class="meeko-icon"']) assert.ok(search.includes(attribute), `${attribute} in ${search}`)
	assert.match(search, /viewBox="0 0 24 24"/)
	const trash = svgs.find((tag) => tag.includes('data-icon="lucide:trash-2"'))
	assert.match(trash, /role="img"/)
	assert.match(trash, /aria-label="Eliminar"/)
	assert.doesNotMatch(trash, /aria-hidden/)
	assert.match(trash, /width="20px"/)
	assert.match(
		svgs.find((tag) => tag.includes('data-icon="local:logo"')),
		/width="2em" height="1em"/,
	)
	assert.ok(svgs.some((tag) => tag.includes('data-icon="lucide:menu"')))
	assert.ok(svgs.some((tag) => tag.includes('data-icon="lucide:check"')))
	// No inline style, no script from the local file, the monochrome local icon in currentColor.
	const main = /<main[\s\S]*<\/main>/.exec(html)[0]
	assert.doesNotMatch(main, /style=|<script|onload|#ff0000/)
	assert.match(main, /<path d="M0 0h20v10z" fill="currentColor"\/>/)
	assert.match(main, /<path fill="none" stroke="currentColor"[^>]*d="M4 5h16M4 12h16M4 19h16"/)
	// The client bundle has the icons used (and those of include), never the rest of the collection.
	const scripts = (await Promise.all(all.filter((file) => file.endsWith('.js')).map((file) => readFile(file, 'utf8')))).join('\n')
	for (const used of ['lucide:search', 'lucide:trash-2', 'lucide:x', 'lucide:menu', 'lucide:check', 'local:logo']) assert.ok(scripts.includes(used), used)
	for (const unused of ['lucide:zap', 'lucide:house', 'lucide:a-arrow-down']) assert.ok(!scripts.includes(unused), unused)
	assert.doesNotMatch(scripts, /api\.iconify\.design|fetch\(['"`]https/)
	assert.ok(scripts.length < 200_000, `client JavaScript is ${scripts.length} bytes`)
})

test('an unknown literal name fails meeko build with its file and position', { timeout: 240_000 }, async (context) => {
	const { put, run } = await consumer(context)
	await put('meeko.config.mjs', "export default { modules: ['@meekojs/icon'], icon: { collections: ['lucide'] } }\n")
	await put('app/pages/index.meeko', '<template>\n\t<p><UIIcon name="lucide:serch" /></p>\n</template>\n')
	// The type check of meeko build reports it first; the build transform (meeko dev) fails the same way, by position.
	await assert.rejects(run('build'), /index\.meeko:2:13 TS2820: .*Did you mean '"lucide:search"'\?/)
})

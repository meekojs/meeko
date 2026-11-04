import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { collectionIcon, installedCollections, loadCollection, loadSources, resolveIcon, scopeIds } from '../dist/collections.js'
import { iconDeclarations } from '../dist/declarations.js'
import { iconView } from '../dist/index.js'
import { resolveOptions } from '../dist/options.js'
import { transformIconTags } from '../dist/transform.js'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))

async function project(files) {
	const temporary = join(packageRoot, '.meeko', 'tests')
	await mkdir(temporary, { recursive: true })
	const root = await mkdtemp(join(temporary, 'unit-'))
	for (const [path, contents] of Object.entries(files)) {
		await mkdir(join(root, path, '..'), { recursive: true })
		await writeFile(join(root, path), contents)
	}
	return root
}

test('options are validated with errors that name the option', () => {
	assert.deepEqual(resolveOptions({}), { collections: [], include: [], local: undefined, size: '1em' })
	assert.deepEqual(resolveOptions({ collections: ['lucide', 'lucide'], include: ['lucide:x', 'mdi:*'], size: '20px', local: false }), { collections: ['lucide'], include: ['lucide:x', 'mdi:*'], local: false, size: '20px' })
	assert.throws(() => resolveOptions({ colections: ['lucide'] }), /icon: unknown option colections/)
	assert.throws(() => resolveOptions({ collections: ['Lucide'] }), /collections must be a list of Iconify prefixes/)
	assert.throws(() => resolveOptions({ collections: ['local'] }), /"local" is reserved/)
	assert.throws(() => resolveOptions({ include: ['search'] }), /invalid include entry "search"/)
	assert.throws(() => resolveOptions({ size: '1em; color: red' }), /invalid size/)
})

test('a collection icon resolves with @iconify/utils, aliases included, and unknown names suggest the closest', () => {
	const lucide = loadCollection(packageRoot, 'lucide')
	assert.ok(lucide.names.length > 1500)
	const search = resolveIcon({ collections: new Map([['lucide', lucide]]), locals: new Map(), localFiles: new Map(), localDirectory: undefined }, 'lucide:search')
	assert.equal(search[0], '0 0 24 24')
	assert.match(search[1], /^<g fill="none" stroke="currentColor"/)
	const alias = Object.keys(lucide.data.aliases ?? {})[0]
	assert.ok(collectionIcon(lucide, alias), `alias ${alias}`)
	const sources = { collections: new Map([['lucide', lucide]]), locals: new Map(), localFiles: new Map(), localDirectory: undefined }
	assert.throws(() => resolveIcon(sources, 'lucide:serch'), /unknown icon "lucide:serch"\. Did you mean lucide:search/)
	assert.throws(() => resolveIcon(sources, 'mdi:home'), /"mdi:home" belongs to the collection "mdi", which is not in icon\.collections/)
	assert.throws(() => resolveIcon(sources, 'local:logo'), /needs a folder of local icons/)
})

test('a configured collection that is not installed is a clear error with the install command', async (context) => {
	const root = await project({ 'package.json': '{"private":true}' })
	context.after(() => rm(root, { recursive: true, force: true }))
	assert.throws(() => loadCollection(root, 'no-such-set'), /the collection "no-such-set" of icon\.collections is not installed .*pnpm add -D @iconify-json\/no-such-set/)
})

test('local SVG files become local:<name>; unknown local names suggest the closest; installed collections come from package.json', async (context) => {
	const root = await project({
		'package.json': JSON.stringify({ devDependencies: { '@iconify-json/lucide': '*', '@iconify-json/mdi': '*', other: '*' } }),
		'app/icons/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><path d="M0 0h20v10z" fill="#123456"/></svg>',
	})
	context.after(() => rm(root, { recursive: true, force: true }))
	assert.deepEqual(installedCollections(root), ['lucide', 'mdi'])
	const sources = loadSources(root, resolveOptions({ collections: ['lucide'] }))
	assert.deepEqual(sources.locals.get('local:logo'), ['0 0 20 10', '<path d="M0 0h20v10z" fill="currentColor"/>'])
	assert.throws(() => resolveIcon(sources, 'local:lgo'), /no lgo\.svg in .*Did you mean local:logo/)
	const declarations = iconDeclarations(sources, installedCollections(root))
	assert.deepEqual([...declarations.keys()], ['names-lucide.d.ts', 'names-local.d.ts', 'collections.d.ts'])
	assert.match(declarations.get('names-local.d.ts'), /"local:logo": true/)
	assert.match(declarations.get('names-lucide.d.ts'), /declare module '@meekojs\/icon' \{\n\tinterface GeneratedIconNames \{\n\t\t"lucide:a-arrow-down": true/)
	assert.match(declarations.get('collections.d.ts'), /"lucide": true\n\t\t"mdi": true/)
	await writeFile(join(root, 'app/icons/Bad Name.svg'), '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>')
	assert.throws(() => loadSources(root, resolveOptions({})), /rename it in kebab-case/)
	assert.throws(() => loadSources(root, resolveOptions({ local: 'missing' })), /icon\.local names a folder that does not exist/)
})

test('ids are scoped per icon, deterministically, with their references', () => {
	const body = '<defs><linearGradient id="a"><stop offset="0"/></linearGradient></defs><path fill="url(#a)" href="#a" d="M0 0"/>'
	const scoped = scopeIds(body, 'logos-x')
	assert.equal(scoped, '<defs><linearGradient id="meeko-icon-logos-x-a"><stop offset="0"/></linearGradient></defs><path fill="url(#meeko-icon-logos-x-a)" href="#meeko-icon-logos-x-a" d="M0 0"/>')
	assert.equal(scopeIds(body, 'logos-x'), scoped)
})

test('the transform embeds literal names and the literals of bind:name, and nothing in scripts or comments', () => {
	const icons = { 'lucide:search': ['0 0 24 24', '<path d="M1 1" data-x=\'q\'/>'], 'lucide:x': ['0 0 24 24', '<path d="M2 2"/>'], 'lucide:menu': ['0 0 24 24', '<path d="M3 3"/>'] }
	const resolve = (name) => {
		if (!icons[name]) throw new Error(`icon: unknown icon "${name}"`)
		return icons[name]
	}
	const source = `<script lang="ts">const s = '<UIIcon name="lucide:search" />'</script>
<template>
	<!-- <UIIcon name="lucide:nope" /> -->
	<UIIcon name="lucide:search" label="Buscar" />
	<UIIcon
		bind:name="open.value ? 'lucide:x' : 'lucide:menu'"
	/>
	<UIIcon bind:name="name.value" />
	<UIIconic name="lucide:search" />
</template>
<style>.a::after { content: '<UIIcon name="lucide:nope">' }</style>
`
	const result = transformIconTags(source, resolve)
	assert.deepEqual(result.names.sort(), ['lucide:menu', 'lucide:search', 'lucide:x'])
	assert.equal(result.code.match(/bind:resolved=/g).length, 2)
	assert.ok(result.code.includes(`<UIIcon bind:resolved="{'lucide:search':['0 0 24 24','\\u003cpath d=\\u0022M1 1\\u0022 data-x=\\'q\\'/\\u003e']}" name="lucide:search" label="Buscar" />`), result.code)
	assert.ok(result.code.includes(`<UIIcon bind:resolved="{'lucide:x':['0 0 24 24','\\u003cpath d=\\u0022M2 2\\u0022/\\u003e'],'lucide:menu':`))
	// The embedded value is a JavaScript expression that gives back the icon.
	const expression = /bind:resolved="([^"]*)" name="lucide:search"/.exec(result.code)[1]
	assert.deepEqual(new Function(`return ${expression}`)(), { 'lucide:search': icons['lucide:search'] })
	assert.equal(transformIconTags('<template><p>none</p></template>', resolve), undefined)
	assert.throws(
		() => transformIconTags('<template>\n\t<UIIcon name="lucide:serch" />\n</template>', resolve),
		(error) => {
			assert.match(error.message, /unknown icon "lucide:serch"/)
			assert.equal(error.offset, 12)
			return true
		},
	)
})

test('iconView: decorative by default, accessible with a label, proportional width and an empty fallback', () => {
	const registry = { 'lucide:check': ['0 0 24 24', '<path d="M1 1"/>'], 'local:wide': ['0 0 20 10', '<path d="M2 2"/>'] }
	assert.deepEqual(iconView('lucide:check', undefined, registry, '1em', undefined), { body: '<path d="M1 1"/>', height: '1em', hidden: 'true', label: undefined, missing: false, role: undefined, viewBox: '0 0 24 24', width: '1em' })
	const labelled = iconView('lucide:check', undefined, registry, '1em', 'Hecho')
	assert.deepEqual([labelled.hidden, labelled.role, labelled.label], [undefined, 'img', 'Hecho'])
	assert.equal(iconView('local:wide', undefined, registry, '1.5em', undefined).width, '3em')
	assert.equal(iconView('local:wide', undefined, registry, 'calc(1em + 2px)', undefined).width, undefined)
	assert.equal(iconView('lucide:x', { 'lucide:x': ['0 0 24 24', '<path d="M9 9"/>'] }, registry, '1em', undefined).body, '<path d="M9 9"/>')
	const missing = iconView('lucide:nope', undefined, registry, '1em', '  ')
	assert.deepEqual([missing.missing, missing.body, missing.viewBox, missing.hidden], [true, '', undefined, 'true'])
})

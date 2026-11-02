import { compile } from '@meekojs/meeko/compiler'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { format } from 'prettier'

import plugin from '../dist/index.js'

for (const name of ['button', 'dashboard', 'error', 'login']) {
	test(`formats ${name} with the existing public formatting contract`, async () => {
		const base = new URL(`../../meeko/tests/fixtures/prettier/${name}`, import.meta.url)
		const source = await readFile(`${fileURLToPath(base)}.meeko`, 'utf8')
		const expected = await readFile(`${fileURLToPath(base)}.formatted.meeko`, 'utf8')
		const options = { filepath: 'Component.meeko', plugins: [plugin] }
		const formatted = await format(source, options)
		assert.equal(formatted, expected.replaceAll('\r\n', '\n'))
		assert.equal(await format(formatted, options), formatted)
		compile(formatted, 'Component.meeko')
	})
}

test('keeps self-closing HTML elements and empty elements with end tags as written', async () => {
	const source = `<script lang="ts">\nconst title = "t"\n</script>\n\n<template>\n<div class="a"   bind:title="title" /><span/><p>after</p><ul><li /><li>b</li></ul><svg><path d="M0" /></svg><em></em>\n</template>\n`
	const options = { filepath: 'Component.meeko', plugins: [plugin] }
	const formatted = await format(source, options)
	assert.match(formatted, /<div class="a" bind:title="title" \/>/)
	assert.match(formatted, /<span \/>/)
	assert.match(formatted, /<li \/>\s*<li>b<\/li>/)
	assert.match(formatted, /<path d="M0" \/>/)
	assert.match(formatted, /<em><\/em>/)
	assert.equal(await format(formatted, options), formatted)
	compile(formatted, 'Component.meeko')
})

test('keeps hyphenated snippet names, as cell-<key> of a generic table', async () => {
	const source = `<script lang="ts">\nimport * as Grid from "./Grid.meeko"\nconst users = [{ id: 1, email: "ada@x.io" }]\n</script>\n\n<template>\n<Grid bind:rows="users"><snippet name="cell-email" params="row,value"><a>{value}</a></snippet><snippet name="header-created-at">On</snippet></Grid>\n</template>\n`
	const options = { filepath: 'Component.meeko', plugins: [plugin] }
	const formatted = await format(source, options)
	assert.match(formatted, /<snippet\s+name="cell-email"/)
	assert.match(formatted, /name="header-created-at"/)
	assert.equal(await format(formatted, options), formatted)
	compile(formatted, 'Component.meeko')
})

const ignoreWhitespace = { filepath: 'Component.meeko', plugins: [plugin], htmlWhitespaceSensitivity: 'ignore', printWidth: 800, singleAttributePerLine: true }

test('htmlWhitespaceSensitivity: "ignore" adds no space where the source has none, because the compiler renders it', async () => {
	const source = `<template>\n<p>Uno <code>a</code>, dos (<code>b</code>): <strong>c</strong><em>d</em> <a href="/e" class="f">e</a>. {valor}.</p>\n</template>\n`
	const formatted = await format(source, ignoreWhitespace)
	assert.match(formatted, /<code>a<\/code>, dos \(<code>b<\/code>\):/)
	assert.match(formatted, /<strong>c<\/strong><em>d<\/em>/)
	// An element with its attributes on several lines keeps its text glued too.
	assert.match(formatted, />e<\/a\s*>\. \{valor\}\./)
	assert.equal(await format(formatted, ignoreWhitespace), formatted)
	compile(formatted, 'Component.meeko')
})

test('htmlWhitespaceSensitivity: "ignore" still splits the nodes that have a space between them', async () => {
	const source = `<template>\n<p>Uno <code>a</code> dos</p>\n<div><span>b</span> <span>c</span></div>\n<UIButton variant="x" size="y">Texto</UIButton>\n</template>\n`
	const formatted = await format(source, ignoreWhitespace)
	assert.match(formatted, /Uno\n\s*<code>a<\/code>\n\s*dos/)
	assert.match(formatted, /<span>b<\/span>\n\s*<span>c<\/span>/)
	// A component is not a phrasing element: its content can go on its own line.
	assert.match(formatted, /size="y"\n>\n\s*Texto\n<\/UIButton>/)
	assert.equal(await format(formatted, ignoreWhitespace), formatted)
})

test('keeps the default whitespace sensitivity untouched', async () => {
	const source = `<template>\n<p>Uno <code>a</code>, dos</p>\n</template>\n`
	const formatted = await format(source, { filepath: 'Component.meeko', plugins: [plugin] })
	assert.match(formatted, /<p>Uno <code>a<\/code>, dos<\/p>/)
})

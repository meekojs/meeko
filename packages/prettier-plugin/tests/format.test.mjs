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

test('formats the event of a model, a name with two colons, as any event', async () => {
	const source = `<script lang="ts">\nimport { signal } from "@meekojs/meeko"\nimport * as AppInput from "./AppInput.meeko"\nconst name = signal("")\n</script>\n\n<template>\n<AppInput   bind:modelValue="name.value" on:update:modelValue="(next)=>{name.value=next}" />\n</template>\n`
	const options = { filepath: 'Component.meeko', plugins: [plugin] }
	const formatted = await format(source, options)
	assert.match(formatted, /bind:modelValue="name\.value"/)
	assert.match(formatted, /on:update:modelValue="\s*\(next\) => \{\s*name\.value = next;?\s*\}\s*"/)
	assert.equal(await format(formatted, options), formatted)
	assert.match(compile(formatted, 'Component.meeko').code, /"onUpdate:modelValue":/)
})

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

const preserveWhitespace = { filepath: 'Component.meeko', plugins: [plugin], htmlWhitespaceSensitivity: 'css', printWidth: 800, singleAttributePerLine: true }

test('ignore formats snippet footers as complete nested tags', async () => {
	const source = '<template>\n<AuthCard><snippet name="footer">¿Ya tienes una cuenta?<MeekoLink to="/login" class="text-accent-text underline underline-offset-4">Ingresar</MeekoLink></snippet></AuthCard>\n</template>\n'
	const options = { ...preserveWhitespace, htmlWhitespaceSensitivity: 'ignore', useTabs: true, meekoIndentSections: true }
	const expected = await format(source, { parser: 'vue', htmlWhitespaceSensitivity: 'ignore', singleAttributePerLine: true, printWidth: 800, useTabs: true })
	const broken = source.replace('>¿Ya', '\n>¿Ya').replace('>Ingresar', '\n>Ingresar').replace('</MeekoLink>', '</MeekoLink\n>')
	for (const text of [source, broken]) {
		const formatted = await format(text, options)
		assert.equal(formatted, expected)
		assert.equal(await format(formatted, options), formatted)
		compile(formatted, 'Component.meeko')
	}
})

test('separates adjacent sections with exactly one blank line', async () => {
	const sections = ['<script server lang="ts">export const title="Meeko"</script>', '<script lang="ts">const label="Label"</script>', '<template><p>{label}</p></template>', '<style>p{color:red}</style>']
	for (const gap of ['', '\n', '\n\n', '\n\n\n\n', '\r\n']) {
		for (const htmlWhitespaceSensitivity of ['ignore', 'css', 'strict']) {
			const options = { filepath: 'Component.meeko', plugins: [plugin], htmlWhitespaceSensitivity }
			const formatted = await format(sections.join(gap), options)
			assert.equal(formatted.match(/<\/script>\n\n<(?:script|template)/g)?.length, 2)
			assert.match(formatted, /<\/template>\n\n<style>/)
			assert.doesNotMatch(formatted, /\n{3}/)
			assert.equal(await format(formatted, options), formatted)
			compile(formatted, 'Component.meeko')
		}
	}
})

test('ignore formats nested form elements like Prettier HTML, including previously split tags', async () => {
	const source = '<template>\n<label class="grid gap-2 text-sm font-medium">Tipo de acceso<select model="mode" class="min-h-11 rounded-lg border border-input bg-canvas px-3"><option value="email">Responsable · con correo</option><option value="employee">Empleado · con usuario</option></select></label>\n</template>\n'
	const options = { ...preserveWhitespace, htmlWhitespaceSensitivity: 'ignore', useTabs: true, meekoIndentSections: true }
	const expected = await format(source, { parser: 'vue', htmlWhitespaceSensitivity: 'ignore', singleAttributePerLine: true, printWidth: 800, useTabs: true })
	for (const text of [source, source.replace('>Tipo', '\n>Tipo').replace('</select>', '</select\n>'), source.replace('>Tipo', '>\nTipo').replace('</label>', '\n</label>')]) {
		const formatted = await format(text, options)
		assert.equal(formatted, expected)
		assert.equal(await format(formatted, options), formatted)
		compile(formatted, 'Component.meeko')
	}
})

test('the default whitespace mode adds no space where the source has none, because the compiler renders it', async () => {
	const source = `<template>\n<p>Uno <code>a</code>, dos (<code>b</code>): <strong>c</strong><em>d</em> <a href="/e" class="f">e</a>. {valor}.</p>\n</template>\n`
	const formatted = await format(source, preserveWhitespace)
	assert.match(formatted, /<code>a<\/code>, dos \(<code>b<\/code>\):/)
	assert.match(formatted, /<strong>c<\/strong><em>d<\/em>/)
	// An element with its attributes on several lines keeps its text glued too.
	assert.match(formatted, />e<\/a\s*>\. \{valor\}\./)
	assert.equal(await format(formatted, preserveWhitespace), formatted)
	compile(formatted, 'Component.meeko')
})

test('the default whitespace mode preserves spaces between inline nodes', async () => {
	const source = `<template>\n<p>Uno <code>a</code> dos</p>\n<div><span>b</span> <span>c</span></div>\n<UIButton variant="x" size="y">Texto</UIButton>\n</template>\n`
	const formatted = await format(source, preserveWhitespace)
	assert.match(formatted, /Uno <code>a<\/code> dos/)
	assert.match(formatted, /<span>b<\/span> <span>c<\/span>/)
	// Its text has no whitespace in the source, and the component would render it inside the button.
	assert.match(formatted, /size="y">Texto<\/UIButton>/)
	assert.equal(await format(formatted, preserveWhitespace), formatted)
})

test('keeps the default whitespace sensitivity untouched', async () => {
	const source = `<template>\n<p>Uno <code>a</code>, dos</p>\n</template>\n`
	const formatted = await format(source, { filepath: 'Component.meeko', plugins: [plugin] })
	assert.match(formatted, /<p>Uno <code>a<\/code>, dos<\/p>/)
})

for (const htmlWhitespaceSensitivity of ['ignore', 'css', 'strict']) {
	for (const printWidth of [30, 100, 800]) {
		test(`keeps text-only closing tags complete at width ${printWidth} with ${htmlWhitespaceSensitivity}`, async () => {
			const source = '<template>\n<article>\n<MeekoLink class="link" to="/">Volver al inicio</MeekoLink>\n</article>\n</template>\n'
			const options = { ...preserveWhitespace, htmlWhitespaceSensitivity, printWidth }
			const formatted = await format(source, options)
			assert.match(formatted, /<MeekoLink\n\s+class="link"\n\s+to="\/"/)
			assert.match(formatted, /inicio\s*<\/MeekoLink>/)
			if (printWidth >= 100 && htmlWhitespaceSensitivity !== 'ignore') assert.match(formatted, /to="\/">Volver al inicio<\/MeekoLink>/)
			assert.equal(await format(formatted, options), formatted)
			const broken = source.replace('>Volver al inicio</MeekoLink>', '\n>Volver al inicio</MeekoLink\n>')
			assert.equal(await format(broken, options), formatted)
			compile(formatted, 'Component.meeko')
		})
		test(`Enter inside text keeps the closing tag complete at width ${printWidth} with ${htmlWhitespaceSensitivity}`, async () => {
			const options = { ...preserveWhitespace, htmlWhitespaceSensitivity, printWidth }
			for (const text of ['\nEsta página resume cómo Ordemi utiliza la información.', 'Esta página resume\ncómo Ordemi utiliza la información.', '\nEsta página resume cómo Ordemi utiliza la información.\n']) {
				const source = `<template>\n<p class="mt-5 text-lg leading-8 text-muted">${text}</p>\n</template>\n`
				const formatted = await format(source, options)
				assert.match(formatted, /<\/p>/)
				if (text.startsWith('\n')) assert.match(formatted, /text-muted"\s*>\n\s+Esta/)
				assert.equal(await format(formatted, options), formatted)
				const broken = source.replace('</p>', '</p\n>')
				assert.equal(await format(broken, options), formatted)
				compile(formatted, 'Component.meeko')
			}
		})
	}
}

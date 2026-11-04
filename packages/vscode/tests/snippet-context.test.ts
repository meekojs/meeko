import assert from 'node:assert/strict'
import { test } from 'node:test'

import { snippetContextAt } from '../src/snippet-context'

/** The context at the `|` of a component. */
function contextAt(marked: string): string | undefined {
	const offset = marked.indexOf('|')
	assert.ok(offset >= 0, marked)
	return snippetContextAt(marked.slice(0, offset) + marked.slice(offset + 1), offset)
}

test('the code of both scripts accepts script snippets', () => {
	assert.equal(contextAt('<script lang="ts">\n|\n</script>'), 'script')
	assert.equal(contextAt('<script server lang="ts">\n|\n</script>'), 'script')
	assert.equal(contextAt('<script lang="ts">\nconst a = "x"\nms|\n</script>'), 'script')
	assert.equal(contextAt('<script\n\tserver\n\tlang="ts"\n>\n|\n</script>'), 'script')
	// While the component does not compile, and with the block still open.
	assert.equal(contextAt('<script lang="ts">\nconst a = \n|'), 'script')
})

test('strings, comments and members of a script accept none', () => {
	for (const code of ["const a = 'x|'", 'const a = "x|"', 'const a = `x|`', 'const a = `${|}`', '// x|', '/* x|', 'value.|', 'value.ms|', 'value?.ms|']) {
		assert.equal(contextAt(`<script lang="ts">\n${code}\n</script>`), undefined, code)
	}
	// A closed string or comment, and a string left open on an earlier line, end before the cursor.
	for (const code of ["const a = 'x'\n|", '// x\n|', '/* x */ |', "const a = 'x\n|", "const a = /'/\n|", 'const a = 4 / 2 / 1\n|']) {
		assert.equal(contextAt(`<script lang="ts">\n${code}\n</script>`), 'script', code)
	}
})

test('a regular expression still open accepts none, and a division or a closed one does not count', () => {
	for (const code of ['const re = /abc|', 'const re = /|', 'const re = /a[/|', 'const re = /a\\/|', 'if (/a|', 'return /a|', 'const a = [/x/, /y|', 'const a = 1 + /x|']) {
		assert.equal(contextAt(`<script lang="ts">\n${code}\n</script>`), undefined, code)
	}
	assert.equal(contextAt('<script lang="ts">\nconst re = /abc|</script>'), undefined, 'right before the closing tag')
	for (const code of ['const re = /abc/ |', 'const re = /abc/g\n|', 'const a = b / c |', 'const a = b /|', 'const a = (b) / 2 |', 'const a = items[0] / 2 |', 'const a = i++ / 2 |', 'const a = obj.return / 2 |', 'const a = 4 / 2 / 1 |', 'const re = /abc\n|', 'const a = 1 / 2\n|']) {
		assert.equal(contextAt(`<script lang="ts">\n${code}\n</script>`), 'script', code)
	}
})

test('the content of the template accepts template snippets', () => {
	assert.equal(contextAt('<template>|</template>'), 'template')
	assert.equal(contextAt('<template>\n\t|\n</template>'), 'template')
	assert.equal(contextAt('<template>\n\t<div>|</div>\n</template>'), 'template')
	assert.equal(contextAt('<template>\n\t<div on:click="() => go()">\n\t\t|\n\t</div>\n</template>'), 'template')
	assert.equal(contextAt('<template>\n\t<input disabled />\n\t|\n</template>'), 'template')
	assert.equal(contextAt('<template>\n\t<template if:when="a">|</template>\n\t<p />\n</template>'), 'template')
	assert.equal(contextAt('<template>\n\t{a}\n\t|\n</template>'), 'template')
	assert.equal(contextAt('<template>\n\t<!-- { -->\n\t<p title="{">|</p>\n</template>'), 'template')
	assert.equal(contextAt('<template>\n\t<!-- a -->|\n</template>'), 'template')
})

test('tags, values, comments and expressions of the template accept none', () => {
	for (const markup of ['<div |>', '<div class="a|">', '<div if:when="a|">', '<|', '<di|', '</di|', '</|', '<!-- a| -->', '<!-- a|', '{|}', '{ a.|b }', "{ 'a|' }"]) {
		assert.equal(contextAt(`<template>\n\t${markup}\n</template>`), undefined, markup)
	}
})

test('the root, section tags and <style> accept none: the root belongs to contributes.snippets', () => {
	for (const source of ['|', '|<script lang="ts"></script>', '<script lang="ts"></script>\n|\n<template></template>', '<!-- | -->', '<script lang="|ts"></script>', '<script |lang="ts"></script>', '<template |></template>', '<template></template>\n|', '<style>\n|\n</style>', '<style scoped>a { | }</style>']) {
		assert.equal(contextAt(source), undefined, source)
	}
})

test('sections are found in order, whatever their text says', () => {
	// A <template> or a comment written in a script opens nothing.
	assert.equal(contextAt('<script lang="ts">\nconst a = "<template>"\n</script>\n<script server lang="ts">\n|\n</script>\n<template></template>'), 'script')
	assert.equal(contextAt('<script lang="ts">\nconst a = "<!--"\n|\n</script>'), 'script')
	// A commented section is not a section.
	assert.equal(contextAt('<!-- <script lang="ts"> -->\n|\n<template></template>'), undefined)
	// An attribute with `>` does not end the opening tag.
	assert.equal(contextAt('<script lang="ts" generic="T extends Array<string>">\n|\n</script>'), 'script')
	assert.equal(contextAt('<script lang="ts" generic="T extends Array<|string>">\n</script>'), undefined)
})

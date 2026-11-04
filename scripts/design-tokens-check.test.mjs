import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { checkDesignTokens, scanCss, scanMeeko } from './design-tokens-check.mjs'
import { designExceptions } from './design-tokens-exceptions.mjs'

const rules = (findings) => findings.map((finding) => finding.rule)

/** A throwaway repository with these files, removed when the test ends. */
function repository(context, files) {
	const root = mkdtempSync(join(tmpdir(), 'design-tokens-'))
	context.after(() => rmSync(root, { recursive: true, force: true }))
	for (const [name, content] of Object.entries(files)) {
		mkdirSync(dirname(join(root, name)), { recursive: true })
		writeFileSync(join(root, name), content)
	}
	return root
}

test('the repository has no design outside the tokens and no stale exception', () => {
	const { files, violations, stale } = checkDesignTokens(fileURLToPath(new URL('../', import.meta.url)))
	assert.ok(files > 100, `read only ${files} files`)
	assert.deepEqual(violations, [])
	assert.deepEqual(stale, [])
})

test('every exception names one file, one rule, an exact value and its reason', () => {
	for (const { file, rule, value, reason } of designExceptions) {
		assert.match(file, /^(?:apps|packages\/docs)\//)
		assert.doesNotMatch(file, /[*?]/, 'no wildcards')
		assert.ok(rule && value && reason?.length > 20, file)
	}
})

test('reports a hex, a colour function, a font size, a font family, a font face and a removed variable', () => {
	assert.deepEqual(rules(scanCss('.a { color: #fff; background: #12345678 }')), ['hex-color', 'hex-color'])
	assert.deepEqual(rules(scanCss('.a { color: rgb(0 0 0) }')), ['color-function'])
	assert.deepEqual(rules(scanCss('.a { font-size: 13px }')), ['font-size'])
	assert.deepEqual(rules(scanCss('.a { font-size: 0.8rem !important }')), ['font-size'])
	assert.deepEqual(rules(scanCss('.a { font-size: calc(var(--ui-font-size-sm) + 2px) }')), ['font-size'])
	assert.deepEqual(rules(scanCss('.a { font-size: var(--own-size) }')), ['font-size'])
	assert.deepEqual(rules(scanCss('.a { font-size: var(--ui-font-size-sm, var(--own-size)) }')), ['font-size'])
	assert.deepEqual(rules(scanCss('.a { font-family: Inter, sans-serif }')), ['font-family'])
	assert.deepEqual(rules(scanCss('.a { font: 12px/1 Inter }')), ['font'])
	assert.deepEqual(rules(scanCss('@font-face { font-family: var(--ui-font-sans); src: url(a.woff2) }')), ['font-face'])
	assert.deepEqual(rules(scanCss('.a { color: var(--meeko-ui-text) }')), ['meeko-ui-variable'])
	assert.deepEqual(rules(scanCss('.a { --meeko-ui-text: red }')), ['meeko-ui-variable'])
	assert.deepEqual(rules(scanCss('.a { & .b { color: #000 } }')), ['hex-color'])
})

test('accepts tokens and what is not a colour or a value', () => {
	const css = `
		/* #fff, font-size: 13px and --meeko-ui-text in a comment */
		.a { font-size: var(--ui-font-size-sm); font-family: var(--ui-font-mono); color: var(--ui-color-text) }
		.b { font-size: inherit; font: inherit; font-size: calc(var(--ui-font-size-sm) * 2) }
		#fff { color: var(--ui-color-text) }
		.c { fill: url(#abc); background: url("a#fff.png"); content: "#fff" }
	`
	assert.deepEqual(scanCss(css), [])
})

test('in a component it reads <style>, style, bind:style and the SVG colours, and ignores example code', () => {
	const source = (template, style = '') => `<template>\n${template}\n</template>\n${style}`
	assert.deepEqual(rules(scanMeeko(source('<p />', '<style>\n.a { color: #fff }\n</style>\n'))), ['hex-color'])
	assert.deepEqual(rules(scanMeeko(source('<p style="font-size: 12px" />'))), ['font-size'])
	assert.deepEqual(rules(scanMeeko(source('<p hidden style="color: var(--meeko-ui-text)" />'))), ['meeko-ui-variable'])
	assert.deepEqual(rules(scanMeeko(source(`<p bind:style="ok ? 'color: #fff' : undefined" />`))), ['hex-color'])
	assert.deepEqual(rules(scanMeeko(source(`<p bind:style="{ fontSize: '12px' }" />`))), ['font-size'])
	assert.deepEqual(scanMeeko(source(`<p bind:style="{ fontSize: 'var(--ui-font-size-sm)' }" />`)), [])
	assert.deepEqual(rules(scanMeeko(source('<path fill="#123456" />'))), ['hex-color'])
	assert.deepEqual(scanMeeko(source('<path fill="url(#grad)" stroke="currentColor" />')), [])
	// Example code: an attribute with code, the text of a <pre> or a <code>, and an expression.
	const examples = source(`<DocsCode code=".a { color: #fff; font-size: 12px; --meeko-ui-a: 1 }" />\n<pre>.a { color: #fff }</pre>\n<code>--meeko-ui-text</code>\n<p>{'<style>.a { color: #fff }</style>'}</p>\n<p title="a > b" style="color: var(--ui-color-text)">#fff</p>`)
	assert.deepEqual(scanMeeko(examples), [])
})

test('reports a space before punctuation after an element, in the guides of every language', () => {
	const source = (template) => `<template>\n${template}\n</template>\n`
	assert.deepEqual(rules(scanMeeko(source('<p>\n\t<code>x</code>\n\t.\n</p>'))), ['space-before-punctuation'])
	assert.deepEqual(rules(scanMeeko(source('<p>\n\t<code>x</code>\n\t, otro\n</p>'))), ['space-before-punctuation'])
	assert.deepEqual(rules(scanMeeko(source('<p>\n\tuno (\n\t<code>x</code>)\n</p>'))), ['space-before-punctuation'])
	assert.deepEqual(scanMeeko(source('<p>\n\tuno (<code>x</code>), dos\n\t<code>y</code>.\n</p>')), [])
	assert.deepEqual(scanMeeko(source('<UIButton>\n\t<span>Exportar</span>\n\t.md\n</UIButton>')), [], 'a word that starts with a dot')
	assert.deepEqual(scanMeeko(source('<pre>\n<code>x</code>\n.\n</pre>')), [], 'preformatted text is code')
})

test('reads file names with brackets, ignores output folders and only trusts exact exceptions', (context) => {
	const root = repository(context, {
		'apps/a/app/pages/[id].meeko': '<template>\n<p />\n</template>\n\n<style>\n.a { color: #111 }\n</style>\n',
		'apps/a/app/styles/main.css': '.b { font-size: 12px }\n.c { font-size: 13px }\n',
		'apps/a/dist/main.css': '.d { color: #222 }\n',
		'apps/a/node_modules/x/main.css': '.e { color: #333 }\n',
		'apps/a/app/copy.ts': "export const css = '.f { color: #444 }'\n",
		'packages/docs/src/docs.css': '.g { color: var(--meeko-ui-text) }\n',
	})
	const exceptions = [{ file: 'apps/a/app/styles/main.css', rule: 'font-size', value: 'font-size: 12px', reason: 'Only this value.' }]
	const { violations, stale, files } = checkDesignTokens(root, { exceptions })
	assert.equal(files, 3)
	assert.deepEqual(stale, [])
	assert.deepEqual(
		violations.map(({ file, line, rule }) => [file, line, rule]),
		[
			['apps/a/app/pages/[id].meeko', 6, 'hex-color'],
			['apps/a/app/styles/main.css', 2, 'font-size'],
			['packages/docs/src/docs.css', 1, 'meeko-ui-variable'],
		],
	)
})

test('an exception that nothing uses is an error', (context) => {
	const root = repository(context, { 'apps/a/main.css': '.a { color: var(--ui-color-text) }\n', 'packages/docs/docs.css': '' })
	const exceptions = [{ file: 'apps/a/main.css', rule: 'hex-color', value: 'color: #fff', reason: 'Nothing uses it any more.' }]
	const { violations, stale } = checkDesignTokens(root, { exceptions })
	assert.deepEqual(violations, [])
	assert.deepEqual(stale, exceptions)
})

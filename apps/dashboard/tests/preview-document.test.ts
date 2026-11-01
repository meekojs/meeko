// The document of the preview's iframe and the size limit of the Markdown, without a browser nor a
// database: what the editor builds and what the schema accepts.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as v from 'valibot'

import { previewDocument, previewPolicy, previewStyles, previewTokens } from '../app/utils/preview-document'
import { encodedBytes, markdownSchema, maxMarkdownBytes, saveDraftInput, utf8Bytes } from '../shared/schemas/dashboard'

test('the preview document carries its policy before the draft, the theme and only safe tokens', () => {
	const hostile = '<style>body { display: none }</style><script>parent.x = 1</script><meta http-equiv="Content-Security-Policy" content="script-src *">'
	const html = previewDocument({ html: hostile, theme: 'light', tokens: { '--bg': ' #fff ', '--ink': 'red; } body { display: none', '--line': '', 'not-a-token': 'x' } })
	const policy = html.indexOf('http-equiv="Content-Security-Policy"')
	assert.ok(policy > 0 && policy < html.indexOf(hostile), 'the policy comes first: a later one in the draft can only add restrictions')
	assert.match(html, /^<!doctype html>\n<html lang="es" data-theme="light">/)
	assert.match(html, /:root \{ color-scheme: light; --bg: #fff; \}/)
	assert.doesNotMatch(html, /--ink:|--line:|not-a-token/, 'a value that would close the rule is dropped')
	assert.match(html, /<body class="dash-preview prose">\n<style>body/)
	assert.match(previewPolicy, /script-src 'none'/)
	assert.match(previewPolicy, /frame-src 'none'/)
	assert.match(previewPolicy, /form-action 'none'/)
})

test('the styles of the preview are the prose rules of the site, on the tokens of the docs', () => {
	assert.match(previewStyles, /\.dash-preview\.prose \{/)
	assert.match(previewStyles, /:root\[data-theme='light'\] \.dash-preview \.shiki span/)
	for (const token of ['--bg', '--ink', '--ink-soft', '--accent-ink', '--code-bg', '--font-mono', '--font-ui']) assert.ok(previewTokens.includes(token), token)
	assert.doesNotMatch(previewStyles, /<\/style/i, 'the styles cannot close their element')
})

test('the size of a Markdown counts its JSON escapes, so an accepted save always fits in the RPC body', () => {
	assert.equal(encodedBytes('a"b'), 6)
	assert.equal(encodedBytes('\u0001'), 8, 'a control character is six bytes and the quotes two')
	const quotes = '"'.repeat(460_000)
	assert.ok(utf8Bytes(quotes) < maxMarkdownBytes && encodedBytes(quotes) > maxMarkdownBytes)
	assert.equal(v.safeParse(markdownSchema, quotes).success, false, 'half the limit as UTF-8, over it once escaped')
	assert.equal(v.safeParse(markdownSchema, 'é'.repeat(440_000)).success, true)
	// The worst text within the limit, with the longest author and note, still fits in 1 MiB.
	const worst = `x${'\u0001'.repeat(Math.floor((maxMarkdownBytes - 3) / 6))}`
	assert.ok(encodedBytes(worst) <= maxMarkdownBytes)
	const input = { sourceId: 1, revisionId: 1, markdown: worst, author: '\u0001'.repeat(200), note: '\u0001'.repeat(500), expectedHash: 'a'.repeat(64), baseHash: 'b'.repeat(64) }
	assert.equal(v.safeParse(saveDraftInput, input).success, true, JSON.stringify(v.safeParse(saveDraftInput, input).issues?.[0]?.message))
	assert.ok(utf8Bytes(JSON.stringify(input)) < 1_048_576)
})

// The document of the preview's iframe and the size limit of the Markdown, without a browser nor a
// database: what the editor builds and what the schema accepts.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import * as v from 'valibot'

import { previewDocument, previewPageStyles, previewPolicy, previewTokens } from '../app/utils/preview-document'
import { encodedBytes, markdownSchema, maxMarkdownBytes, saveDraftInput, utf8Bytes } from '../shared/schemas/dashboard'

/** The sheets of @meekojs/ui that app/utils/preview-styles.ts loads through Vite. */
const sheet = (name: string) => readFileSync(new URL(`../../../packages/ui/src/app/styles/${name}.css`, import.meta.url), 'utf8')
const styles = `${sheet('code')}\n${sheet('prose')}`

test('the preview document carries its policy before the draft, the theme and only safe tokens', () => {
	const hostile = '<style>body { display: none }</style><script>parent.x = 1</script><meta http-equiv="Content-Security-Policy" content="script-src *">'
	const html = previewDocument({ html: hostile, theme: 'light', styles: '', tokens: { '--ui-color-bg': ' #fff ', '--ui-color-text': 'red; } body { display: none', '--ui-color-border': '', 'not-a-token': 'x' } })
	const policy = html.indexOf('http-equiv="Content-Security-Policy"')
	assert.ok(policy > 0 && policy < html.indexOf(hostile), 'the policy comes first: a later one in the draft can only add restrictions')
	assert.match(html, /^<!doctype html>\n<html lang="es" data-theme="light">/)
	assert.match(html, /:root \{ color-scheme: light; --ui-color-bg: #fff; \}/)
	assert.doesNotMatch(html, /--ui-color-text:|--ui-color-border:|not-a-token/, 'a value that would close the rule is dropped')
	assert.match(html, /<body class="dash-preview meeko-ui-prose">\n<style>body/)
	assert.match(previewPolicy, /script-src 'none'/)
	assert.match(previewPolicy, /frame-src 'none'/)
	assert.match(previewPolicy, /form-action 'none'/)
})

test('the preview is dressed by the sheets of UI, on their tokens, and writes no design of its own', () => {
	const tokens = previewTokens(styles)
	for (const token of ['--ui-color-bg', '--ui-color-text', '--ui-color-text-soft', '--ui-color-primary-text', '--ui-color-bg-subtle', '--ui-font-mono', '--ui-font-sans']) assert.ok(tokens.includes(token), token)
	assert.match(previewDocument({ html: '', theme: 'dark', styles, tokens: {} }), /@scope \(\.meeko-ui-prose\)/)
	assert.doesNotMatch(previewPageStyles, /#[0-9a-f]{3,8}\b|font-family|font-weight/i, 'the page around the prose only reads tokens')
	assert.doesNotMatch(styles + previewPageStyles, /<\/style/i, 'the styles cannot close their element')
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

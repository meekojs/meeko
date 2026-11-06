import assert from 'node:assert/strict'
import { test } from 'node:test'

import { renderFragment, renderMarkdown, renderSource, textHeadings } from '../src/content/markdown'
import { createSourceContext, withSourceContext } from '../src/content/repository'

test('translated guide links preserve existing sections and drop unavailable fragments', async () => {
	const doc = await withSourceContext(createSourceContext(undefined, 'en'), () => renderMarkdown('[Existing](/docs/framework#create-an-application) [Unavailable](/docs/framework#no-such-section)', 'docs/example.md'))
	assert.match(doc.html, /href="\/docs\/framework#create-an-application"/)
	assert.match(doc.html, /href="\/docs\/framework">Unavailable/)
	assert.doesNotMatch(doc.html, /#no-such-section/)
})

for (const [locale, heading] of [
	['es', 'Después del ejemplo'],
	['en', 'After the example'],
] as const) {
	test(`literal HTML examples do not swallow later sections (${locale})`, async () => {
		const markdown = `# ${locale === 'es' ? 'Cambios' : 'Changes'}\n\n## Ejemplo\n\n<textarea>\n&amp;x</textarea>\n\n## ${heading}\n\nTexto final.\n`
		const doc = await renderMarkdown(markdown, 'packages/meeko/CHANGELOG.md')
		assert.match(doc.html, /&lt;textarea&gt;/)
		assert.doesNotMatch(doc.html, /<textarea(?:\s|>)/i)
		assert.match(doc.html, /<h2 id="(?:después-del-ejemplo|after-the-example)">/)
		assert.match(doc.html, /Texto final/)
		assert.equal(doc.toc.at(-1)?.text, heading)
		assert.equal((await textHeadings(markdown)).get(doc.toc.at(-1)!.id), heading)
	})
}

test('the real changelog renders headings after the textarea example', async () => {
	const doc = await renderSource('packages/meeko/CHANGELOG.md')
	assert.match(doc.html, /&lt;textarea&gt;/)
	assert.doesNotMatch(doc.html, /<textarea(?:\s|>)/i)
	assert.equal(doc.toc.at(-1)?.text, '0.0.1')
	assert.match(doc.html, /<h2 id="001">0\.0\.1/)
})

test('script, style, pre and generic examples stay text while authored anchors remain HTML', async () => {
	const markdown = '# Title\n\n<script>alert(1)</script>\n\n<style>body { color: red }</style>\n\n<pre>sample</pre>\n\nSignal<T> and `.meeko` files.\n\n<a id="real-anchor"></a>\n\n<details><summary>Nota</summary>Texto</details>\n\n```html\n<textarea>literal</textarea>\n```\n\n## Final\n'
	const doc = await renderMarkdown(markdown, 'docs/doctor.md')
	for (const tag of ['script', 'style', 'pre']) {
		assert.match(doc.html, new RegExp(`&lt;${tag}&gt;`))
		assert.doesNotMatch(doc.html, new RegExp(`<${tag}>`, 'i'))
	}
	assert.match(doc.html, /Signal&lt;T&gt;/)
	assert.match(doc.html, /<code>\.meeko<\/code>/)
	assert.match(doc.html, /<a id="real-anchor"><\/a>/)
	assert.match(doc.html, /<details><summary>Nota<\/summary>Texto<\/details>/)
	assert.match(doc.html, /<div class="code-block" data-lang="html">/)
	assert.match(doc.html, /&#x3C;/)
	assert.equal((await textHeadings(markdown)).get('real-anchor'), 'real-anchor')
	assert.equal(doc.toc.at(-1)?.id, 'final')
})

test('external fragments still escape all raw HTML', async () => {
	const html = await renderFragment('<details>one</details> <script>alert(1)</script>', 'docs/doctor.md')
	assert.doesNotMatch(html, /<(?:details|script)>/)
	assert.match(html, /&lt;details&gt;/)
})

test('unclosed raw-text tags cannot consume the remaining document', async () => {
	for (const tag of ['textarea', 'script', 'style', 'pre']) {
		const markdown = `# Start\n\n<${tag}>\n\n## Still here\n\nEnd.\n`
		const doc = await renderMarkdown(markdown, 'docs/doctor.md')
		assert.match(doc.html, new RegExp(`&lt;${tag}&gt;`))
		assert.match(doc.html, /<h2 id="still-here">/)
		assert.equal(doc.toc.at(-1)?.id, 'still-here')
		assert.equal((await textHeadings(markdown)).get('still-here'), 'Still here')
	}
})

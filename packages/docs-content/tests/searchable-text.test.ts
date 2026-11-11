import assert from 'node:assert/strict'
import test from 'node:test'

import { searchableText, searchExcerpt } from '../src/db/snapshots'

test('the indexed text leaves out routes, sources and the outlines of icons', () => {
	const text = searchableText('/docs/reference', {
		groups: [
			{
				id: 'reactivity',
				title: 'Reactividad',
				icon: 'M9 1.75 3.75 9h4l-1 5.25L12.25 7h-4Z',
				items: [{ name: 'signal', href: '/docs/reference/signal', summary: 'Crea una señal.' }],
			},
		],
		// In a field that does not say so: a value that is only a route, a path, a URL or an outline.
		page: { to: '/docs/signal', file: 'docs/framework.md', link: 'https://meekojs.com/x', shape: 'M8 2 14 5 8 8 2 5Z M2 8l6 3 6-3' },
	})
	assert.equal(text, 'Reactividad signal Crea una señal.')
})

test('the indexed text decodes every entity once, also those that Shiki writes as numbers', () => {
	const text = searchableText('/docs/x', {
		doc: { html: '<pre><code><span>&#x3C;template></span> &#60;p> &lt;b&gt; a &amp; b &amp;lt; &nbsp;c &#39;d&#39;</code></pre>' },
	})
	assert.equal(text, "<template> <p> <b> a & b &lt; c 'd'")
})

test('prose that looks a little like a path stays', () => {
	const text = searchableText('/docs/x', {
		doc: { title: 'E/S', body: 'Usa / para separar', word: 'Modelo', sentence: 'M y otras letras' },
	})
	assert.equal(text, 'E/S Usa / para separar Modelo M y otras letras')
})

test('the home and the plain text files are not indexed', () => {
	assert.equal(searchableText('/', { doc: { title: 'Inicio' } }), '')
	assert.equal(searchableText('/llms.txt', { doc: { title: 'Texto' } }), '')
})

test('rendered copy controls do not become searchable content', () => {
	const text = searchableText('/docs/hydrate', {
		doc: { html: '<p>Hydrate la aplicación.</p><div class="code-block"><div class="code-head" data-pagefind-ignore><span>meeko</span><button type="button" data-copy>Copiar</button></div><pre>hydrate()</pre></div>' },
	})
	assert.equal(text, 'Hydrate la aplicación. hydrate()')
})

test('search excerpts discard partial words at either edge', () => {
	const source = 'Primera introducción completa sobre hidratación, señales y tareas pendientes en aplicaciones grandes.'
	const start = 16
	const window = source.slice(start - 1, 75)
	assert.equal(searchExcerpt(window, start, source.length), '…completa sobre hidratación, señales y tareas…')
	assert.equal(searchExcerpt(source, 1, source.length), source)
})

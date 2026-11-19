import assert from 'node:assert/strict'
import test from 'node:test'

import { searchDocs } from '../app/utils/search.ts'

test('search highlights accents safely and keeps the requested locale', async () => {
	const original = globalThis.fetch
	let requested
	globalThis.fetch = async (url) => {
		requested = url
		return Response.json([
			{ url: '/en/docs/hydrate', title: 'Hydrate', excerpt: 'Para hidratación usa <script> y señales.', sections: [] },
		])
	}
	try {
		const [result] = await searchDocs('hidratacion', 'en')
		assert.equal(requested, '/api/docs/search?q=hidratacion&locale=en')
		assert.equal(result.excerpt, 'Para <mark>hidratación</mark> usa &lt;script&gt; y señales.')
	} finally {
		globalThis.fetch = original
	}
})

test('search returns no rows for an empty response', async () => {
	const original = globalThis.fetch
	globalThis.fetch = async () => Response.json([])
	try {
		assert.deepEqual(await searchDocs('sin coincidencias'), [])
	} finally {
		globalThis.fetch = original
	}
})

test('search marks hydrate and tareas without changing the result URLs', async () => {
	const original = globalThis.fetch
	globalThis.fetch = async () =>
		Response.json([
			{ url: '/docs/hydrate', title: 'Hydrate', excerpt: 'Use hydrate en el cliente.', sections: [] },
			{ url: '/docs/tareas', title: 'Tareas', excerpt: 'Las tareas se ejecutan al cargar.', sections: [] },
		])
	try {
		const hydrate = await searchDocs('hydrate')
		assert.equal(hydrate[0].excerpt, 'Use <mark>hydrate</mark> en el cliente.')
		assert.equal(hydrate[0].url, '/docs/hydrate')
		const tasks = await searchDocs('tareas')
		assert.equal(tasks[1].excerpt, 'Las <mark>tareas</mark> se ejecutan al cargar.')
		assert.equal(tasks[1].url, '/docs/tareas')
	} finally {
		globalThis.fetch = original
	}
})

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { discoverAutoImports } from '../src/autoimports/registry.ts'
import { applyAutoImports } from '../src/autoimports/transform.ts'
import { createId } from '../src/index.ts'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function withCrypto<T>(crypto: unknown, run: () => T): T {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!
	Object.defineProperty(globalThis, 'crypto', { value: crypto, configurable: true })
	try {
		return run()
	} finally {
		Object.defineProperty(globalThis, 'crypto', descriptor)
	}
}

test('createId is a public function usable from ordinary functions without component context', () => {
	function createItem() {
		return { id: createId() }
	}
	const ids = Array.from({ length: 20_000 }, () => createItem().id)
	assert.equal(new Set(ids).size, ids.length)
	assert.ok(ids.every((id) => uuid.test(id)))
})

test('uses native randomUUID and preserves its failures', () => {
	const expected = '3d17fca4-a544-4937-a47c-e9c32fbe4638'
	assert.equal(
		withCrypto({ randomUUID: () => expected }, () => createId()),
		expected,
	)
	assert.throws(
		() =>
			withCrypto(
				{
					randomUUID: () => {
						throw new Error('entropy failure')
					},
				},
				() => createId(),
			),
		/entropy failure/,
	)
})

test('the browser fallback uses cryptographic bytes with UUID version and variant bits', () => {
	for (const [byte, expected] of [
		[0, '00000000-0000-4000-8000-000000000000'],
		[255, 'ffffffff-ffff-4fff-bfff-ffffffffffff'],
	] as const) {
		const id = withCrypto({ getRandomValues: (bytes: Uint8Array) => bytes.fill(byte) }, () => createId())
		assert.equal(id, expected)
		assert.match(id, uuid)
	}
	assert.throws(() => withCrypto(undefined, () => createId()), /Web Crypto/)
})

test('createId is autoimported in app, shared and server code and yields to an explicit project export', async () => {
	const root = await mkdtemp(join(tmpdir(), 'meeko-create-id-'))
	try {
		await writeFile(join(root, 'package.json'), '{"type":"module"}')
		const registry = await discoverAutoImports(root)
		for (const [file, scope] of [
			['app/utils/items.ts', 'client'],
			['shared/items.ts', 'shared'],
			['server/api/items.post.ts', 'server'],
		] as const) {
			assert.match(applyAutoImports('export function createItem(){ return createId() }', join(root, file), registry, scope), /import \{ createId as createId \} from "@meekojs\/meeko"/)
		}
		await mkdir(join(root, 'app', 'utils'), { recursive: true })
		await writeFile(join(root, 'app', 'utils', 'id.ts'), 'export const createId=()=>"local"')
		const own = await discoverAutoImports(root)
		const code = applyAutoImports('const id=createId()', join(root, 'app', 'pages', 'index.meeko'), own, 'client')
		assert.match(code, /utils\/id/)
		assert.doesNotMatch(code, /from "@meekojs\/meeko"/)
	} finally {
		await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
	}
})

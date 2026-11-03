import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const source = join(root, 'packages/ui/src')

// `@meekojs/ui` never shipped a 0.x.
test('no public declaration of UI says it arrived in a 0.x version that never shipped', () => {
	const stale = readdirSync(source, { recursive: true })
		.map((file) => join(source, String(file)))
		.filter((file) => /\.(?:ts|meeko)$/.test(file))
		.filter((file) => /@since 0\./.test(readFileSync(file, 'utf8')))
	assert.deepEqual(stale, [])
})

test('the documentation and the changelog do not name UI 0.2', () => {
	for (const file of ['docs/packages.md', 'docs/en/packages.md', 'apps/ui/app/pages/feedback.meeko', 'apps/ui/app/pages/en/feedback.meeko', 'packages/ui/CHANGELOG.md']) {
		assert.doesNotMatch(readFileSync(join(root, file), 'utf8'), /\bUI 0\.2\b/, file)
	}
})

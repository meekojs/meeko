import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { format } from 'prettier'

import plugin from '../dist/index.js'

// The fixture resolves tailwindcss and @tailwindcss/postcss from packages/meeko, as a project would.
const fixture = fileURLToPath(new URL('../../meeko/tests/fixtures/tailwind-app/', import.meta.url))

test('meekoSortClasses tailwind orders with the project design system', async () => {
	const source = '<template>\n<p class="text-white custom p-gutter bg-brand flex custom">x</p>\n</template>\n'
	const options = { filepath: `${fixture}app/components/Probe.meeko`, plugins: [plugin], meekoSortClasses: 'tailwind' }
	const formatted = await format(source, options)
	assert.equal(formatted, '<template>\n<p class="custom flex bg-brand p-gutter text-white">x</p>\n</template>\n')
	assert.equal(await format(formatted, options), formatted)
})

test('the plugin declares the tailwind choice and the stylesheet option', () => {
	assert.ok(plugin.options.meekoSortClasses.choices.some((choice) => choice.value === 'tailwind'))
	assert.equal(plugin.options.meekoTailwindStylesheet.type, 'string')
})

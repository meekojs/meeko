import { appearance, buttonAppearance, variants } from '@meekojs/ui/theme'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { tv } from 'tailwind-variants/lite'

test('appearance selects only requested keys and returns independent records', () => {
	const selection = appearance({ color: ['neutral', 'rose'], radius: true, size: false }).variants
	assert.deepEqual(selection, { color: { neutral: 'ui-neutral', rose: 'ui-rose' }, radius: variants.radius })
	delete selection.radius.md
	assert.equal(variants.radius.md, 'rounded-md')
	assert.deepEqual(appearance({}).variants, {})
	assert.deepEqual(appearance({ color: [] }).variants, { color: {} })
})

test('appearance composes with slots, local variants and compound variants', () => {
	const select = tv({
		slots: { base: 'relative', trigger: 'flex' },
		variants: {
			...appearance({ color: true }).variants,
			size: { sm: { trigger: 'h-7' } },
		},
		compoundVariants: [{ color: 'success', size: 'sm', class: { trigger: 'rounded-sm' } }],
	})
	const slots = select({ color: 'success', size: 'sm' })
	assert.equal(slots.base(), 'relative ui-success')
	assert.equal(slots.trigger(), 'flex h-7 rounded-sm')
	assert.match(buttonAppearance({ color: 'rose', variant: 'solid', radius: '3xl' }), /ui-rose.*rounded-3xl/)
})

test('the published stylesheet includes every catalog class and its palette steps', async () => {
	const css = await readFile(new URL('../dist/styles/main.css', import.meta.url), 'utf8')
	for (const group of Object.values(variants)) {
		for (const classes of Object.values(group)) {
			for (const utility of classes.split(' ').filter(Boolean)) {
				const selector = '.' + utility.replace(/[^\w-]/g, '\\$&')
				assert.ok(css.includes(selector), utility)
			}
		}
	}
	assert.match(css, /\.ui-neutral\s*\{\s*--ui-1: var\(--ui-color-surface-1\)/)
	assert.match(css, /--ui-color-rose-9: oklch\(/)
	assert.match(css, /:root\[data-theme='dark'\][\s\S]*?--ui-color-rose-9: oklch\(/)
	assert.doesNotMatch(css, /--ui-color-[\w-]+: undefined/)
})

test('the published types constrain Tailwind Variants to the selected keys and values', { timeout: 30_000 }, async () => {
	const compiler = fileURLToPath(new URL('./node_modules/typescript/bin/tsc', new URL('../', import.meta.url)))
	const fixture = fileURLToPath(new URL('./appearance.types.ts', import.meta.url))
	await promisify(execFile)(process.execPath, [compiler, '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'es2022', '--strict', '--skipLibCheck', '--noEmit', fixture], { timeout: 25_000 })
})

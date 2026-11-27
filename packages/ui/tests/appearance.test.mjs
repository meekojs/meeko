import { appearance, buttonTheme, colorCompoundVariants, defineTheme, iconButtonTheme, variants } from '@meekojs/ui/theme'
import { hueCompoundVariants, hueNames, hues } from '@meekojs/ui/theme/hues'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const semantic = ['primary', 'secondary', 'neutral', 'success', 'info', 'warning', 'danger']
const treatments = ['solid', 'soft', 'outline', 'ghost', 'surface', 'subtle', 'link', 'plain', 'glass']

test('the catalog names the semantic colors, the treatments and the control sizes', () => {
	assert.deepEqual(Object.keys(variants.color), semantic)
	assert.deepEqual(Object.keys(variants.variant), treatments)
	assert.deepEqual(Object.keys(variants.size), ['xs', 'sm', 'md', 'lg', 'xl'])
	for (const key of ['color', 'variant']) for (const classes of Object.values(variants[key])) assert.equal(classes, '', `${key} paints only through compound variants`)
	assert.equal(variants.size.lg, 'min-h-(--ui-control-height-lg) p-(--ui-control-padding-lg) text-control-lg')
	// Solo utilidades de Tailwind: nada de clases propias ui-<color> ni de las variables --ui-1…12.
	const catalog = JSON.stringify([variants, colorCompoundVariants, hueCompoundVariants])
	assert.doesNotMatch(catalog, /\bui-(?:primary|neutral|gray|rose)\b|--ui-\d|--ui-contrast|--ui-gradient/)
})

test('every color has one literal entry per painted treatment, built from the same steps', () => {
	const painted = treatments.filter((variant) => variant !== 'plain')
	const pairs = (entries) => entries.map(({ color, variant }) => `${color}/${variant}`)
	assert.deepEqual(
		pairs(colorCompoundVariants),
		semantic.flatMap((color) => painted.map((variant) => `${color}/${variant}`)),
	)
	assert.deepEqual(
		pairs(hueCompoundVariants),
		hueNames.flatMap((color) => painted.map((variant) => `${color}/${variant}`)),
	)

	const template = Object.fromEntries(colorCompoundVariants.filter(({ color }) => color === 'primary').map(({ variant, class: className }) => [variant, className]))
	for (const entry of [...colorCompoundVariants, ...hueCompoundVariants]) assert.equal(entry.class, template[entry.variant].replaceAll('primary', entry.color), `${entry.color}/${entry.variant}`)

	assert.equal(template.solid, 'border-transparent bg-primary-9 text-primary-contrast not-disabled:hover:bg-primary-10 not-disabled:active:bg-primary-10')
	assert.match(template.glass, /\bbg-gray-a3\b.*\btext-primary-11\b/)
})

test('the raw hues are the Radix Colors scales and stay apart from the semantic colors', () => {
	assert.deepEqual(hueNames, ['gray', 'mauve', 'slate', 'sage', 'olive', 'sand', 'tomato', 'red', 'ruby', 'crimson', 'pink', 'plum', 'purple', 'violet', 'iris', 'indigo', 'blue', 'cyan', 'teal', 'jade', 'green', 'grass', 'brown', 'bronze', 'gold', 'sky', 'mint', 'lime', 'yellow', 'amber', 'orange'])
	assert.equal(hues.names, hueNames)
	assert.equal(hues.compoundVariants, hueCompoundVariants)
	assert.deepEqual(
		semantic.filter((color) => hueNames.includes(color)),
		[],
	)
})

test('every color step of the catalog is a token of the sheet that generates its classes', async () => {
	const sheet = (name) => readFile(new URL(`../src/app/styles/${name}`, import.meta.url), 'utf8')
	const declared = (css) => new Set([...css.matchAll(/(--color-[\w-]+):/g)].map(([, name]) => name))
	const main = declared(await sheet('theme.css'))
	const raw = declared(await sheet('hues.css'))
	const used = (entries) => new Set(entries.flatMap(({ class: className }) => [...className.matchAll(/(?:^|[\s:])(?:bg|text|border)-([a-z]+-(?:a?\d+|contrast))\b/g)].map(([, token]) => `--color-${token}`)))
	for (const token of used(colorCompoundVariants)) assert.ok(main.has(token), `theme.css declares ${token}`)
	for (const token of used(hueCompoundVariants)) assert.ok(token.startsWith('--color-gray-a') ? main.has(token) : raw.has(token), `${token} is declared once, where its classes are generated`)
	// The alpha gray is always there, in the main entry; the raw gray only with the hues.
	for (const step of Array.from({ length: 12 }, (_, index) => index + 1)) {
		assert.ok(main.has(`--color-gray-a${step}`) && !raw.has(`--color-gray-a${step}`), `gray-a${step}`)
		assert.ok(raw.has(`--color-gray-${step}`) && !main.has(`--color-gray-${step}`), `gray-${step}`)
	}
})

test('appearance selects only requested keys and returns independent records', () => {
	const selection = appearance({ color: ['neutral', 'info'], radius: true, size: false }).variants
	assert.deepEqual(selection, { color: { neutral: '', info: '' }, radius: variants.radius })
	delete selection.radius.md
	assert.equal(variants.radius.md, 'rounded-md')
	assert.deepEqual(appearance({}), { variants: {}, compoundVariants: [] })
	assert.deepEqual(appearance({ color: [] }).variants, { color: {} })
	assert.deepEqual(appearance({ color: ['rose'] }).variants, { color: {} }, 'an unknown value is ignored at runtime too')
})

test('appearance keeps only the compound variants of the chosen colors and treatments', () => {
	const { compoundVariants } = appearance({ variant: ['soft', 'outline', 'plain'], color: ['primary', 'danger'] })
	assert.deepEqual(
		compoundVariants.map(({ color, variant }) => `${color}/${variant}`),
		['primary/soft', 'primary/outline', 'danger/soft', 'danger/outline'],
	)
	assert.equal(compoundVariants[0].class, colorCompoundVariants.find(({ color, variant }) => color === 'primary' && variant === 'soft').class)
	assert.equal(appearance({ variant: true, color: true }).compoundVariants.length, semantic.length * (treatments.length - 1))
	assert.deepEqual(appearance({ variant: true }).compoundVariants, [], 'without colors nothing paints')
	assert.deepEqual(appearance({ color: true }).compoundVariants, [], 'without treatments nothing paints')
	assert.deepEqual(appearance({ variant: ['plain'], color: true }).compoundVariants, [])
	compoundVariants[0].class = 'changed'
	assert.notEqual(colorCompoundVariants[1].class, 'changed')
})

test('the raw hues are opt-in through the palette', () => {
	assert.deepEqual(Object.keys(appearance({ color: true }).variants.color), semantic)
	const withHues = appearance({ color: true, variant: ['solid'] }, { hues })
	assert.deepEqual(Object.keys(withHues.variants.color), [...semantic, ...hueNames])
	assert.equal(withHues.compoundVariants.length, semantic.length + hueNames.length)

	const tag = defineTheme({ ...appearance({ variant: ['soft'], color: ['primary', 'crimson'] }, { hues }) })
	assert.equal(tag({ variant: 'soft', color: 'crimson' }), 'border-transparent bg-crimson-3 text-crimson-11 not-disabled:hover:bg-crimson-4 not-disabled:active:bg-crimson-5')
	assert.match(tag({ variant: 'soft', color: 'primary' }), /\bbg-primary-3\b/)
})

test('appearance sends its classes to the chosen slot of a recipe with slots', () => {
	const selection = appearance({ variant: ['outline'], color: ['success'], size: ['sm'] }, { slot: 'trigger' })
	assert.deepEqual(selection.variants.size, { sm: { trigger: variants.size.sm } })
	assert.deepEqual(selection.variants.color, { success: '' })
	assert.deepEqual(selection.compoundVariants[0].class, { trigger: colorCompoundVariants.find(({ color, variant }) => color === 'success' && variant === 'outline').class })

	const select = defineTheme({
		slots: { base: 'relative', trigger: 'flex' },
		...selection,
		compoundVariants: [...selection.compoundVariants, { color: 'success', size: 'sm', class: { trigger: 'rounded-sm' } }],
	})
	const slots = select({ variant: 'outline', color: 'success', size: 'sm' })
	assert.equal(slots.base(), 'relative')
	assert.match(slots.trigger(), /^flex min-h-\(--ui-control-height-sm\) p-\(--ui-control-padding-sm\) text-control-sm border-\(length:--ui-border-width\) border-success-7 text-success-11 .* rounded-sm$/)

	const root = defineTheme({ slots: { base: 'relative', icon: 'size-4' }, ...appearance({ variant: ['solid'], color: ['info'] }) })({ variant: 'solid', color: 'info' })
	assert.match(root.base(), /^relative .*bg-info-9/)
	assert.equal(root.icon(), 'size-4')
})

test('defineTheme merges the theme utilities with Tailwind Merge', () => {
	const recipe = defineTheme({ ...appearance({ variant: ['solid'], color: ['primary'], size: true }) })
	const classes = recipe({ variant: 'solid', color: 'primary', size: 'sm' }).split(' ')
	// text-control-sm es tamaño de fuente y text-primary-contrast es color: conviven.
	assert.ok(classes.includes('text-control-sm'))
	assert.ok(classes.includes('text-primary-contrast'))
	// La clase del consumidor gana a la de la receta.
	const custom = recipe({ variant: 'solid', color: 'primary', class: 'bg-red-9' }).split(' ')
	assert.ok(custom.includes('bg-red-9'))
	assert.ok(!custom.includes('bg-primary-9'))
	assert.ok(custom.includes('not-disabled:hover:bg-primary-10'), 'a different modifier is another property')
	// Dos colores de fondo se resuelven al último, también con pasos alfa.
	assert.equal(defineTheme({ base: 'bg-primary-9 bg-gray-a3' })(), 'bg-gray-a3')
	assert.equal(defineTheme({ base: 'bg-gray-a3 bg-danger-2' })(), 'bg-danger-2')
	// Dos tamaños de fuente o dos colores de texto se resuelven al último.
	assert.equal(defineTheme({ base: 'text-xs text-control-lg' })(), 'text-control-lg')
	assert.equal(defineTheme({ base: 'text-control-sm text-info-11 text-info-contrast' })(), 'text-control-sm text-info-contrast')
	assert.equal(defineTheme({ base: 'text-control text-control-md' })(), 'text-control text-control-md', 'text-control alone is the control color')
	// Pesos e interletrados propios de theme.css.
	assert.equal(defineTheme({ base: 'font-sans font-control font-bold' })(), 'font-sans font-bold')
	assert.equal(defineTheme({ base: 'tracking-snug tracking-display' })(), 'tracking-display')
	assert.equal(defineTheme({ base: 'max-w-4k max-w-sm' })(), 'max-w-sm')
	assert.match(buttonTheme({ color: 'danger', variant: 'solid', radius: '3xl', class: 'rounded-none' }), /rounded-none/)
	assert.doesNotMatch(buttonTheme({ color: 'danger', variant: 'solid', radius: '3xl', class: 'rounded-none' }), /rounded-3xl/)
})

test('the recipes keep the semantic colors and the shared catalog', () => {
	assert.deepEqual(Object.keys(buttonTheme.variants.color), semantic)
	assert.deepEqual(Object.keys(buttonTheme.variants.size), ['xs', 'sm', 'md', 'lg', 'xl'])
	assert.deepEqual(Object.keys(buttonTheme.variants.variant), ['solid', 'soft', 'surface', 'outline', 'subtle', 'ghost', 'link'])
	assert.deepEqual(Object.keys(iconButtonTheme.variants.variant), ['solid', 'soft', 'surface', 'outline', 'subtle', 'ghost'])
	assert.equal(buttonTheme(), buttonTheme({ variant: 'solid', color: 'primary', size: 'md', radius: 'md' }))
	assert.match(buttonTheme({ color: 'danger', variant: 'ghost', radius: 'full' }), /rounded-full.*text-danger-11/)
})

test('the published types constrain the recipes to the selected keys and values', { timeout: 60_000 }, async () => {
	const compiler = fileURLToPath(new URL('./node_modules/typescript/bin/tsc', new URL('../', import.meta.url)))
	const fixture = fileURLToPath(new URL('./appearance.types.ts', import.meta.url))
	await promisify(execFile)(process.execPath, [compiler, '--ignoreConfig', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'es2022', '--strict', '--skipLibCheck', '--noEmit', fixture], { timeout: 55_000 })
})

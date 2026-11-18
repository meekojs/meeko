import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { routeKey } from '../../meeko/dist/app/runtime/navigation.js'
import { compile } from '../../meeko/dist/compiler.js'
import { createRoot, provide } from '../../meeko/dist/index.js'
import { uiDefaultsKey } from '../dist/app/utils/defaults.js'
import { icons } from '../dist/app/utils/icons.js'
import { sparklineShape } from '../dist/app/utils/sparkline.js'
import { statChange, statTone } from '../dist/app/utils/stat.js'
import { sparkline, stat } from '../dist/app/variants/data.js'
import { validateDefaults } from '../dist/defaults.js'

const components = ['Popover', 'Tooltip', 'Hint', 'Sparkline', 'Stat']
const i18nKey = Symbol.for('meeko.i18n')

/** Compiles the real components and a page with `template`, and renders it in SSR with the given contexts. */
async function render(context, template, { defaults, locale } = {}) {
	const parent = fileURLToPath(new URL('../.meeko/', import.meta.url))
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(parent + 'stat-')
	context.after(() => rm(directory, { recursive: true, force: true }))
	const runtime = (path) => JSON.stringify(new URL(`../../meeko/dist/${path}`, import.meta.url).href)
	const write = async (file, source) => {
		const code = compile(source, `${directory}/${file}.meeko`)
			.code.replaceAll('from "@meekojs/meeko/internal"', `from ${runtime('internal.js')}`)
			.replaceAll('from "@meekojs/meeko"', `from ${runtime('index.js')}`)
			.replace(/from ["']\.\/(\w+)\.meeko["']/g, 'from "./$1.ts"')
			.replace(/from ["'](?:\.\.\/)+(utils|variants)\/([\w-]+)["']/g, (_, folder, utility) => `from ${JSON.stringify(new URL(`../dist/app/${folder}/${utility}.js`, import.meta.url).href)}`)
			.replace(/from ["']\.\/internal\/Icon\.meeko["']/g, 'from "./Icon.ts"')
		await writeFile(`${directory}/${file}.ts`, code)
	}
	await write('Icon', await readFile(new URL('../src/app/components/internal/Icon.meeko', import.meta.url), 'utf8'))
	for (const name of components) await write(name, await readFile(new URL(`../src/app/components/${name}.meeko`, import.meta.url), 'utf8'))
	const imports = components.map((name) => `import * as UI${name} from "./${name}.meeko"`).join('; ')
	await write('Page', `<script lang="ts">${imports}</script><template>${template}</template>`)
	const page = await import(pathToFileURL(`${directory}/Page.ts`).href)
	return createRoot(() => {
		provide(routeKey, {})
		if (defaults) provide(uiDefaultsKey, defaults)
		if (locale) provide(i18nKey, { locale })
		// Without the comments and the hydration markers, and without the whitespace between the tags.
		return page
			.renderToString({})
			.replace(/<!--.*?-->/g, '')
			.replace(/ data-meeko="[^"]*"/g, '')
			.replace(/>\s+</g, '><')
			.trim()
	})
}

/** The opening tag of the first element that matches `pattern`, and its attributes. */
function element(html, pattern) {
	const tag = html.match(new RegExp(`<${pattern}(?:\\s[^>]*)?>`))?.[0]
	assert.ok(tag, `no <${pattern}> in ${html}`)
	const attributes = Object.fromEntries([...tag.matchAll(/\s([\w:-]+)(?:="([^"]*)")?/g)].map(([, name, value]) => [name, value ?? '']))
	return { tag, attributes, classes: (attributes.class ?? '').split(' ') }
}

/** The text of an element, without tags and with its whitespace collapsed. */
const textOf = (html) =>
	html
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()

/** The <dd> elements of a stat, with their classes and content. */
const definitions = (html) => [...html.matchAll(/<dd class="([^"]*)">([\s\S]*?)<\/dd>/g)].map(([, classes, content]) => ({ classes: classes.split(' '), content }))

test('UIStat without the props of a key figure keeps its markup and its classes', async (context) => {
	// The classes of 1.10: the look of a stat does not change for the apps that already use it.
	assert.deepEqual(
		{ base: stat().base(), label: stat().label(), value: stat().value(), detail: stat().detail() },
		{
			base: 'ui:m-0 ui:grid ui:min-w-0 ui:font-sans ui:text-md ui:leading-normal ui:font-regular ui:text-text ui:[overflow-wrap:anywhere] ui:content-start ui:gap-1',
			label: 'ui:text-sm ui:text-text-soft',
			value: 'ui:m-0 ui:tabular-nums ui:text-2xl ui:font-semibold ui:tracking-tight',
			detail: 'ui:m-0 ui:tabular-nums ui:text-sm ui:text-text-soft',
		},
	)
	const html = await render(context, '<UIStat label="Visitas" bind:value="1400" detail="Esta semana" />')
	assert.equal(html, `<dl class="${stat().base()}"><dt class="${stat().label()}">Visitas</dt><dd class="${stat().value()}">1400</dd><dd class="${stat().detail()}">\n\t\t\tEsta semana\n\t\t</dd></dl>`)
	assert.doesNotMatch(html, /@container|svg|<a\b/)
})

test('UIStat with a change formats it in the locale, with its arrow, its tone and a sentence for screen readers', async (context) => {
	const html = await render(context, '<UIStat label="Ingresos" value="12 400 €" bind:change="12.5" period="frente a los 30 días anteriores" />')
	const root = element(html, 'dl')
	assert.ok(root.classes.includes('ui:@container'), 'a key figure is the container of its compact mode')
	assert.ok(root.classes.includes('ui:[contain-intrinsic-inline-size:var(--ui-stat-intrinsic-width)]'))
	assert.ok(!root.classes.includes('ui:grid-cols-[minmax(0,1fr)_auto]'), 'one column without a trend')
	const [, change] = definitions(html)
	assert.ok(change.classes.includes('ui:text-sm'))
	assert.match(change.content, /<span class="[^"]*ui:text-success-text[^"]*">/, 'up is good by default')
	assert.match(change.content, new RegExp(`<path d="${icons.arrowUp}"`))
	assert.match(change.content, /<span aria-hidden="true">\+12,5\u00a0%<\/span>/)
	assert.match(change.content, /<span class="ui:sr-only">Sube 12,5\u00a0%<\/span>/)
	assert.match(change.content, /<span>frente a los 30 días anteriores<\/span>/, 'the period, without a class of its own')

	// Down is bad, unless down is good; zero is neutral, with the arrow to the end of the line.
	const down = await render(context, '<UIStat label="Conversión" value="3 %" bind:change="-3" />')
	assert.match(down, /ui:text-danger-text/)
	assert.match(down, new RegExp(`<path d="${icons.arrowDown}"`))
	assert.match(down, /<span aria-hidden="true">-3\u00a0%<\/span><span class="ui:sr-only">Baja 3\u00a0%<\/span>/)
	const faster = await render(context, '<UIStat label="Tiempo de respuesta" value="180 ms" bind:change="-12" good="down" changeFormat="number" />')
	assert.match(faster, /ui:text-success-text/)
	assert.match(faster, /<span aria-hidden="true">-12<\/span><span class="ui:sr-only">Baja 12<\/span>/)
	const flat = await render(context, '<UIStat label="Errores" value="0" bind:change="0" />')
	assert.match(flat, /<span class="[^"]*ui:text-text[ "]/)
	assert.match(flat, new RegExp(`<svg[^>]*class="[^"]*ui:rtl:\\[scale:-1_1\\][^"]*"[^>]*><path d="${icons.arrowEnd}"`))
	assert.match(flat, /<span aria-hidden="true">0\u00a0%<\/span><span class="ui:sr-only">Sin cambios<\/span>/)

	// In English, the texts and the numbers of English.
	const english = await render(context, '<UIStat label="Revenue" value="$12,400" bind:change="1234.5" changeFormat="number" />', { locale: 'en' })
	assert.match(english, /<span aria-hidden="true">\+1,234\.5<\/span><span class="ui:sr-only">Up 1,234\.5<\/span>/)
})

test('UIStat takes a change already formatted, whose sign gives the direction, and changeDirection when it does not', async (context) => {
	const html = await render(context, '<UIStat label="Pedidos" value="320" change="−8 pedidos" />')
	assert.match(html, /ui:text-danger-text/)
	assert.match(html, /<span aria-hidden="true">−8 pedidos<\/span><span class="ui:sr-only">Baja 8 pedidos<\/span>/)
	const unsigned = await render(context, '<UIStat label="Puesto" value="3.º" change="2 puestos" changeDirection="down" good="down" />')
	assert.match(unsigned, /ui:text-success-text/)
	assert.match(unsigned, /<span class="ui:sr-only">Baja 2 puestos<\/span>/)
})

test('UIStat links its detail with a text of its own, named with the label, and keeps the links of its snippets apart', async (context) => {
	const html = await render(context, '<UIStat label="Visitas" bind:value="1400" href="/visitas" target="_blank" />')
	const link = element(html, 'a')
	assert.equal(link.attributes.href, '/visitas')
	assert.equal(link.attributes.rel, 'noopener noreferrer')
	assert.equal(link.attributes['aria-label'], 'Ver detalle: Visitas', 'the default text says nothing alone in a list of links')
	assert.ok(link.classes.includes('ui:focus-visible:outline-solid'))
	assert.equal(textOf(html.slice(html.indexOf('<a'))), 'Ver detalle')
	assert.ok(element(html, 'dl').classes.includes('ui:@container'), 'a link alone makes it a key figure')
	// Only the link is a link: the <dl> keeps its terms and the snippets can hold links of their own.
	assert.equal(html.match(/<a\b/g).length, 1)
	assert.ok(html.indexOf('<a') > html.indexOf('</dt>'))

	const own = await render(context, '<UIStat label="Visitas" bind:value="1400" href="/visitas" linkLabel="Ver todas las visitas" rel="external" />')
	assert.equal(element(own, 'a').attributes['aria-label'], undefined, 'an own text is the name as it is')
	assert.equal(element(own, 'a').attributes.rel, 'external')
	assert.match(own, />\s*Ver todas las visitas\s*<\/a>/)
	const english = await render(context, '<UIStat label="Visits" bind:value="1400" href="/visits" />', { locale: 'en' })
	assert.equal(element(english, 'a').attributes['aria-label'], 'View details: Visits')
})

test('UIStat draws its trend with a sparkline beside the value, in the tone of the change, and stacks it in a narrow container', async (context) => {
	const html = await render(context, '<UIStat label="Visitas" bind:value="1400" bind:change="-4" bind:trend="[3, 5, 4, 8]" />')
	const root = element(html, 'dl')
	assert.ok(root.classes.includes('ui:grid-cols-[minmax(0,1fr)_auto]'))
	const trend = definitions(html).find(({ content }) => content.includes('<svg role="img"'))
	assert.ok(trend.classes.includes('ui:col-[2]') && trend.classes.includes('ui:w-(--ui-stat-trend-width)'))
	assert.ok(trend.classes.includes('ui:@max-stat-narrow:col-span-full'), 'below the narrow size of the container, a row of its own')
	const svg = element(html, 'svg role="img"')
	assert.ok(svg.classes.includes('ui:text-danger-text'), 'the tone of the change')
	assert.equal(svg.attributes['aria-label'], 'Tendencia: mínimo 3, máximo 8, último 8')
	assert.match(html, /<path d="M[^"]+Z" class="[^"]*ui:fill-current/, 'the area under the line')
	assert.ok(element(html, 'dd').classes.includes('ui:@max-stat-narrow:text-xl'), 'a smaller value in compact mode')
	// Without a change, the accent; with trendLabel, a name of its own.
	const accent = await render(context, '<UIStat label="Visitas" bind:value="1400" bind:trend="[1, 2]" trendLabel="Visitas de la semana, al alza" />')
	assert.ok(element(accent, 'svg role="img"').classes.includes('ui:text-primary-text'))
	assert.equal(element(accent, 'svg role="img"').attributes['aria-label'], 'Visitas de la semana, al alza')
})

test('UISparkline is an image named by a summary of its series, as wide as its container and as tall as its token', async (context) => {
	const html = await render(context, '<UISparkline bind:values="[1200, 900.5, 1500]" bind:format="{ style: \'currency\', currency: \'EUR\', maximumFractionDigits: 0 }" />', { locale: 'en' })
	const svg = element(html, 'svg')
	assert.equal(svg.attributes.role, 'img')
	assert.equal(svg.attributes['aria-label'], 'Trend: minimum €901, maximum €1,500, latest €1,500')
	assert.equal(svg.attributes.viewBox, '0 0 100 32')
	assert.equal(svg.attributes.preserveAspectRatio, 'none')
	assert.deepEqual(svg.classes, sparkline().base().split(' '))
	assert.ok(svg.classes.includes('ui:w-full') && svg.classes.includes('ui:h-(--ui-sparkline-height)'), 'its size comes from CSS')
	const line = element(html, 'path')
	assert.equal(line.attributes.d, sparklineShape([1200, 900.5, 1500]).line)
	assert.ok(line.classes.includes('ui:[vector-effect:non-scaling-stroke]'), 'the stroke keeps its width when the box stretches')
	assert.ok(svg.classes.includes('ui:motion-reduce:animate-none'), 'no animation with reduced motion')
	assert.equal(html.match(/<path/g).length, 1, 'no area by default')

	const custom = await render(context, '<UISparkline bind:values="[]" label="Sin visitas todavía" tone="success" area class="mine" bind:ui="{ line: \'my-line\' }" />')
	assert.equal(element(custom, 'svg').attributes['aria-label'], 'Sin visitas todavía')
	assert.ok(element(custom, 'svg').classes.includes('ui:text-success-text') && element(custom, 'svg').classes.includes('mine'))
	assert.doesNotMatch(custom, /<path/, 'no paths without values')
	assert.equal(element(await render(context, '<UISparkline bind:values="[]" />'), 'svg').attributes['aria-label'], 'Sin datos')
	const styled = await render(context, '<UISparkline bind:values="[1, 2]" area bind:ui="{ line: \'my-line\' }" />', { defaults: { sparkline: { class: 'app-spark', ui: { area: 'app-area' } } } })
	assert.ok(element(styled, 'svg').classes.includes('app-spark'))
	assert.match(styled, /<path d="[^"]+" class="[^"]*app-area"/)
	assert.match(styled, /<path d="[^"]+" class="[^"]*my-line"/)
})

test('the geometry of a sparkline fills its box, scales between its bounds and keeps a flat series in the middle', () => {
	assert.deepEqual(sparklineShape([0, 10]), { line: 'M0,30L100,2', area: 'M0,30L100,2L100,32L0,32Z', summary: { min: 0, max: 10, last: 10 } })
	assert.equal(sparklineShape([5]).line, 'M0,16L100,16', 'one value is a flat line across')
	assert.equal(sparklineShape([4, 4, 4]).line, 'M0,16L50,16L100,16')
	assert.equal(sparklineShape([1, Number.NaN, 3, Infinity]).line, 'M0,30L100,2', 'values that are not finite are left out')
	assert.equal(sparklineShape([5, 10], { min: 0, max: 20 }).line, 'M0,23L100,16')
	assert.equal(sparklineShape([-5, 30], { min: 0, max: 20 }).line, 'M0,30L100,2', 'outside its bounds, a value stays in the box')
	assert.deepEqual(sparklineShape([]), { line: '', area: '', summary: undefined })
})

test('the change of a stat: its direction, its signed text and its magnitude', () => {
	assert.deepEqual(statChange(12.5, { locale: 'es' }), { direction: 'up', shown: '+12,5\u00a0%', magnitude: '12,5\u00a0%' })
	assert.deepEqual(statChange(0.01, { locale: 'es' }), { direction: 'flat', shown: '0\u00a0%', magnitude: '0\u00a0%' }, 'a change that rounds to zero is flat')
	assert.deepEqual(statChange(-3, { locale: 'en', format: 'number' }), { direction: 'down', shown: '-3', magnitude: '3' })
	assert.deepEqual(statChange('+4 pts', { locale: 'es' }), { direction: 'up', shown: '+4 pts', magnitude: '4 pts' })
	assert.equal(statChange('0 pts', { locale: 'es' }).direction, 'flat')
	assert.equal(statChange(5, { locale: 'es', direction: 'down' }).direction, 'down')
	assert.equal(statTone('up'), 'success')
	assert.equal(statTone('up', 'down'), 'danger')
	assert.equal(statTone('down', 'down'), 'success')
	assert.equal(statTone('flat', 'down'), 'neutral')
})

test('ui.defaults validates the slots of a key figure and of a sparkline', async (context) => {
	assert.doesNotThrow(() => validateDefaults({ stat: { ui: { change: 'a', delta: 'b', trend: 'c', link: 'd' } }, sparkline: { class: 'e', ui: { line: 'f' } } }))
	assert.throws(() => validateDefaults({ sparkline: { ui: { dot: 'x' } } }), /unknown slot dot in defaults\.sparkline\.ui; its slots are base, area, line/)
	assert.throws(() => validateDefaults({ stat: { tone: 'success' } }), /unknown option defaults\.stat\.tone/)
	const html = await render(context, '<UIStat label="Visitas" bind:value="1" bind:change="2" bind:ui="{ delta: \'mine\' }" />', { defaults: { stat: { ui: { change: 'app-change', delta: 'app-delta' } } } })
	assert.match(html, /<dd class="[^"]*app-change">/)
	assert.match(html, /<span class="[^"]*app-delta mine">/)
})

test('UIStat puts a UIHint after its label with hint, and the label snippet replaces the text of the term', async (context) => {
	const html = await render(context, '<UIStat label="Ingresos" hint="Ventas cobradas, sin impuestos" value="12 400 €" bind:ui="{ hint: \'my-hint\' }" />')
	const term = html.match(/<dt[^>]*>([\s\S]*?)<\/dt>/)?.[1] ?? ''
	assert.match(term, /^Ingresos<button/, 'the label first, with no line break before its hint')
	assert.match(term, /<button[^>]*aria-label="Más información"/, 'the hint is a UIHint, named by its default text')
	assert.match(term, /class="[^"]*ui:ms-1[^"]* my-hint/, 'a space away from the label, with ui.hint')
	assert.match(term, /Ventas cobradas, sin impuestos/)
	const custom = await render(context, '<UIStat label="Ingresos" value="12 400 €"><snippet name="label"><strong>Ingresos</strong> netos</snippet></UIStat>')
	assert.match(custom, /<dt[^>]*><strong>Ingresos<\/strong> netos<\/dt>/)
	const plain = await render(context, '<UIStat label="Visitas" bind:value="1400" />')
	assert.match(plain, /<dt class="[^"]*">Visitas<\/dt>/, 'without hint nor snippet, the term is its text alone')
})

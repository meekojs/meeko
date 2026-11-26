import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { routeKey } from '../../meeko/dist/app/runtime/navigation.js'
import { compile } from '../../meeko/dist/compiler.js'
import { createRoot, provide } from '../../meeko/dist/index.js'
import { uiDefaultsKey } from '../dist/app/utils/defaults.js'
import { icons } from '../dist/app/utils/icons.js'
import { validateDefaults } from '../dist/defaults.js'

const components = ['Popover', 'Tooltip', 'IconButton', 'Hint']
const i18nKey = Symbol.for('meeko.i18n')

/** Compiles the real components and a page with `template`, and renders it in SSR with the given contexts. */
async function render(context, template, { defaults, locale } = {}) {
	const parent = fileURLToPath(new URL('../.meeko/', import.meta.url))
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(parent + 'icon-button-')
	context.after(() => rm(directory, { recursive: true, force: true }))
	const runtime = (path) => JSON.stringify(new URL(`../../meeko/dist/${path}`, import.meta.url).href)
	const write = async (file, source) => {
		const code = compile(source, `${directory}/${file}.meeko`)
			.code.replaceAll('from "@meekojs/meeko/internal"', `from ${runtime('internal.js')}`)
			.replaceAll('from "@meekojs/meeko"', `from ${runtime('index.js')}`)
			.replace(/from ["']\.\/(\w+)\.meeko["']/g, 'from "./$1.ts"')
			.replace(/from ["'](?:\.\.\/)+(utils|theme(?:\/components)?)\/([\w-]+)["']/g, (_, folder, utility) => `from ${JSON.stringify(new URL(`../dist/app/${folder}/${utility}.js`, import.meta.url).href)}`)
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
		return page.renderToString({}).replace(/<!--.*?-->/g, '')
	})
}

/** The opening tag of the first element that matches `pattern`, and its attributes. */
function element(html, pattern) {
	const tag = html.match(new RegExp(`<${pattern}(?:\\s[^>]*)?>`))?.[0]
	assert.ok(tag, `no <${pattern}> in ${html}`)
	const attributes = Object.fromEntries([...tag.matchAll(/\s([\w:-]+)(?:="([^"]*)")?/g)].map(([, name, value]) => [name, value ?? '']))
	return { tag, attributes, classes: (attributes.class ?? '').split(' ') }
}

test('UIIconButton is a <button> named by its label, with its icon and a tooltip that does not describe it again', async (context) => {
	const html = await render(context, '<UIIconButton label="Cerrar" icon="close" />')
	const button = element(html, 'button')
	assert.equal(button.attributes['aria-label'], 'Cerrar')
	assert.equal(button.attributes.type, 'button')
	assert.equal(button.attributes['aria-describedby'], undefined, 'the tooltip repeats the name: it is not its description')
	assert.equal(button.attributes['aria-pressed'], undefined, 'not a toggle without pressed')
	assert.equal(button.attributes.title, undefined)
	// The tooltip is the label, and the browser that has Interest Invokers opens it without a script.
	const tooltip = element(html, 'span[^>]*role="tooltip"')
	assert.equal(button.attributes.interestfor, tooltip.attributes.id)
	assert.equal(tooltip.attributes.popover, 'hint')
	assert.match(html, /role="tooltip"[^>]*>Cerrar<\/span>/)
	// The icon of the package, hidden from the accessibility tree.
	assert.match(html, new RegExp(`<svg[^>]*aria-hidden="true"[^>]*>\\s*<path d="${icons.close}"`))
	// Neutral ghost by default, square, of the size md, with the primary accent when pressed.
	for (const name of ['bg-transparent', 'border-transparent', 'text-neutral-11', 'p-0', 'rounded-md', 'min-w-(--ui-control-height-md)', 'min-h-(--ui-control-height-md)', 'leading-tight', 'aria-pressed:bg-primary-3']) assert.ok(button.classes.includes(name), name)
	assert.ok(!button.classes.some((name) => name.startsWith('p-(')), 'no padding of a button with text')
	assert.doesNotMatch(html, /undefined/)
})

test('UIIconButton variant, color, size and radius are those of UIButton', async (context) => {
	const html = await render(context, '<UIIconButton label="Borrar" icon="close" variant="solid" color="danger" size="lg" radius="full" />')
	const { classes } = element(html, 'button')
	for (const name of ['bg-danger-9', 'text-danger-contrast', 'min-w-(--ui-control-height-lg)', 'min-h-(--ui-control-height-lg)', 'rounded-full', 'aria-pressed:bg-danger-10']) assert.ok(classes.includes(name), name)
	for (const name of ['bg-transparent', 'rounded-md', 'aria-pressed:bg-primary-3']) assert.ok(!classes.includes(name), name)
	const soft = element(await render(context, '<UIIconButton label="Avisar" icon="info" variant="soft" color="warning" size="xs" />'), 'button')
	for (const name of ['bg-warning-3', 'text-warning-11', 'min-w-(--ui-control-height-xs)', 'aria-pressed:bg-warning-3', 'aria-pressed:border-warning-7']) assert.ok(soft.classes.includes(name), name)
})

test('UIIconButton pressed is aria-pressed of a toggle, and a link never takes it', async (context) => {
	const html = await render(context, '<UIIconButton label="Fijar" icon="check" bind:pressed="true" /><UIIconButton label="Silenciar" icon="close" bind:pressed="false" />')
	const [on, off] = [...html.matchAll(/<button[^>]*>/g)].map(([tag]) => tag)
	assert.match(on, /aria-pressed="true"/)
	assert.match(off, /aria-pressed="false"/)
	const link = await render(context, '<UIIconButton label="Docs" icon="arrowEnd" href="/docs" target="_blank" />')
	const anchor = element(link, 'a')
	assert.equal(anchor.attributes.href, '/docs')
	assert.equal(anchor.attributes.rel, 'noopener noreferrer')
	assert.equal(anchor.attributes.type, undefined, 'type is for a <button>')
	assert.equal(anchor.attributes['aria-pressed'], undefined)
	assert.equal(anchor.attributes['aria-label'], 'Docs')
	assert.equal(anchor.attributes.interestfor, element(link, 'span[^>]*role="tooltip"').attributes.id)
})

test('UIIconButton pressed keeps the accent border under the pointer, also in outline and surface', async (context) => {
	const html = await render(context, '<UIIconButton label="A" icon="check" variant="outline" bind:pressed="true" /><UIIconButton label="B" icon="check" variant="surface" color="danger" bind:pressed="true" />')
	const [outline, surface] = [...html.matchAll(/<button[^>]*class="([^"]*)"/g)].map(([, value]) => value.split(' '))
	// `not-disabled:hover:border-*` of the catalog is more specific than `aria-pressed:border-*`: the pressed hover sets it again.
	assert.ok(outline.includes('not-disabled:hover:border-control-border') && outline.includes('aria-pressed:border-primary-7'))
	assert.ok(outline.includes('aria-pressed:not-disabled:hover:border-primary-7'), outline.join(' '))
	assert.ok(surface.includes('not-disabled:hover:border-danger-7') && surface.includes('aria-pressed:not-disabled:hover:border-danger-7'), surface.join(' '))
})

test('UIIconButton keeps the line height of the recipe with a font size of the instance', async (context) => {
	const html = await render(context, '<UIIconButton label="A" icon="check" class="text-sm" /><UIIconButton label="B" icon="check" class="leading-none" />')
	const [sized, spaced] = [...html.matchAll(/<button[^>]*class="([^"]*)"/g)].map(([, value]) => value.split(' '))
	assert.ok(sized.includes('text-sm') && !sized.includes('text-control-md') && sized.includes('leading-tight'), sized.join(' '))
	assert.ok(spaced.includes('leading-none') && !spaced.includes('leading-tight'), spaced.join(' '))
})

test('UIIconButton loading and disabled: busy keeps the focus, disabled is the native state', async (context) => {
	const html = await render(context, '<UIIconButton label="Guardar" icon="check" bind:loading="true" /><UIIconButton label="Enviar" icon="arrowEnd" type="submit" disabled />')
	const [busy, disabled] = [...html.matchAll(/<button[^>]*>/g)].map(([tag]) => tag)
	assert.match(busy, /aria-busy="true"/)
	assert.match(busy, /aria-disabled="true"/)
	assert.doesNotMatch(busy, /\sdisabled(?=[\s=>])/)
	assert.match(disabled, /\sdisabled(?:=""|\s|>)/)
	assert.match(disabled, /type="submit"/)
})

test('UIIconButton without tooltip keeps its name; its own id, icon path and snippet reach the action', async (context) => {
	const bare = await render(context, '<UIIconButton label="Menú" icon="menu" bind:tooltip="false" />')
	assert.doesNotMatch(bare, /role="tooltip"|interestfor/)
	assert.equal(element(bare, 'button').attributes['aria-label'], 'Menú')
	const own = await render(context, '<UIIconButton id="search" label="Buscar" icon="M2 2h12" data-testid="find" aria-describedby="note" />')
	const button = element(own, 'button')
	assert.equal(button.attributes.id, 'search', 'the id of the instance is the id of the trigger')
	assert.equal(button.attributes['data-testid'], 'find')
	assert.equal(button.attributes['aria-describedby'], 'note', 'a description of its own still reaches it')
	assert.match(own, /<path d="M2 2h12"/)
	const snippet = await render(context, '<UIIconButton label="Estrella"><svg viewBox="0 0 16 16" aria-hidden="true" class="star"><circle r="4" /></svg></UIIconButton>')
	assert.match(snippet, /<button[^>]*><svg viewBox="0 0 16 16" aria-hidden="true" class="star">/)
})

test('UIIconButton takes class, ui and the variants of ui.defaults.iconButton; the instance wins', async (context) => {
	const defaults = { iconButton: { variant: 'outline', size: 'sm', class: 'app-icon', ui: { icon: 'app-glyph', tooltip: 'app-tip' } } }
	validateDefaults(defaults)
	const html = await render(context, '<UIIconButton label="Uno" icon="close" /><UIIconButton label="Dos" icon="close" variant="surface" class="mine" bind:ui="{ base: \'my-base\', icon: \'my-glyph\' }" />', { defaults })
	const [first, second] = [...html.matchAll(/<button[^>]*class="([^"]*)"/g)].map(([, value]) => value.split(' '))
	assert.ok(first.includes('border-control-border'), 'outline of ui.defaults')
	assert.ok(first.includes('min-w-(--ui-control-height-sm)'), 'size of ui.defaults')
	assert.ok(first.includes('app-icon'))
	assert.ok(second.includes('bg-neutral-2'), 'the variant of the instance wins')
	assert.ok(!second.includes('border-control-border'))
	// As in every component: the slot base first, then the class of ui.defaults and the one of the instance.
	assert.ok(second.includes('my-base'))
	assert.ok(second.indexOf('app-icon') < second.indexOf('mine'), second.join(' '))
	assert.match(html, /<svg[^>]*class="[^"]*app-glyph my-glyph"/)
	assert.match(html, /role="tooltip"[^>]*class="[^"]*app-tip/)
	assert.throws(() => validateDefaults({ iconButton: { tone: 'danger' } }), /unknown option defaults\.iconButton\.tone; iconButton accepts class, ui, variant, color, size, radius/)
	assert.throws(() => validateDefaults({ iconButton: { shape: 'pill' } }), /unknown option defaults\.iconButton\.shape/)
	assert.throws(() => validateDefaults({ iconButton: { variant: 'link' } }), /invalid defaults\.iconButton\.variant; use one of solid, soft, surface, outline, subtle, ghost/)
	assert.throws(() => validateDefaults({ iconButton: { color: 'crimson' } }), /invalid defaults\.iconButton\.color/)
	validateDefaults({ iconButton: { color: 'danger', radius: 'full', size: 'xl' } })
	assert.throws(() => validateDefaults({ hint: { ui: { label: 'x' } } }), /unknown slot label in defaults\.hint\.ui; its slots are base, icon, tooltip/)
})

test('UIHint is a button named by the UI texts and described by its help, of the size of the text around it', async (context) => {
	const html = await render(context, '<h2>Ingresos <UIHint text="Sin impuestos ni devoluciones." /></h2>')
	const button = element(html, 'button')
	const tooltip = element(html, 'span[^>]*role="tooltip"')
	assert.equal(button.attributes['aria-label'], 'Más información')
	assert.equal(button.attributes['aria-describedby'], tooltip.attributes.id, 'the help is its description')
	assert.equal(button.attributes.interestfor, tooltip.attributes.id)
	assert.equal(button.attributes.type, 'button')
	assert.match(html, /role="tooltip"[^>]*>Sin impuestos ni devoluciones\.<\/span>/)
	assert.match(html, new RegExp(`<svg[^>]*class="[^"]*size-\\(--ui-icon-size-text\\)[^"]*"[^>]*>\\s*<path d="${icons.info.replace(/\./g, '\\.')}"`))
	for (const name of ['align-(--ui-icon-text-align)', 'cursor-help', 'text-text-soft', 'before:-inset-(--ui-hint-hit-area)']) assert.ok(button.classes.includes(name), name)
	// Phrasing content: the heading keeps the button and the tooltip inside it.
	assert.match(html, /^<h2>Ingresos <button[^>]*>[\s\S]*<\/button><span[^>]*>[^<]*<\/span><\/h2>$/)
})

test('UIHint takes a label, a placement, a snippet, its id, the texts of the locale and ui.defaults.hint', async (context) => {
	const html = await render(context, '<UIHint id="margin" label="Qué es el margen" placement="right" class="mine" bind:ui="{ tooltip: \'my-tip\' }">Ingresos menos <em>costes</em>.</UIHint>', { defaults: { hint: { class: 'app-hint', ui: { icon: 'app-glyph' } } } })
	const button = element(html, 'button')
	assert.equal(button.attributes.id, 'margin')
	assert.equal(button.attributes['aria-label'], 'Qué es el margen')
	assert.ok(button.classes.indexOf('app-hint') < button.classes.indexOf('mine'))
	assert.match(html, /<svg[^>]*class="[^"]*app-glyph"/)
	const tooltip = element(html, 'span[^>]*role="tooltip"')
	assert.ok(tooltip.classes.includes('my-tip'))
	assert.ok(tooltip.classes.includes('[position-area:right]'))
	assert.match(html, /role="tooltip"[^>]*>Ingresos menos <em>costes<\/em>\.<\/span>/)
	const english = await render(context, '<UIHint text="Before taxes" />', { locale: 'en' })
	assert.equal(element(english, 'button').attributes['aria-label'], 'More information')
})

test('UIIconButton and UIHint public types', () => {
	const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
	execFileSync(process.execPath, [tsc, '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--allowImportingTsExtensions', '--allowArbitraryExtensions', '--module', 'nodenext', '--target', 'es2022', fileURLToPath(new URL('./types/icon-button.ts', import.meta.url))], { stdio: 'pipe' })
})

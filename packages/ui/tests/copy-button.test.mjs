import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { routeKey } from '../../meeko/dist/app/runtime/navigation.js'
import { compile } from '../../meeko/dist/compiler.js'
import { createRoot, provide } from '../../meeko/dist/index.js'
import { canCopy, copyFeedbackTime } from '../dist/app/utils/clipboard.js'
import { uiDefaultsKey } from '../dist/app/utils/defaults.js'
import { icons } from '../dist/app/utils/icons.js'
import { uiMessagesKey } from '../dist/app/utils/messages.js'
import { validateDefaults } from '../dist/defaults.js'

const components = ['Popover', 'Tooltip', 'IconButton', 'Button', 'CopyButton']

/** Compiles the real components and a page with `template`, and renders it in SSR with the given contexts. */
async function render(context, template, { defaults, messages } = {}) {
	const parent = fileURLToPath(new URL('../.meeko/', import.meta.url))
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(parent + 'copy-button-')
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
		if (messages) provide(uiMessagesKey, messages)
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

test('UICopyButton waits hidden in SSR, as a neutral surface <button> with the UI text and an empty status region', async (context) => {
	const html = await render(context, '<UICopyButton value="pnpm add @meekojs/ui" />')
	const button = element(html, 'button')
	assert.equal(button.attributes.type, 'button')
	assert.equal(button.attributes['data-copy-state'], 'idle')
	// Without the script it cannot copy: hidden, keeping its place, so hydration moves nothing.
	assert.ok(button.classes.includes('invisible'), button.tag)
	// The look of a neutral surface UIButton, and the colors of the result where the text is not on a solid.
	for (const name of ['bg-neutral-2', 'border-neutral-6', 'text-neutral-11', 'data-[copy-state=copied]:[color:var(--ui-copy-button-copied-color)]', 'data-[copy-state=failed]:[color:var(--ui-copy-button-failed-color)]']) assert.ok(button.classes.includes(name), name)
	assert.match(html, /<button[^>]*>\s*Copiar\s*<\/button>/)
	// The live region exists from the first paint, empty: only a result is announced.
	assert.match(html, /<span role="status" class="sr-only"[^>]*><\/span>/)
	assert.doesNotMatch(html, /undefined/)
})

test('UICopyButton with iconOnly is a ghost UIIconButton named by its label, with the copy icon and a tooltip', async (context) => {
	const html = await render(context, '<UICopyButton value="secreto" iconOnly label="Copiar el token" />')
	const button = element(html, 'button')
	assert.equal(button.attributes['aria-label'], 'Copiar el token')
	assert.equal(button.attributes['data-copy-state'], 'idle')
	for (const name of ['bg-transparent', 'text-neutral-11', 'p-0', 'invisible']) assert.ok(button.classes.includes(name), name)
	assert.match(html, new RegExp(`<path d="${icons.copy}"`))
	assert.match(html, /role="tooltip"[^>]*>Copiar el token<\/span>/)
	// The colors of the result read the tokens, never a value of their own.
	assert.ok(button.classes.some((name) => name.includes('--ui-copy-button-copied-color')))
})

test('UICopyButton texts come from copyButton messages, and the props win over them', async (context) => {
	const english = await render(context, '<UICopyButton value="x" />', { messages: { locale: 'en' } })
	assert.match(english, /<button[^>]*>\s*Copy\s*<\/button>/)
	const own = await render(context, '<UICopyButton value="x" />', { messages: { locale: 'fr', messages: { fr: { copyButton: { copy: 'Copier' } } } } })
	assert.match(own, /<button[^>]*>\s*Copier\s*<\/button>/)
	const prop = await render(context, '<UICopyButton value="x" label="Copiar enlace" />', { messages: { locale: 'en' } })
	assert.match(prop, /<button[^>]*>\s*Copiar enlace\s*<\/button>/)
})

test('UICopyButton takes variant, color, size, radius, disabled, attributes, class and ui; ui.defaults.copyButton is validated', async (context) => {
	const html = await render(context, '<UICopyButton id="copy" value="x" variant="solid" color="danger" size="sm" radius="full" disabled class="mine" bind:ui="{ status: \'my-status\' }" />')
	const button = element(html, 'button')
	assert.equal(button.attributes.id, 'copy')
	assert.match(button.tag, /\sdisabled(?:=""|\s|>)/)
	for (const name of ['bg-danger-9', 'min-h-(--ui-control-height-sm)', 'rounded-full', 'mine']) assert.ok(button.classes.includes(name), name)
	// On a solid the result keeps the color of the solid: no state color.
	assert.ok(!button.classes.some((name) => name.includes('--ui-copy-button-copied-color')))
	assert.match(html, /<span role="status" class="sr-only my-status"[^>]*>/)
	const defaults = { copyButton: { variant: 'outline', class: 'app-copy' } }
	validateDefaults(defaults)
	const themed = await render(context, '<UICopyButton value="x" />', { defaults })
	const outline = element(themed, 'button')
	assert.ok(outline.classes.includes('border-control-border'), 'outline of ui.defaults')
	assert.ok(outline.classes.includes('app-copy'))
	assert.throws(() => validateDefaults({ copyButton: { variant: 'link' } }), /invalid defaults\.copyButton\.variant/)
	assert.throws(() => validateDefaults({ copyButton: { shape: 'pill' } }), /unknown option defaults\.copyButton\.shape/)
	const tinted = element(await render(context, '<UICopyButton value="x" iconOnly label="Copiar" />', { defaults: { copyButton: { color: 'primary', variant: 'soft' } } }), 'button')
	for (const name of ['bg-primary-3', 'text-primary-11', 'p-0']) assert.ok(tinted.classes.includes(name), name)
	assert.throws(() => validateDefaults({ copyButton: { ui: { icon: 'x' } } }), /unknown slot icon in defaults\.copyButton\.ui/)
})

test('UICopyButton keeps the line height of the button it paints with a font size of the instance', async (context) => {
	const text = element(await render(context, '<UICopyButton value="x" class="text-sm" />'), 'button')
	assert.ok(text.classes.includes('text-sm') && !text.classes.includes('text-control-md') && text.classes.includes('leading-tight'), text.classes.join(' '))
	const icon = element(await render(context, '<UICopyButton value="x" iconOnly label="Copiar" class="text-sm" />'), 'button')
	assert.ok(icon.classes.includes('text-sm') && icon.classes.includes('leading-tight'), icon.classes.join(' '))
})

test('canCopy is false on the server and the feedback lasts as long as that of a code block', () => {
	assert.equal(canCopy(), typeof document !== 'undefined')
	assert.equal(copyFeedbackTime, 1600)
})

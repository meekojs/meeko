import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { routeKey } from '../../meeko/dist/app/runtime/navigation.js'
import { compile } from '../../meeko/dist/compiler.js'
import { createRoot, provide } from '../../meeko/dist/index.js'
import { avatarInitials } from '../dist/app/utils/avatar.js'
import { uiDefaultsKey } from '../dist/app/utils/defaults.js'
import { icons } from '../dist/app/utils/icons.js'
import { validateDefaults } from '../dist/defaults.js'

/** Compila el componente real y una página con `template`, y la pinta en SSR con los `ui.defaults` dados. */
async function render(context, template, { defaults } = {}) {
	const parent = fileURLToPath(new URL('../.meeko/', import.meta.url))
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(parent + 'avatar-')
	context.after(() => rm(directory, { recursive: true, force: true }))
	const runtime = (path) => JSON.stringify(new URL(`../../meeko/dist/${path}`, import.meta.url).href)
	const write = async (file, source) => {
		const code = compile(source, `${directory}/${file}.meeko`)
			.code.replaceAll('from "@meekojs/meeko/internal"', `from ${runtime('internal.js')}`)
			.replaceAll('from "@meekojs/meeko"', `from ${runtime('index.js')}`)
			.replace(/from ["']\.\/(\w+)\.meeko["']/g, 'from "./$1.ts"')
			.replace(/from ["'](?:\.\.\/)+(utils|variants|theme(?:\/components)?)\/([\w-]+)["']/g, (_, folder, utility) => `from ${JSON.stringify(new URL(`../dist/app/${folder}/${utility}.js`, import.meta.url).href)}`)
		await writeFile(`${directory}/${file}.ts`, code)
	}
	await write('Avatar', await readFile(new URL('../src/app/components/Avatar.meeko', import.meta.url), 'utf8'))
	await write('Page', `<script lang="ts">import * as UIAvatar from "./Avatar.meeko"</script><template>${template}</template>`)
	const page = await import(pathToFileURL(`${directory}/Page.ts`).href)
	return createRoot(() => {
		provide(routeKey, {})
		if (defaults) provide(uiDefaultsKey, defaults)
		return page.renderToString({}).replace(/<!--.*?-->/g, '')
	})
}

/** La etiqueta de apertura del primer elemento que coincide con `pattern`, y sus atributos. */
function element(html, pattern) {
	const tag = html.match(new RegExp(`<${pattern}(?:\\s[^>]*)?>`))?.[0]
	assert.ok(tag, `no <${pattern}> in ${html}`)
	const attributes = Object.fromEntries([...tag.matchAll(/\s([\w:-]+)(?:="([^"]*)")?/g)].map(([, name, value]) => [name, value ?? '']))
	return { tag, attributes, classes: (attributes.class ?? '').split(' ') }
}

test('avatarInitials takes the first letter of up to two words, and only the first one of an email', () => {
	assert.equal(avatarInitials('Ana Pérez'), 'AP')
	assert.equal(avatarInitials('  ana   maría pérez '), 'AM')
	assert.equal(avatarInitials('Ángel'), 'Á')
	assert.equal(avatarInitials('(Ana) López'), 'AL')
	assert.equal(avatarInitials('ana.perez@example.com'), 'A')
	assert.equal(avatarInitials('Diego <diego@example.com>'), 'DD')
	assert.equal(avatarInitials('@example.com'), 'E')
	assert.equal(avatarInitials(''), '')
	assert.equal(avatarInitials('   '), '')
	assert.equal(avatarInitials(undefined), '')
})

test('UIAvatar without src paints the initials as an image named by name, with the tokens of its size and shape', async (context) => {
	const html = await render(context, '<UIAvatar name="Ana Pérez" />')
	const box = element(html, 'span')
	assert.equal(box.attributes.role, 'img')
	assert.equal(box.attributes['aria-label'], 'Ana Pérez')
	assert.equal(box.attributes['aria-hidden'], undefined)
	for (const name of ['size-(--ui-avatar-size-md)', 'text-(length:--ui-avatar-font-size-md)', 'rounded-full', 'bg-(color:--ui-avatar-bg)', 'text-(color:--ui-avatar-color)']) assert.ok(box.classes.includes(name), name)
	assert.match(html, /<span[^>]*>AP<\/span>$/)
	assert.doesNotMatch(html, /<img|<svg|undefined/)
})

test('UIAvatar of an email shows one letter; label wins as the accessible name; size and shape change the box', async (context) => {
	const html = await render(context, '<UIAvatar name="ana@example.com" label="Tu cuenta" size="sm" shape="rounded" class="mine" bind:ui="{ base: \'my-base\' }" />')
	const box = element(html, 'span')
	assert.equal(box.attributes['aria-label'], 'Tu cuenta')
	for (const name of ['size-(--ui-avatar-size-sm)', 'rounded-(--ui-avatar-radius)', 'my-base', 'mine']) assert.ok(box.classes.includes(name), name)
	assert.ok(!box.classes.includes('rounded-full'))
	assert.match(html, />A<\/span>$/)
})

test('UIAvatar without name paints the person glyph, hidden, or the fallback snippet', async (context) => {
	const glyph = await render(context, '<UIAvatar size="lg" />')
	const box = element(glyph, 'span')
	assert.equal(box.attributes.role, undefined)
	assert.equal(box.attributes['aria-label'], undefined)
	assert.ok(box.classes.includes('size-(--ui-avatar-size-lg)'))
	const svg = element(glyph, 'svg')
	assert.equal(svg.attributes['aria-hidden'], 'true')
	assert.ok(svg.classes.includes('size-3/5'))
	assert.match(glyph, new RegExp(`<path d="${icons.person}"`))
	const fallback = await render(context, '<UIAvatar label="Invitado"><snippet name="fallback"><b>?</b></snippet></UIAvatar>')
	assert.equal(element(fallback, 'span').attributes['aria-label'], 'Invitado')
	assert.match(fallback, /<b>\?<\/b>/)
	assert.doesNotMatch(fallback, /<svg/)
	// Un nombre en blanco no da iniciales ni nombre.
	const blank = await render(context, '<UIAvatar name="  " />')
	assert.equal(element(blank, 'span').attributes.role, undefined)
	assert.match(blank, /<svg/)
})

test('UIAvatar with src paints an <img> whose alt is the name, without a role on the box', async (context) => {
	const html = await render(context, '<UIAvatar name="Ana Pérez" src="/ana.webp" bind:ui="{ image: \'my-image\' }" />')
	const box = element(html, 'span')
	assert.equal(box.attributes.role, undefined)
	assert.equal(box.attributes['aria-label'], undefined)
	const image = element(html, 'img')
	assert.equal(image.attributes.src, '/ana.webp')
	assert.equal(image.attributes.alt, 'Ana Pérez')
	for (const name of ['object-cover', 'size-full', 'my-image']) assert.ok(image.classes.includes(name), name)
	// Las iniciales sólo llegan si la imagen falla, al hidratar.
	assert.doesNotMatch(html, />AP</)
	const nameless = await render(context, '<UIAvatar src="/x.webp" />')
	assert.equal(element(nameless, 'img').attributes.alt, '')
})

test('UIAvatar decorative is aria-hidden, with an empty alt and no role', async (context) => {
	const initials = await render(context, '<UIAvatar name="Ana Pérez" decorative />')
	const box = element(initials, 'span')
	assert.equal(box.attributes['aria-hidden'], 'true')
	assert.equal(box.attributes.role, undefined)
	assert.equal(box.attributes['aria-label'], undefined)
	assert.match(initials, />AP<\/span>$/)
	const image = await render(context, '<UIAvatar name="Ana Pérez" src="/ana.webp" decorative />')
	assert.equal(element(image, 'span').attributes['aria-hidden'], 'true')
	assert.equal(element(image, 'img').attributes.alt, '')
})

test('ui.defaults.avatar gives size, shape, class and ui; the instance wins; it is validated', async (context) => {
	const defaults = { avatar: { size: 'lg', shape: 'rounded', class: 'app-avatar', ui: { glyph: 'app-glyph' } } }
	validateDefaults(defaults)
	const themed = await render(context, '<UIAvatar />', { defaults })
	const box = element(themed, 'span')
	for (const name of ['size-(--ui-avatar-size-lg)', 'rounded-(--ui-avatar-radius)', 'app-avatar']) assert.ok(box.classes.includes(name), name)
	assert.ok(element(themed, 'svg').classes.includes('app-glyph'))
	const own = await render(context, '<UIAvatar name="Ana" size="sm" shape="circle" />', { defaults })
	assert.ok(element(own, 'span').classes.includes('size-(--ui-avatar-size-sm)'))
	assert.ok(element(own, 'span').classes.includes('rounded-full'))
	assert.throws(() => validateDefaults({ avatar: { size: 'xl' } }), /invalid defaults\.avatar\.size/)
	assert.throws(() => validateDefaults({ avatar: { ui: { initials: 'x' } } }), /unknown slot initials in defaults\.avatar\.ui/)
})

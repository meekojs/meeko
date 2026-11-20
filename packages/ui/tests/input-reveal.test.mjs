import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { routeKey } from '../../meeko/dist/app/runtime/navigation.js'
import { compile } from '../../meeko/dist/compiler.js'
import { createRoot, provide } from '../../meeko/dist/index.js'
import { icons } from '../dist/app/utils/icons.js'
import { builtinMessages, resolveUIMessages, uiMessagesKey } from '../dist/app/utils/messages.js'
import { validateOptions } from '../dist/options.js'

/** Compila <UIInput> y una página con `template`, y la pinta en SSR con los mensajes dados. */
async function render(context, template, { messages } = {}) {
	const parent = fileURLToPath(new URL('../.meeko/', import.meta.url))
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(parent + 'input-reveal-')
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
	await write('Input', await readFile(new URL('../src/app/components/Input.meeko', import.meta.url), 'utf8'))
	await write('Page', `<script lang="ts">import { signal } from "@meekojs/meeko"; import * as UIInput from "./Input.meeko"</script><template>${template}</template>`)
	const page = await import(pathToFileURL(`${directory}/Page.ts`).href)
	return createRoot(() => {
		provide(routeKey, {})
		if (messages) provide(uiMessagesKey, messages)
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

test('UIInput without reveal is only the <input>, with the end padding of always', async (context) => {
	for (const template of ['<UIInput name="q" class="mine" />', '<UIInput type="password" name="secret" />', '<UIInput type="email" bind:reveal="true" />']) {
		const html = await render(context, template)
		assert.match(html, /^<input [^>]*\/?>$/, template)
		const input = element(html, 'input')
		assert.ok(input.classes.includes('ui:pe-3'), template)
		assert.ok(!input.classes.includes('ui:pe-(--ui-control-height-md)'), template)
		assert.equal(input.attributes.reveal, undefined, 'reveal does not reach the <input>')
	}
})

test('UIInput type="password" reveal adds a button that does not submit, unpressed, named by input.show, invisible until hydration', async (context) => {
	const html = await render(context, '<UIInput id="secret" type="password" name="secret" autocomplete="current-password" reveal model="signal(\'abc\')" />')
	const box = element(html, 'span')
	assert.ok(box.classes.includes('ui:relative'))
	const input = element(html, 'input')
	assert.equal(input.attributes.type, 'password')
	assert.equal(input.attributes.name, 'secret')
	assert.equal(input.attributes.autocomplete, 'current-password')
	assert.equal(input.attributes.value, 'abc')
	assert.ok(input.classes.includes('ui:pe-(--ui-control-height-md)'))
	assert.ok(!input.classes.includes('ui:pe-3'))
	const button = element(html, 'button')
	assert.equal(button.attributes.type, 'button')
	assert.equal(button.attributes['aria-pressed'], 'false')
	assert.equal(button.attributes['aria-label'], 'Mostrar contraseña')
	assert.equal(button.attributes['aria-controls'], 'secret')
	assert.ok(button.classes.includes('ui:invisible'), button.tag)
	assert.match(html, new RegExp(`<path d="${icons.eye}"`))
	assert.doesNotMatch(html, /undefined/)
})

test('UIInput reveal is disabled with the field, and showLabel and hideLabel win over the messages', async (context) => {
	const html = await render(context, '<UIInput type="password" reveal disabled showLabel="Ver clave" hideLabel="Tapar clave" />')
	assert.match(element(html, 'button').tag, /\sdisabled(?:=""|\s|>)/)
	assert.equal(element(html, 'button').attributes['aria-label'], 'Ver clave')
	const english = await render(context, '<UIInput type="password" reveal />', { messages: { locale: 'en' } })
	assert.equal(element(english, 'button').attributes['aria-label'], 'Show password')
	const french = await render(context, '<UIInput type="password" reveal />', { messages: { locale: 'fr', messages: { fr: { input: { show: 'Afficher le mot de passe' } } } } })
	assert.equal(element(french, 'button').attributes['aria-label'], 'Afficher le mot de passe')
})

test('input.show and input.hide come in Spanish and English, and ui.messages validates them', () => {
	assert.deepEqual(builtinMessages.es.input, { show: 'Mostrar contraseña', hide: 'Ocultar contraseña' })
	assert.deepEqual(builtinMessages.en.input, { show: 'Show password', hide: 'Hide password' })
	assert.equal(resolveUIMessages('en-GB').input.hide, 'Hide password')
	assert.equal(resolveUIMessages('fr', { messages: { fr: { input: { hide: 'Masquer' } } } }).input.show, 'Mostrar contraseña')
	assert.doesNotThrow(() => validateOptions({ messages: { fr: { input: { show: 'Afficher', hide: 'Masquer' } } } }))
	assert.throws(() => validateOptions({ messages: { fr: { input: { toggle: 'Basculer' } } } }), /unknown message messages\.fr\.input\.toggle/)
	assert.throws(() => validateOptions({ messages: { fr: { input: { show: '' } } } }), /messages\.fr\.input\.show must be a non-empty string/)
})

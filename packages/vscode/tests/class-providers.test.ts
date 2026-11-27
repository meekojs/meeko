import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

import { activeProviderExtensions, classSettingsForServer, legacyTailwindExtension, providersFromResponse, requestClassProviders } from '../src/class-providers'

const tailwind = { name: 'Tailwind CSS', vscode: ['bradlc.vscode-tailwindcss'], languages: ['tailwindcss'] }
const uno = { name: 'UnoCSS', vscode: ['antfu.unocss'], languages: [] }
const active =
	(...ids: string[]) =>
	(id: string) =>
		ids.includes(id)

/** The decision of the bundled server, which the extension talks to. */
async function serverDecision(): Promise<(settings: Record<string, unknown>, providers: readonly (typeof tailwind)[]) => boolean> {
	const classes = pathToFileURL(resolve(import.meta.dirname, '../../meeko/src/language-server/classes.ts')).href
	return ((await import(classes)) as { classProviderActive: (settings: Record<string, unknown>, providers: readonly (typeof tailwind)[]) => boolean }).classProviderActive
}

test('the response of meeko/classProviders is read defensively', () => {
	assert.deepEqual(providersFromResponse({ providers: [tailwind, uno] }), [tailwind, uno])
	assert.deepEqual(providersFromResponse({ providers: [{ name: 'X', vscode: ['a.b', 3], languages: 'css' }, { vscode: [] }, null] }), [{ name: 'X', vscode: ['a.b'], languages: [] }])
	for (const value of [null, undefined, 'x', [], {}, { providers: 'x' }]) assert.deepEqual(providersFromResponse(value), [])
})

test('a server before 1.12 does not know the request: its error counts as no providers', async () => {
	const methodNotFound = Object.assign(new Error('Unhandled method meeko/classProviders'), { code: -32601 })
	assert.deepEqual(await requestClassProviders(() => Promise.reject(methodNotFound)), [])
	assert.deepEqual(await requestClassProviders(() => Promise.resolve(null)), [])
	assert.deepEqual(await requestClassProviders(() => Promise.resolve({ providers: [tailwind] })), [tailwind])
})

test('the extension reports the active extensions of the declared providers and keeps tailwindActive for older servers', () => {
	assert.deepEqual(activeProviderExtensions([tailwind, uno, { ...tailwind, name: 'Again' }], active('bradlc.vscode-tailwindcss', 'antfu.unocss')), ['bradlc.vscode-tailwindcss', 'antfu.unocss'])
	assert.deepEqual(activeProviderExtensions([tailwind], active()), [])
	// The user settings pass through; an empty list still says that this client knows the providers.
	assert.deepEqual(classSettingsForServer({ completion: 'auto', hover: 'on' }, [tailwind], active(legacyTailwindExtension)), { completion: 'auto', hover: 'on', activeExtensions: ['bradlc.vscode-tailwindcss'], tailwindActive: true })
	assert.deepEqual(classSettingsForServer(null, [], active(legacyTailwindExtension)), { activeExtensions: [], tailwindActive: true }, 'tailwindActive as before 1.12, whatever the project declares')
	assert.deepEqual(classSettingsForServer({ completion: 'on' }, [uno], active()), { completion: 'on', activeExtensions: [], tailwindActive: false })
})

test('new extension with a new server: the project decides which extension takes its generated classes', async () => {
	const decide = await serverDecision()
	const settings = (providers: (typeof tailwind)[], ...ids: string[]) => classSettingsForServer({ completion: 'auto' }, providers, active(...ids))
	assert.equal(decide(settings([tailwind], legacyTailwindExtension), [tailwind]), true, 'declared by @meekojs/ui and active')
	assert.equal(decide(settings([tailwind]), [tailwind]), false, 'declared and inactive')
	// A project that declares nothing gets every class from Meeko, also with Tailwind CSS IntelliSense active.
	assert.equal(decide(settings([], legacyTailwindExtension), []), false)
	assert.equal(decide(settings([uno], 'antfu.unocss', legacyTailwindExtension), [uno]), true)
})

test('old extension with a new server: only tailwindActive arrives', async () => {
	const decide = await serverDecision()
	assert.equal(decide({ completion: 'auto', tailwindActive: true }, [tailwind]), true)
	assert.equal(decide({ completion: 'auto', tailwindActive: false }, [tailwind]), false)
	assert.equal(decide({ completion: 'auto', tailwindActive: true }, [uno]), false)
	assert.equal(decide({ completion: 'auto', tailwindActive: true }, []), true, 'nothing declared: the explicit signal of that client still delegates')
})

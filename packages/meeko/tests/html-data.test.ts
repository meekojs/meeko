import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { generateHtmlData, readSources } from '../scripts/html-data.ts'
import { ariaAttributes, ariaRoles } from '../src/shared/html-data/aria.ts'
import { booleanAttributeNames, elementAttributeNames, globalAttributeNames } from '../src/shared/html-data/attribute-names.ts'
import { htmlElementAttributes, htmlElements, htmlGlobalAttributes } from '../src/shared/html-data/attributes.ts'
import { elementEventNames, htmlEventNames } from '../src/shared/html-data/events.ts'
import { deprecatedTagNames, htmlTagNames, voidTagNames } from '../src/shared/html-data/tags.ts'

const packageRoot = join(import.meta.dirname, '..')
const words = (list: string): string[] => (list ? list.split(' ') : [])

test('the generated HTML data are up to date with the snapshots and @mdn/browser-compat-data', async () => {
	const files = await generateHtmlData(await readSources())
	for (const [path, content] of Object.entries(files)) {
		assert.equal(await readFile(join(packageRoot, path), 'utf8'), content, `${path} is out of date: run pnpm -F @meekojs/meeko html-data --offline`)
	}
})

test('enumerated attributes carry the values of the standard', () => {
	assert.deepEqual(htmlElementAttributes.dialog.closedby.values, ['any', 'closerequest', 'none'])
	assert.deepEqual(htmlElementAttributes.button.type.values, ['submit', 'reset', 'button'])
	assert.deepEqual(htmlGlobalAttributes.popover.values, ['auto', 'manual', 'hint', ''])
	assert.deepEqual([...htmlElementAttributes.input.type.values].sort(), ['button', 'checkbox', 'color', 'date', 'datetime-local', 'email', 'file', 'hidden', 'image', 'month', 'number', 'password', 'radio', 'range', 'reset', 'search', 'submit', 'tel', 'text', 'time', 'url', 'week'])
	assert.deepEqual(htmlElementAttributes.button.popovertargetaction.values, ['toggle', 'show', 'hide'])
	assert.deepEqual(htmlElementAttributes.template.shadowrootmode.values, ['open', 'closed'])
	assert.deepEqual(htmlElementAttributes.img.fetchpriority.values, ['auto', 'high', 'low'])
	assert.ok(htmlGlobalAttributes.hidden.values.includes('until-found'))
	assert.ok(htmlElementAttributes.button.command.values.includes('show-modal'))
	assert.ok(htmlElementAttributes.img.referrerpolicy.values.includes('strict-origin-when-cross-origin'))
	// A closed list types the value; `freeform` marks suggestions, `tokens` a list separated by spaces.
	for (const data of [htmlElementAttributes.dialog.closedby, htmlElementAttributes.button.type, htmlElementAttributes.input.type, htmlGlobalAttributes.popover]) {
		assert.ok(!('freeform' in data) && !('tokens' in data))
	}
	assert.equal(htmlElementAttributes.input.step.freeform, true)
	assert.equal(htmlElementAttributes.button.command.freeform, true)
	assert.equal(htmlElementAttributes.iframe.sandbox.tokens, true)
	assert.equal(htmlGlobalAttributes.role.tokens, true)
})

test('recent features of the standard are in the data', () => {
	for (const name of ['popover', 'inert', 'writingsuggestions', 'autocorrect', 'enterkeyhint']) assert.ok(words(globalAttributeNames).includes(name), name)
	for (const [tag, names] of Object.entries({ button: 'command commandfor popovertarget popovertargetaction', details: 'name', dialog: 'closedby', img: 'fetchpriority', link: 'blocking fetchpriority', script: 'blocking', template: 'shadowrootclonable shadowrootdelegatesfocus shadowrootmode shadowrootserializable' })) {
		for (const name of words(names)) assert.ok(words(elementAttributeNames[tag as keyof typeof elementAttributeNames]).includes(name), `${tag}.${name}`)
	}
	for (const tag of ['search', 'selectedcontent', 'dialog', 'menu']) assert.ok(words(htmlTagNames).includes(tag), tag)
	assert.ok(!('boolean' in htmlGlobalAttributes.hidden), 'hidden takes "until-found", so it is no longer boolean')
	assert.ok(words(booleanAttributeNames).includes('inert') && words(booleanAttributeNames).includes('shadowrootdelegatesfocus'))
	assert.deepEqual(words(voidTagNames), ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
	assert.equal(htmlElements.img.void, true)
	assert.equal(htmlElements.dialog.interface, 'HTMLDialogElement')
	assert.ok(words(htmlEventNames['*']).includes('beforetoggle') && words(htmlEventNames.body).includes('pagereveal'))
	assert.ok(words(elementEventNames).includes('pointerdown') && words(elementEventNames).includes('transitionend'))
})

test('ARIA has the states, properties and roles of WAI-ARIA 1.3', () => {
	assert.deepEqual(ariaAttributes['aria-current'].values, ['page', 'step', 'location', 'date', 'time', 'true', 'false'])
	assert.deepEqual(ariaAttributes['aria-checked'].values, ['false', 'mixed', 'true', 'undefined'])
	assert.equal(ariaAttributes['aria-labelledby'].type, 'ID reference list')
	assert.ok('aria-braillelabel' in ariaAttributes && 'aria-colindextext' in ariaAttributes)
	assert.equal(ariaAttributes['aria-grabbed'].deprecated, true)
	assert.ok('button' in ariaRoles && 'doc-chapter' in ariaRoles && 'graphics-document' in ariaRoles)
	assert.ok(!('widget' in ariaRoles), 'abstract roles are left out')
	assert.equal(ariaRoles.directory.deprecated, true)
	assert.ok(htmlGlobalAttributes.role.values.includes('switch'))
})

test('everything Meeko 1.7 accepted is still accepted, the obsolete names as deprecated', async () => {
	const legacy = (await readSources()).legacy
	const global = new Set(words(globalAttributeNames))
	for (const name of legacy.globalAttributes) assert.ok(global.has(name), name)
	for (const [tag, names] of Object.entries(legacy.elements)) {
		assert.ok(words(htmlTagNames).includes(tag), tag)
		const own = new Set(words(elementAttributeNames[tag as keyof typeof elementAttributeNames]))
		for (const name of names) assert.ok(own.has(name) || global.has(name), `${tag}.${name}`)
	}
	assert.equal(htmlElementAttributes.body.alink.deprecated, true)
	assert.equal(htmlGlobalAttributes.contextmenu.deprecated, true)
	assert.ok(words(deprecatedTagNames).includes('param'))
	// Meeko's own rules: `is` is a directive, and `type` of <a> is only a MIME hint.
	assert.ok(!global.has('is') && !words(elementAttributeNames.a).includes('type'))
	assert.ok(!words(globalAttributeNames).some((name) => name.startsWith('on')))
})

import assert from 'node:assert/strict'
import test from 'node:test'

import i18n from '../../../apps/i18n/meeko.config'
import ui from '../../../apps/ui/meeko.config'
import { docsLocaleDefaults, docsShellCatalog, docsSiteDefaults } from '../src/site-config'

test('site configuration preserves module order, metadata and shared defaults', () => {
	assert.deepEqual(ui.modules, ['@meekojs/ui', '@meekojs/ui/editor', '@meekojs/icon', 'meeko-docs', '@meekojs/i18n'])
	assert.deepEqual(i18n.modules, ['@meekojs/ui', 'meeko-docs', '@meekojs/i18n'])
	assert.equal(ui.site, 'https://ui.meekojs.com')
	assert.equal(i18n.site, 'https://i18n.meekojs.com')
	assert.deepEqual(ui.theme, { default: 'dark' })
	assert.deepEqual(i18n.theme, { default: 'dark' })
	assert.equal(ui.viewTransitions, true)
	assert.equal(i18n.viewTransitions, true)
	assert.deepEqual(ui.docs, { site: 'ui' })
	assert.deepEqual(i18n.docs, { site: 'i18n' })
	assert.deepEqual(ui.document, docsSiteDefaults('ui', 'Componentes tipados, temas y documentación para construir interfaces con Meeko.').document)
	assert.deepEqual(i18n.document, docsSiteDefaults('i18n', 'Traducciones tipadas, catálogos, plurales y formatos para aplicaciones Meeko.').document)
	assert.deepEqual(ui.icon, { collections: ['lucide'], include: ['lucide:sun', 'lucide:moon'] })
})

test('locale catalog order, shell fallback and i18n overrides stay explicit', () => {
	assert.deepEqual(Object.keys(ui.i18n!.catalogs), ['es', 'en'])
	assert.deepEqual(Object.keys(i18n.i18n!.catalogs), ['es', 'en', 'ar'])
	assert.deepEqual(ui.i18n!.global, ['shell'])
	assert.deepEqual(i18n.i18n!.global, ['site', 'shell'])
	assert.deepEqual(Object.keys(i18n.i18n!.catalogs.es!), ['common', 'checkout', 'site', 'shell'])
	assert.deepEqual(i18n.i18n!.catalogs.ar, {
		common: 'app/locales/ar/common.json',
		checkout: 'app/locales/ar/checkout.json',
		site: 'app/locales/es/site.json',
		...docsShellCatalog('es'),
	})
	assert.deepEqual(i18n.i18n!.directions, { ar: 'rtl' })
	assert.deepEqual(i18n.i18n!.partial, { ar: ['/playground'] })
	assert.deepEqual(i18n.i18n!.routes, { '/namespaces': ['checkout'] })
	assert.equal(i18n.i18n!.strategy, 'prefix_except_default')
	assert.deepEqual(ui.i18n!.cookie, docsLocaleDefaults().cookie)
	assert.deepEqual(i18n.i18n!.cookie, docsLocaleDefaults().cookie)
	assert.equal(ui.i18n!.defaultLocale, 'es')
	assert.equal(i18n.i18n!.defaultLocale, 'es')
	assert.equal(ui.i18n!.catalogs.es.shell, 'node_modules/meeko-docs/locales/es/shell.json')
	assert.equal(ui.i18n!.catalogs.en.shell, 'node_modules/meeko-docs/locales/en/shell.json')
	assert.equal(i18n.i18n!.catalogs.en.shell, 'node_modules/meeko-docs/locales/en/shell.json')
})

test('defaults return independent objects and caller overrides remain local', () => {
	const first = docsSiteDefaults('ui', 'First')
	const second = docsSiteDefaults('i18n', 'Second')
	first.document.head.meta[0]!.content = 'Changed'
	first.document.head.link[0]!.href = '/other.png'
	assert.equal(second.document.head.meta[0]!.content, 'Second')
	assert.equal(second.document.head.link[0]!.href, '/brand/meeko-logo.png')
	assert.equal(ui.document.head.meta[0]!.content, 'Componentes tipados, temas y documentación para construir interfaces con Meeko.')
	assert.equal(i18n.document.head.meta[0]!.content, 'Traducciones tipadas, catálogos, plurales y formatos para aplicaciones Meeko.')
	const locale = docsLocaleDefaults()
	locale.cookie.name = 'custom'
	assert.equal(docsLocaleDefaults().cookie.name, 'meeko-locale')
	assert.deepEqual({ ...docsSiteDefaults('ui', 'Default'), theme: { default: 'light' } }.theme, { default: 'light' })
})

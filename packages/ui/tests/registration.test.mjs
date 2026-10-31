import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { discoverAutoImports, discoverComponents } from '../../meeko/dist/autoimports/registry.js'
import ui from '../dist/index.js'
import * as runtime from '../dist/runtime.js'

test('UI registers public components and composables without leaking private globals', async () => {
	const root = fileURLToPath(new URL('../../../apps/ui', import.meta.url))
	const components = await discoverComponents(root)
	assert.ok(components.some(({ name }) => name === 'UIApp'))
	assert.ok(components.some(({ name }) => name === 'UIModal'))
	assert.ok(components.some(({ name }) => name === 'UITable'))
	assert.ok(components.some(({ name }) => name === 'UICard'))
	assert.ok(components.some(({ name }) => name === 'UILink'))
	assert.ok(components.some(({ name }) => name === 'UILinkCard'))
	assert.ok(components.some(({ name }) => name === 'UIBadge'))
	assert.ok(!components.some(({ name }) => name === 'UIInternalModalInstance' || name === 'UIModalInstance'))
	const entries = await discoverAutoImports(root)
	const fromUi = entries.filter((entry) => entry.file === '@meekojs/ui/runtime')
	assert.deepEqual(fromUi.map(({ name }) => name).sort(), ['useModal', 'useModalInstance'])
	assert.ok(!entries.some(({ name }) => name.startsWith('UIInternalModalInstance') || name.startsWith('UIModalInstance')))
	assert.deepEqual(Object.keys(runtime).sort(), ['useModal', 'useModalInstance'])
	await access(new URL('../dist/app/components/internal/ModalInstance.meeko', import.meta.url))
	await access(new URL('../dist/app/components/internal/ModalInstance.d.meeko.ts', import.meta.url))
})

test('UI registers a static app plugin and only aliases the consumer component registry', async () => {
	const root = fileURLToPath(new URL(`../.meeko/static-plugin-${randomUUID()}/`, import.meta.url))
	const plugins = []
	const vitePlugins = []
	ui.setup(
		{},
		{
			rootDir: root,
			addComponentsDir() {},
			addStylesheet() {},
			addAutoImports() {},
			addPlugin(plugin) {
				plugins.push(plugin)
			},
			addVitePlugin(plugin) {
				vitePlugins.push(plugin)
			},
		},
	)
	assert.equal(plugins.length, 1)
	assert.match(fileURLToPath(plugins[0]).replaceAll('\\', '/'), /\/dist\/app\/plugins\/modal\.js$/)
	await access(plugins[0])
	assert.equal(vitePlugins[0].resolveId('virtual:meeko-ui-components'), join(root, '.meeko', 'generated', 'components.ts'))
	assert.equal(vitePlugins[0].resolveId('unrelated-module'), undefined)
	await assert.rejects(access(join(root, '.meeko')), { code: 'ENOENT' })
	await assert.rejects(import('@meekojs/ui/internal'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' })
})

import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { generateComponentRegistry } from '../src/autoimports/components'
import { discoverAutoImports, discoverComponents } from '../src/autoimports/registry'
import { checkFrameworkProject } from '../src/framework/check-project'
import { componentExcluded, normalizeComponentExcludes } from '../src/framework/component-exclusions'
import { generateComponentRegistryTypes } from '../src/framework/type-declarations'
import { linkRepositoryPackages, tempProject } from './helpers/temp-project'

test('module exclusions remove private components and their globals without blocking explicit imports', async (context) => {
	const root = await tempProject(context, 'component-exclusions')
	await linkRepositoryPackages(root)
	await mkdir(join(root, 'ui-components/internal'), { recursive: true })
	await mkdir(join(root, 'app/pages'), { recursive: true })
	await mkdir(join(root, 'app/utils'), { recursive: true })
	await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}')
	await writeFile(
		join(root, 'meeko.config.mjs'),
		`import { defineMeekoModule } from '@meekojs/meeko/framework';
export default { modules: [defineMeekoModule({ meta: { name: 'private-components' }, setup(_options, meeko) {
  meeko.addComponentsDir(new URL('./ui-components', import.meta.url), { prefix: 'Ui', exclude: ['internal/**', '**/*.private.meeko'] });
} })] };`,
	)
	await writeFile(join(root, 'ui-components/internal/Hidden.meeko'), '<template><p>Private content</p></template>')
	await writeFile(join(root, 'ui-components/internal/.Hidden.meeko'), '<template><p>Hidden private file</p></template>')
	await writeFile(join(root, 'ui-components/Unused.private.meeko'), '<template><p>Not registered</p></template>')
	await writeFile(join(root, 'ui-components/Public.meeko'), `<script lang="ts">import * as Hidden from './internal/Hidden.meeko';</script><template><Hidden /></template>`)
	await writeFile(join(root, 'app/pages/index.meeko'), '<template><UiPublic /></template>')
	await writeFile(
		join(root, 'app/utils/visibility.client.ts'),
		`import type { ComponentName } from '@meekojs/meeko';
const name: ComponentName = 'UiPublic';
// @ts-expect-error Private components are absent from ComponentName.
const privateName: ComponentName = 'UiInternalHidden';
// @ts-expect-error Private components are not autoimported.
UiInternalHidden;
// @ts-expect-error Their generated component types are not global either.
type HiddenProps = UiInternalHiddenProps;
export { name, privateName };
`,
	)
	assert.deepEqual(
		(await discoverComponents(root)).map(({ name }) => name),
		['UiPublic'],
	)
	const autoimports = await discoverAutoImports(root)
	assert.ok(autoimports.some(({ name }) => name === 'UiPublicProps'))
	assert.ok(!autoimports.some(({ name }) => name.includes('Hidden') || name.includes('Unused')))
	const loaders = await readFile(await generateComponentRegistry(root), 'utf8')
	const declarations = await readFile(await generateComponentRegistryTypes(root), 'utf8')
	for (const source of [loaders, declarations]) {
		assert.match(source, /UiPublic/)
		assert.doesNotMatch(source, /UiInternalHidden|UiUnused/)
	}
	assert.deepEqual(
		(await checkFrameworkProject(root)).filter((item) => (item.severity ?? 'error') === 'error'),
		[],
	)
})

test('exclusion globs are relative, normalized, copied and validated', () => {
	const raw = ['internal\\**', '**/*.private.meeko']
	const exclude = normalizeComponentExcludes(raw)
	raw[0] = 'public/**'
	assert.ok(Object.isFrozen(exclude))
	const directory = { dir: '/components', exclude }
	assert.ok(componentExcluded('/components/internal/Hidden.meeko', directory))
	assert.ok(componentExcluded('/components/internal/.Hidden.meeko', directory))
	assert.ok(componentExcluded('/components/Card.private.meeko', directory))
	assert.ok(!componentExcluded('/components/Card.meeko', directory))
	assert.deepEqual(normalizeComponentExcludes(undefined), [])
	for (const invalid of ['internal/**', null, [12], [''], ['../**'], ['C:/secrets/**'], ['/absolute/**'], ['!internal/**']]) {
		assert.throws(() => normalizeComponentExcludes(invalid), /relative glob/)
	}
})

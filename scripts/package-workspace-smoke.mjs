// Empaqueta los seis paquetes públicos del workspace, los instala desde sus tarballs en un consumidor externo
// y comprueba entradas públicas, tipos, ESLint, Prettier, `meeko check`, `meeko build`, CSS e iconos. Funciona
// en Windows, macOS y Linux.
//
// Uso: node scripts/package-workspace-smoke.mjs [--offline] [--keep]
//   --offline  instala sin red (el store de pnpm debe contener las dependencias); `-Offline` también se admite.
//   --keep     conserva el consumidor temporal en vez de eliminarlo, para inspeccionarlo.
// Termina con código 1 si falla un paso.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { childEnv, defaultTimeout, legacyArguments, run, runMain, withTemporaryDirectory } from './process-utils.mjs'

const workspace = fileURLToPath(new URL('../', import.meta.url))
/** Pasos que sólo ejecutan Node o TypeScript sobre archivos ya instalados. */
const quick = 5 * 60_000
const packages = ['meeko', 'ui', 'i18n', 'icon', 'prettier-plugin', 'eslint-plugin']

const exportsSmoke = String.raw`import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { signal } from '@meekojs/meeko';
import { compile } from '@meekojs/meeko/compiler';
import { defineEslint } from '@meekojs/eslint-plugin';
import prettier from 'prettier';
import { Linter } from 'eslint';
const require = createRequire(import.meta.url);
for (const name of ['meeko', 'ui', 'i18n', 'icon', 'prettier-plugin', 'eslint-plugin']) {
  const entry = require.resolve('@meekojs/' + name);
  const metadata = JSON.parse(await readFile(new URL('../package.json', pathToFileURL(entry)), 'utf8'));
  for (const key of Object.keys(metadata.exports)) {
    if (key.includes('*')) continue;
    const specifier = '@meekojs/' + name + (key === '.' ? '' : key.slice(1));
    // Node cannot import a stylesheet (@meekojs/ui/hues included): it must resolve to a file of the tarball, for the bundler.
    // Nor a JSON file without an import attribute (@meekojs/ui/package.json, which the Prettier plugin reads).
    if (key.endsWith('.css') || key.endsWith('.json') || String(metadata.exports[key]).endsWith('.css')) assert.ok(existsSync(require.resolve(specifier)), specifier);
    else await import(specifier);
  }
}
const { default: icon } = await import('@meekojs/icon/module');
assert.equal(icon.meta.name, '@meekojs/icon');
assert.equal(signal(3).value, 3);
assert.equal(typeof compile, 'function');
assert.deepEqual(new Linter().verify('<script lang="ts">const name = "Meeko";</script><template><button type="button">{name}</button></template>', defineEslint({ perfectionist: true, unusedImports: true }), { filename: 'App.meeko' }), []);
const formatted = await prettier.format('<template><button type="button">Save</button></template>', { parser: 'meeko', plugins: ['@meekojs/prettier-plugin'] });
assert.match(formatted, /Save/);
console.log('All public package entry points, ESLint and Prettier work from installed tarballs.');
`

// Meeko references a module's components by their real path, where pnpm puts the module's own dependencies
// (tailwind-variants): through the node_modules/@meekojs/ui link, TypeScript would look for them next to the consumer.
const componentDeclarations = String.raw`import { readdir, realpath, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
async function declarations(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? declarations(resolve(directory, entry.name)) : entry.name.endsWith('.d.meeko.ts') ? [resolve(directory, entry.name)] : []))).flat();
}
const files = await declarations(await realpath('node_modules/@meekojs/ui/dist/app/components'));
if (!files.length) throw new Error('Installed UI contains no component declarations');
const imports = files.map((file, index) => "import type * as Component" + index + " from './" + relative(process.cwd(), file).replaceAll('\\', '/') + "';");
await writeFile('component-declarations.ts', imports.join('\n') + '\nexport type Components = [' + files.map((_file, index) => 'typeof Component' + index).join(', ') + '];\n');
`

const mainTs = String.raw`import { signal } from '@meekojs/meeko';
import { defineMeekoModule } from '@meekojs/meeko/framework';
import ui from '@meekojs/ui';
import i18n from '@meekojs/i18n/module';
import { defineEslint } from '@meekojs/eslint-plugin';
import type { MeekoPrettierOptions } from '@meekojs/prettier-plugin';
import { useModal } from '@meekojs/ui/runtime';
const formatting: MeekoPrettierOptions = { meekoIndentSections: true };
export const smoke = { state: signal(1), ui, i18n, useModal, formatting, lint: defineEslint({ perfectionist: true, unusedImports: true }), module: defineMeekoModule({ meta: { name: 'smoke' }, setup() {} }) };
`

const meekoConfig = 'export default { modules: ["@meekojs/ui", "@meekojs/i18n", "@meekojs/ui/editor", "@meekojs/icon"], viewTransitions: true, icon: { collections: ["lucide"] }, i18n: { defaultLocale: "en", catalogs: { en: "app/locales/en.json" } }, ui: { tokens: { primary: "var(--consumer-primary)" }, defaults: { link: { radius: "full" } } } };'

const indexPage = String.raw`<script lang="ts">
  import { signal } from '@meekojs/meeko';
  const markdown = signal('# Installed editor');
  import type { TableColumn } from '@meekojs/ui/runtime';
  const rows = [{ id: 1, name: 'Packaged component' }];
  const columns = [{ key: 'name', label: 'Name', footer: (rows) => rows.length }] satisfies TableColumn<typeof rows[number]>[];
</script>
<template>
  <UICard title="Installed card" variant="soft"><UIButton>Styled package</UIButton></UICard>
  <UIIcon name="lucide:house" />
  <UIMarkdownEditor model="markdown" label="Installed editor" />
  <UILink href="/#packaged">Packaged link defaults</UILink>
  <UILinkCard to="/" title="Packaged link card" />
  <UITable caption="Installed table" layout="grid" bind:columns="columns" bind:rows="rows" rowKey="id" />
</template>
`

const postcssConfig = String.raw`export default { plugins: [{ postcssPlugin: 'consumer-ui-colors', Declaration(node) {
  if (node.prop === '--ui-color-info-9') node.value = '#123456';
} }] };
`

const stylesSmoke = String.raw`import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const directory = '.meeko/output/node/client/assets';
const files = (await readdir(directory)).filter((file) => file.endsWith('.css'));
assert.ok(files.length, 'UI emits production CSS');
const css = (await Promise.all(files.map((file) => readFile(directory + '/' + file, 'utf8')))).join('\n');
// The consumer's Tailwind compiles the entry of UI from the tarball: its layers and the utilities of a button and a table.
// UI follows Tailwind's layers: its base in ui-base, its hand-written rules in components and its classes in utilities.
assert.match(css, /@layer ui-base\{/);
assert.match(css, /@layer components\{[\s\S]*\.meeko-ui-sr-only\{/);
assert.match(css, /@layer utilities\{[\s\S]*\.aria-busy\\:before\\:animate-spin/);
assert.match(css, /\.\\\[overflow-wrap\\:normal\\\]/);
assert.match(css, /--ui-color-info-9:\s*#123456/);
assert.match(css, /--ui-color-primary:\s*var\(--consumer-primary\)/);
assert.doesNotMatch(css, /@import/);
console.log('Installed UI CSS uses consumer PostCSS and ships as a production asset.');
`

const iconSmoke = String.raw`import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
const files = (await readdir('.meeko/output/node', { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile() && /\.(js|mjs|html)$/.test(entry.name));
const contents = await Promise.all(files.map((entry) => readFile(entry.parentPath + '/' + entry.name, 'utf8')));
assert.ok(contents.some((content) => content.includes('M15 21v-8')), 'UIIcon inlines lucide:house at build time');
console.log('Installed icon module inlines the icon in the build.');
`

const eslintConfig = String.raw`import { defineEslint } from '@meekojs/eslint-plugin';
export default defineEslint({ perfectionist: true, unusedImports: true });
`

/** Escribe `content` en `path`, creando las carpetas que falten. */
function write(path, content) {
	mkdirSync(join(path, '..'), { recursive: true })
	writeFileSync(path, content)
}

/** Lee un manifiesto JSON. */
const readManifest = (path) => JSON.parse(readFileSync(path, 'utf8'))

/**
 * Empaqueta, instala y comprueba todo en `consumerRoot`.
 * @param {string} consumerRoot Directorio temporal propio, fuera del workspace: así una dependencia sin declarar no se cuela por un `node_modules` ancestro.
 * @param {{ offline: boolean, keep: boolean }} options `offline` instala sin red; `keep` conserva el consumidor.
 */
function check(consumerRoot, { offline, keep }) {
	const env = childEnv()
	const tarballs = join(consumerRoot, 'tarballs')
	const consumer = join(consumerRoot, 'consumer')
	mkdirSync(tarballs, { recursive: true })
	mkdirSync(consumer, { recursive: true })

	const dependencies = {
		eslint: '10.13.0',
		prettier: '3.9.10',
		vite: '8.3.5',
		typescript: '7.0.2',
		'@types/node': '24.19.2',
		'@iconify-json/lucide': '1.2.149',
		// The consumer compiles the entry of UI with its own Tailwind: `@import 'tailwindcss'` resolves from it.
		tailwindcss: '4.3.5',
	}
	for (const name of packages) {
		const folder = join(workspace, 'packages', name)
		run('pnpm', ['--dir', folder, 'pack', '--pack-destination', tarballs], { env, failure: `Packing failed: ${name}` })
		const manifest = readManifest(join(folder, 'package.json'))
		const filename = `${manifest.name.replace(/^@/, '').replaceAll('/', '-')}-${manifest.version}.tgz`
		dependencies[manifest.name] = `file:../tarballs/${filename}`
	}
	const ui = readManifest(join(workspace, 'packages/ui/package.json'))
	for (const peer of Object.keys(ui.peerDependenciesMeta ?? {})) dependencies[peer] = ui.peerDependencies[peer]
	write(join(consumer, 'package.json'), `${JSON.stringify({ name: 'meeko-build-consumer', private: true, type: 'module', dependencies }, null, 2)}\n`)

	write(join(consumer, 'smoke.mjs'), exportsSmoke)
	write(join(consumer, 'component-declarations.mjs'), componentDeclarations)
	write(join(consumer, 'main.ts'), mainTs)
	write(join(consumer, 'app/styles/main.css'), "@import 'tailwindcss';\n@import '@meekojs/ui';\n")
	write(join(consumer, 'app/locales/en.json'), '{"hello":"Hello"}')
	write(join(consumer, 'meeko.config.mjs'), meekoConfig)
	write(join(consumer, 'app/pages/index.meeko'), indexPage)
	write(join(consumer, 'postcss.config.mjs'), postcssConfig)
	write(join(consumer, 'styles-smoke.mjs'), stylesSmoke)
	write(join(consumer, 'icon-smoke.mjs'), iconSmoke)
	// User code stays strict: `meeko check` reads this configuration.
	write(join(consumer, 'tsconfig.json'), '{"compilerOptions":{"strict":true,"exactOptionalPropertyTypes":true,"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","skipLibCheck":true}}')
	write(join(consumer, 'eslint.config.mjs'), eslintConfig)
	write(join(consumer, '.prettierrc.json'), '{"plugins":["@meekojs/prettier-plugin"],"useTabs":true}')

	const pnpm = (args, failure, timeout = quick) => run('pnpm', args, { cwd: consumer, env, failure, timeout })
	const node = (script, failure) => run(process.execPath, [script], { cwd: consumer, env, failure, timeout: quick })
	// A genuinely external consumer cannot rely on workspace resolution or cached registry metadata.
	pnpm(['install', '--prefer-offline', '--ignore-scripts', ...(offline ? ['--offline'] : [])], 'Consumer installation failed', defaultTimeout)
	node('smoke.mjs', 'Installed exports smoke failed')
	node('component-declarations.mjs', 'Installed component declaration inventory failed')
	// These are the actual adjacent declarations from the tarball, not regenerated app stubs.
	pnpm(['exec', 'tsc', '--ignoreConfig', '--noEmit', '--strict', '--exactOptionalPropertyTypes', '--allowImportingTsExtensions', '--allowArbitraryExtensions', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'component-declarations.ts'], 'Installed UI component declarations do not resolve in strict NodeNext')
	// TypeScript-ESLint's declarations reference the TS 6 compiler API; TS 7 consumers
	// use skipLibCheck, as in Meeko's generated app configuration. User code stays strict.
	pnpm(['exec', 'tsc', '--ignoreConfig', '--noEmit', '--strict', '--exactOptionalPropertyTypes', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'main.ts'], 'NodeNext consumer type check failed')
	pnpm(['exec', 'meeko', 'check', '.'], 'Installed UI check failed')
	pnpm(['exec', 'eslint', 'app/pages/index.meeko'], 'Installed ESLint plugin failed from its CLI')
	pnpm(['exec', 'prettier', '--write', 'app/pages/index.meeko'], 'Installed Prettier plugin failed from its CLI')
	pnpm(['exec', 'meeko', 'check', '.'], 'A page formatted by the installed Prettier plugin no longer checks')
	pnpm(['exec', 'meeko', 'build', '.'], 'Installed UI build failed', defaultTimeout)
	node('styles-smoke.mjs', 'Installed UI stylesheet smoke failed')
	node('icon-smoke.mjs', 'Installed icon smoke failed')
	console.log(keep ? `Workspace package smoke passed: ${consumer}` : 'Workspace package smoke passed.')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	await runMain(async () => {
		const { values } = parseArgs({ args: legacyArguments(process.argv.slice(2), { Offline: '--offline', Keep: '--keep' }), options: { offline: { type: 'boolean' }, keep: { type: 'boolean' } } })
		const options = { offline: values.offline === true, keep: values.keep === true }
		await withTemporaryDirectory({ prefix: 'meeko-build-consumer-', base: tmpdir(), keep: options.keep }, (directory) => check(directory, options))
	})
}

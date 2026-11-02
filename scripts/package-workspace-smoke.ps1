$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
# Outside the workspace: an undeclared dependency cannot leak through an ancestor node_modules.
$consumerRoot = Join-Path ([IO.Path]::GetTempPath()) ('meeko-build-consumer-' + [guid]::NewGuid().ToString('N'))
$tarballs = Join-Path $consumerRoot 'tarballs'
$consumer = Join-Path $consumerRoot 'consumer'
New-Item -ItemType Directory -Path $tarballs, $consumer -Force | Out-Null

Push-Location $workspace
try {
  $dependencies = [ordered]@{
    eslint = '10.13.0'
    prettier = '3.9.10'
    vite = '8.3.5'
    typescript = '7.0.2'
    '@types/node' = '24.19.2'
  }
  foreach ($name in @('meeko', 'ui', 'i18n', 'prettier-plugin', 'eslint-plugin')) {
    & pnpm --dir (Join-Path $workspace "packages/$name") pack --pack-destination $tarballs
    if ($LASTEXITCODE -ne 0) { throw "Packing failed: $name" }
    $manifest = Get-Content -Raw -LiteralPath (Join-Path $workspace "packages/$name/package.json") | ConvertFrom-Json
    $filename = ($manifest.name -replace '^@', '' -replace '/', '-') + '-' + $manifest.version + '.tgz'
    $dependencies[$manifest.name] = "file:../tarballs/$filename"
  }
  @{ name = 'meeko-build-consumer'; private = $true; type = 'module'; dependencies = $dependencies } |
    ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $consumer 'package.json') -Encoding utf8

  @'
import assert from 'node:assert/strict';
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
for (const name of ['meeko', 'ui', 'i18n', 'prettier-plugin', 'eslint-plugin']) {
  const entry = require.resolve('@meekojs/' + name);
  const metadata = JSON.parse(await readFile(new URL('../package.json', pathToFileURL(entry)), 'utf8'));
  for (const key of Object.keys(metadata.exports)) {
    if (key.includes('*')) continue;
    const specifier = '@meekojs/' + name + (key === '.' ? '' : key.slice(1));
    // Node cannot import a stylesheet: it must resolve to a file of the tarball, for the bundler.
    if (key.endsWith('.css')) assert.ok(existsSync(require.resolve(specifier)), specifier);
    else await import(specifier);
  }
}
assert.equal(signal(3).value, 3);
assert.equal(typeof compile, 'function');
assert.deepEqual(new Linter().verify('<script lang="ts">const name = "Meeko";</script><template><button type="button">{name}</button></template>', defineEslint({ perfectionist: true, unusedImports: true }), { filename: 'App.meeko' }), []);
const formatted = await prettier.format('<template><button type="button">Save</button></template>', { parser: 'meeko', plugins: ['@meekojs/prettier-plugin'] });
assert.match(formatted, /Save/);
console.log('All public package entry points, ESLint and Prettier work from installed tarballs.');
'@ | Set-Content -LiteralPath (Join-Path $consumer 'smoke.mjs') -Encoding utf8
  @'
import { readdir, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
async function declarations(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? declarations(resolve(directory, entry.name)) : entry.name.endsWith('.d.meeko.ts') ? [resolve(directory, entry.name)] : []))).flat();
}
const files = await declarations(resolve('node_modules/@meekojs/ui/dist/app/components'));
if (!files.length) throw new Error('Installed UI contains no component declarations');
const imports = files.map((file, index) => `import type * as Component${index} from './${relative(process.cwd(), file).replaceAll('\\', '/')}';`);
await writeFile('component-declarations.ts', imports.join('\n') + '\nexport type Components = [' + files.map((_file, index) => `typeof Component${index}`).join(', ') + '];\n');
'@ | Set-Content -LiteralPath (Join-Path $consumer 'component-declarations.mjs') -Encoding utf8
  @'
import { signal } from '@meekojs/meeko';
import { defineMeekoModule } from '@meekojs/meeko/framework';
import ui from '@meekojs/ui';
import i18n from '@meekojs/i18n/module';
import { defineEslint } from '@meekojs/eslint-plugin';
import type { MeekoPrettierOptions } from '@meekojs/prettier-plugin';
import { useModal } from '@meekojs/ui/runtime';
const formatting: MeekoPrettierOptions = { meekoIndentSections: true };
export const smoke = { state: signal(1), ui, i18n, useModal, formatting, lint: defineEslint({ perfectionist: true, unusedImports: true }), module: defineMeekoModule({ meta: { name: 'smoke' }, setup() {} }) };
'@ | Set-Content -LiteralPath (Join-Path $consumer 'main.ts') -Encoding utf8
  New-Item -ItemType Directory -Path (Join-Path $consumer 'app/pages') -Force | Out-Null
  'export default { modules: ["@meekojs/ui"], viewTransitions: true, ui: { tokens: { primary: "var(--consumer-primary)" }, defaults: { link: { shape: "pill" } } } };' | Set-Content -LiteralPath (Join-Path $consumer 'meeko.config.mjs') -Encoding utf8
  @'
<script lang="ts">
  import type { TableColumn } from '@meekojs/ui/runtime';
  const rows = [{ id: 1, name: 'Packaged component' }];
  const columns = [{ key: 'name', label: 'Name', footer: (rows) => rows.length }] satisfies TableColumn<typeof rows[number]>[];
</script>
<template>
  <UICard title="Installed card" variant="soft"><UIButton>Styled package</UIButton></UICard>
  <UILink href="/#packaged">Packaged link defaults</UILink>
  <UILinkCard to="/" title="Packaged link card" />
  <UITable caption="Installed table" layout="grid" bind:columns="columns" bind:rows="rows" rowKey="id" />
</template>
'@ | Set-Content -LiteralPath (Join-Path $consumer 'app/pages/index.meeko') -Encoding utf8
  @'
export default { plugins: [{ postcssPlugin: 'consumer-ui-colors', Declaration(node) {
  if (node.prop === '--ui-color-info-9') node.value = '#123456';
} }] };
'@ | Set-Content -LiteralPath (Join-Path $consumer 'postcss.config.mjs') -Encoding utf8
  @'
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const directory = '.meeko/output/node/client/assets';
const files = (await readdir(directory)).filter((file) => file.endsWith('.css'));
assert.ok(files.length, 'UI emits production CSS');
const css = (await Promise.all(files.map((file) => readFile(`${directory}/${file}`, 'utf8')))).join('\n');
assert.match(css, /\.meeko-ui-button/);
assert.match(css, /\.meeko-ui-table/);
assert.match(css, /\.meeko-ui-card/);
assert.match(css, /--ui-color-info-9:\s*#123456/);
assert.match(css, /--ui-color-primary:\s*var\(--consumer-primary\)/);
assert.doesNotMatch(css, /@import/);
console.log('Installed UI CSS uses consumer PostCSS and ships as a production asset.');
'@ | Set-Content -LiteralPath (Join-Path $consumer 'styles-smoke.mjs') -Encoding utf8
  Push-Location $consumer
  try {
    # A genuinely external consumer cannot rely on workspace resolution or cached registry metadata.
    & pnpm install --prefer-offline --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw 'Consumer installation failed' }
    & node smoke.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Installed exports smoke failed' }
    & node component-declarations.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Installed component declaration inventory failed' }
    # These are the actual adjacent declarations from the tarball, not regenerated app stubs.
    & pnpm exec tsc --ignoreConfig --noEmit --strict --allowImportingTsExtensions --allowArbitraryExtensions --target ES2022 --module NodeNext --moduleResolution NodeNext component-declarations.ts
    if ($LASTEXITCODE -ne 0) { throw 'Installed UI component declarations do not resolve in strict NodeNext' }
    # TypeScript-ESLint's declarations reference the TS 6 compiler API; TS 7 consumers
    # use skipLibCheck, as in Meeko's generated app configuration. User code stays strict.
    & pnpm exec tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext main.ts
    if ($LASTEXITCODE -ne 0) { throw 'NodeNext consumer type check failed' }
    & pnpm exec meeko check .
    if ($LASTEXITCODE -ne 0) { throw 'Installed UI check failed' }
    & pnpm exec meeko build .
    if ($LASTEXITCODE -ne 0) { throw 'Installed UI build failed' }
    & node styles-smoke.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Installed UI stylesheet smoke failed' }
  } finally { Pop-Location }
  Write-Host "Workspace package smoke passed: $consumer"
} finally { Pop-Location }

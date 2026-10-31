$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$temporaryRoot = Join-Path $workspace '.meeko'
$consumerRoot = Join-Path $temporaryRoot ('build-consumer-' + [guid]::NewGuid().ToString('N'))
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
    await import('@meekojs/' + name + (key === '.' ? '' : key.slice(1)));
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
import { signal } from '@meekojs/meeko';
import { defineMeekoModule } from '@meekojs/meeko/framework';
import ui from '@meekojs/ui';
import i18n from '@meekojs/i18n/module';
import { defineEslint } from '@meekojs/eslint-plugin';
import type { MeekoPrettierOptions } from '@meekojs/prettier-plugin';
const formatting: MeekoPrettierOptions = { meekoIndentSections: true };
export const smoke = { state: signal(1), ui, i18n, formatting, lint: defineEslint({ perfectionist: true, unusedImports: true }), module: defineMeekoModule({ meta: { name: 'smoke' }, setup() {} }) };
'@ | Set-Content -LiteralPath (Join-Path $consumer 'main.ts') -Encoding utf8
  Push-Location $consumer
  try {
    & pnpm install --offline --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw 'Consumer installation failed' }
    & node smoke.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Installed exports smoke failed' }
    # TypeScript-ESLint's declarations reference the TS 6 compiler API; TS 7 consumers
    # use skipLibCheck, as in Meeko's generated app configuration. User code stays strict.
    & pnpm exec tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext main.ts
    if ($LASTEXITCODE -ne 0) { throw 'NodeNext consumer type check failed' }
  } finally { Pop-Location }
  Write-Host "Workspace package smoke passed: $consumer"
} finally { Pop-Location }

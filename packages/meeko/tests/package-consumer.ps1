$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$testRoot = Join-Path $temporaryRoot ("meeko-package-" + [guid]::NewGuid().ToString('N'))
$consumer = Join-Path $testRoot 'consumer'

try {
  New-Item -ItemType Directory -Path $consumer -Force | Out-Null
  $packageName = (& npm pack $repoRoot --pack-destination $testRoot --silent | Select-Object -Last 1)
  if ($LASTEXITCODE -ne 0 -or !$packageName) { throw 'No se pudo empaquetar Meeko.' }
  $tarball = Join-Path $testRoot $packageName

  Set-Content -LiteralPath (Join-Path $consumer 'package.json') -Encoding utf8 -Value '{"name":"meeko-external-consumer","private":true,"type":"module"}'
  Set-Content -LiteralPath (Join-Path $consumer 'Counter.meeko') -Encoding utf8 -Value @'
<script lang="ts">
import { signal } from "@meekojs/meeko";
interface Props { initial?: number }
const props = defineProps<Props>({ initial: 4 });
const count = signal(props.initial);
</script>
<template>
  <button>{count.value}</button>
</template>
'@
  Set-Content -LiteralPath (Join-Path $consumer 'main.ts') -Encoding utf8 -Value @'
import { hydrate } from "./Counter.meeko";
const root = document.getElementById("app");
if (root) hydrate(root, {});
'@
  Set-Content -LiteralPath (Join-Path $consumer 'index.html') -Encoding utf8 -Value '<!doctype html><html><body><main id="app"></main><script type="module" src="/main.ts"></script></body></html>'
  Set-Content -LiteralPath (Join-Path $consumer 'vite.config.mjs') -Encoding utf8 -Value @'
import { defineConfig } from "vite";
import { meeko } from "@meekojs/meeko/vite";
export default defineConfig({ plugins: [meeko()] });
'@
  Set-Content -LiteralPath (Join-Path $consumer 'tsconfig.json') -Encoding utf8 -Value '{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"noEmit":true,"lib":["ES2022","DOM"],"allowArbitraryExtensions":true,"rootDirs":[".",".meeko/types"]},"include":["main.ts"]}'
  Set-Content -LiteralPath (Join-Path $consumer 'smoke.mjs') -Encoding utf8 -Value @'
import { renderToString } from "./Counter.generated.ts";
import { mountDevtoolsPanel } from "@meekojs/meeko/devtools-ui";
if (!renderToString({}).includes("meeko:text:0-->4")) {
  throw new Error("SSR del paquete instalado produjo un resultado inesperado");
}
if (typeof mountDevtoolsPanel !== "function") {
  throw new Error("El paquete instalado no exporta el panel DevTools");
}
'@

  Set-Content -LiteralPath (Join-Path $consumer 'palette.ts') -Encoding utf8 -Value 'export const names: readonly string[] = ["gray", "blue"];'
  Set-Content -LiteralPath (Join-Path $consumer 'utilities.ts') -Encoding utf8 -Value @'
import { defineUtilities } from "@meekojs/meeko/postcss";
import { names } from "./palette";
export default defineUtilities(({ rule }) => names.map((name) => rule(`.color[data-color='${name}']`, { "--color-1": `var(--${name}-1)` })));
'@
  Set-Content -LiteralPath (Join-Path $consumer 'postcss-smoke.mjs') -Encoding utf8 -Value @'
import postcss from "postcss";
import { meekoUtilities } from "@meekojs/meeko/postcss";
import { resolve } from "node:path";
const result = await postcss([meekoUtilities()]).process('@utilities "./utilities.ts" layer(utilities);', { from: resolve("styles.css") });
if (!/@layer utilities[^]*data-color='blue'[^]*var\(--blue-1\)/.test(result.css)) {
  throw new Error("@utilities del paquete instalado produjo un resultado inesperado:\n" + result.css);
}
const dependencies = result.messages.filter((message) => message.type === "dependency").length;
if (dependencies !== 2 || result.warnings().length) {
  throw new Error(`@utilities no empaquetó el módulo con rolldown (dependencias: ${dependencies}, avisos: ${result.warnings().length})`);
}
'@

  & npm install --prefix $consumer --ignore-scripts --no-audit --no-fund $tarball 'vite@8.3.5'
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar el tarball en el consumidor externo.' }

  Push-Location $consumer
  try {
    $cli = Join-Path $consumer 'node_modules/.bin/meeko.cmd'
    if (!(Test-Path -LiteralPath $cli)) { throw 'El paquete no instaló el comando meeko.' }
    & $cli check Counter.meeko
    if ($LASTEXITCODE -ne 0) { throw 'Falló meeko check desde el paquete instalado.' }
    & $cli compile Counter.meeko Counter.generated.ts
    if ($LASTEXITCODE -ne 0) { throw 'Falló meeko compile desde el paquete instalado.' }
    & node smoke.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Falló SSR desde el paquete instalado.' }
    & node postcss-smoke.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Falló @meekojs/meeko/postcss desde el paquete instalado.' }
    & $cli types Counter.meeko
    if ($LASTEXITCODE -ne 0) { throw 'Falló meeko types desde el paquete instalado.' }
    & node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
    if ($LASTEXITCODE -ne 0) { throw 'Falló TypeScript en el consumidor externo.' }
    & node node_modules/vite/bin/vite.js build
    if ($LASTEXITCODE -ne 0) { throw 'Falló Vite en el consumidor externo.' }

    $starter = Join-Path $testRoot 'starter'
    & $cli init $starter
    if ($LASTEXITCODE -ne 0) { throw 'Falló meeko init desde el paquete instalado.' }
    $starterManifestPath = Join-Path $starter 'package.json'
    $starterManifest = Get-Content -LiteralPath $starterManifestPath -Raw | ConvertFrom-Json
    $packageVersion = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
    if ($starterManifest.dependencies.'@meekojs/meeko' -ne $packageVersion) { throw 'El proyecto generado no fijó la versión instalada de Meeko.' }
    $starterManifest.dependencies.'@meekojs/meeko' = $tarball
    $starterManifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $starterManifestPath -Encoding utf8
    & npm install --prefix $starter --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias del proyecto generado.' }
    & npm run build --prefix $starter
    if ($LASTEXITCODE -ne 0) { throw 'Falló el build SSR del proyecto generado.' }

    $prepared = Join-Path $testRoot 'prepared'
    New-Item -ItemType Directory -Path $prepared -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $prepared 'package.json') -Encoding utf8 -Value '{"name":"existing-shell","type":"commonjs","scripts":{"test":"echo original"},"dependencies":{"@meekojs/meeko":"^0.0.2"}}'
    Set-Content -LiteralPath (Join-Path $prepared 'pnpm-workspace.yaml') -Encoding utf8 -Value "minimumReleaseAgeExclude:`n  - '@meekojs/meeko@0.0.2'`n"
    Set-Content -LiteralPath (Join-Path $prepared 'pnpm-lock.yaml') -Encoding utf8 -Value "lockfileVersion: '9.0'`n"
    & $cli init $prepared
    if ($LASTEXITCODE -ne 0) { throw 'Falló meeko init en un directorio preparado por pnpm.' }
    $preparedManifestPath = Join-Path $prepared 'package.json'
    $preparedManifest = Get-Content -LiteralPath $preparedManifestPath -Raw | ConvertFrom-Json
    if ($preparedManifest.scripts.test -ne 'echo original' -or $preparedManifest.dependencies.'@meekojs/meeko' -ne $packageVersion) {
      throw 'meeko init no conservó el manifiesto o no fijó la versión instalada.'
    }
    $preparedManifest.dependencies.'@meekojs/meeko' = $tarball
    $preparedManifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $preparedManifestPath -Encoding utf8
    & pnpm -C $prepared install --no-frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar el proyecto preparado con pnpm.' }
    & pnpm -C $prepared run build
    if ($LASTEXITCODE -ne 0) { throw 'Falló el build SSR del proyecto preparado con pnpm.' }
  } finally {
    Pop-Location
  }
  Write-Output 'Consumidor externo: CLI, tipos, Vite e init SSR OK.'
} finally {
  $resolvedTarget = [System.IO.Path]::GetFullPath($testRoot)
  if ($resolvedTarget.StartsWith($temporaryRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTarget)) {
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
  }
}

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
interface Props { initial: number }
const props = defineProps<Props>();
const count = signal(props.initial);
</script>
<template>
  <button>{count.value}</button>
</template>
'@
  Set-Content -LiteralPath (Join-Path $consumer 'main.ts') -Encoding utf8 -Value @'
import { hydrate } from "./Counter.meeko";
const root = document.getElementById("app");
if (root) hydrate(root, { initial: 4 });
'@
  Set-Content -LiteralPath (Join-Path $consumer 'index.html') -Encoding utf8 -Value '<!doctype html><html><body><main id="app"></main><script type="module" src="/main.ts"></script></body></html>'
  Set-Content -LiteralPath (Join-Path $consumer 'vite.config.mjs') -Encoding utf8 -Value @'
import { defineConfig } from "vite";
import { meeko } from "@meekojs/meeko/vite";
export default defineConfig({ plugins: [meeko()] });
'@
  Set-Content -LiteralPath (Join-Path $consumer 'tsconfig.json') -Encoding utf8 -Value '{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"noEmit":true,"lib":["ES2022","DOM"],"allowArbitraryExtensions":true},"include":["main.ts"]}'
  Set-Content -LiteralPath (Join-Path $consumer 'smoke.mjs') -Encoding utf8 -Value @'
import { renderToString } from "./Counter.generated.ts";
if (!renderToString({ initial: 4 }).includes("meeko:text:0-->4")) {
  throw new Error("SSR del paquete instalado produjo un resultado inesperado");
}
'@

  & npm install --prefix $consumer --ignore-scripts --no-audit --no-fund $tarball 'vite@8.3.5'
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar el tarball en el consumidor externo.' }

  Push-Location $consumer
  try {
    $cli = Join-Path $consumer 'node_modules/@meekojs/meeko/dist/cli.js'
    & node $cli check Counter.meeko
    if ($LASTEXITCODE -ne 0) { throw 'Falló meeko check desde el paquete instalado.' }
    & node $cli compile Counter.meeko Counter.generated.ts
    if ($LASTEXITCODE -ne 0) { throw 'Falló meeko compile desde el paquete instalado.' }
    & node smoke.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Falló SSR desde el paquete instalado.' }
    & node $cli types Counter.meeko
    if ($LASTEXITCODE -ne 0) { throw 'Falló meeko types desde el paquete instalado.' }
    & node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
    if ($LASTEXITCODE -ne 0) { throw 'Falló TypeScript en el consumidor externo.' }
    & node node_modules/vite/bin/vite.js build
    if ($LASTEXITCODE -ne 0) { throw 'Falló Vite en el consumidor externo.' }
  } finally {
    Pop-Location
  }
  Write-Output 'Consumidor externo: CLI, tipos y Vite OK.'
} finally {
  $resolvedTarget = [System.IO.Path]::GetFullPath($testRoot)
  if ($resolvedTarget.StartsWith($temporaryRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTarget)) {
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
  }
}

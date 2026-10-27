param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version
)

$ErrorActionPreference = 'Stop'
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$testRoot = Join-Path $temporaryRoot ("meeko-registry-measure-" + [guid]::NewGuid().ToString('N'))
$consumer = Join-Path $testRoot 'consumer'
$npmCache = Join-Path $testRoot 'npm-cache'

try {
  New-Item -ItemType Directory -Path $consumer, $npmCache -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $consumer 'package.json') -Encoding utf8 -Value '{"name":"meeko-registry-measure","private":true,"type":"module"}'
  Set-Content -LiteralPath (Join-Path $consumer 'Counter.meeko') -Encoding utf8 -Value @'
<script lang="ts">
import { signal } from "@meekojs/meeko";
interface Props { initial: number }
const props = defineProps<Props>();
const count = signal(props.initial);
</script>
<template><button>{count.value}</button></template>
'@
  Set-Content -LiteralPath (Join-Path $consumer 'ssr.mjs') -Encoding utf8 -Value @'
const started = performance.now();
const { renderToString } = await import("./Counter.generated.ts");
const imported = performance.now();
const html = renderToString({ initial: 4 });
const rendered = performance.now();
if (!html.includes("meeko:text:0-->4")) throw new Error("SSR inesperado");
process.stdout.write(JSON.stringify({ importMs: imported - started, renderMs: rendered - imported }));
'@

  Push-Location $consumer
  try {
    $installTimer = [System.Diagnostics.Stopwatch]::StartNew()
    & npm install --ignore-scripts --no-audit --no-fund --cache $npmCache "@meekojs/meeko@$Version" | Out-Null
    $installTimer.Stop()
    if ($LASTEXITCODE -ne 0) { throw 'Falló la instalación desde npm.' }

    $installedVersion = (Get-Content -LiteralPath 'node_modules/@meekojs/meeko/package.json' -Raw | ConvertFrom-Json).version
    if ($installedVersion -ne $Version) { throw "Se instaló $installedVersion en lugar de $Version." }
    $installedBytes = (Get-ChildItem -LiteralPath 'node_modules' -File -Recurse | Measure-Object -Property Length -Sum).Sum
    $meekoBytes = (Get-ChildItem -LiteralPath 'node_modules/@meekojs/meeko' -File -Recurse | Measure-Object -Property Length -Sum).Sum

    $compileTimer = [System.Diagnostics.Stopwatch]::StartNew()
    $cli = Join-Path $consumer 'node_modules/.bin/meeko.cmd'
    & $cli compile Counter.meeko Counter.generated.ts | Out-Null
    $compileTimer.Stop()
    if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación del componente.' }

    $starts = @()
    for ($run = 0; $run -lt 7; $run++) {
      $processTimer = [System.Diagnostics.Stopwatch]::StartNew()
      $raw = & node ssr.mjs
      $processTimer.Stop()
      if ($LASTEXITCODE -ne 0) { throw 'Falló el proceso SSR.' }
      $sample = $raw | ConvertFrom-Json
      $starts += [pscustomobject]@{
        processMs = [math]::Round($processTimer.Elapsed.TotalMilliseconds, 2)
        importMs = [math]::Round($sample.importMs, 2)
        renderMs = [math]::Round($sample.renderMs, 3)
      }
    }

    [pscustomobject]@{
      package = "@meekojs/meeko@$Version"
      node = (& node --version)
      installMs = [math]::Round($installTimer.Elapsed.TotalMilliseconds, 2)
      installedBytes = $installedBytes
      meekoBytes = $meekoBytes
      compileMs = [math]::Round($compileTimer.Elapsed.TotalMilliseconds, 2)
      starts = $starts
    } | ConvertTo-Json -Depth 5
  } finally {
    Pop-Location
  }
} finally {
  $resolvedTarget = [System.IO.Path]::GetFullPath($testRoot)
  if ($resolvedTarget.StartsWith($temporaryRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTarget)) {
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
  }
}

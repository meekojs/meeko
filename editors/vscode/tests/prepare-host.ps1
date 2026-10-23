$ErrorActionPreference = 'Stop'

$editorRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $editorRoot '../..')).Path
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$testRoot = Join-Path $temporaryRoot ("meeko-host-" + [guid]::NewGuid().ToString('N'))
$consumer = Join-Path $testRoot 'consumer'
$extension = Join-Path $testRoot 'vsix/extension'
$vscode = Join-Path $env:LOCALAPPDATA 'Programs/Microsoft VS Code/Code.exe'
$vsix = Join-Path $editorRoot 'artifacts/meeko-language-0.0.1-win32-x64.vsix'

if (!(Test-Path -LiteralPath $vscode)) { throw "No se encontró VS Code: $vscode" }
if (!(Test-Path -LiteralPath $vsix)) { throw "Primero ejecuta pnpm run package:vsix: $vsix" }

try {
  New-Item -ItemType Directory -Path $consumer -Force | Out-Null
  Expand-Archive -LiteralPath $vsix -DestinationPath (Join-Path $testRoot 'vsix')
  Set-Content -LiteralPath (Join-Path $consumer 'package.json') -Encoding utf8 -Value '{"name":"meeko-consumer-test","private":true,"type":"module"}'
  Set-Content -LiteralPath (Join-Path $consumer 'Counter.meeko') -Encoding utf8 -Value @'
<script lang="ts">
import { signal } from "meeko";
const count=signal(0);
const bad: number = "invalid";
</script>
<template>
  <button on:click="() => count.value++">{count.value}</button>
</template>
'@
  $packageName = (& npm pack $repoRoot --pack-destination $testRoot --silent | Select-Object -Last 1)
  if ($LASTEXITCODE -ne 0 -or !$packageName) { throw 'No se pudo empaquetar el motor Meeko.' }
  & npm install --prefix $consumer --ignore-scripts --no-audit --no-fund (Join-Path $testRoot $packageName)
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar Meeko en el proyecto consumidor.' }

  $env:MEEKO_HOST_VSCODE = $vscode
  $env:MEEKO_HOST_EXTENSION = $extension
  $env:MEEKO_HOST_CONSUMER = $consumer
  $env:MEEKO_HOST_DATA = Join-Path $testRoot 'user-data'
  Push-Location $editorRoot
  try {
    & pnpm run test:host
    if ($LASTEXITCODE -ne 0) { throw 'Falló la prueba en VS Code.' }
  } finally {
    Pop-Location
  }
} finally {
  Remove-Item Env:MEEKO_HOST_VSCODE, Env:MEEKO_HOST_EXTENSION, Env:MEEKO_HOST_CONSUMER, Env:MEEKO_HOST_DATA -ErrorAction SilentlyContinue
  $resolvedTarget = [System.IO.Path]::GetFullPath($testRoot)
  if ($resolvedTarget.StartsWith($temporaryRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTarget)) {
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
  }
}

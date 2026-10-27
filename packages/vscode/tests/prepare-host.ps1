param([string] $VSCodeExecutable)

$ErrorActionPreference = 'Stop'

$editorRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$packageRoot = (Resolve-Path -LiteralPath (Join-Path $editorRoot '../meeko')).Path
$manifest = Get-Content -LiteralPath (Join-Path $editorRoot 'package.json') -Raw | ConvertFrom-Json
$targetOs = if ($IsWindows) { 'win32' } elseif ($IsLinux) { 'linux' } elseif ($IsMacOS) { 'darwin' } else { throw 'Sistema operativo no admitido por las pruebas host.' }
$targetCpu = switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()) {
  'X64' { 'x64' }
  'Arm64' { 'arm64' }
  default { throw 'Arquitectura no admitida por las pruebas host.' }
}
$target = "$targetOs-$targetCpu"
$temporaryRoot = if ($IsWindows) { [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()) } else { '/tmp' }
$testRoot = Join-Path $temporaryRoot ("meeko-host-" + [guid]::NewGuid().ToString('N'))
$consumer = Join-Path $testRoot 'consumer'
$extension = Join-Path $testRoot 'vsix/extension'
$vscode = $VSCodeExecutable
if (!$vscode -and $IsWindows) { $vscode = Join-Path $env:LOCALAPPDATA 'Programs/Microsoft VS Code/Code.exe' }
if (!$vscode -and !$IsWindows) {
  $codeCommand = Get-Command code -ErrorAction SilentlyContinue
  if ($codeCommand) { $vscode = $codeCommand.Source }
}
$vsix = Join-Path $editorRoot "artifacts/$($manifest.name)-$($manifest.version)-$target.vsix"

if ($vscode -and !(Test-Path -LiteralPath $vscode -PathType Leaf)) {
  if ($VSCodeExecutable) { throw "No se encontró el ejecutable de VS Code indicado: $vscode" }
  $vscode = $null
}
if (!(Test-Path -LiteralPath $vsix)) { throw "Primero genera el VSIX para ${target}: $vsix" }

try {
  New-Item -ItemType Directory -Path $consumer -Force | Out-Null
  $extractionRoot = Join-Path $testRoot 'vsix'
  if ($IsWindows) {
    Expand-Archive -LiteralPath $vsix -DestinationPath $extractionRoot
  } else {
    New-Item -ItemType Directory -Path $extractionRoot -Force | Out-Null
    & unzip -q $vsix -d $extractionRoot
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo extraer el VSIX conservando permisos Unix.' }
  }
  Set-Content -LiteralPath (Join-Path $consumer 'package.json') -Encoding utf8 -Value '{"name":"meeko-consumer-test","private":true,"type":"module"}'
  Set-Content -LiteralPath (Join-Path $consumer 'Counter.meeko') -Encoding utf8 -Value @'
<script lang="ts">
import { signal } from "@meekojs/meeko";
const count=signal(0);
const bad: number = "invalid";
</script>
<template><button  class="counter" on:click="() => count.value++">{count.value}</button></template>
<style>.counter{color:red;}</style>
'@
  Set-Content -LiteralPath (Join-Path $consumer 'Semantic.meeko') -Encoding utf8 -Value @'
<script lang="ts">
const title = "Hola";
const enabled = true;
const items = [{ name: "Ada" }];
const handler = () => title;
const chosen = { name: "Ada" };
let mutable = 1;
</script>
<template>
  <button on:click="handler" if:condition="enabled" bind:title="title">{title} {chosen.name}</button>
  <ul><li each:of="items" each:as="item">{item.name}</li></ul>
  <component is="chosen"></component>
  <p>{chosen?.name} {mutable} {title}</p>
</template>
'@
  Set-Content -LiteralPath (Join-Path $consumer 'answer.ts') -Encoding utf8 -Value 'export const answer = "ok";'
  Set-Content -LiteralPath (Join-Path $consumer 'Imported.meeko') -Encoding utf8 -Value '<script lang="ts">import { answer } from "./answer.js"; const text: string = answer;</script><template>{text}</template>'
  New-Item -ItemType Directory -Path (Join-Path $consumer 'app/pages'), (Join-Path $consumer 'app/layouts') -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $consumer 'app/pages/index.meeko') -Encoding utf8 -Value '<script lang="ts"></script><template><p>Home</p></template>'
  Set-Content -LiteralPath (Join-Path $consumer 'contract-data.ts') -Encoding utf8 -Value 'export type Data = string;'
  Set-Content -LiteralPath (Join-Path $consumer 'app/pages/dependent.meeko') -Encoding utf8 -Value '<script lang="ts">const props = defineProps<{ data: string }>();</script><template><p>{props.data}</p></template>'
  Set-Content -LiteralPath (Join-Path $consumer 'app/pages/dependent.route.ts') -Encoding utf8 -Value @'
import { definePage } from "@meekojs/meeko/framework";
import type { Data } from "../../contract-data.js";
export const route = definePage({ load: (): Data => null as unknown as Data });
'@
  Set-Content -LiteralPath (Join-Path $consumer 'app/pages/zones.meeko') -Encoding utf8 -Value @'
<script server lang="ts">
import { definePage } from "@meekojs/meeko/framework";
export const route = definePage({ load: () => ({ title: "Zones" }) });
</script>
<script lang="ts">
import { signal } from "@meekojs/meeko";
const props = defineProps<{ data: { title: string } }>();
const count = signal(0);
onMounted(() => {
  count.value = 1;
});
</script>
<template><p>{props.data.title} {count.value}</p></template>
'@
  Set-Content -LiteralPath (Join-Path $consumer 'app/layouts/default.meeko') -Encoding utf8 -Value '<script lang="ts">const props = defineProps<{ outlet: object; missing: string }>();</script><template><p>Layout</p></template>'
  $packageName = (& npm pack $packageRoot --pack-destination $testRoot --silent | Select-Object -Last 1)
  if ($LASTEXITCODE -ne 0 -or !$packageName) { throw 'No se pudo empaquetar el motor Meeko.' }
  & npm install --prefix $consumer --ignore-scripts --no-audit --no-fund (Join-Path $testRoot $packageName)
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar Meeko en el proyecto consumidor.' }

  if ($vscode) { $env:MEEKO_HOST_VSCODE = $vscode }
  else { Remove-Item Env:MEEKO_HOST_VSCODE -ErrorAction SilentlyContinue }
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

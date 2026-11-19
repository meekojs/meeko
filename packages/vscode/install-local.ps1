# Compatibilidad con la orden anterior: la instalación vive en install-local.mjs.
param(
  [switch] $UseExistingVsix,
  [string] $CodeCommand,
  [switch] $ShowCliDeprecations
)

$ErrorActionPreference = 'Stop'
$arguments = @((Join-Path $PSScriptRoot 'install-local.mjs'))
if ($UseExistingVsix) { $arguments += '--use-existing-vsix' }
if ($CodeCommand) { $arguments += @('--code', $CodeCommand) }
if ($ShowCliDeprecations) { $arguments += '--show-cli-deprecations' }
& node @arguments
if ($LASTEXITCODE -ne 0) { throw 'Falló la instalación local en VS Code.' }

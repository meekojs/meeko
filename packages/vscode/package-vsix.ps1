# Compatibilidad con scripts/package-vsix-matrix.ps1 y la CI: el empaquetado vive en package-vsix.mjs.
param(
  [ValidateSet('win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64')]
  [string] $Target,
  [switch] $SkipBuild
)

$ErrorActionPreference = 'Stop'
$arguments = @((Join-Path $PSScriptRoot 'package-vsix.mjs'))
if ($Target) { $arguments += @('--target', $Target) }
if ($SkipBuild) { $arguments += '--skip-build' }
& node @arguments
if ($LASTEXITCODE -ne 0) { throw 'Falló la creación del VSIX.' }

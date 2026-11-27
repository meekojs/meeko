# Compatibilidad con la documentación y los scripts anteriores: la comprobación vive en package-workspace-smoke.mjs.
param([switch] $Offline)

$ErrorActionPreference = 'Stop'
$arguments = @((Join-Path $PSScriptRoot 'package-workspace-smoke.mjs'))
if ($Offline) { $arguments += '--offline' }
& node @arguments
if ($LASTEXITCODE -ne 0) { throw 'Falló el humo de los paquetes del workspace.' }

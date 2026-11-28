# Compatibilidad con la documentación y los scripts anteriores: la preparación vive en prepare-host.mjs.
param([string] $VSCodeExecutable)

$ErrorActionPreference = 'Stop'
$arguments = @((Join-Path $PSScriptRoot 'prepare-host.mjs'))
if ($VSCodeExecutable) { $arguments += @('--vscode-executable', $VSCodeExecutable) }
& node @arguments
if ($LASTEXITCODE -ne 0) { throw 'Fallaron las pruebas de host de VS Code.' }

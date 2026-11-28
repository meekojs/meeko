# Compatibilidad con la documentación y los scripts anteriores: la comprobación vive en package-consumer.mjs.
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'package-consumer.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Falló la comprobación del consumidor externo.' }

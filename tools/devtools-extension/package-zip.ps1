param(
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$extensionRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = Get-Content -LiteralPath (Join-Path $extensionRoot 'manifest.json') -Raw | ConvertFrom-Json

if (-not $OutputPath) {
  $OutputPath = Join-Path $extensionRoot "artifacts/meeko-devtools-$($manifest.version).zip"
}
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $resolvedOutput) {
  throw "El archivo ya existe: $resolvedOutput. Elige otra ruta o elimínalo explícitamente antes de volver a empaquetar."
}

# Lista cerrada: el ZIP distribuible no incluye pruebas ni herramientas de desarrollo.
$files = @(
  'manifest.json',
  'devtools.html',
  'devtools.js',
  'panel.html',
  'panel.js',
  'panel.css',
  'protocol.js',
  'meeko-logo.png',
  'README.md'
)
foreach ($file in $files) {
  if (-not (Test-Path -LiteralPath (Join-Path $extensionRoot $file) -PathType Leaf)) {
    throw "Falta un archivo de la extensión: $file"
  }
}

$outputDirectory = Split-Path -Parent $resolvedOutput
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$archive = [System.IO.Compression.ZipFile]::Open($resolvedOutput, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in $files) {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive,
      (Join-Path $extensionRoot $file),
      "meeko-devtools/$file",
      [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
} finally {
  $archive.Dispose()
}

$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedOutput
Write-Output "Archivo: $resolvedOutput"
Write-Output "SHA256: $($hash.Hash)"

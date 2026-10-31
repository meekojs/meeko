param(
  [switch] $UseExistingVsix,
  [string] $CodeCommand = 'code',
  [switch] $ShowCliDeprecations
)

$ErrorActionPreference = 'Stop'

$codeCli = Get-Command $CodeCommand -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (!$codeCli) {
  throw "No se encuentra '$CodeCommand'. Añade el CLI de VS Code al PATH o indica -CodeCommand <ruta>."
}

$hostOs = if ($IsWindows) { 'win32' } elseif ($IsLinux) { 'linux' } elseif ($IsMacOS) { 'darwin' } else { throw 'Sistema operativo no admitido.' }
$hostCpu = switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()) {
  'X64' { 'x64' }
  'Arm64' { 'arm64' }
  default { throw 'Arquitectura no admitida.' }
}
$target = "$hostOs-$hostCpu"
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json
$vsix = Join-Path $PSScriptRoot "artifacts/$($manifest.name)-$($manifest.version)-$target.vsix"

if (!$UseExistingVsix) {
  & pwsh -NoProfile -File (Join-Path $PSScriptRoot 'package-vsix.ps1') -Target $target
  if ($LASTEXITCODE -ne 0) { throw 'Falló la creación del VSIX; no se ha instalado.' }
}

if (!(Test-Path -LiteralPath $vsix -PathType Leaf)) {
  throw "No existe el VSIX: $vsix. Ejecuta el script sin -UseExistingVsix para generarlo."
}

$archive = [System.IO.Compression.ZipFile]::OpenRead($vsix)
try {
  $entry = $archive.GetEntry('extension/syntaxes/meeko.tmLanguage.json')
  if (!$entry) { throw 'El VSIX no contiene la gramática de Meeko.' }
  $reader = [System.IO.StreamReader]::new($entry.Open())
  try { $packagedGrammar = $reader.ReadToEnd() | ConvertFrom-Json -AsHashtable | ConvertTo-Json -Depth 100 -Compress }
  finally { $reader.Dispose() }
} finally { $archive.Dispose() }

if (!$UseExistingVsix) {
  $sourceGrammar = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'syntaxes/meeko.tmLanguage.json') -Raw | ConvertFrom-Json -AsHashtable | ConvertTo-Json -Depth 100 -Compress
  if ($sourceGrammar -cne $packagedGrammar) { throw 'La gramática cambió durante el empaquetado. Guarda el archivo y vuelve a ejecutar el script.' }
}

$extensionId = "$($manifest.publisher).$($manifest.name)"
$previousNodeOptions = $env:NODE_OPTIONS
try {
  # VS Code's gallery request still uses url.parse(): microsoft/vscode#319867.
  # Scope the workaround to its CLI; keep all other warnings and restore the caller's environment.
  if (!$ShowCliDeprecations) {
    $env:NODE_OPTIONS = (@($previousNodeOptions, '--disable-warning=DEP0169') | Where-Object { $_ }) -join ' '
  }
  & $codeCli.Source --install-extension $vsix --force
  if ($LASTEXITCODE -ne 0) { throw 'Falló la instalación local en VS Code.' }

  $location = & $codeCli.Source --locate-extension $extensionId
  if ($LASTEXITCODE -ne 0 -or !$location) { throw 'No se puede localizar la extensión instalada.' }
} finally {
  $env:NODE_OPTIONS = $previousNodeOptions
}
$installedGrammar = Join-Path ([string](@($location)[-1])) 'syntaxes/meeko.tmLanguage.json'
if (!(Test-Path -LiteralPath $installedGrammar -PathType Leaf)) { throw 'No se encuentra la gramática instalada.' }
$installedContents = Get-Content -LiteralPath $installedGrammar -Raw | ConvertFrom-Json -AsHashtable | ConvertTo-Json -Depth 100 -Compress
if ($installedContents -cne $packagedGrammar) {
  throw 'La gramática instalada no coincide con el VSIX. Revisa la instalación de VS Code.'
}

Write-Output "Instalada $($manifest.publisher).$($manifest.name) $($manifest.version) ($target)."
Write-Output 'En VS Code ejecuta Developer: Reload Window para cargar los cambios.'

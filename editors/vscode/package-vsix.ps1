param(
  [ValidateSet('win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64')]
  [string] $Target
)

$ErrorActionPreference = 'Stop'

if (!$Target) {
  $hostOs = if ($IsWindows) { 'win32' } elseif ($IsLinux) { 'linux' } elseif ($IsMacOS) { 'darwin' } else { throw 'Sistema operativo no admitido para el VSIX.' }
  $hostCpu = switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()) {
    'X64' { 'x64' }
    'Arm64' { 'arm64' }
    default { throw 'Arquitectura no admitida para el VSIX.' }
  }
  $Target = "$hostOs-$hostCpu"
}

$extensionRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$manifest = Get-Content -LiteralPath (Join-Path $extensionRoot 'package.json') -Raw | ConvertFrom-Json
$typescriptManifest = Get-Content -LiteralPath (Join-Path $extensionRoot 'node_modules/typescript/package.json') -Raw | ConvertFrom-Json
$targetOs, $targetCpu = $Target.Split('-')
$nativePackage = "typescript-$Target"
$nativeExecutable = if ($targetOs -eq 'win32') { 'tsc.exe' } else { 'tsc' }
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$stagingRoot = Join-Path $temporaryRoot ("meeko-vsix-" + [guid]::NewGuid().ToString('N'))
$outputDirectory = Join-Path $extensionRoot 'artifacts'
$outputFile = Join-Path $outputDirectory ("$($manifest.name)-$($manifest.version)-$Target.vsix")

if ($typescriptManifest.optionalDependencies.PSObject.Properties.Name -notcontains "@typescript/$nativePackage") {
  throw "TypeScript $($typescriptManifest.version) no distribuye el binario nativo para $Target."
}

try {
  Push-Location $extensionRoot
  & pnpm run check
  if ($LASTEXITCODE -ne 0) { throw 'Falló la comprobación de tipos.' }
  & pnpm run build
  if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación de la extensión.' }

  New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
  foreach ($name in @('package.json', 'README.md', 'language-configuration.json', '.vscodeignore')) {
    Copy-Item -LiteralPath (Join-Path $extensionRoot $name) -Destination $stagingRoot
  }
  Copy-Item -LiteralPath (Join-Path $extensionRoot '../../LICENSE') -Destination $stagingRoot
  foreach ($name in @('dist', 'syntaxes', 'icons')) {
    Copy-Item -LiteralPath (Join-Path $extensionRoot $name) -Destination $stagingRoot -Recurse
  }

  Push-Location $stagingRoot
  try {
    & npm install --omit=dev --ignore-scripts --no-audit --no-fund --os=$targetOs --cpu=$targetCpu
    if ($LASTEXITCODE -ne 0) { throw 'Falló la instalación aislada de TypeScript.' }
    $nativePath = Join-Path $stagingRoot "node_modules/@typescript/$nativePackage/lib/$nativeExecutable"
    if (!(Test-Path -LiteralPath $nativePath -PathType Leaf)) {
      throw "Falta el ejecutable nativo de TypeScript para $Target en el paquete aislado."
    }
    $installedNativePackages = @(Get-ChildItem -LiteralPath (Join-Path $stagingRoot 'node_modules/@typescript') -Directory -Filter 'typescript-*' | Select-Object -ExpandProperty Name)
    if ($installedNativePackages.Count -ne 1 -or $installedNativePackages[0] -ne $nativePackage) {
      throw "El paquete aislado contiene binarios nativos inesperados: $($installedNativePackages -join ', ')."
    }
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
    & pnpm dlx '@vscode/vsce@4.0.0' package --target $Target --allow-missing-repository --out $outputFile
    if ($LASTEXITCODE -ne 0) { throw 'Falló la creación del VSIX.' }
    $binaryEntry = "extension/node_modules/@typescript/$nativePackage/lib/$nativeExecutable"
    if ($targetOs -ne 'win32') {
      # Corrige sólo la metadata ZIP: reescribir el archivo con ZipArchive corrompe firmas binarias del paquete.
      & node (Join-Path $extensionRoot 'scripts/set-vsix-executable.mjs') $outputFile $binaryEntry
      if ($LASTEXITCODE -ne 0) { throw 'No se pudo restaurar el bit de ejecución del binario TypeScript.' }
    }
    $archive = [System.IO.Compression.ZipFile]::OpenRead($outputFile)
    try {
      $binary = $archive.GetEntry($binaryEntry)
      if (!$binary) { throw "El VSIX no contiene $binaryEntry." }
      if ($targetOs -ne 'win32') {
        $mode = ($binary.ExternalAttributes -shr 16) -band 0x1FF
        if ($mode -ne 0x1ED) { throw "El ejecutable de $Target carece del modo 0755." }
      }
      $nativeEntries = @($archive.Entries | Where-Object {
        $_.FullName -match '^extension/node_modules/@typescript/typescript-(?:win32|linux|darwin)-[^/]+/lib/tsc(?:\.exe)?$'
      })
      if ($nativeEntries.Count -ne 1) {
        throw "El VSIX contiene $($nativeEntries.Count) ejecutables nativos de TypeScript; se esperaba uno."
      }
    } finally {
      $archive.Dispose()
    }
  } finally {
    Pop-Location
  }
  Write-Output $outputFile
} finally {
  Pop-Location
  $resolvedTarget = [System.IO.Path]::GetFullPath($stagingRoot)
  if ($resolvedTarget.StartsWith($temporaryRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTarget)) {
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
  }
}

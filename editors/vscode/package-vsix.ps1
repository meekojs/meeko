$ErrorActionPreference = 'Stop'

$extensionRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$stagingRoot = Join-Path $temporaryRoot ("meeko-vsix-" + [guid]::NewGuid().ToString('N'))
$outputDirectory = Join-Path $extensionRoot 'artifacts'
$outputFile = Join-Path $outputDirectory 'meeko-language-0.0.1-win32-x64.vsix'

try {
  & pnpm run check
  if ($LASTEXITCODE -ne 0) { throw 'Falló la comprobación de tipos.' }
  & pnpm run build
  if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación de la extensión.' }

  New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
  foreach ($name in @('package.json', 'README.md', 'language-configuration.json', '.vscodeignore')) {
    Copy-Item -LiteralPath (Join-Path $extensionRoot $name) -Destination $stagingRoot
  }
  foreach ($name in @('dist', 'syntaxes', 'icons')) {
    Copy-Item -LiteralPath (Join-Path $extensionRoot $name) -Destination $stagingRoot -Recurse
  }

  Push-Location $stagingRoot
  try {
    & npm install --omit=dev --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Falló la instalación aislada de TypeScript.' }
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
    & pnpm dlx '@vscode/vsce@4.0.0' package --target win32-x64 --allow-missing-repository --out $outputFile
    if ($LASTEXITCODE -ne 0) { throw 'Falló la creación del VSIX.' }
  } finally {
    Pop-Location
  }
  Write-Output $outputFile
} finally {
  $resolvedTarget = [System.IO.Path]::GetFullPath($stagingRoot)
  if ($resolvedTarget.StartsWith($temporaryRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTarget)) {
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
  }
}

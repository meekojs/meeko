param(
  [Parameter(Mandatory)] [string] $ExpectedVersion,
  [Parameter(Mandatory)] [string] $OutputDirectory
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$extensionRoot = Join-Path $repositoryRoot 'packages/vscode'
$manifest = Get-Content -LiteralPath (Join-Path $extensionRoot 'package.json') -Raw | ConvertFrom-Json
if ($manifest.version -cne $ExpectedVersion) {
  throw "VS Code manifest version $($manifest.version) does not match $ExpectedVersion."
}
$output = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $output -Force | Out-Null

& pnpm -F meeko-language run check
if ($LASTEXITCODE -ne 0) { throw 'VS Code check failed.' }
& pnpm -F meeko-language run build
if ($LASTEXITCODE -ne 0) { throw 'VS Code build failed.' }
foreach ($target in @(& (Join-Path $PSScriptRoot 'vsix-targets.ps1'))) {
  & pwsh -NoProfile -File (Join-Path $extensionRoot 'package-vsix.ps1') -Target $target -SkipBuild
  if ($LASTEXITCODE -ne 0) { throw "VSIX packaging failed for $target." }
  $name = "meeko-language-$ExpectedVersion-$target.vsix"
  $source = Join-Path $extensionRoot "artifacts/$name"
  if (!(Test-Path -LiteralPath $source -PathType Leaf)) { throw "VSIX is missing: $source" }
  Copy-Item -LiteralPath $source -Destination (Join-Path $output $name) -Force
}
& (Join-Path $PSScriptRoot 'release-assets.ps1') -Directory $output -VscodeVersion $ExpectedVersion

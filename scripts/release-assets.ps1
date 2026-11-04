param(
  [Parameter(Mandatory)] [string] $Directory,
  [Parameter(Mandatory)] [string] $VscodeVersion,
  [string] $DevtoolsVersion,
  [switch] $WriteChecksums,
  [switch] $VerifyChecksums
)

$ErrorActionPreference = 'Stop'
$targets = @(& (Join-Path $PSScriptRoot 'vsix-targets.ps1'))
$expected = @($targets | ForEach-Object { "meeko-language-$VscodeVersion-$_.vsix" })
if ($DevtoolsVersion) { $expected += "meeko-devtools-$DevtoolsVersion.zip" }
if ($WriteChecksums -and $VerifyChecksums) { throw 'Choose either -WriteChecksums or -VerifyChecksums.' }
if (($WriteChecksums -or $VerifyChecksums) -and !$DevtoolsVersion) { throw 'Checksums require -DevtoolsVersion.' }

$root = [System.IO.Path]::GetFullPath($Directory)
if (!(Test-Path -LiteralPath $root -PathType Container)) { throw "Asset directory does not exist: $root" }
$actual = @(Get-ChildItem -LiteralPath $root -File | Select-Object -ExpandProperty Name)
$allowed = @($expected)
if ($WriteChecksums -or $VerifyChecksums) { $allowed += 'SHA256SUMS.txt' }
$missing = @($expected | Where-Object { $_ -cnotin $actual })
$unexpected = @($actual | Where-Object { $_ -cnotin $allowed })
if ($missing.Count -or $unexpected.Count) {
  throw "Invalid release assets. Missing: $($missing -join ', '); unexpected: $($unexpected -join ', ')."
}

$paths = @($expected | ForEach-Object { Join-Path $root $_ })
if ($WriteChecksums -or $VerifyChecksums) {
  $checksumPath = Join-Path $root 'SHA256SUMS.txt'
  $lines = @($expected | Sort-Object | ForEach-Object {
    "$((Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $root $_)).Hash.ToLowerInvariant())  $_"
  })
  if ($WriteChecksums) {
    Set-Content -LiteralPath $checksumPath -Value $lines -Encoding utf8NoBOM
  } else {
    if (!(Test-Path -LiteralPath $checksumPath -PathType Leaf)) { throw 'SHA256SUMS.txt is missing.' }
    $stored = @(Get-Content -LiteralPath $checksumPath)
    if (($stored -join "`n") -cne ($lines -join "`n")) { throw 'SHA256SUMS.txt does not match the release assets.' }
  }
  $paths += $checksumPath
}
$paths

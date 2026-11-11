$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'release-assets.ps1'
$matrix = Join-Path $PSScriptRoot 'package-vsix-matrix.ps1'
$root = Join-Path ([System.IO.Path]::GetTempPath()) ("meeko-release-assets-test-" + [guid]::NewGuid().ToString('N'))
$targets = @(& (Join-Path $PSScriptRoot 'vsix-targets.ps1'))
$assertions = 0
$manifestVersion = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '../packages/vscode/package.json') -Raw | ConvertFrom-Json).version
$global:MeekoMockFailure = ''
$global:MeekoMockCalls = @()

function pnpm {
  $global:MeekoMockCalls += "pnpm:$($args[-1])"
  $global:LASTEXITCODE = if ($global:MeekoMockFailure -eq $args[-1]) { 17 } else { 0 }
}

function pwsh {
  $global:MeekoMockCalls += 'pwsh:pack'
  $global:LASTEXITCODE = 17
}

function Assert-Throws([scriptblock] $Action, [string] $Pattern) {
  $script:assertions++
  try { & $Action | Out-Null } catch {
    if ($_.Exception.Message -notmatch $Pattern) { throw "Expected '$Pattern', received '$($_.Exception.Message)'." }
    return
  }
  throw "Expected error matching '$Pattern'."
}

try {
  if (($targets -join ',') -cne 'win32-x64,win32-arm64,linux-x64,linux-arm64,darwin-x64,darwin-arm64') {
    throw 'VSIX target inventory changed unexpectedly.'
  }
  $assertions++
  New-Item -ItemType Directory -Path $root | Out-Null
  foreach ($target in $targets) {
    Set-Content -LiteralPath (Join-Path $root "meeko-language-1.2.3-$target.vsix") -Value $target -NoNewline
  }
  $vsix = @(& $script -Directory $root -VscodeVersion '1.2.3')
  if ($vsix.Count -ne 6 -or $vsix[0] -notlike '*win32-x64.vsix') { throw 'VSIX inventory was incorrect.' }
  $assertions++
  Assert-Throws { & $script -Directory $root -VscodeVersion '1.2.4' } 'Missing:.*1.2.4.*unexpected:.*1.2.3'
  Assert-Throws { & $matrix -ExpectedVersion '0.0.0' -OutputDirectory $root } 'does not match'

  $global:MeekoMockFailure = 'check'
  $global:MeekoMockCalls = @()
  Assert-Throws { & $matrix -ExpectedVersion $manifestVersion -OutputDirectory (Join-Path $root 'check-failure') } 'VS Code check failed'
  if (($global:MeekoMockCalls -join ',') -cne 'pnpm:check') { throw 'Build or packaging ran after a failed check.' }
  $assertions++
  $global:MeekoMockFailure = 'build'
  $global:MeekoMockCalls = @()
  Assert-Throws { & $matrix -ExpectedVersion $manifestVersion -OutputDirectory (Join-Path $root 'build-failure') } 'VS Code build failed'
  if (($global:MeekoMockCalls -join ',') -cne 'pnpm:check,pnpm:build') { throw 'Packaging ran after a failed build.' }
  $assertions++
  $global:MeekoMockFailure = ''
  $global:MeekoMockCalls = @()
  $packOutput = Join-Path $root 'pack-failure'
  Assert-Throws { & $matrix -ExpectedVersion $manifestVersion -OutputDirectory $packOutput } 'VSIX packaging failed for win32-x64'
  if (($global:MeekoMockCalls -join ',') -cne 'pnpm:check,pnpm:build,pwsh:pack' -or @(Get-ChildItem -LiteralPath $packOutput -File).Count -ne 0) {
    throw 'Packaging failure did not stop before copying.'
  }
  $assertions++

  $missing = Join-Path $root 'meeko-language-1.2.3-linux-arm64.vsix'
  Remove-Item -LiteralPath $missing
  Assert-Throws { & $script -Directory $root -VscodeVersion '1.2.3' } 'Missing:.*linux-arm64'
  Set-Content -LiteralPath $missing -Value 'linux-arm64' -NoNewline

  $zip = Join-Path $root 'meeko-devtools-4.5.6.zip'
  Set-Content -LiteralPath $zip -Value 'zip fixture' -NoNewline
  $all = @(& $script -Directory $root -VscodeVersion '1.2.3' -DevtoolsVersion '4.5.6' -WriteChecksums)
  if ($all.Count -ne 8 -or $all[-1] -notlike '*SHA256SUMS.txt') { throw 'Release inventory was incorrect.' }
  $assertions++
  $verified = @(& $script -Directory $root -VscodeVersion '1.2.3' -DevtoolsVersion '4.5.6' -VerifyChecksums)
  if (($verified -join '|') -cne ($all -join '|')) { throw 'Verified inventory differs from generated inventory.' }
  $assertions++
  $lines = @(Get-Content -LiteralPath (Join-Path $root 'SHA256SUMS.txt'))
  if ($lines.Count -ne 7 -or $lines[0] -notmatch '^[0-9a-f]{64}  meeko-devtools-4\.5\.6\.zip$') { throw 'Checksum format or order was incorrect.' }
  $assertions++
  Assert-Throws { & $script -Directory $root -VscodeVersion '1.2.3' -DevtoolsVersion '4.5.7' -VerifyChecksums } 'Missing:.*4.5.7'

  Set-Content -LiteralPath $zip -Value 'tampered' -NoNewline
  Assert-Throws { & $script -Directory $root -VscodeVersion '1.2.3' -DevtoolsVersion '4.5.6' -VerifyChecksums } 'does not match'
  Set-Content -LiteralPath $zip -Value 'zip fixture' -NoNewline
  Set-Content -LiteralPath (Join-Path $root 'unexpected.txt') -Value 'extra'
  Assert-Throws { & $script -Directory $root -VscodeVersion '1.2.3' -DevtoolsVersion '4.5.6' -VerifyChecksums } 'unexpected:.*unexpected.txt'
  Remove-Item -LiteralPath (Join-Path $root 'unexpected.txt')
  Remove-Item -LiteralPath (Join-Path $root 'SHA256SUMS.txt')
  Assert-Throws { & $script -Directory $root -VscodeVersion '1.2.3' -DevtoolsVersion '4.5.6' -VerifyChecksums } 'SHA256SUMS.txt is missing'
  Assert-Throws { & $script -Directory $root -VscodeVersion '1.2.3' -WriteChecksums } 'require -DevtoolsVersion'
  Write-Output "PASS: $assertions release asset assertions"
} finally {
  Remove-Variable -Name MeekoMockFailure, MeekoMockCalls -Scope Global -ErrorAction SilentlyContinue
  $temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  $resolved = [System.IO.Path]::GetFullPath($root)
  if ($resolved.StartsWith($temporaryRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolved)) {
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}

#requires -Version 7.0
<#
Publishes the six public packages, in order, from verified tarballs.

- publish-first.ps1 (interactive): only packages that do not exist on npm yet. An existing package
  never goes through here: publishing it locally would drop the provenance of its previous version.
- -PackOnly (gates job): packs and verifies the tarballs; it needs neither npm nor the registry.
- -Trusted (publish job): publishes those tarballs with OIDC and skips versions that already exist.

Dry run unless -Execute. Nothing is published until every package has passed the preflight.
#>
[CmdletBinding()]
param(
  [switch]$Execute,
  [switch]$Trusted,
  [switch]$Resume,
  [switch]$PackOnly,
  [string]$ExpectedVersion,
  [string]$ArtifactDirectory,
  [string]$Registry = 'https://registry.npmjs.org/'
)
$ErrorActionPreference = 'Stop'
$env:NODE_OPTIONS = '--max-old-space-size=8192'
$root = Split-Path -Parent $PSScriptRoot
$packages = @('meeko', 'i18n', 'icon', 'ui', 'eslint-plugin', 'prettier-plugin')
$Registry = $Registry.TrimEnd('/') + '/'

if ($PackOnly -and ($Execute -or $Trusted -or $Resume)) { throw '-PackOnly cannot be combined with -Execute, -Trusted or -Resume.' }
if ($Trusted -and $Resume) { throw '-Trusted already skips published versions; -Resume is for the interactive first publication.' }

# Returns the JSON document, or $null only for HTTP 404: a network or authentication failure must
# never look like a missing version.
function Get-RegistryDocument([string]$Path) {
  try {
    return Invoke-RestMethod -Uri ($Registry + $Path) -TimeoutSec 30
  } catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 404) { return $null }
    throw
  }
}

# 'published', 'missing-version' (the package exists, this version does not) or 'new-package'.
function Get-RegistryState([string]$Name, [string]$Version) {
  $escapedName = [uri]::EscapeDataString($Name)
  $metadata = Get-RegistryDocument "$escapedName/$([uri]::EscapeDataString($Version))"
  if ($null -ne $metadata) {
    if ($metadata.version -ne $Version) { throw "Unexpected registry response for $Name@$Version" }
    return 'published'
  }
  # The root document, not a dist-tag: a package published only under `next` has no `latest` and still exists.
  $package = Get-RegistryDocument $escapedName
  if ($null -eq $package) { return 'new-package' }
  if ($package.name -ne $Name) { throw "Unexpected registry response for $Name" }
  return 'missing-version'
}

# Tells "not logged in" from "could not ask". Only the npm error code is echoed, never its details.
function Assert-NpmSession {
  $ErrorActionPreference = 'Continue'
  $output = @(& npm whoami --registry $Registry 2>&1 | ForEach-Object { "$_" })
  if ($LASTEXITCODE -eq 0) {
    Write-Host "npm user: $($output[-1])"
    return
  }
  if ($output -match 'E401|ENEEDAUTH') { throw 'There is no npm session: the maintainer must run npm login first. This script stores no tokens.' }
  $code = @($output -match 'npm (error|ERR!) code') | Select-Object -First 1
  throw "Could not verify the npm session, and logging in may not solve it ($code)."
}

# What npm will receive: a tarball with another identity or an unresolved workspace range cannot be fixed later.
function Assert-Tarball([string]$Path, $Manifest) {
  if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing tarball: $Path" }
  # Relative path: GNU tar reads a colon in the file name as a remote host.
  Push-Location -LiteralPath (Split-Path -Parent $Path)
  try {
    $raw = (& tar -xzOf (Split-Path -Leaf $Path) package/package.json) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "Could not read the manifest of $Path" }
  } finally { Pop-Location }
  $packed = $raw | ConvertFrom-Json
  if ($packed.name -ne $Manifest.name -or $packed.version -ne $Manifest.version) { throw "$Path contains $($packed.name)@$($packed.version), expected $($Manifest.name)@$($Manifest.version)." }
  if ($packed.private) { throw "$Path is private." }
  if ($raw -match '"(workspace|catalog):') { throw "$Path contains an unresolved workspace or catalog range." }
}

function Write-RegistryInventory($Items) {
  foreach ($item in $Items) {
    $state = try { Get-RegistryState $item.name $item.version } catch { 'unknown: the registry did not answer' }
    Write-Host "  $($item.name)@$($item.version): $state"
  }
}

Push-Location -LiteralPath $root
try {
  if ($Trusted) {
    if (!$ExpectedVersion -or $env:GITHUB_ACTIONS -ne 'true' -or $env:GITHUB_REF_TYPE -ne 'tag' -or $env:GITHUB_REF_NAME -ne "v$ExpectedVersion") {
      throw 'Trusted publishing requires GitHub Actions and the matching approved version tag.'
    }
    if (!$ArtifactDirectory) { throw 'Trusted publishing requires -ArtifactDirectory with the tarballs that passed the gates.' }
  } elseif (!$PackOnly) {
    $dirty = & git --no-optional-locks status --porcelain
    if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Commit and review all release changes first; the working tree must be clean.' }
    $head = & git rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the current commit.' }
    Write-Host "Commit: $head"
    if ($Execute) {
      & git merge-base --is-ancestor HEAD origin/main
      if ($LASTEXITCODE -ne 0) { throw 'The commit is not on origin/main: only an approved commit that passed CI is published. A dry run works from any commit.' }
    }
    Assert-NpmSession
  }
  if (!$PackOnly) {
    $npmVersion = & npm --version
    if ($LASTEXITCODE -ne 0 -or [version]($npmVersion -replace '-.*$', '') -lt [version]'11.5.1') { throw 'npm >=11.5.1 is required.' }
  }

  $manifests = @($packages | ForEach-Object { Get-Content -Raw -LiteralPath "packages/$_/package.json" | ConvertFrom-Json })
  $version = $manifests[0].version
  if (!$ExpectedVersion) { $ExpectedVersion = $version }
  if ($ExpectedVersion -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') { throw "Invalid version: $ExpectedVersion" }
  foreach ($manifest in $manifests) {
    if ($manifest.private -or $manifest.version -ne $ExpectedVersion) { throw "Release version mismatch: $($manifest.name) ($($manifest.version))" }
  }
  # A prerelease goes to `next` and never moves `latest`.
  $distTag = if ($version.Contains('-')) { 'next' } else { 'latest' }

  # Preflight every package before touching the registry.
  $pending = @()
  if ($PackOnly) {
    $pending = $manifests
  } else {
    foreach ($manifest in $manifests) {
      $id = "$($manifest.name)@$version"
      $state = Get-RegistryState $manifest.name $version
      if ($state -eq 'published') {
        if (!$Trusted -and !$Resume) { throw "$id already exists. If an earlier run stopped halfway, inspect the registry and rerun with -Resume." }
        Write-Host "Already published; skipping $id"
      } elseif ($Trusted) {
        if ($state -eq 'new-package') { throw "$($manifest.name) does not exist on npm and has no Trusted Publisher yet: publish it first with publish-first.ps1. Nothing was published." }
        $pending += $manifest
      } elseif ($state -eq 'missing-version') {
        Write-Host "Left to the trusted workflow, to keep its provenance: $id"
      } else {
        $pending += $manifest
      }
    }
  }

  $artifacts = @()
  if ($Trusted) {
    # The publish job only receives tarballs: it installs nothing and runs no project code.
    $ArtifactDirectory = (Resolve-Path -LiteralPath $ArtifactDirectory).Path
  } else {
    if (!$ArtifactDirectory) { $ArtifactDirectory = Join-Path ([IO.Path]::GetTempPath()) ('meeko-release-' + [guid]::NewGuid().ToString('N')) }
    New-Item -ItemType Directory -Force -Path $ArtifactDirectory | Out-Null
    $ArtifactDirectory = (Resolve-Path -LiteralPath $ArtifactDirectory).Path
  }
  # Every artifact must be ready before the first registry mutation. pnpm resolves workspace:*.
  foreach ($manifest in $pending) {
    $short = $manifest.name -replace '^@meekojs/', ''
    if (!$Trusted) {
      & pnpm --dir "packages/$short" pack --pack-destination $ArtifactDirectory
      if ($LASTEXITCODE -ne 0) { throw "Packing failed: $short. Nothing was published." }
    }
    $path = Join-Path $ArtifactDirectory "meekojs-$short-$version.tgz"
    Assert-Tarball $path $manifest
    $artifacts += [pscustomobject]@{ name = $manifest.name; version = $version; path = $path }
  }
  if ($PackOnly) {
    Write-Host "Packed $($artifacts.Count) tarballs: $ArtifactDirectory"
    return
  }

  foreach ($artifact in $artifacts) {
    $arguments = @('publish', $artifact.path, '--access', 'public', '--tag', $distTag, '--registry', $Registry)
    # publishConfig asks for provenance; only an explicit flag overrides it outside OIDC.
    if ($Trusted) { $arguments += '--provenance' } else { $arguments += '--provenance=false' }
    if (!$Execute) { $arguments += '--dry-run' }
    # npm handles interactive 2FA/OTP on the console. Never capture its output or pass credentials as arguments.
    & npm @arguments
    if ($LASTEXITCODE -ne 0) {
      if (!$Execute) { throw "Dry run failed: $($artifact.name)@$version. Nothing was published." }
      Write-Host 'Publication stopped. Registry state:'
      Write-RegistryInventory $artifacts
      $next = if ($Trusted) { 'rerun this workflow' } else { 'rerun with -Resume' }
      throw "Publication failed: $($artifact.name)@$version. A published version is immutable: inspect the state above, fix the cause and $next."
    }
  }
  $outcome = if ($Execute) { "published $($artifacts.Count) packages" } else { "dry run of $($artifacts.Count) packages, nothing was published" }
  Write-Host "Completed: $outcome (trusted=$Trusted, dist-tag=$distTag); artifacts: $ArtifactDirectory"
} finally { Pop-Location }

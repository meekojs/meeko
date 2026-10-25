param([switch]$Benchmark, [string]$Tarball)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$scratch = Join-Path $repo '.meeko'
New-Item -ItemType Directory -Path $scratch -Force | Out-Null
$run = Join-Path $scratch ('fullstack-run-' + [guid]::NewGuid().ToString('N'))
$consumer = Join-Path $run 'consumer'
$starter = Join-Path $run 'starter'
$serverProcess = $null

try {
  & (Join-Path $repo 'node_modules/.bin/tsc.cmd') -p (Join-Path $repo 'tsconfig.build.json')
  if ($LASTEXITCODE -ne 0) { throw 'Meeko package build failed.' }
  New-Item -ItemType Directory -Path $consumer -Force | Out-Null
  $env:npm_config_cache = Join-Path $scratch 'npm-cache'
  if ($Tarball) {
    $tarball = (Resolve-Path -LiteralPath $Tarball).Path
  } else {
    $name = (& npm pack $repo --pack-destination $run --ignore-scripts --silent | Select-Object -Last 1)
    if ($LASTEXITCODE -ne 0 -or !$name) { throw 'Meeko tarball creation failed.' }
    $tarball = Join-Path $run $name
  }
  foreach ($entry in Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'fixtures/fullstack-consumer')) {
    Copy-Item -LiteralPath $entry.FullName -Destination (Join-Path $consumer $entry.Name) -Recurse -Force
  }
  $manifestPath = Join-Path $consumer 'package.json'
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $manifest.dependencies.'@meekojs/meeko' = $tarball
  $manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding utf8
  & npm install --prefix $consumer --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Clean external consumer installation failed.' }
  & node (Join-Path $consumer 'node_modules/@meekojs/meeko/dist/cli.js') init-framework $starter
  if ($LASTEXITCODE -ne 0) { throw 'Packaged framework starter generation failed.' }
  $starterManifestPath = Join-Path $starter 'package.json'
  $starterManifest = Get-Content -LiteralPath $starterManifestPath -Raw | ConvertFrom-Json
  $starterManifest.dependencies.'@meekojs/meeko' = $tarball
  $starterManifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $starterManifestPath -Encoding utf8
  & npm install --prefix $starter --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Clean packaged framework starter installation failed.' }
  & npm run check --prefix $starter
  if ($LASTEXITCODE -ne 0) { throw 'Packaged framework starter typecheck failed.' }
  & npm run build --prefix $starter
  if ($LASTEXITCODE -ne 0) { throw 'Packaged framework starter production build failed.' }
  & npm run build --prefix $consumer
  if ($LASTEXITCODE -ne 0) { throw 'External consumer check or production build failed.' }
  $clientAssets = Get-ChildItem -LiteralPath (Join-Path $consumer '.meeko/output/client') -Recurse -File -Filter '*.js'
  $privateHits = $clientAssets | Select-String -Pattern 'server/api/|server/rpc/|server/socket/|sessions\.sqlite'
  if ($privateHits) {
    throw "Private server code reached the client bundle: $(($privateHits | Select-Object -First 3 | ForEach-Object { $_.Path + ':' + $_.Matches[0].Value }) -join ', ')"
  }

  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = $listener.LocalEndpoint.Port
  $listener.Stop()
  $env:PORT = [string]$port
  $env:MEEKO_TEST_PORT = [string]$port
  $out = Join-Path $run 'server.stdout.log'
  $err = Join-Path $run 'server.stderr.log'
  $serverProcess = Start-Process -FilePath (Get-Command node).Source -ArgumentList @('node_modules/@meekojs/meeko/dist/cli.js', 'start', '.') -WorkingDirectory $consumer -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  $ready = $false
  $lastHealthError = ''
  for ($attempt = 0; $attempt -lt 50; $attempt++) {
    if ($serverProcess.HasExited) { throw "External server exited: $(Get-Content -LiteralPath $err -Raw)" }
    & node -e "fetch(process.argv[1]).then(r => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))" "http://127.0.0.1:$port/" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    $lastHealthError = 'HTTP 200 not yet available'
    Start-Sleep -Milliseconds 200
  }
  if (!$ready) { throw "External server did not become ready: $lastHealthError. stdout: $(Get-Content -LiteralPath $out -Raw -ErrorAction SilentlyContinue) stderr: $(Get-Content -LiteralPath $err -Raw -ErrorAction SilentlyContinue)" }
  Push-Location $consumer
  try {
    & node smoke.mjs
    if ($LASTEXITCODE -ne 0) { throw 'External HTTP/WebSocket smoke failed.' }
  } finally { Pop-Location }
  & node (Join-Path $PSScriptRoot 'fullstack-browser.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'External Chrome smoke failed.' }
  if ($Benchmark) {
    & npm run vite:build --prefix $repo
    if ($LASTEXITCODE -ne 0) { throw 'Minimal app build for benchmark failed.' }
    $env:MEEKO_BENCH_CONSUMER = $consumer
    $env:MEEKO_BENCH_OUTPUT = Join-Path $scratch 'benchmarks/stability-baseline.json'
    $previousErrorAction = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      & node --expose-gc (Join-Path $repo 'benchmarks/stability-baseline.mjs')
    } finally { $ErrorActionPreference = $previousErrorAction }
    if ($LASTEXITCODE -ne 0) { throw 'Stability benchmark failed.' }
  }
  Write-Output 'External full-stack consumer and generated starter: installation, types, build, SSR, API, RPC, sessions, Socket and Chrome OK.'
} finally {
  if ($serverProcess -and !$serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -Force }
  foreach ($name in @('PORT', 'MEEKO_TEST_PORT', 'MEEKO_BENCH_CONSUMER', 'MEEKO_BENCH_OUTPUT', 'npm_config_cache')) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
  $resolvedScratch = [System.IO.Path]::GetFullPath($scratch).TrimEnd('\') + '\'
  $resolvedRun = [System.IO.Path]::GetFullPath($run)
  if ($resolvedRun.StartsWith($resolvedScratch, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedRun)) {
    Remove-Item -LiteralPath $resolvedRun -Recurse -Force
  }
}

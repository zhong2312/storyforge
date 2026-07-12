param(
  [string]$SourceRoot,
  [string]$OutputRoot,
  [switch]$SkipPortCheck
)

$ErrorActionPreference = 'Stop'
$builderRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$defaultSource = Join-Path $builderRoot '..\..'
$source = (Resolve-Path -LiteralPath $(if ($SourceRoot) { $SourceRoot } else { $defaultSource })).Path
$output = $(if ($OutputRoot) {
  if (-not (Test-Path -LiteralPath $OutputRoot)) {
    New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
  }
  (Resolve-Path -LiteralPath $OutputRoot).Path
} else {
  (Get-Location).Path
})
$outputExe = Join-Path $output 'StoryForge-Windows-Portable.exe'
$pendingExe = Join-Path $output '.StoryForge-Windows-Portable.exe.new'

function Resolve-GoExecutable {
  $command = Get-Command go.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $known = @(
    'C:\tmp\go1.22.12\go\bin\go.exe',
    (Join-Path $env:LOCALAPPDATA 'StoryForgeBuilder\go1.22.12\go\bin\go.exe')
  )
  foreach ($path in $known) {
    if (Test-Path -LiteralPath $path) { return $path }
  }

  $cacheRoot = Join-Path $env:LOCALAPPDATA 'StoryForgeBuilder\go1.22.12'
  $zipPath = Join-Path $cacheRoot 'go1.22.12.windows-amd64.zip'
  New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
  Write-Host '[3/6] Go was not found. Downloading portable Go 1.22.12...'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri 'https://go.dev/dl/go1.22.12.windows-amd64.zip' -OutFile $zipPath -UseBasicParsing
  Expand-Archive -LiteralPath $zipPath -DestinationPath $cacheRoot -Force
  $downloaded = Join-Path $cacheRoot 'go\bin\go.exe'
  if (-not (Test-Path -LiteralPath $downloaded)) { throw 'Portable Go download is incomplete.' }
  return $downloaded
}

if (-not (Test-Path -LiteralPath (Join-Path $source 'package.json'))) {
  throw "StoryForge source was not found: $source"
}
if (-not (Test-Path -LiteralPath (Join-Path $source 'packaging\desktop\go.mod'))) {
  throw 'Wails desktop source is missing from packaging\desktop.'
}
if (-not $SkipPortCheck -and (Get-NetTCPConnection -LocalPort 17831 -State Listen -ErrorAction SilentlyContinue)) {
  throw 'Port 17831 is in use. Close StoryForge-Windows-Portable.exe before building.'
}

$package = Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$package.version
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { throw 'npm.cmd was not found. Install Node.js 18 or newer first.' }

Write-Host "[1/6] Source: $source"
Write-Host "[2/6] Building StoryForge v$version frontend..."
Push-Location $source
try {
  if (-not (Test-Path -LiteralPath (Join-Path $source 'node_modules'))) {
    & $npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
  }
  & $npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

$go = Resolve-GoExecutable
$staging = Join-Path $env:TEMP ("storyforge-wails-build-" + [guid]::NewGuid().ToString('N'))
$web = Join-Path $staging 'web'
$webBase = Join-Path $web 'storyforge'

New-Item -ItemType Directory -Path $webBase -Force | Out-Null
try {
  Write-Host '[3/6] Assembling embedded WebView2 assets...'
  Copy-Item -Path (Join-Path $source 'packaging\desktop\*.go') -Destination $staging
  Copy-Item -LiteralPath (Join-Path $source 'packaging\desktop\go.mod') -Destination $staging
  if (Test-Path -LiteralPath (Join-Path $source 'packaging\desktop\go.sum')) {
    Copy-Item -LiteralPath (Join-Path $source 'packaging\desktop\go.sum') -Destination $staging
  }
  $iconInput = Join-Path $source 'public\icon-512.png'
  $iconOutput = Join-Path $staging 'StoryForge-res.syso'
  Push-Location (Join-Path $source 'packaging\desktop')
  try {
    & $go run .\cmd\resourcegen -input $iconInput -output $iconOutput
    if ($LASTEXITCODE -ne 0) { throw "Windows icon resource generation failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
  Copy-Item -Path (Join-Path $source 'dist\*') -Destination $webBase -Recurse
  Copy-Item -LiteralPath (Join-Path $source 'dist\index.html') -Destination (Join-Path $web 'index.html')

  $bootstrap = Join-Path $output 'tools\portable-builder\storyforge-test-bootstrap.js'
  $seedFiles = @(Get-ChildItem -LiteralPath (Join-Path $output 'data') -Filter 'storyforge-*.json' -File -ErrorAction SilentlyContinue)
  if ((Test-Path -LiteralPath $bootstrap) -and $seedFiles.Count -gt 0) {
    $seed = ($seedFiles | Sort-Object @{ Expression = { $_.Name.Length } }, LastWriteTime | Select-Object -First 1).FullName
    Copy-Item -LiteralPath $bootstrap -Destination (Join-Path $web 'storyforge-test-bootstrap.js')
    Copy-Item -LiteralPath $seed -Destination (Join-Path $web 'storyforge-test-seed.json')
    $script = '      <script>if (!new URLSearchParams(location.search).has("storyforge-test")) { const u = new URL(location.href); u.searchParams.set("storyforge-test", "1"); history.replaceState(null, "", u.pathname + u.search) }</script>' + [Environment]::NewLine +
      '      <script type="module" src="/storyforge-test-bootstrap.js"></script>' + [Environment]::NewLine
    foreach ($indexPath in @((Join-Path $web 'index.html'), (Join-Path $webBase 'index.html'))) {
      $index = Get-Content -LiteralPath $indexPath -Raw -Encoding UTF8
      $index = $index.Replace('</body>', $script + '  </body>')
      Set-Content -LiteralPath $indexPath -Value $index -Encoding UTF8
    }
    Write-Host '      Test seed bootstrap included.'
  }

  Write-Host '[4/6] Downloading Wails dependencies...'
  Push-Location $staging
  try {
    if (-not $env:GOPROXY) { $env:GOPROXY = 'https://goproxy.cn,https://proxy.golang.org,direct' }
    $env:CGO_ENABLED = '0'
    & $go mod download
    if ($LASTEXITCODE -ne 0) { throw "go mod download failed with exit code $LASTEXITCODE" }

    Write-Host '[5/6] Compiling Wails WebView2 Portable EXE...'
    $candidate = Join-Path $staging 'StoryForge-Windows-Portable.exe'
    & $go build -buildvcs=false -trimpath -tags 'desktop,production,native_webview2loader' `
      -ldflags "-s -w -H windowsgui -X main.appVersion=$version" -o $candidate .
    if ($LASTEXITCODE -ne 0) { throw "go build failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }

  if ((Get-Item -LiteralPath $candidate).Length -lt 1MB) { throw 'Generated EXE is unexpectedly small.' }
  if (Test-Path -LiteralPath $pendingExe) { Remove-Item -LiteralPath $pendingExe -Force }
  Copy-Item -LiteralPath $candidate -Destination $pendingExe
  if ((Get-FileHash -Algorithm SHA256 $candidate).Hash -ne (Get-FileHash -Algorithm SHA256 $pendingExe).Hash) {
    throw 'EXE verification failed after copying to the output directory.'
  }
  Move-Item -LiteralPath $pendingExe -Destination $outputExe -Force

  $hash = (Get-FileHash -Algorithm SHA256 $outputExe).Hash
  Write-Host '[6/6] Build completed.'
  Write-Host "Output: $outputExe"
  Write-Host "Framework: Wails 2 + Microsoft Edge WebView2"
  Write-Host "SHA256: $hash"
} finally {
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}

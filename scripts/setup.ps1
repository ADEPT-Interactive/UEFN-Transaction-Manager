param(
    [switch]$ForceBuild,
    [switch]$PreferPortableRuntime
)

$ErrorActionPreference = "Stop"
$toolRoot = Split-Path -Parent $PSScriptRoot

function Invoke-NativeChecked {
    param(
        [Parameter(Mandatory = $true)] [string]$FilePath,
        [Parameter(Mandatory = $true)] [string[]]$ArgumentList,
        [Parameter(Mandatory = $true)] [string]$Description
    )
    Write-Host "`n> $Description" -ForegroundColor Cyan
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) { throw "$Description failed with exit code $LASTEXITCODE." }
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) {
    throw "Source setup requires Node.js 22.12.0 or newer. End-user installer releases bundle Electron and do not require Node.js."
}
$nodeVersionText = (& $node.Source --version).Trim().TrimStart('v')
try { $nodeVersion = [version]$nodeVersionText } catch { throw "Could not parse the installed Node.js version: $nodeVersionText." }
if ($nodeVersion -lt [version]'22.12.0') { throw "Source setup requires Node.js 22.12.0 or newer; found $nodeVersionText." }
if ($PreferPortableRuntime) {
    Write-Host "PreferPortableRuntime is retained for command compatibility; Electron dependencies are installed through the locked npm toolchain." -ForegroundColor DarkGray
}

Push-Location $toolRoot
try {
    Invoke-NativeChecked -FilePath $npm.Source -ArgumentList @("ci", "--no-audit", "--no-fund") -Description "Installing locked Electron and application dependencies"
    Invoke-NativeChecked -FilePath $npm.Source -ArgumentList @("run", "install:electron-runtime") -Description "Installing the locked Electron desktop runtime"
    Invoke-NativeChecked -FilePath $npm.Source -ArgumentList @("run", "build") -Description "Building the frontend, authenticated bridge, Electron main process, and hardened preload"
}
finally {
    Pop-Location
}

$electron = Join-Path $toolRoot "node_modules\electron\dist\electron.exe"
if (-not (Test-Path -LiteralPath $electron) -or -not (Test-Path -LiteralPath (Join-Path $toolRoot "dist-electron\main.cjs"))) {
    throw "Setup finished without producing the Electron development runtime and desktop bundle."
}

Write-Host "`nSetup complete. Run npm run dev:desktop to open the Electron manager from source." -ForegroundColor Green
Write-Host "Published installer releases register Transaction Manager with Windows Start/Search and Add or Remove Programs; they do not need Node.js, npm, Python, .NET, WebView2, or administrator access." -ForegroundColor DarkGray

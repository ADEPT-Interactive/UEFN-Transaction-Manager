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
    throw "Source setup requires Node.js 20 or newer. End-user ZIP releases bundle Electron and do not require Node.js."
}
$major = [int]((& $node.Source --version).Trim().TrimStart('v').Split('.')[0])
if ($major -lt 20) { throw "Source setup requires Node.js 20 or newer; found $(& $node.Source --version)." }
if ($PreferPortableRuntime) {
    Write-Host "PreferPortableRuntime is retained for command compatibility; Electron dependencies are installed through the locked npm toolchain." -ForegroundColor DarkGray
}

Push-Location $toolRoot
try {
    Invoke-NativeChecked -FilePath $npm.Source -ArgumentList @("ci", "--no-audit", "--no-fund") -Description "Installing locked Electron and application dependencies"
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
Write-Host "Published ZIP releases remain download, extract, and launch only; they do not need Node.js, npm, Python, .NET, WebView2, or administrator access." -ForegroundColor DarkGray

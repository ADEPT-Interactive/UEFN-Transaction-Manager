param(
    [int]$Port = 49287,
    [int]$WaitSeconds = 5
)

$ErrorActionPreference = "Stop"
$toolRoot = Split-Path -Parent $PSScriptRoot
$appVersion = (Get-Content -LiteralPath (Join-Path $toolRoot "version.json") -Raw | ConvertFrom-Json).version
$shell = Join-Path $toolRoot "desktop\bin\Release\net48\publish\UEFNEntitlementManager-$appVersion.exe"
$server = Join-Path $toolRoot "dist\server.cjs"
$node = Get-Command node.exe -ErrorAction Stop
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("uem-shell-test-" + [guid]::NewGuid().ToString("N"))
$logRoot = Join-Path $testRoot "logs"
$stdout = Join-Path $logRoot "bridge.stdout.log"
$stderr = Join-Path $logRoot "bridge.stderr.log"
$bridge = $null
$desktop = $null

if (-not (Test-Path -LiteralPath $shell) -or -not (Test-Path -LiteralPath $server)) {
    throw "Build the manager and desktop shell before running this verification script."
}

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$env:PORT = $Port.ToString()
$env:UEM_SESSION_TOKEN = "desktop-shell-ui-token-012345678901234567890123456789"
$env:UEM_EDITOR_TOKEN = "desktop-shell-editor-token-012345678901234567890123456789"
$env:UEM_CONTENT_ROOT = $testRoot
$env:UEM_ASSET_MOUNT = "/DesktopShellTest"
$env:UEM_IDLE_TIMEOUT_MS = "120000"

try {
    $bridge = Start-Process -FilePath $node.Source -ArgumentList @("dist/server.cjs") -WorkingDirectory $toolRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    $healthy = $false
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
        try {
            $health = Invoke-WebRequest -Uri ("http://127.0.0.1:{0}/api/health" -f $Port) -UseBasicParsing -TimeoutSec 1
            if ($health.StatusCode -eq 200) {
                $healthy = $true
                break
            }
        }
        catch {
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $healthy) {
        throw "The bridge did not become healthy. Review $stdout and $stderr."
    }

    $uiToken = [uri]::EscapeDataString($env:UEM_SESSION_TOKEN)
    $contentDir = [uri]::EscapeDataString($testRoot)
    $url = "http://127.0.0.1:{0}/#token={1}&contentDir={2}&assetFolder=EntitlementIcons&verseFile=managed_transactions.verse" -f $Port, $uiToken, $contentDir
    $desktop = Start-Process -FilePath $shell -ArgumentList @($url) -PassThru
    Start-Sleep -Seconds $WaitSeconds
    if ($desktop.HasExited) {
        throw "The standalone desktop shell exited with code $($desktop.ExitCode)."
    }

    Write-Host "Standalone desktop shell started successfully (PID $($desktop.Id))." -ForegroundColor Green
}
finally {
    if ($desktop -and -not $desktop.HasExited) {
        Stop-Process -Id $desktop.Id -Force
    }
    if ($bridge -and -not $bridge.HasExited) {
        Stop-Process -Id $bridge.Id -Force
    }
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}

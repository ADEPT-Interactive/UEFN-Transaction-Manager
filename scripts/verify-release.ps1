param(
    [string]$ArchivePath = "release\UEFN Entitlement Manager.zip",
    [switch]$KeepTestFiles
)

$ErrorActionPreference = "Stop"
$archive = (Resolve-Path -LiteralPath (Join-Path (Get-Location) $ArchivePath)).Path
$extractRoot = Join-Path ([IO.Path]::GetTempPath()) ("uem-release-test-" + [guid]::NewGuid().ToString("N"))
$process = $null

New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
try {
    Expand-Archive -LiteralPath $archive -DestinationPath $extractRoot -Force
    $packageRoot = Join-Path $extractRoot "UEFN Entitlement Manager"
    $appVersion = (Get-Content -LiteralPath (Join-Path $packageRoot "version.json") -Raw | ConvertFrom-Json).version
    $desktopFileName = "UEFNEntitlementManager-$appVersion.exe"
    $node = Get-ChildItem -LiteralPath (Join-Path $packageRoot ".runtime") -Filter "node.exe" -Recurse | Select-Object -First 1
    $server = Join-Path $packageRoot "dist\server.cjs"
    $launcher = Join-Path $packageRoot "entitlement_manager.py"
    $desktopShell = Join-Path $packageRoot $desktopFileName
    if (-not $node -or -not (Test-Path -LiteralPath $server) -or -not (Test-Path -LiteralPath $launcher) -or -not (Test-Path -LiteralPath $desktopShell)) {
        throw "The release is missing its bundled runtime, bridge, desktop shell, or UEFN launcher."
    }
    $runtimeModules = Join-Path $packageRoot "node_modules"
    if (-not (Test-Path -LiteralPath $runtimeModules)) {
        throw "The release is missing the image-normalization runtime modules."
    }
    $allowedRuntimeModules = @("@img", "detect-libc", "sharp")
    $unexpectedRuntimeModules = Get-ChildItem -LiteralPath $runtimeModules -Force | Where-Object { $allowedRuntimeModules -notcontains $_.Name }
    if ($unexpectedRuntimeModules) {
        throw "The release contains unexpected runtime modules: $($unexpectedRuntimeModules.Name -join ', ')."
    }
    foreach ($moduleName in $allowedRuntimeModules) {
        if (-not (Test-Path -LiteralPath (Join-Path $runtimeModules $moduleName))) {
            throw "The release is missing the required runtime module: $moduleName."
        }
    }

    $nodeVersion = (& $node.FullName --version).Trim()
    Write-Host "Bundled runtime: $nodeVersion"
    Write-Host "Standalone desktop shell: $desktopShell"
    Write-Host "Bundled bridge: $server"

    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
    $listener.Stop()
    $env:PORT = [string]$port
    $env:UEM_SESSION_TOKEN = "release-test-ui-token-0123456789-0123456789"
    $env:UEM_EDITOR_TOKEN = "release-test-editor-token-0123456789-0123456789"
    $env:UEM_CONTENT_ROOT = $packageRoot
    $env:UEM_ASSET_MOUNT = "/ReleaseTest"
    $env:UEM_IDLE_TIMEOUT_MS = "120000"
    $stdout = Join-Path $extractRoot "bridge.stdout.log"
    $stderr = Join-Path $extractRoot "bridge.stderr.log"
    $process = Start-Process -FilePath $node.FullName -ArgumentList @(( '"' + $server + '"' )) -WorkingDirectory $packageRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr

    $healthy = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 250
        if ($process.HasExited) {
            break
        }
        try {
            $response = Invoke-WebRequest -Uri ("http://127.0.0.1:" + $port + "/api/health") -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                $healthy = $true
                break
            }
        }
        catch {
        }
    }
    if (-not $healthy) {
        Write-Host ("Bridge exited=" + $process.HasExited + "; exitCode=" + $process.ExitCode)
        Get-Content -LiteralPath $stdout -ErrorAction SilentlyContinue
        Get-Content -LiteralPath $stderr -ErrorAction SilentlyContinue
        throw "The extracted release bridge did not pass its health check."
    }
    $baseUri = "http://127.0.0.1:$port"
    $headers = @{ "X-UEM-Token" = $env:UEM_SESSION_TOKEN }
    $frontend = Invoke-WebRequest -Uri ($baseUri + "/") -UseBasicParsing -TimeoutSec 3
    if ($frontend.StatusCode -ne 200 -or $frontend.Content -notmatch "<div id=`"root`">") {
        throw "The extracted release did not serve its production frontend."
    }
    try {
        Invoke-WebRequest -Uri ($baseUri + "/api/session/heartbeat") -Method Post -ContentType "application/json" -Body "{}" -UseBasicParsing -TimeoutSec 3 | Out-Null
        throw "The release accepted an unauthenticated API request."
    }
    catch {
        if ($_.Exception.Response.StatusCode.value__ -ne 401) { throw }
    }
    $heartbeat = Invoke-RestMethod -Uri ($baseUri + "/api/session/heartbeat") -Method Post -Headers $headers -ContentType "application/json" -Body "{}" -TimeoutSec 3
    if (-not $heartbeat.success) { throw "The authenticated release heartbeat failed." }

    $saveBody = @{ fileName = "release_smoke.verse"; content = "# release smoke test"; createBackup = $true; expectedHash = $null } | ConvertTo-Json
    $saved = Invoke-RestMethod -Uri ($baseUri + "/api/verse/save") -Method Post -Headers $headers -ContentType "application/json" -Body $saveBody -TimeoutSec 3
    if (-not $saved.success -or $saved.contentHash -notmatch "^[a-f0-9]{64}$") { throw "The extracted release could not save a revision-tracked Verse file." }
    $loaded = Invoke-RestMethod -Uri ($baseUri + "/api/verse/load") -Method Post -Headers $headers -ContentType "application/json" -Body '{"fileName":"release_smoke.verse"}' -TimeoutSec 3
    if ($loaded.content -ne "# release smoke test" -or $loaded.contentHash -ne $saved.contentHash) { throw "The extracted release did not load the saved Verse revision losslessly." }

    Invoke-RestMethod -Uri ($baseUri + "/api/session/shutdown") -Method Post -Headers $headers -ContentType "application/json" -Body "{}" -TimeoutSec 3 | Out-Null
    if (-not $process.WaitForExit(5000)) { throw "The extracted release bridge did not exit after authenticated shutdown." }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "verify-standalone-project-link.ps1") -PackageRoot $packageRoot
    if ($LASTEXITCODE -ne 0) { throw "The extracted standalone project-link workflow failed with exit code $LASTEXITCODE." }
    Write-Host "Extracted release frontend, standalone project linking, authentication, revision-safe save/load, and shutdown checks passed." -ForegroundColor Green
}
finally {
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force
        $process.WaitForExit()
    }
    if (-not $KeepTestFiles -and (Test-Path -LiteralPath $extractRoot)) {
        Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    elseif ($KeepTestFiles) {
        Write-Host "Kept extracted test files at $extractRoot" -ForegroundColor Yellow
    }
}

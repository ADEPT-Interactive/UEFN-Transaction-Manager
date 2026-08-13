param(
    [string]$PackageRoot = "."
)

$ErrorActionPreference = "Stop"
$resolvedRoot = (Resolve-Path -LiteralPath $PackageRoot).Path
$appVersion = (Get-Content -LiteralPath (Join-Path $resolvedRoot "version.json") -Raw | ConvertFrom-Json).version
$desktopFileName = "UEFNEntitlementManager-$appVersion.exe"
$publishedShell = Join-Path $resolvedRoot "desktop\bin\Release\net48\publish\$desktopFileName"
$packagedShell = Join-Path $resolvedRoot $desktopFileName
$shell = if (Test-Path -LiteralPath $packagedShell) { $packagedShell } else { $publishedShell }
if (-not (Test-Path -LiteralPath $shell)) { throw "Standalone desktop shell is missing: $shell" }

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("uem-standalone-link-" + [guid]::NewGuid().ToString("N"))
$projectRoot = Join-Path $testRoot "StandaloneTest"
$contentRoot = Join-Path $projectRoot "Content"
$projectFile = Join-Path $projectRoot "StandaloneTest.uefnproject"
$bootProcess = $null
$managerProcess = $null
$childProcessId = $null
$sessionStatePath = Join-Path $env:LOCALAPPDATA "UEFN Entitlement Manager\active-session.json"

try {
    New-Item -ItemType Directory -Path $contentRoot -Force | Out-Null
    @'
{
  "fileVersion": 15,
  "title": "Standalone Test",
  "plugins": [{ "name": "StandaloneTest", "bIsRoot": true, "bIsPublic": false }],
  "dataSets": { "experimental": { "pythonExperimental": { "bEnablePythonForProject": false } } }
}
'@ | Set-Content -LiteralPath $projectFile -Encoding UTF8

    $bootTimer = [Diagnostics.Stopwatch]::StartNew()
    $bootProcess = Start-Process -FilePath $shell -WorkingDirectory $resolvedRoot -WindowStyle Hidden -PassThru
    while ($bootTimer.ElapsedMilliseconds -lt 3000) {
        Start-Sleep -Milliseconds 50
        $bootProcess.Refresh()
        if ($bootProcess.HasExited) { throw "The project-link boot menu exited unexpectedly." }
        if ($bootProcess.MainWindowHandle -ne [IntPtr]::Zero) { break }
    }
    if ($bootProcess.MainWindowHandle -eq [IntPtr]::Zero) { throw "The project-link boot menu did not create its window within three seconds." }
    $earlyBridge = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $bootProcess.Id -and $_.Name -eq "node.exe" }
    if ($earlyBridge) { throw "The secure bridge started before the user linked a project." }
    Stop-Process -Id $bootProcess.Id -Force
    $bootProcess.WaitForExit()
    $bootProcess = $null

    $managerProcess = Start-Process -FilePath $shell -ArgumentList @("--project", ('"' + $projectFile + '"')) -WorkingDirectory $resolvedRoot -WindowStyle Hidden -PassThru
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 250
        $managerProcess.Refresh()
        if ($managerProcess.HasExited) { throw "The standalone project session exited with code $($managerProcess.ExitCode)." }
        $child = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $managerProcess.Id -and $_.Name -eq "node.exe" } | Select-Object -First 1
        if ($child) { $childProcessId = $child.ProcessId; break }
    }
    if (-not $childProcessId) { throw "The desktop shell did not start its owned secure project bridge." }
    for ($attempt = 0; $attempt -lt 30 -and -not (Test-Path -LiteralPath $sessionStatePath); $attempt++) {
        Start-Sleep -Milliseconds 200
        $managerProcess.Refresh()
        if ($managerProcess.HasExited) { throw "The standalone project session exited before publishing its editor connector state." }
    }
    if (-not (Test-Path -LiteralPath $sessionStatePath)) { throw "The automatic UEFN editor connector session was not published." }
    $sessionState = Get-Content -LiteralPath $sessionStatePath -Raw | ConvertFrom-Json
    if ($sessionState.desktopProcessId -ne $managerProcess.Id -or $sessionState.contentRoot -ne $contentRoot -or $sessionState.assetMount -ne "/StandaloneTest") {
        throw "The published editor connector session does not match the linked project."
    }
    if (-not (Test-Path -LiteralPath $sessionState.connectorScript)) { throw "The editor session points to a missing connector runtime." }
    $pythonRoot = Join-Path $contentRoot "Python"
    $autoConnector = Join-Path $pythonRoot "uefn_auto_connector.py"
    $initUnreal = Join-Path $pythonRoot "init_unreal.py"
    if (-not (Test-Path -LiteralPath $autoConnector) -or -not (Test-Path -LiteralPath $initUnreal)) {
        throw "The desktop shell did not install its project-scoped automatic connector."
    }
    $initSource = Get-Content -LiteralPath $initUnreal -Raw
    if ($initSource -notmatch "UEM_AUTO_CONNECTOR_BEGIN" -or $initSource -notmatch "_uem_auto_connector\.install") {
        throw "The generated init_unreal.py is missing the managed automatic-connector startup block."
    }
    Write-Host "Standalone boot menu painted in $($bootTimer.ElapsedMilliseconds) ms; independent linking and automatic connector checks passed." -ForegroundColor Green
}
finally {
    if ($managerProcess -and -not $managerProcess.HasExited) { Stop-Process -Id $managerProcess.Id -Force -ErrorAction SilentlyContinue }
    if ($bootProcess -and -not $bootProcess.HasExited) { Stop-Process -Id $bootProcess.Id -Force -ErrorAction SilentlyContinue }
    if ($childProcessId -and (Get-Process -Id $childProcessId -ErrorAction SilentlyContinue)) { Stop-Process -Id $childProcessId -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $sessionStatePath) {
        try {
            $state = Get-Content -LiteralPath $sessionStatePath -Raw | ConvertFrom-Json
            if ($managerProcess -and $state.desktopProcessId -eq $managerProcess.Id) { Remove-Item -LiteralPath $sessionStatePath -Force }
        }
        catch {
        }
    }
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue }
}

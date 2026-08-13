param(
    [Parameter(Mandatory = $true)]
    [string]$PackageRoot,
    [int]$WaitSeconds = 5
)

$ErrorActionPreference = "Stop"
$packageRoot = (Resolve-Path -LiteralPath $PackageRoot -ErrorAction Stop).Path
$appVersion = (Get-Content -LiteralPath (Join-Path $packageRoot "version.json") -Raw | ConvertFrom-Json).version
$desktopFileName = "UEFNEntitlementManager-$appVersion.exe"
$launcher = Join-Path $packageRoot "entitlement_manager.py"
$desktop = Join-Path $packageRoot $desktopFileName
$sourceDesktop = Join-Path $packageRoot "desktop\bin\Release\net48\publish\$desktopFileName"
$server = Join-Path $packageRoot "dist\server.cjs"
$python = Get-Command python.exe -ErrorAction Stop
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("uem-launcher-test-" + [guid]::NewGuid().ToString("N"))
$logRoot = Join-Path $testRoot "logs"
$launcherLog = Join-Path $logRoot "launcher.log"
$launcherErrorLog = Join-Path $logRoot "launcher-error.log"
$launcherProcess = $null
$trackedIds = [System.Collections.Generic.HashSet[int]]::new()

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class UemWindowCloser {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
}
"@

if (-not (Test-Path -LiteralPath $desktop)) { $desktop = $sourceDesktop }
if (-not (Test-Path -LiteralPath $launcher) -or -not (Test-Path -LiteralPath $desktop) -or -not (Test-Path -LiteralPath $server)) {
    throw "The package is missing its launcher, desktop shell, or bridge: $packageRoot"
}

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$oldEnvironment = @{
    UEM_CONTENT_ROOT = $env:UEM_CONTENT_ROOT
    UEM_ASSET_MOUNT = $env:UEM_ASSET_MOUNT
    UEM_IDLE_TIMEOUT_MS = $env:UEM_IDLE_TIMEOUT_MS
}
$env:UEM_CONTENT_ROOT = $testRoot
$env:UEM_ASSET_MOUNT = "/LauncherTest"
$env:UEM_IDLE_TIMEOUT_MS = "120000"

function Get-ManagerProcesses {
    Get-CimInstance Win32_Process | Where-Object {
        ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($packageRoot, [StringComparison]::OrdinalIgnoreCase)) -or
        ($_.CommandLine -and $_.CommandLine -match [regex]::Escape($packageRoot))
    }
}

try {
    $launcherProcess = Start-Process -FilePath $python.Source -ArgumentList @('"' + $launcher + '"') -WorkingDirectory $packageRoot -WindowStyle Hidden -RedirectStandardOutput $launcherLog -RedirectStandardError $launcherErrorLog -PassThru
    [void]$trackedIds.Add($launcherProcess.Id)

    $deadline = (Get-Date).AddSeconds(15)
    $desktopProcess = $null
    $bridgeProcess = $null
    while ((Get-Date) -lt $deadline) {
        $processes = @(Get-ManagerProcesses)
        $desktopProcess = $processes | Where-Object { $_.Name -eq $desktopFileName } | Select-Object -First 1
        $bridgeProcess = $processes | Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -match "dist[\\/]server\.cjs" } | Select-Object -First 1
        if ($desktopProcess -and $bridgeProcess) { break }
        Start-Sleep -Milliseconds 250
    }

    if (-not $desktopProcess -or -not $bridgeProcess) {
        $output = if (Test-Path -LiteralPath $launcherLog) { Get-Content -LiteralPath $launcherLog -Raw } else { "<launcher log unavailable>" }
        $errors = if (Test-Path -LiteralPath $launcherErrorLog) { Get-Content -LiteralPath $launcherErrorLog -Raw } else { "<launcher error log unavailable>" }
        throw "Launcher did not produce both the desktop shell and bridge.\nSTDOUT:\n$output\nSTDERR:\n$errors"
    }

    [void]$trackedIds.Add([int]$desktopProcess.ProcessId)
    [void]$trackedIds.Add([int]$bridgeProcess.ProcessId)
    Start-Sleep -Seconds $WaitSeconds

    $desktopStillRunning = Get-Process -Id ([int]$desktopProcess.ProcessId) -ErrorAction SilentlyContinue
    $bridgeStillRunning = Get-Process -Id ([int]$bridgeProcess.ProcessId) -ErrorAction SilentlyContinue
    if (-not $desktopStillRunning -or -not $bridgeStillRunning) {
        throw "The launched desktop shell or bridge exited during the dashboard startup window."
    }

    $desktopWindow = Get-Process -Id ([int]$desktopProcess.ProcessId) -ErrorAction Stop
    $closeDeadline = (Get-Date).AddSeconds(10)
    while ($desktopWindow.MainWindowHandle -eq [IntPtr]::Zero -and (Get-Date) -lt $closeDeadline) {
        Start-Sleep -Milliseconds 250
        $desktopWindow.Refresh()
    }
    if ($desktopWindow.MainWindowHandle -eq [IntPtr]::Zero) {
        throw "The desktop shell process remained alive but did not create a visible manager window."
    }

    $diagnosticPath = Join-Path $env:LOCALAPPDATA ("UEFN Entitlement Manager\logs\desktop-shell-{0}.log" -f $desktopProcess.ProcessId)
    $navigationDeadline = (Get-Date).AddSeconds(5)
    $navigationLog = ""
    while ((Get-Date) -lt $navigationDeadline) {
        if (Test-Path -LiteralPath $diagnosticPath) {
            $navigationLog = Get-Content -LiteralPath $diagnosticPath -Raw
            if ($navigationLog -match "Dashboard navigation completed: success=True") { break }
        }
        Start-Sleep -Milliseconds 250
    }
    if ($navigationLog -notmatch "Dashboard navigation completed: success=True") {
        throw "The manager window appeared but the dashboard did not report a successful navigation. Diagnostic log: $diagnosticPath"
    }

    [void][UemWindowCloser]::PostMessage($desktopWindow.MainWindowHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    while ((Get-Date) -lt $closeDeadline) {
        $desktopAlive = Get-Process -Id ([int]$desktopProcess.ProcessId) -ErrorAction SilentlyContinue
        $bridgeAlive = Get-Process -Id ([int]$bridgeProcess.ProcessId) -ErrorAction SilentlyContinue
        if (-not $desktopAlive -and -not $bridgeAlive) { break }
        Start-Sleep -Milliseconds 250
    }
    if ((Get-Process -Id ([int]$desktopProcess.ProcessId) -ErrorAction SilentlyContinue) -or
        (Get-Process -Id ([int]$bridgeProcess.ProcessId) -ErrorAction SilentlyContinue)) {
        throw "The manager window closed without releasing the bridge process."
    }

    Write-Host "Launcher produced a visible standalone shell and released its bridge cleanly (desktop PID $($desktopProcess.ProcessId), bridge PID $($bridgeProcess.ProcessId))." -ForegroundColor Green
}
finally {
    foreach ($id in $trackedIds) {
        $process = Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($process) { Stop-Process -Id $id -Force }
    }
    foreach ($key in $oldEnvironment.Keys) {
        Set-Item -Path ("Env:" + $key) -Value $oldEnvironment[$key]
    }
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}

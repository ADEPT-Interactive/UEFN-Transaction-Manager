param(
    [string]$ApplicationPath = "",
    [string]$PackageRoot = "",
    [switch]$Packaged,
    [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"
$toolRoot = Split-Path -Parent $PSScriptRoot
if (-not $PackageRoot) { $PackageRoot = $toolRoot }
$PackageRoot = (Resolve-Path -LiteralPath $PackageRoot).Path
if (-not $ApplicationPath) {
    $ApplicationPath = Join-Path $toolRoot "node_modules\electron\dist\electron.exe"
}
$ApplicationPath = (Resolve-Path -LiteralPath $ApplicationPath).Path
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("uem-electron-lifecycle-" + [guid]::NewGuid().ToString("N"))
$projectRoot = Join-Path $testRoot "PortableTest"
$contentRoot = Join-Path $projectRoot "Plugins\PortableTest\Content"
$projectFile = Join-Path $projectRoot "PortableTest.uefnproject"
$statePath = Join-Path $env:LOCALAPPDATA "UEFN Entitlement Manager\active-session.json"
$trackedIds = [System.Collections.Generic.HashSet[int]]::new()

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class UemElectronWindowCloser {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
}
"@

function Get-DescendantProcesses {
    param([Parameter(Mandatory = $true)] [int]$RootProcessId)
    $all = @(Get-CimInstance Win32_Process)
    $known = [System.Collections.Generic.HashSet[int]]::new()
    [void]$known.Add($RootProcessId)
    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($process in $all) {
            if ($known.Contains([int]$process.ParentProcessId) -and -not $known.Contains([int]$process.ProcessId)) {
                [void]$known.Add([int]$process.ProcessId)
                $changed = $true
            }
        }
    }
    return @($all | Where-Object { $known.Contains([int]$_.ProcessId) })
}

function Wait-ForLog {
    param(
        [Parameter(Mandatory = $true)] [string]$LogPath,
        [Parameter(Mandatory = $true)] [string]$Pattern,
        [Parameter(Mandatory = $true)] [System.Diagnostics.Process]$Process
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $text = ""
    while ((Get-Date) -lt $deadline) {
        $Process.Refresh()
        if ($Process.HasExited) { throw "Electron exited before '$Pattern' appeared in $LogPath." }
        if (Test-Path -LiteralPath $LogPath) {
            $text = Get-Content -LiteralPath $LogPath -Raw
            if ($text -match "Fatal error dialog:") { throw "Electron reported a fatal error. Diagnostic log: $LogPath`n$text" }
            if ($text -match $Pattern) { return $text }
        }
        Start-Sleep -Milliseconds 150
    }
    throw "Electron did not report '$Pattern' within $TimeoutSeconds seconds. Diagnostic log: $LogPath`n$text"
}

function Start-TestApplication {
    param([bool]$AutoConfirm, [bool]$AutoSwitch)
    $env:UEM_TEST_MODE = "1"
    $env:UEM_TEST_AUTO_CONFIRM = if ($AutoConfirm) { "1" } else { "0" }
    $env:UEM_TEST_AUTO_SWITCH = if ($AutoSwitch) { "1" } else { "0" }
    $arguments = if ($Packaged) {
        @("--project", ('"' + $projectFile + '"'))
    } else {
        @(('"' + $PackageRoot + '"'), "--project", ('"' + $projectFile + '"'))
    }
    return Start-Process -FilePath $ApplicationPath -ArgumentList $arguments -WorkingDirectory $PackageRoot -PassThru
}

function Stop-TestApplication {
    param([Parameter(Mandatory = $true)] [System.Diagnostics.Process]$Process)
    $Process.Refresh()
    if (-not $Process.HasExited -and $Process.MainWindowHandle -ne [IntPtr]::Zero) {
        [void][UemElectronWindowCloser]::PostMessage($Process.MainWindowHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    }
    $deadline = (Get-Date).AddSeconds(15)
    while (-not $Process.HasExited -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 150
        $Process.Refresh()
    }
    if (-not $Process.HasExited) { throw "Electron did not exit after its visible window received WM_CLOSE." }
}

New-Item -ItemType Directory -Path $contentRoot -Force | Out-Null
$descriptor = '{"title":"Portable Lifecycle Test","plugins":[{"name":"PortableTest","bIsRoot":true}],"bEnablePythonForProject":false}'
Set-Content -LiteralPath $projectFile -Value $descriptor -Encoding UTF8

try {
    $picker = Start-TestApplication -AutoConfirm $false -AutoSwitch $false
    [void]$trackedIds.Add($picker.Id)
    $pickerLog = Join-Path $env:LOCALAPPDATA ("UEFN Entitlement Manager\logs\electron-main-{0}.log" -f $picker.Id)
    $pickerText = Wait-ForLog -LogPath $pickerLog -Pattern "Project launcher renderer ready:" -Process $picker
    $windowDeadline = (Get-Date).AddSeconds(10)
    while ($picker.MainWindowHandle -eq [IntPtr]::Zero -and (Get-Date) -lt $windowDeadline) { Start-Sleep -Milliseconds 100; $picker.Refresh() }
    if ($picker.MainWindowHandle -eq [IntPtr]::Zero) { throw "The project picker did not create a visible window." }
    if ($pickerText -match "Bridge started:") { throw "The bridge started before explicit project confirmation." }
    $pickerDescendants = @(Get-DescendantProcesses -RootProcessId $picker.Id)
    if ($pickerDescendants | Where-Object { $_.CommandLine -match "dist[\\/]server\.cjs" }) { throw "A bridge child process exists before explicit project confirmation." }
    Stop-TestApplication -Process $picker

    $manager = Start-TestApplication -AutoConfirm $true -AutoSwitch $true
    [void]$trackedIds.Add($manager.Id)
    $managerLog = Join-Path $env:LOCALAPPDATA ("UEFN Entitlement Manager\logs\electron-main-{0}.log" -f $manager.Id)
    $managerText = Wait-ForLog -LogPath $managerLog -Pattern "Project switch completed" -Process $manager
    $managerText = Wait-ForLog -LogPath $managerLog -Pattern "(?s)Dashboard renderer ready:.*Dashboard renderer ready:" -Process $manager
    if (([regex]::Matches($managerText, "Bridge started:")).Count -lt 2) { throw "Project switching did not start a replacement bridge." }
    if (([regex]::Matches($managerText, "Bridge shutdown completed:")).Count -lt 1) { throw "Project switching did not stop the previous bridge." }

    $manager.Refresh()
    if ($manager.MainWindowHandle -eq [IntPtr]::Zero) { throw "The dashboard process is alive but has no visible manager window." }
    $descendants = @(Get-DescendantProcesses -RootProcessId $manager.Id)
    foreach ($process in $descendants) { [void]$trackedIds.Add([int]$process.ProcessId) }
    $visible = @($descendants | ForEach-Object { Get-Process -Id ([int]$_.ProcessId) -ErrorAction SilentlyContinue } | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero })
    if ($visible.Count -ne 1) { throw "Expected one visible manager window, found $($visible.Count)." }
    $bridgeChildren = @($descendants | Where-Object { $_.CommandLine -match "dist[\\/]server\.cjs" })
    if ($bridgeChildren.Count -ne 1) { throw "Expected exactly one owned bridge after project switching, found $($bridgeChildren.Count)." }
    foreach ($bridgeChild in $bridgeChildren) {
        $bridgeProcess = Get-Process -Id ([int]$bridgeChild.ProcessId) -ErrorAction Stop
        if ($bridgeProcess.MainWindowHandle -ne [IntPtr]::Zero) { throw "The bridge child created an unexpected console or application window." }
    }

    Stop-TestApplication -Process $manager
    Start-Sleep -Milliseconds 750
    foreach ($id in $trackedIds) {
        if (Get-Process -Id $id -ErrorAction SilentlyContinue) { throw "Electron lifecycle left process $id running." }
    }
    if (Test-Path -LiteralPath $statePath) { throw "Electron lifecycle left active-session.json behind." }
    $finalText = Get-Content -LiteralPath $managerLog -Raw
    if ($finalText -notmatch "Electron shutdown completed" -or $finalText -match "Fatal error dialog:") { throw "Electron did not complete a clean diagnostic shutdown. Log: $managerLog" }
    Write-Host "Electron picker, project confirmation, dashboard navigation, project switching, and owned-process shutdown passed." -ForegroundColor Green
}
finally {
    foreach ($id in $trackedIds) {
        $process = Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($process) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
    }
    Remove-Item Env:UEM_TEST_MODE,Env:UEM_TEST_AUTO_CONFIRM,Env:UEM_TEST_AUTO_SWITCH -ErrorAction SilentlyContinue
    if ((Resolve-Path -LiteralPath $testRoot -ErrorAction SilentlyContinue).Path -like (([IO.Path]::GetTempPath().TrimEnd('\')) + "\uem-electron-lifecycle-*")) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}

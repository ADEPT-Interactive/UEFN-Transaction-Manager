param(
    [string]$ApplicationPath = "",
    [string]$PackageRoot = "",
    [switch]$Packaged,
    [switch]$Hidden,
    [switch]$FailureRollback,
    [ValidateSet("initialized", "uninitialized")]
    [string]$CatalogState = "uninitialized",
    [int]$TimeoutSeconds = 60
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
$statePath = Join-Path $testRoot "state\active-session.json"
$trackedIds = [System.Collections.Generic.HashSet[int]]::new()
$trackedIdentities = @{}
$originalLocalAppData = [Environment]::GetEnvironmentVariable("LOCALAPPDATA", "Process")
$testLocalAppData = Join-Path $testRoot "localappdata"
New-Item -ItemType Directory -Path $testLocalAppData -Force | Out-Null
$env:LOCALAPPDATA = $testLocalAppData

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

function Track-ProcessIdentity {
    param([Parameter(Mandatory = $true)] [int]$ProcessId)
    try {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
        if ($process) { $trackedIdentities[$ProcessId] = [string]$process.CreationDate }
    }
    catch {}
}

function Test-TrackedProcessAlive {
    param([Parameter(Mandatory = $true)] [int]$ProcessId)
    if (-not $trackedIdentities.ContainsKey($ProcessId)) { return $false }
    try {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
        return $null -ne $process -and [string]$process.CreationDate -eq [string]$trackedIdentities[$ProcessId]
    }
    catch { return $false }
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
        if (Test-Path -LiteralPath $LogPath) {
            $text = Get-Content -LiteralPath $LogPath -Raw
            if ($text -match "Fatal error dialog:") { throw "Electron reported a fatal error. Diagnostic log: $LogPath`n$text" }
            if ($text -match $Pattern) { return $text }
        }
        if ($Process.HasExited) { throw "Electron exited before '$Pattern' appeared in $LogPath." }
        Start-Sleep -Milliseconds 150
    }
    throw "Electron did not report '$Pattern' within $TimeoutSeconds seconds. Diagnostic log: $LogPath`n$text"
}

function Start-TestApplication {
    param([bool]$AutoConfirm, [bool]$AutoSwitch)
    $env:UEM_TEST_MODE = "1"
    $env:UEM_TEST_HIDDEN = if ($Hidden) { "1" } else { "0" }
    $env:UEM_TEST_AUTO_CONFIRM = if ($AutoConfirm) { "1" } else { "0" }
    $env:UEM_TEST_AUTO_SWITCH = if ($AutoSwitch) { "1" } else { "0" }
    $env:UEM_TEST_AUTO_SWITCH_CLICKS = if ($Hidden -and $AutoSwitch) { "3" } else { "1" }
    $env:UEM_TEST_AUTO_EXIT = if ($Hidden -and $AutoSwitch) { "1" } else { "0" }
    $env:UEM_TEST_AUTO_SWITCH_CYCLES = if ($Hidden -and $AutoSwitch -and -not $FailureRollback) { "10" } else { "1" }
    $env:UEM_TEST_FAIL_REPLACEMENT = if ($FailureRollback -and $AutoSwitch) { "1" } else { "0" }
    $env:UEM_TEST_LATE_IPC = if ($AutoSwitch) { "1" } else { "0" }
    $env:UEM_TEST_STATE_ROOT = Join-Path $testRoot "state"
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
    if ($Hidden) {
        $deadline = (Get-Date).AddSeconds(10)
        while (-not $Process.HasExited -and (Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 100
            $Process.Refresh()
        }
        if (-not $Process.HasExited) {
            Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
            $Process.WaitForExit(5000) | Out-Null
        }
        if (-not $Process.HasExited) { throw "Hidden Electron did not exit after its bounded test shutdown." }
        return
    }
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
if ($CatalogState -eq "initialized") {
    Copy-Item -LiteralPath (Join-Path $toolRoot "docs\showcase\runtime\Creator Commerce Demo\Content\managed_transactions.verse") -Destination (Join-Path $contentRoot "managed_transactions.verse") -Force
}

try {
    $picker = Start-TestApplication -AutoConfirm $false -AutoSwitch $false
    [void]$trackedIds.Add($picker.Id)
    Track-ProcessIdentity -ProcessId $picker.Id
    $pickerLog = Join-Path $env:LOCALAPPDATA ("UEFN Entitlement Manager\logs\electron-main-{0}.log" -f $picker.Id)
    $pickerText = Wait-ForLog -LogPath $pickerLog -Pattern "Project launcher renderer ready:" -Process $picker
    if ($Hidden) {
        if ($picker.MainWindowHandle -ne [IntPtr]::Zero) { throw "Hidden lifecycle picker created a visible window." }
    }
    else {
        $windowDeadline = (Get-Date).AddSeconds(10)
        while ($picker.MainWindowHandle -eq [IntPtr]::Zero -and (Get-Date) -lt $windowDeadline) { Start-Sleep -Milliseconds 100; $picker.Refresh() }
        if ($picker.MainWindowHandle -eq [IntPtr]::Zero) { throw "The project picker did not create a visible window." }
    }
    if ($pickerText -match "Bridge started:") { throw "The bridge started before explicit project confirmation." }
    $pickerDescendants = @(Get-DescendantProcesses -RootProcessId $picker.Id)
    if ($pickerDescendants | Where-Object { $_.CommandLine -match "dist[\\/]server\.cjs" }) { throw "A bridge child process exists before explicit project confirmation." }
    Stop-TestApplication -Process $picker

    $manager = Start-TestApplication -AutoConfirm $true -AutoSwitch $true
    [void]$trackedIds.Add($manager.Id)
    Track-ProcessIdentity -ProcessId $manager.Id
    $managerLog = Join-Path $env:LOCALAPPDATA ("UEFN Entitlement Manager\logs\electron-main-{0}.log" -f $manager.Id)
    $managerPattern = if ($FailureRollback) { "Project switch replacement failed; current dashboard retained:" } elseif ($Hidden) { "Electron shutdown completed" } else { "Project switch completed" }
    $managerText = Wait-ForLog -LogPath $managerLog -Pattern $managerPattern -Process $manager
    if ($Hidden) {
        if ($FailureRollback) {
            if ($managerText -match "Fatal error dialog:") { throw "Candidate failure incorrectly became fatal." }
            if ($managerText -notmatch "Synthetic replacement candidate failure requested") { throw "The candidate-failure path was not exercised." }
            if ($managerText -notmatch "Late IPC from retiring dashboard rejected:") { throw "Late IPC from the retiring dashboard was not rejected." }
            if (([regex]::Matches($managerText, "Bridge shutdown completed:")).Count -ne 0) { throw "The old bridge was torn down before replacement rollback completed." }
            if ($managerText -match "Launcher candidate validated before bridge teardown:") { throw "The failing candidate was treated as validated." }
            if ($managerText -match "Retiring dashboard window destroyed:") { throw "Rollback destroyed the retained dashboard." }
        }
        else {
            $expectedSwitches = 10
            $launcherReadyCount = ([regex]::Matches($managerText, "Project launcher renderer ready:")).Count
            $bridgeStartedCount = ([regex]::Matches($managerText, "Bridge started:")).Count
            $navigationCount = ([regex]::Matches($managerText, "Expected navigation started:")).Count
            $bridgeShutdownCount = ([regex]::Matches($managerText, "Bridge shutdown completed:")).Count
            $replacementCount = ([regex]::Matches($managerText, "Replacement launcher window created:")).Count
            $candidateValidatedCount = ([regex]::Matches($managerText, "Launcher candidate validated before bridge teardown:")).Count
            $retiredCount = ([regex]::Matches($managerText, "Retiring dashboard window destroyed:")).Count
            if ($launcherReadyCount -lt ($expectedSwitches + 1)) {
                $testState = (($managerText -split "`r?`n" | Where-Object { $_ -match "Hidden test (auto-switch scheduled|switch state)" }) -join " | ")
                $tail = (($managerText -split "`r?`n" | Select-Object -Last 18) -join " | ")
                throw "Hidden project switching did not validate every returned launcher renderer; count=$launcherReadyCount expected=$($expectedSwitches + 1). state=$testState tail=$tail"
            }
            if ($bridgeStartedCount -lt $expectedSwitches) { throw "Hidden project switching did not start every synthetic bridge; count=$bridgeStartedCount expected=$expectedSwitches." }
            if ($navigationCount -ne $expectedSwitches) { throw "Rapid hidden Switch Project requests were not serialized into exactly $expectedSwitches navigation transactions; count=$navigationCount." }
            if ($bridgeShutdownCount -ne $expectedSwitches) { throw "Hidden project switching caused an unexpected number of bridge shutdowns; count=$bridgeShutdownCount." }
            if ($replacementCount -ne $expectedSwitches) { throw "The replacement-window lifecycle did not run once per switch; count=$replacementCount." }
            if ($candidateValidatedCount -ne $expectedSwitches) { throw "A launcher candidate was not validated before bridge teardown; count=$candidateValidatedCount." }
            if ($retiredCount -ne $expectedSwitches) { throw "A retiring dashboard window was not destroyed after handoff; count=$retiredCount." }
            if ($managerText -match "Navigation recovery retry started:") { throw "The replacement lifecycle retried navigation on the same WebContents." }
            if ($managerText -match "Late IPC from retiring dashboard was unexpectedly accepted:") { throw "Late IPC from a retiring dashboard was accepted." }
            if ($managerText -notmatch "Navigation destination verified:") { throw "Hidden project switching did not prove the launcher destination before completion." }
            if ($managerText -notmatch "Launcher protocol request completed:.*status=200") { throw "Hidden project switching did not receive a successful launcher protocol response." }
        }
    }
    else {
        $managerText = Wait-ForLog -LogPath $managerLog -Pattern "(?s)Dashboard renderer ready:.*Dashboard renderer ready:" -Process $manager
        if (([regex]::Matches($managerText, "Bridge started:")).Count -lt 2) { throw "Project switching did not start a replacement bridge." }
    }
    if (-not $FailureRollback -and ([regex]::Matches($managerText, "Bridge shutdown completed:")).Count -lt 1) { throw "Project switching did not stop the previous bridge." }

    if ($Hidden) {
        if ($manager.MainWindowHandle -ne [IntPtr]::Zero) { throw "Hidden Electron lifecycle created a visible manager window." }
    }
    else {
        $managerWindowDeadline = (Get-Date).AddSeconds(10)
        while ($manager.MainWindowHandle -eq [IntPtr]::Zero -and (Get-Date) -lt $managerWindowDeadline) {
            Start-Sleep -Milliseconds 100
            $manager.Refresh()
        }
        if ($manager.MainWindowHandle -eq [IntPtr]::Zero) { throw "The dashboard process is alive but has no visible manager window." }
    }
    $descendants = @(Get-DescendantProcesses -RootProcessId $manager.Id)
    foreach ($process in $descendants) {
        [void]$trackedIds.Add([int]$process.ProcessId)
        Track-ProcessIdentity -ProcessId ([int]$process.ProcessId)
    }
    # WebView2/Electron utility children can expose a non-zero MainWindowHandle
    # while having no user-visible title. Count the actual manager window only.
    $visible = @($descendants | ForEach-Object { Get-Process -Id ([int]$_.ProcessId) -ErrorAction SilentlyContinue } | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and -not [string]::IsNullOrWhiteSpace($_.MainWindowTitle) })
    if ($Hidden) {
        if ($visible.Count -ne 0) {
            $visibleDetails = ($visible | ForEach-Object { "pid=$($_.Id) title='$($_.MainWindowTitle)' path='$($_.Path)'" }) -join '; '
            throw "Hidden lifecycle created visible manager windows: $visibleDetails"
        }
    }
    elseif ($visible.Count -ne 1) {
        $visibleDetails = ($visible | ForEach-Object { "pid=$($_.Id) title='$($_.MainWindowTitle)' path='$($_.Path)'" }) -join '; '
        throw "Expected one visible manager window, found $($visible.Count): $visibleDetails"
    }
    $bridgeChildren = @($descendants | Where-Object { $_.CommandLine -match "dist[\\/]server\.cjs" })
    if ($FailureRollback) {
        if ($bridgeChildren.Count -gt 1) { throw "Candidate rollback left more than one owned bridge process, found $($bridgeChildren.Count)." }
    }
    else {
        $expectedBridgeCount = if ($Hidden) { 0 } else { 1 }
        if ($bridgeChildren.Count -ne $expectedBridgeCount) { throw "Expected $expectedBridgeCount owned bridge process(es) after project switching, found $($bridgeChildren.Count)." }
    }
    foreach ($bridgeChild in $bridgeChildren) {
        $bridgeProcess = Get-Process -Id ([int]$bridgeChild.ProcessId) -ErrorAction SilentlyContinue
        if (-not $bridgeProcess) {
            if ($FailureRollback) { continue }
            throw "The expected bridge process $($bridgeChild.ProcessId) exited during lifecycle verification."
        }
        if ($bridgeProcess.MainWindowHandle -ne [IntPtr]::Zero) { throw "The bridge child created an unexpected console or application window." }
    }

    Stop-TestApplication -Process $manager
    Start-Sleep -Milliseconds 750
    foreach ($id in $trackedIds) {
        if (Test-TrackedProcessAlive -ProcessId $id) { throw "Electron lifecycle left owned process $id running." }
    }
    if (Test-Path -LiteralPath $statePath) { throw "Electron lifecycle left active-session.json behind." }
    $finalText = Get-Content -LiteralPath $managerLog -Raw
    if ($finalText -notmatch "Electron shutdown completed" -or $finalText -match "Fatal error dialog:") { throw "Electron did not complete a clean diagnostic shutdown. Log: $managerLog" }
    $label = if ($Hidden) { "hidden " } else { "" }
    Write-Host "Electron ${label}picker, ${CatalogState} catalog project confirmation, dashboard navigation, project switching, and owned-process shutdown passed." -ForegroundColor Green
}
finally {
    foreach ($id in $trackedIds) {
        if (Test-TrackedProcessAlive -ProcessId $id) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
    }
    if (Test-Path -LiteralPath $statePath) {
        try {
            $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
            $stateContentRoot = [IO.Path]::GetFullPath([string]$state.contentRoot).TrimEnd('\')
            $syntheticRoot = [IO.Path]::GetFullPath($projectRoot).TrimEnd('\')
            if ($stateContentRoot.StartsWith($syntheticRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
                Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
            }
        }
        catch {}
    }
    Remove-Item Env:UEM_TEST_MODE,Env:UEM_TEST_HIDDEN,Env:UEM_TEST_AUTO_CONFIRM,Env:UEM_TEST_AUTO_SWITCH,Env:UEM_TEST_AUTO_SWITCH_CLICKS,Env:UEM_TEST_AUTO_EXIT,Env:UEM_TEST_AUTO_SWITCH_CYCLES,Env:UEM_TEST_FAIL_REPLACEMENT,Env:UEM_TEST_LATE_IPC,Env:UEM_TEST_STATE_ROOT -ErrorAction SilentlyContinue
    [Environment]::SetEnvironmentVariable("LOCALAPPDATA", $originalLocalAppData, "Process")
    if ((Resolve-Path -LiteralPath $testRoot -ErrorAction SilentlyContinue).Path -like (([IO.Path]::GetTempPath().TrimEnd('\')) + "\uem-electron-lifecycle-*")) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}

param(
    [Parameter(Mandatory = $true)] [string]$PlanPath
)

$ErrorActionPreference = "Stop"
$plan = Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json
$currentRoot = [IO.Path]::GetFullPath($plan.currentRoot).TrimEnd('\')
$stagedRoot = [IO.Path]::GetFullPath($plan.stagedRoot).TrimEnd('\')
$relaunchPath = [IO.Path]::GetFullPath($plan.relaunchPath)
$resultPath = [IO.Path]::GetFullPath($plan.resultPath)
$cleanupRoot = [IO.Path]::GetFullPath($plan.cleanupRoot).TrimEnd('\')
$backupRoot = Join-Path ([IO.Path]::GetTempPath()) ("uem-portable-backup-" + [guid]::NewGuid().ToString("N"))
$copied = [System.Collections.Generic.List[string]]::new()
$moved = [System.Collections.Generic.List[string]]::new()
$relaunchArguments = if ($null -ne $plan.relaunchArguments) { @($plan.relaunchArguments | ForEach-Object { [string]$_ }) } else { @('--portable-update-result', $resultPath) }

function Assert-Contained {
    param([string]$Root, [string]$RelativePath)
    if ([IO.Path]::IsPathRooted($RelativePath) -or ($RelativePath -split '[/\\]') -contains '..') { throw "Portable update manifest contains an unsafe path: $RelativePath" }
    $candidate = [IO.Path]::GetFullPath((Join-Path $Root ($RelativePath -replace '/', '\')))
    if ($candidate -ne $Root -and -not $candidate.StartsWith($Root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Portable update path escaped its root: $RelativePath" }
    return $candidate
}

function Read-ManagedFiles {
    param([string]$Root)
    $markerPath = Join-Path $Root 'portable.json'
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { throw "Portable marker is missing from $Root." }
    $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
    if ($marker.distribution -ne 'portable' -or $marker.schemaVersion -ne 1 -or -not $marker.managedFiles) { throw "Portable marker is invalid in $Root." }
    return @($marker.managedFiles | ForEach-Object { [string]$_ })
}

function Write-Result {
    param([bool]$Success, [string]$Message)
    $parent = Split-Path -Parent $resultPath
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    ([ordered]@{ success = $Success; message = $Message; timestamp = [DateTime]::UtcNow.ToString('O') } | ConvertTo-Json) | Set-Content -LiteralPath $resultPath -Encoding UTF8
}

try {
    if (-not (Test-Path -LiteralPath $currentRoot -PathType Container)) { throw "The portable application directory no longer exists." }
    if (-not (Test-Path -LiteralPath $stagedRoot -PathType Container)) { throw "The staged portable update no longer exists." }
    if (-not (Test-Path -LiteralPath $relaunchPath -PathType Leaf)) { throw "The portable executable path is invalid." }
    $oldFiles = @(Read-ManagedFiles -Root $currentRoot)
    $newFiles = @(Read-ManagedFiles -Root $stagedRoot)
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

    $process = Get-Process -Id ([int]$plan.processId) -ErrorAction SilentlyContinue
    $deadline = (Get-Date).AddSeconds(90)
    while ($process -and -not $process.HasExited -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200; $process.Refresh() }
    if ($process -and -not $process.HasExited) { throw "The running portable application did not exit before replacement." }

    foreach ($relative in $oldFiles) {
        $source = Assert-Contained -Root $currentRoot -RelativePath $relative
        if (Test-Path -LiteralPath $source -PathType Leaf) {
            $backup = Assert-Contained -Root $backupRoot -RelativePath $relative
            New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force | Out-Null
            Move-Item -LiteralPath $source -Destination $backup -Force
            [void]$moved.Add($relative)
        }
    }

    foreach ($relative in $newFiles) {
        $source = Assert-Contained -Root $stagedRoot -RelativePath $relative
        $destination = Assert-Contained -Root $currentRoot -RelativePath $relative
        if ((Test-Path -LiteralPath $destination -PathType Leaf) -and -not $moved.Contains($relative)) { throw "The update would overwrite an unmanaged file: $relative" }
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Force
        [void]$copied.Add($relative)
    }

    Write-Result -Success $true -Message 'Portable update completed successfully.'
    $newProcess = Start-Process -FilePath $relaunchPath -WorkingDirectory $currentRoot -ArgumentList $relaunchArguments -PassThru -WindowStyle Hidden
    Start-Sleep -Milliseconds 1500
    $newProcess.Refresh()
    if ($newProcess.HasExited) { throw "The updated portable application exited during relaunch." }
    if (Test-Path -LiteralPath $backupRoot) { Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $cleanupRoot) { Remove-Item -LiteralPath $cleanupRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
catch {
    $failureMessage = $_.Exception.Message
    try {
        foreach ($relative in $copied) {
            $destination = Assert-Contained -Root $currentRoot -RelativePath $relative
            if (Test-Path -LiteralPath $destination -PathType Leaf) { Remove-Item -LiteralPath $destination -Force }
        }
        foreach ($relative in $moved) {
            $backup = Assert-Contained -Root $backupRoot -RelativePath $relative
            $destination = Assert-Contained -Root $currentRoot -RelativePath $relative
            if (Test-Path -LiteralPath $backup -PathType Leaf) {
                New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
                Move-Item -LiteralPath $backup -Destination $destination -Force
            }
        }
        Write-Result -Success $false -Message $failureMessage
        if (Test-Path -LiteralPath $relaunchPath -PathType Leaf) { Start-Process -FilePath $relaunchPath -WorkingDirectory $currentRoot -ArgumentList $relaunchArguments -WindowStyle Hidden | Out-Null }
    } catch { }
}
finally {
    if (Test-Path -LiteralPath $backupRoot) { Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction SilentlyContinue }
}

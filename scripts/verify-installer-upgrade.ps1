param(
    [Parameter(Mandatory = $true)] [string]$BaselineInstaller,
    [Parameter(Mandatory = $true)] [string]$CandidateInstaller,
    [Parameter(Mandatory = $true)] [string]$IsolationRoot,
    [switch]$NaturalPath,
    [switch]$KeepTestFiles
)

$ErrorActionPreference = 'Stop'

function Resolve-File([string]$path, [string]$label) {
    $resolved = Resolve-Path -LiteralPath $path -ErrorAction Stop
    if (-not (Test-Path -LiteralPath $resolved.Path -PathType Leaf)) { throw "$label is not a file: $path" }
    return $resolved.Path
}

function Get-UtmUninstallEntries {
    @(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            $properties = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction Stop
            if ($properties.DisplayName -like 'UEFN Transaction Manager*') {
                [pscustomobject]@{
                    Key = $_.PSPath
                    DisplayName = $properties.DisplayName
                    DisplayVersion = $properties.DisplayVersion
                    UninstallString = $properties.UninstallString
                    DisplayIcon = $properties.DisplayIcon
                }
            }
        }
        catch { }
    })
}

function Get-UtmShortcut {
    $path = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\UEFN Transaction Manager.lnk'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($path)
    [pscustomobject]@{ Path = $path; Target = $shortcut.TargetPath; WorkingDirectory = $shortcut.WorkingDirectory; IconLocation = $shortcut.IconLocation }
}

function Get-ProductVersion([string]$path) {
    return (Get-Item -LiteralPath $path).VersionInfo.ProductVersion
}

function Start-Installer([string]$path, [string]$installRoot, [switch]$useNaturalPath) {
    $arguments = if ($useNaturalPath) { @('/S') } else { @('/S', "/D=$installRoot") }
    $process = Start-Process -FilePath $path -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Installer exited with code $($process.ExitCode): $path" }
}

function Stop-UtmProcess([string]$expectedPath) {
    $normalized = [IO.Path]::GetFullPath($expectedPath)
    $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -ieq $normalized
    })
    foreach ($process in $processes) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Start-FromShortcut([string]$expectedPath) {
    $shortcut = Get-UtmShortcut
    if (-not $shortcut -or $shortcut.Target -ine $expectedPath) { throw 'The Start Menu shortcut does not target the candidate installation.' }
    $process = Start-Process -FilePath $shortcut.Target -WorkingDirectory $shortcut.WorkingDirectory -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        Start-Sleep -Milliseconds 250
        $observed = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.Id)" -ErrorAction SilentlyContinue
        if ($observed -and $observed.ExecutablePath -and ([IO.Path]::GetFullPath($observed.ExecutablePath) -ieq [IO.Path]::GetFullPath($expectedPath))) {
            Stop-UtmProcess $expectedPath
            return $true
        }
    } while ([DateTime]::UtcNow -lt $deadline)
    Stop-UtmProcess $expectedPath
    throw 'Launching through the Start Menu shortcut did not produce the expected candidate executable path.'
}

function Invoke-Uninstall([object]$entry) {
    if (-not $entry -or [string]::IsNullOrWhiteSpace($entry.UninstallString)) { throw 'The installed candidate has no supported per-user uninstall command.' }
    if ($entry.UninstallString -notmatch '^"(?<path>[^"]+)"(?<args>.*)$') { throw "Unsupported uninstall command format: $($entry.UninstallString)" }
    $uninstaller = $Matches.path
    if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw "Registered uninstaller is missing: $uninstaller" }
    $process = Start-Process -FilePath $uninstaller -ArgumentList @('/currentuser', '/S') -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Uninstaller exited with code $($process.ExitCode)." }
}

$baseline = Resolve-File $BaselineInstaller 'Baseline installer'
$candidate = Resolve-File $CandidateInstaller 'Candidate installer'
$root = [IO.Path]::GetFullPath($IsolationRoot)
$installRoot = if ($NaturalPath) { $null } else { Join-Path $root 'install' }
$marker = Join-Path $env:APPDATA 'UEFN Transaction Manager\installer-upgrade-gate-marker.txt'
$shortcutPath = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\UEFN Transaction Manager.lnk'

if ($root -eq [IO.Path]::GetPathRoot($root)) { throw 'IsolationRoot must be a disposable child directory, not a drive root.' }
if ((Get-UtmUninstallEntries).Count -gt 0 -or (Get-UtmShortcut)) {
    throw 'Refusing to run the installer upgrade gate while a UTM installation or shortcut already exists. Remove it through its supported uninstaller or use an isolated Windows profile.'
}

$evidence = [ordered]@{
    baselineInstaller = $baseline
    baselineSha256 = (Get-FileHash -LiteralPath $baseline -Algorithm SHA256).Hash.ToLowerInvariant()
    candidateInstaller = $candidate
    candidateSha256 = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
    isolationRoot = $root
    steps = [ordered]@{}
}

if (-not $NaturalPath) { New-Item -ItemType Directory -Path $installRoot -Force | Out-Null }
try {
    Start-Installer $baseline $installRoot -useNaturalPath:$NaturalPath
    $baselineEntry = @(Get-UtmUninstallEntries)
    $baselineShortcut = Get-UtmShortcut
    if (-not $baselineShortcut) { throw 'The 4.2.0 installer did not create the expected Start Menu shortcut.' }
    $baselineExe = if ($NaturalPath) { $baselineShortcut.Target } else { Join-Path $installRoot 'UEFN Transaction Manager.exe' }
    if (-not (Test-Path -LiteralPath $baselineExe -PathType Leaf)) { throw 'The 4.2.0 installer did not create the expected application executable.' }
    if ($NaturalPath) { $installRoot = Split-Path -Parent $baselineExe }
    if ($baselineEntry.Count -ne 1 -or -not $baselineShortcut -or $baselineShortcut.Target -ine $baselineExe) { throw 'The 4.2.0 install did not create exactly one matching Start Menu/uninstall identity.' }
    if ((Get-ProductVersion $baselineExe) -notmatch '^4\.2\.0') { throw "The baseline executable reports $(Get-ProductVersion $baselineExe), not 4.2.0." }
    New-Item -ItemType Directory -Path (Split-Path -Parent $marker) -Force | Out-Null
    Set-Content -LiteralPath $marker -Value 'installer-upgrade-gate-state' -Encoding UTF8
    Stop-UtmProcess $baselineExe
    $evidence.steps.baseline = [ordered]@{ version = Get-ProductVersion $baselineExe; installRoot = $installRoot; shortcutTarget = $baselineShortcut.Target; uninstallDisplayVersion = $baselineEntry[0].DisplayVersion; markerCreated = Test-Path -LiteralPath $marker }

    Start-Installer $candidate $installRoot -useNaturalPath:$NaturalPath
    $candidateEntry = @(Get-UtmUninstallEntries)
    $candidateShortcut = Get-UtmShortcut
    if (-not $candidateShortcut) { throw 'The 4.3.0 installer did not preserve the Start Menu shortcut.' }
    $candidateExe = if ($NaturalPath) { $candidateShortcut.Target } else { Join-Path $installRoot 'UEFN Transaction Manager.exe' }
    $versionFile = Join-Path $installRoot 'resources\app\version.json'
    $mainBundle = Join-Path $installRoot 'resources\app\dist-electron\main.cjs'
    $serverBundle = Join-Path $installRoot 'resources\app\dist\server.cjs'
    $rendererBundle = @(Get-ChildItem -LiteralPath (Join-Path $installRoot 'resources\app\dist\assets') -Filter 'index-*.js' -File -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName)
    $pythonBundle = Join-Path $installRoot 'resources\app\entitlement_manager.py'
    if (-not (Test-Path -LiteralPath $candidateExe -PathType Leaf) -or -not (Test-Path -LiteralPath $versionFile -PathType Leaf) -or -not (Test-Path -LiteralPath $mainBundle -PathType Leaf) -or -not (Test-Path -LiteralPath $serverBundle -PathType Leaf) -or $rendererBundle.Count -ne 1 -or -not (Test-Path -LiteralPath $pythonBundle -PathType Leaf)) { throw 'The 4.3.0 upgrade is missing required bundled files.' }
    if ((Get-ProductVersion $candidateExe) -notmatch '^4\.3\.0') { throw "The upgraded executable reports $(Get-ProductVersion $candidateExe), not 4.3.0." }
    $version = Get-Content -LiteralPath $versionFile -Raw | ConvertFrom-Json
    if ($version.version -ne '4.3.0') { throw "The upgraded bundled version is $($version.version), not 4.3.0." }
    if ($candidateEntry.Count -ne 1 -or $candidateShortcut.Target -ine $candidateExe) { throw 'The upgrade did not leave exactly one matching Start Menu/uninstall identity.' }
    if ($NaturalPath -and ($candidateShortcut.Target -ine $baselineShortcut.Target -or $candidateEntry[0].Key -ine $baselineEntry[0].Key)) { throw 'The natural-path upgrade created a different installation identity.' }
    $serverText = Get-Content -LiteralPath $serverBundle -Raw
    $rendererText = Get-Content -LiteralPath $rendererBundle[0] -Raw
    $pythonText = Get-Content -LiteralPath $pythonBundle -Raw
    foreach ($markerText in @('ConsumeEntitlement', 'PendingConsumeIntents', 'validateMigrationParityTable')) {
        if (($serverText + $rendererText) -notmatch [regex]::Escape($markerText)) { throw "The upgraded runtime bundle is missing expected implementation marker: $markerText" }
    }
    if ($pythonText -notmatch 'TextureExporterPNG') { throw 'The upgraded Python bridge is missing the expected texture import marker.' }
    Start-FromShortcut $candidateExe | Out-Null
    $evidence.steps.upgrade = [ordered]@{ version = Get-ProductVersion $candidateExe; installRoot = $installRoot; shortcutTarget = $candidateShortcut.Target; sameLogicalInstall = $candidateShortcut.Target -ieq $baselineShortcut.Target -and $candidateEntry[0].Key -ieq $baselineEntry[0].Key; uninstallDisplayVersion = $candidateEntry[0].DisplayVersion; userStateMarkerSurvives = Test-Path -LiteralPath $marker; mainBundleSha256 = (Get-FileHash -LiteralPath $mainBundle -Algorithm SHA256).Hash.ToLowerInvariant(); serverBundleSha256 = (Get-FileHash -LiteralPath $serverBundle -Algorithm SHA256).Hash.ToLowerInvariant(); rendererBundle = Split-Path -Leaf $rendererBundle[0] }
    if (-not (Test-Path -LiteralPath $marker)) { throw 'The 4.3.0 upgrade did not preserve the user-state marker.' }

    Invoke-Uninstall $candidateEntry[0]
    Start-Sleep -Milliseconds 500
    $evidence.steps.uninstall = [ordered]@{ shortcutRemoved = -not (Test-Path -LiteralPath $shortcutPath); registryRemoved = @(Get-UtmUninstallEntries).Count -eq 0; userStateMarkerStillPresent = Test-Path -LiteralPath $marker; installRootRemoved = -not (Test-Path -LiteralPath $installRoot) }
    if (-not $evidence.steps.uninstall.shortcutRemoved -or -not $evidence.steps.uninstall.registryRemoved -or -not $evidence.steps.uninstall.userStateMarkerStillPresent) { throw 'The supported uninstall did not clean the app identity while preserving user state.' }
    if (-not $evidence.steps.uninstall.installRootRemoved) { throw 'The supported uninstall left the disposable application root behind.' }
    Write-Output ($evidence | ConvertTo-Json -Depth 8)
}
finally {
    if ($installRoot) { Stop-UtmProcess (Join-Path $installRoot 'UEFN Transaction Manager.exe') }
    foreach ($entry in @(Get-UtmUninstallEntries | Where-Object { $_.UninstallString -like "*$root*" })) {
        if ($entry.UninstallString -match '^"(?<path>[^"]+)"' -and (Test-Path -LiteralPath $Matches.path -PathType Leaf)) {
            try { Invoke-Uninstall $entry } catch { }
        }
        if (Test-Path -LiteralPath $entry.Key) { Remove-Item -LiteralPath $entry.Key -Recurse -Force -ErrorAction SilentlyContinue }
    }
    $remainingShortcut = Get-UtmShortcut
    if ($remainingShortcut -and $remainingShortcut.Target -like "$root*") { Remove-Item -LiteralPath $remainingShortcut.Path -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue }
    if (-not $KeepTestFiles -and (Test-Path -LiteralPath $root)) { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
}

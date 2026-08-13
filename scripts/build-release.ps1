param(
    [string]$OutputDirectory = "release",
    [switch]$KeepStaging
)

$ErrorActionPreference = "Stop"
$toolRoot = Split-Path -Parent $PSScriptRoot
$appVersion = (Get-Content -LiteralPath (Join-Path $toolRoot "version.json") -Raw | ConvertFrom-Json).version
$desktopFileName = "UEFNEntitlementManager-$appVersion.exe"
$outputRoot = Join-Path $toolRoot $OutputDirectory
$stagingRoot = Join-Path ([IO.Path]::GetTempPath()) ("uefn-entitlement-manager-release-" + [guid]::NewGuid().ToString("N"))
$packageName = "UEFN Entitlement Manager"
$packageRoot = Join-Path $stagingRoot $packageName
$temporaryRuntimeRoot = $null

Push-Location $toolRoot
try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "setup.ps1") -ForceBuild
    if ($LASTEXITCODE -ne 0) {
        throw "Source setup/build failed."
    }

    $runtime = Get-ChildItem -LiteralPath (Join-Path $toolRoot ".runtime") -Directory -Filter "node-*" -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "node.exe") } |
        Select-Object -First 1
    if (-not $runtime) {
        $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
        if (-not $systemNode) {
            throw "No Node.js runtime is available to stage into the release."
        }
        $systemVersion = (& $systemNode.Source --version).Trim()
        if ($systemVersion -notmatch '^v(?<major>\d+)' -or [int]$Matches.major -lt 20) {
            throw "The available Node.js runtime is not version 20 or newer."
        }
        $runtimeFolderName = "node-" + ($systemVersion -replace '^v', '')
        $runtime = [pscustomobject]@{
            FullName = Join-Path ([IO.Path]::GetTempPath()) ($runtimeFolderName + "-" + [guid]::NewGuid().ToString("N"))
            Name = $runtimeFolderName
        }
        $temporaryRuntimeRoot = $runtime.FullName
        New-Item -ItemType Directory -Path $runtime.FullName -Force | Out-Null
        Copy-Item -LiteralPath $systemNode.Source -Destination (Join-Path $runtime.FullName "node.exe")
    }

    $desktopPublishRoot = Join-Path $toolRoot "desktop\bin\Release\net48\publish"
    $desktopExecutable = Join-Path $desktopPublishRoot $desktopFileName
    if (-not (Test-Path -LiteralPath $desktopExecutable)) {
        throw "The standalone desktop manager shell was not produced by setup."
    }

    New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $toolRoot "dist") -Destination $packageRoot -Recurse
    Copy-Item -LiteralPath (Join-Path $toolRoot "entitlement_manager.py") -Destination $packageRoot
    Copy-Item -LiteralPath (Join-Path $toolRoot "uefn_auto_connector.py") -Destination $packageRoot
    Copy-Item -LiteralPath (Join-Path $toolRoot "version.json") -Destination $packageRoot
    Copy-Item -LiteralPath (Join-Path $toolRoot "LICENSE") -Destination $packageRoot
    Copy-Item -LiteralPath (Join-Path $toolRoot "THIRD_PARTY_NOTICES.txt") -Destination $packageRoot
    Copy-Item -LiteralPath (Join-Path $toolRoot "README-USER.txt") -Destination $packageRoot
    $packageNodeModules = Join-Path $packageRoot "node_modules"
    New-Item -ItemType Directory -Path $packageNodeModules -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $toolRoot "node_modules\sharp") -Destination $packageNodeModules -Recurse
    Copy-Item -LiteralPath (Join-Path $toolRoot "node_modules\@img") -Destination $packageNodeModules -Recurse
    Copy-Item -LiteralPath (Join-Path $toolRoot "node_modules\detect-libc") -Destination $packageNodeModules -Recurse
    Get-ChildItem -LiteralPath $desktopPublishRoot -File | Copy-Item -Destination $packageRoot -Force
    Get-ChildItem -LiteralPath $packageRoot -File -Filter "UEFNEntitlementManager*.exe" |
        Where-Object { $_.Name -ne $desktopFileName } |
        Remove-Item -Force
    New-Item -ItemType Directory -Path (Join-Path $packageRoot ".runtime") -Force | Out-Null
    Copy-Item -LiteralPath $runtime.FullName -Destination (Join-Path $packageRoot ".runtime") -Recurse

    New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
    $archivePath = Join-Path $outputRoot "$packageName.zip"
    if (Test-Path -LiteralPath $archivePath) {
        Remove-Item -LiteralPath $archivePath -Force
    }
    Compress-Archive -LiteralPath $packageRoot -DestinationPath $archivePath -CompressionLevel Optimal
    Write-Host "Release created: $archivePath" -ForegroundColor Green
}
finally {
    Pop-Location
    if (-not $KeepStaging -and (Test-Path -LiteralPath $stagingRoot)) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($temporaryRuntimeRoot -and (Test-Path -LiteralPath $temporaryRuntimeRoot)) {
        Remove-Item -LiteralPath $temporaryRuntimeRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

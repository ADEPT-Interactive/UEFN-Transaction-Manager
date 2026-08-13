param(
    [string]$ArchivePath = "release\UEFN Entitlement Manager.zip",
    [int]$WaitSeconds = 5
)

$ErrorActionPreference = "Stop"
$toolRoot = Split-Path -Parent $PSScriptRoot
$archive = (Resolve-Path -LiteralPath (Join-Path $toolRoot $ArchivePath) -ErrorAction Stop).Path
$extractRoot = Join-Path ([IO.Path]::GetTempPath()) ("uem-release-launcher-" + [guid]::NewGuid().ToString("N"))

try {
    Expand-Archive -LiteralPath $archive -DestinationPath $extractRoot -Force
    $packageRoot = Join-Path $extractRoot "UEFN Entitlement Manager"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "verify-launcher.ps1") -PackageRoot $packageRoot -WaitSeconds $WaitSeconds
    if ($LASTEXITCODE -ne 0) { throw "Packaged launcher verification failed with exit code $LASTEXITCODE." }
    Write-Host "Packaged release launcher verification passed." -ForegroundColor Green
}
finally {
    if (Test-Path -LiteralPath $extractRoot) {
        Remove-Item -LiteralPath $extractRoot -Recurse -Force
    }
}

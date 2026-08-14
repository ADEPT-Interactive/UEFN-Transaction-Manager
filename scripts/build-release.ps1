param(
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$toolRoot = Split-Path -Parent $PSScriptRoot
$appVersion = (Get-Content -LiteralPath (Join-Path $toolRoot "version.json") -Raw | ConvertFrom-Json).version
$desktopFileName = "UEFNEntitlementManager-$appVersion.exe"
$releaseRoot = Join-Path $toolRoot "release"
$archivePath = Join-Path $releaseRoot "UEFN Entitlement Manager.zip"
$inventoryPath = Join-Path $releaseRoot "UEFN Entitlement Manager.contents.tsv"
$stagingRoot = Join-Path ([IO.Path]::GetTempPath()) ("uem-electron-release-" + [guid]::NewGuid().ToString("N"))
$stagingApp = Join-Path $stagingRoot "app"
$packagerOutput = Join-Path $stagingRoot "packaged"
$packageRoot = Join-Path $stagingRoot "UEFN Entitlement Manager"

function Invoke-NativeChecked {
    param(
        [Parameter(Mandatory = $true)] [string]$FilePath,
        [Parameter(Mandatory = $true)] [string[]]$ArgumentList,
        [Parameter(Mandatory = $true)] [string]$Description
    )
    Write-Host "`n> $Description" -ForegroundColor Cyan
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) { throw "$Description failed with exit code $LASTEXITCODE." }
}

function Copy-AppFile {
    param([Parameter(Mandatory = $true)] [string]$RelativePath)
    $source = Join-Path $toolRoot $RelativePath
    $destination = Join-Path $stagingApp $RelativePath
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Required release file is missing: $RelativePath" }
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
}

function Copy-AppDirectory {
    param([Parameter(Mandatory = $true)] [string]$RelativePath)
    $source = Join-Path $toolRoot $RelativePath
    $destination = Join-Path $stagingApp $RelativePath
    if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw "Required release directory is missing: $RelativePath" }
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
}

Push-Location $toolRoot
try {
    $node = Get-Command node.exe -ErrorAction Stop
    $npm = Get-Command npm.cmd -ErrorAction Stop
    if ($SkipTests) {
        Invoke-NativeChecked -FilePath $npm.Source -ArgumentList @("run", "build") -Description "Building Electron, frontend, and bridge"
    }
    else {
        Invoke-NativeChecked -FilePath $npm.Source -ArgumentList @("run", "test:all") -Description "Running complete source verification"
    }

    New-Item -ItemType Directory -Path $stagingApp -Force | Out-Null
    $runtimePackage = @{
        name = "uefn-entitlement-manager-desktop"
        version = $appVersion
        private = $true
        main = "dist-electron/main.cjs"
        type = "commonjs"
    } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $stagingApp "package.json"), $runtimePackage, [Text.UTF8Encoding]::new($false))
    Copy-AppDirectory -RelativePath "dist"
    foreach ($file in @(
        "dist-electron\main.cjs",
        "dist-electron\preload.cjs",
        "electron\launcher.html",
        "electron\launcher.js",
        "electron\assets\uem-icon.ico",
        "electron\assets\uem-icon.svg",
        "electron\assets\adept-insignia.png",
        "entitlement_manager.py",
        "uefn_auto_connector.py",
        "version.json",
        "node_modules\sharp\package.json",
        "node_modules\sharp\LICENSE",
        "node_modules\@img\colour\package.json",
        "node_modules\@img\colour\LICENSE.md",
        "node_modules\@img\colour\index.cjs",
        "node_modules\@img\colour\color.cjs",
        "node_modules\@img\sharp-win32-x64\package.json",
        "node_modules\@img\sharp-win32-x64\LICENSE",
        "node_modules\@img\sharp-win32-x64\index.cjs",
        "node_modules\@img\sharp-win32-x64\versions.json",
        "node_modules\detect-libc\package.json",
        "node_modules\detect-libc\LICENSE",
        "node_modules\koffi\package.json",
        "node_modules\koffi\LICENSE.txt",
        "node_modules\koffi\index.cjs",
        "node_modules\koffi\src\koffi\index.cjs",
        "node_modules\koffi\src\koffi\src\static.cjs",
        "node_modules\@koromix\koffi-win32-x64\package.json",
        "node_modules\@koromix\koffi-win32-x64\index.js",
        "node_modules\@koromix\koffi-win32-x64\win32_x64\koffi.node"
    )) { Copy-AppFile -RelativePath $file }
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $toolRoot "node_modules\sharp\dist") -File -Filter "*.cjs") {
        Copy-AppFile -RelativePath ("node_modules\sharp\dist\" + $file.Name)
    }
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $toolRoot "node_modules\sharp\node_modules\semver") -Recurse -File | Where-Object { $_.Extension -eq ".js" -or $_.Name -in @("package.json", "LICENSE") }) {
        Copy-AppFile -RelativePath ($file.FullName.Substring($toolRoot.Length).TrimStart('\'))
    }
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $toolRoot "node_modules\detect-libc\lib") -File -Filter "*.js") {
        Copy-AppFile -RelativePath ("node_modules\detect-libc\lib\" + $file.Name)
    }
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $toolRoot "node_modules\@img\sharp-win32-x64\lib") -File) {
        Copy-AppFile -RelativePath ("node_modules\@img\sharp-win32-x64\lib\" + $file.Name)
    }

    $packageScript = Join-Path $PSScriptRoot "package-electron.mjs"
    $icon = Join-Path $toolRoot "electron\assets\uem-icon.ico"
    $packagerText = & $node.Source $packageScript "--appDir=$stagingApp" "--outputDir=$packagerOutput" "--icon=$icon" "--version=$appVersion"
    if ($LASTEXITCODE -ne 0) { throw "Electron packaging failed with exit code $LASTEXITCODE." }
    $generatedRoot = ($packagerText | Select-Object -Last 1).Trim()
    if (-not (Test-Path -LiteralPath (Join-Path $generatedRoot $desktopFileName))) { throw "Electron packaging did not produce $desktopFileName." }
    $localesRoot = Join-Path $generatedRoot "locales"
    if (-not (Test-Path -LiteralPath (Join-Path $localesRoot "en-US.pak"))) { throw "Electron packaging omitted the required English locale." }
    Get-ChildItem -LiteralPath $localesRoot -File | Where-Object { $_.Name -ne "en-US.pak" } | Remove-Item -Force
    Move-Item -LiteralPath $generatedRoot -Destination $packageRoot

    $electronLicense = Join-Path $packageRoot "LICENSE"
    if (-not (Test-Path -LiteralPath $electronLicense)) { throw "Electron packaging omitted its runtime license." }
    Move-Item -LiteralPath $electronLicense -Destination (Join-Path $packageRoot "LICENSE.electron.txt")
    foreach ($file in @("LICENSE", "THIRD_PARTY_NOTICES.txt", "README-USER.txt", "version.json")) {
        Copy-Item -LiteralPath (Join-Path $toolRoot $file) -Destination $packageRoot -Force
    }
    New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
    $packageUri = [Uri]($packageRoot.TrimEnd('\') + '\')
    $inventory = @("SHA256`tBytes`tPath") + @(Get-ChildItem -LiteralPath $packageRoot -Recurse -File | Sort-Object FullName | ForEach-Object {
        $relative = [Uri]::UnescapeDataString($packageUri.MakeRelativeUri([Uri]$_.FullName).ToString())
        "{0}`t{1}`t{2}" -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.Length, $relative
    })
    Set-Content -LiteralPath $inventoryPath -Value $inventory -Encoding UTF8
    if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
    Compress-Archive -LiteralPath $packageRoot -DestinationPath $archivePath -CompressionLevel Optimal
    Write-Host "`nPortable Electron release created: $archivePath" -ForegroundColor Green
    Write-Host "Complete contents inventory: $inventoryPath"
    Write-Host ("Archive size: {0:N2} MiB" -f ((Get-Item -LiteralPath $archivePath).Length / 1MB))
}
finally {
    Pop-Location
    if (Test-Path -LiteralPath $stagingRoot) { Remove-Item -LiteralPath $stagingRoot -Recurse -Force }
}

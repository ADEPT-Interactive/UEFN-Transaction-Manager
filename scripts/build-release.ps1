param(
    [switch]$SkipTests,
    [string]$VersionOverride,
    [string]$ReleaseDirectory = "release"
)

$ErrorActionPreference = "Stop"
$toolRoot = Split-Path -Parent $PSScriptRoot
$canonicalVersion = (Get-Content -LiteralPath (Join-Path $toolRoot "version.json") -Raw | ConvertFrom-Json).version
$appVersion = if ($VersionOverride) { $VersionOverride.Trim() } else { $canonicalVersion }
if ($appVersion -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$') {
    throw "Release version is not valid semantic version syntax: $appVersion"
}
$installerFileName = "UEFN-Transaction-Manager-Setup-$appVersion.exe"
$portableFileName = "UEFN-Transaction-Manager-$appVersion-Portable.zip"
$releaseRoot = if ([IO.Path]::IsPathRooted($ReleaseDirectory)) { [IO.Path]::GetFullPath($ReleaseDirectory) } else { Join-Path $toolRoot $ReleaseDirectory }
$stagingRoot = Join-Path ([IO.Path]::GetTempPath()) ("uem-electron-release-" + [guid]::NewGuid().ToString("N"))
$stagingApp = Join-Path $stagingRoot "app"
$builderOutput = Join-Path $stagingRoot "builder-output"
$builderConfigPath = Join-Path $stagingRoot "electron-builder.json"

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

function Copy-AppVersion {
    $destination = Join-Path $stagingApp "version.json"
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    if ($VersionOverride) {
        [IO.File]::WriteAllText($destination, (([ordered]@{ version = $appVersion } | ConvertTo-Json) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    }
    else {
        Copy-AppFile -RelativePath "version.json"
    }
}

function Add-ReleaseChecksum {
    param([Parameter(Mandatory = $true)] [string]$Path, [Parameter(Mandatory = $true)] [AllowEmptyCollection()] [System.Collections.Generic.List[string]]$Lines)
    $item = Get-Item -LiteralPath $Path
    $hash = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    [void]$Lines.Add("$hash  $($item.Name)")
}

Push-Location $toolRoot
try {
    $npm = Get-Command npm.cmd -ErrorAction Stop
    $builder = Join-Path $toolRoot "node_modules\.bin\electron-builder.cmd"
    if (-not (Test-Path -LiteralPath $builder -PathType Leaf)) { throw "electron-builder is not installed. Run npm ci first." }
    if ($SkipTests) {
        Invoke-NativeChecked -FilePath $npm.Source -ArgumentList @("run", "build") -Description "Building Electron, frontend, and bridge"
    }
    else {
        Invoke-NativeChecked -FilePath $npm.Source -ArgumentList @("run", "test:all") -Description "Running complete source verification"
    }

    $builderConfig = Get-Content -LiteralPath (Join-Path $toolRoot "electron-builder.json") -Raw | ConvertFrom-Json
    $builderConfig | Add-Member -NotePropertyName directories -NotePropertyValue ([pscustomobject]@{ output = $builderOutput }) -Force
    $electronVersion = (Get-Content -LiteralPath (Join-Path $toolRoot "node_modules\electron\package.json") -Raw | ConvertFrom-Json).version
    $builderConfig | Add-Member -NotePropertyName electronVersion -NotePropertyValue $electronVersion -Force
    New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
    [IO.File]::WriteAllText($builderConfigPath, ($builderConfig | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))

    New-Item -ItemType Directory -Path $stagingApp -Force | Out-Null
    $runtimePackage = [ordered]@{
        name = "uefn-entitlement-manager"
        version = $appVersion
        description = "Project-scoped In-Island Transactions and Verse transaction manager for UEFN creators"
        author = "AD3PT Interactive Inc."
        private = $true
        main = "dist-electron/main.cjs"
        type = "commonjs"
        dependencies = [ordered]@{
            sharp = "0.35.3"
            koffi = "3.1.5"
        }
        build = $builderConfig
    } | ConvertTo-Json -Depth 20
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
        "LICENSE",
        "README-USER.txt",
        "THIRD_PARTY_NOTICES.txt",
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
    Copy-AppVersion
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

    Invoke-NativeChecked -FilePath $builder -ArgumentList @("--projectDir", $stagingApp, "--config", $builderConfigPath, "--win", "--x64", "--publish", "never") -Description "Building the x64 NSIS installer"
    $builtInstaller = Join-Path $builderOutput $installerFileName
    $builtPortable = Join-Path $builderOutput $portableFileName
    $builtMetadata = Join-Path $builderOutput "latest.yml"
    $builtBlockmap = Join-Path $builderOutput "$installerFileName.blockmap"
    $portableRoot = Join-Path $stagingRoot "portable\UEFN Transaction Manager"
    New-Item -ItemType Directory -Path (Split-Path -Parent $portableRoot) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $builderOutput "win-unpacked") -Destination $portableRoot -Recurse -Force
    Compress-Archive -LiteralPath $portableRoot -DestinationPath $builtPortable -CompressionLevel Optimal
    foreach ($required in @($builtInstaller, $builtPortable, $builtMetadata, $builtBlockmap)) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "electron-builder omitted required release artifact: $required" }
    }
    $metadataText = Get-Content -LiteralPath $builtMetadata -Raw
    $metadataTextNormalized = [Uri]::UnescapeDataString($metadataText)
    if ($metadataTextNormalized -notmatch [regex]::Escape($installerFileName)) { Write-Host $metadataText; throw "latest.yml does not reference $installerFileName." }
    if ($metadataTextNormalized -notmatch "version: $([regex]::Escape($appVersion))") { throw "latest.yml does not declare version $appVersion." }

    New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
    Get-ChildItem -LiteralPath $releaseRoot -File -Force | Remove-Item -Force
    foreach ($artifact in @($builtInstaller, $builtPortable, $builtMetadata, $builtBlockmap)) {
        Copy-Item -LiteralPath $artifact -Destination (Join-Path $releaseRoot (Split-Path -Leaf $artifact)) -Force
    }
    $humanInstaller = Join-Path $releaseRoot "UEFN-Transaction-Manager-Setup.exe"
    $humanPortable = Join-Path $releaseRoot "UEFN-Transaction-Manager-Portable.zip"
    Copy-Item -LiteralPath (Join-Path $releaseRoot $installerFileName) -Destination $humanInstaller -Force
    Copy-Item -LiteralPath (Join-Path $releaseRoot $portableFileName) -Destination $humanPortable -Force
    $versionedInstallerHash = (Get-FileHash -LiteralPath (Join-Path $releaseRoot $installerFileName) -Algorithm SHA256).Hash.ToLowerInvariant()
    $humanInstallerHash = (Get-FileHash -LiteralPath $humanInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
    $versionedPortableHash = (Get-FileHash -LiteralPath (Join-Path $releaseRoot $portableFileName) -Algorithm SHA256).Hash.ToLowerInvariant()
    $humanPortableHash = (Get-FileHash -LiteralPath $humanPortable -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($versionedInstallerHash -ne $humanInstallerHash) { throw "Human installer alias is not byte-identical to the versioned installer." }
    if ($versionedPortableHash -ne $humanPortableHash) { throw "Human portable alias is not byte-identical to the versioned portable archive." }
    Write-Host "Verified byte-identical human aliases for installer and portable archive." -ForegroundColor Green
    $checksumLines = [System.Collections.Generic.List[string]]::new()
    $releaseArtifacts = Get-ChildItem -LiteralPath $releaseRoot -File | Where-Object { $_.Name -notin @("SHA256SUMS.txt", "UEFN Transaction Manager.contents.tsv") } | Sort-Object Name
    foreach ($artifact in $releaseArtifacts) { Add-ReleaseChecksum -Path $artifact.FullName -Lines $checksumLines }
    Set-Content -LiteralPath (Join-Path $releaseRoot "SHA256SUMS.txt") -Value $checksumLines -Encoding UTF8
    $inventory = @("SHA256`tBytes`tPath") + @($releaseArtifacts | ForEach-Object {
        $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        "{0}`t{1}`t{2}" -f $hash, $_.Length, $_.Name
    })
    Set-Content -LiteralPath (Join-Path $releaseRoot "UEFN Transaction Manager.contents.tsv") -Value $inventory -Encoding UTF8
    Write-Host "`nNSIS installer created: $(Join-Path $releaseRoot $installerFileName)" -ForegroundColor Green
    Write-Host "Portable secondary artifact created: $(Join-Path $releaseRoot $portableFileName)"
    Write-Host "Update metadata: $(Join-Path $releaseRoot 'latest.yml')"
    Write-Host "SHA-256: $versionedInstallerHash"
}
finally {
    Pop-Location
    if (Test-Path -LiteralPath $stagingRoot) { Remove-Item -LiteralPath $stagingRoot -Recurse -Force }
}

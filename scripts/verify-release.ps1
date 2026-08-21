param(
    [string]$ArchivePath,
    [string]$InstallerPath,
    [switch]$KeepTestFiles
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http
$toolRoot = Split-Path -Parent $PSScriptRoot
$expectedVersion = (Get-Content -LiteralPath (Join-Path $toolRoot "version.json") -Raw | ConvertFrom-Json).version
if (-not $ArchivePath) { $ArchivePath = "release\UEFN-Entitlement-Manager-$expectedVersion-Portable.zip" }
if (-not $InstallerPath) { $InstallerPath = "release\UEFN-Entitlement-Manager-Setup-$expectedVersion.exe" }
$installer = (Resolve-Path -LiteralPath (Join-Path $toolRoot $InstallerPath)).Path
$archive = (Resolve-Path -LiteralPath (Join-Path $toolRoot $ArchivePath)).Path
$releaseRoot = Split-Path -Parent $installer
$expectedInstallerName = "UEFN-Entitlement-Manager-Setup-$expectedVersion.exe"
$expectedPortableName = "UEFN-Entitlement-Manager-$expectedVersion-Portable.zip"
$humanInstallerPath = Join-Path $releaseRoot "UEFN-Entitlement-Manager-Setup.exe"
$humanPortablePath = Join-Path $releaseRoot "UEFN-Entitlement-Manager-Portable.zip"
$metadataPath = Join-Path $releaseRoot "latest.yml"
$blockmapPath = Join-Path $releaseRoot "$expectedInstallerName.blockmap"
$checksumPath = Join-Path $releaseRoot "SHA256SUMS.txt"
$extractRoot = Join-Path ([IO.Path]::GetTempPath()) ("uem-electron-release-test-" + [guid]::NewGuid().ToString("N"))
$bridgeProcess = $null
$oldEnvironment = @{}

function Get-PeMachine {
    param([Parameter(Mandatory = $true)] [string]$Path)
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
        $reader = [IO.BinaryReader]::new($stream)
        if ($reader.ReadUInt16() -ne 0x5A4D) { throw "Invalid DOS header: $Path" }
        $stream.Position = 0x3C
        $peOffset = $reader.ReadInt32()
        if ($peOffset -lt 0 -or $peOffset + 6 -gt $stream.Length) { throw "Invalid PE offset: $Path" }
        $stream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x00004550) { throw "Invalid PE signature: $Path" }
        return $reader.ReadUInt16()
    }
    finally { $stream.Dispose() }
}

if ((Split-Path -Leaf $installer) -ne $expectedInstallerName) { throw "The installer name does not match the canonical identity/version: $installer" }
if ((Split-Path -Leaf $archive) -ne $expectedPortableName) { throw "The portable archive name does not match the canonical identity/version: $archive" }
$installerMachine = Get-PeMachine -Path $installer
if ($installerMachine -notin @(0x14C, 0x8664)) { throw "The NSIS installer has an unsupported PE architecture: 0x$('{0:X4}' -f $installerMachine)." }
foreach ($metadataFile in @($metadataPath, $blockmapPath, $checksumPath)) { if (-not (Test-Path -LiteralPath $metadataFile -PathType Leaf)) { throw "Required release metadata is missing: $metadataFile" } }
$metadataText = Get-Content -LiteralPath $metadataPath -Raw
if ($metadataText -notmatch [regex]::Escape($expectedInstallerName) -or $metadataText -notmatch "version: $([regex]::Escape($expectedVersion))") { throw "latest.yml does not match the installer name and version." }
$checksumText = Get-Content -LiteralPath $checksumPath -Raw
$installerHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
if ($checksumText -notmatch [regex]::Escape("$installerHash  $expectedInstallerName")) { throw "SHA256SUMS.txt does not match the installer." }
foreach ($alias in @($humanInstallerPath, $humanPortablePath)) { if (-not (Test-Path -LiteralPath $alias -PathType Leaf)) { throw "Required human download alias is missing: $alias" } }
if ((Get-FileHash -LiteralPath $humanInstallerPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $installerHash) { throw "Human installer alias is not byte-identical to the versioned installer." }
$portableHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ((Get-FileHash -LiteralPath $humanPortablePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $portableHash) { throw "Human portable alias is not byte-identical to the versioned portable archive." }
Write-Host "Verified byte-identical human installer and portable aliases."
Write-Host ("Verified installer bootstrap PE architecture 0x{0:X4}, latest.yml, blockmap, and installer SHA-256 metadata." -f $installerMachine)

New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
try {
    Expand-Archive -LiteralPath $archive -DestinationPath $extractRoot -Force
    $packageRoot = Join-Path $extractRoot "UEFN Entitlement Manager"
    $appVersion = (Get-Content -LiteralPath (Join-Path $packageRoot "resources\app\version.json") -Raw | ConvertFrom-Json).version
    if ($appVersion -ne $expectedVersion) { throw "The portable package version $appVersion does not match $expectedVersion." }
    $updaterConfig = Join-Path $packageRoot "resources\app-update.yml"
    if (-not (Test-Path -LiteralPath $updaterConfig -PathType Leaf)) { throw "The packaged release is missing electron-updater configuration: $updaterConfig" }
    $updaterText = Get-Content -LiteralPath $updaterConfig -Raw
    if ($updaterText -notmatch '(?m)^provider:\s*generic\s*$') { throw "Packaged electron-updater configuration is not generic." }
    if ($updaterText -notmatch '(?m)^url:\s*https://updates\.adeptinteractive\.net/uem/stable/\s*$') { throw "Packaged electron-updater URL is not the ADEPT stable endpoint." }
    if ($updaterText -match '(?i)github|owner:|repo:') { throw "Packaged electron-updater configuration still contains GitHub provider settings." }
    Write-Host "Verified packaged electron-updater configuration: generic ADEPT stable endpoint." -ForegroundColor Green
    $desktopFileName = "UEFN Entitlement Manager.exe"
    $desktop = Join-Path $packageRoot $desktopFileName
    $appRoot = Join-Path $packageRoot "resources\app"
    $server = Join-Path $appRoot "dist\server.cjs"
    $required = @(
        $desktop,
        (Join-Path $appRoot "dist\index.html"),
        $server,
        (Join-Path $appRoot "dist-electron\main.cjs"),
        (Join-Path $appRoot "dist-electron\preload.cjs"),
        (Join-Path $appRoot "electron\launcher.html"),
        (Join-Path $appRoot "electron\launcher.js"),
        (Join-Path $appRoot "electron\assets\uem-icon.ico"),
        (Join-Path $appRoot "entitlement_manager.py"),
        (Join-Path $appRoot "uefn_auto_connector.py"),
        (Join-Path $appRoot "node_modules\sharp"),
        (Join-Path $appRoot "node_modules\@img\sharp-win32-x64"),
        (Join-Path $appRoot "node_modules\koffi"),
        (Join-Path $appRoot "node_modules\@koromix\koffi-win32-x64"),
        (Join-Path $appRoot "LICENSE"),
        (Join-Path $packageRoot "LICENSE.electron.txt"),
        (Join-Path $packageRoot "LICENSES.chromium.html"),
        (Join-Path $appRoot "THIRD_PARTY_NOTICES.txt")
    )
    $missing = @($required | Where-Object { -not (Test-Path -LiteralPath $_) })
    if ($missing) { throw "The extracted Electron release is incomplete: $($missing -join ', ')" }

    $forbiddenNames = @("WebView2Loader.dll", "msedgewebview2.exe", "hostfxr.dll", "hostpolicy.dll", "coreclr.dll", "node.exe")
    $forbidden = @(Get-ChildItem -LiteralPath $packageRoot -Recurse -File | Where-Object {
        $forbiddenNames -contains $_.Name -or $_.Name -like "*.runtimeconfig.json" -or $_.FullName -match "[\\/]WebView2Runtime[\\/]" -or $_.FullName -match "[\\/]\.runtime[\\/]"
    })
    if ($forbidden) { throw "The Electron release contains obsolete WebView2, .NET, or standalone Node runtime files: $($forbidden.FullName -join ', ')" }

    $runtimeModuleRoot = Join-Path $appRoot "node_modules"
    $expectedModules = @("@img", "@koromix", "detect-libc", "koffi", "semver", "sharp")
    $unexpectedModules = @(Get-ChildItem -LiteralPath $runtimeModuleRoot -Force | Where-Object { $expectedModules -notcontains $_.Name })
    $unexpectedImgModules = @(Get-ChildItem -LiteralPath (Join-Path $runtimeModuleRoot "@img") -Force | Where-Object { $_.Name -notin @("colour", "sharp-win32-x64") })
    $unexpectedKoromixModules = @(Get-ChildItem -LiteralPath (Join-Path $runtimeModuleRoot "@koromix") -Force | Where-Object { $_.Name -ne "koffi-win32-x64" })
    if ($unexpectedModules -or $unexpectedImgModules -or $unexpectedKoromixModules) {
        throw "The release contains non-required runtime modules: $(@($unexpectedModules.Name) + @($unexpectedImgModules.Name) + @($unexpectedKoromixModules.Name) -join ', ')"
    }
    $sourceCruft = @(Get-ChildItem -LiteralPath $appRoot -Recurse -File | Where-Object {
        $_.Extension -in @(".ts", ".tsx", ".map", ".mjs", ".cc", ".cpp", ".h", ".hh", ".asm", ".lib") -or
        ($_.Extension -eq ".md" -and $_.Name -notmatch "^LICENSE") -or
        $_.FullName -match "[\\/](doc|docs|test|tests|vendor|install)[\\/]"
    })
    if ($sourceCruft) { throw "The release contains non-runtime source, documentation, test, or build files: $($sourceCruft.FullName -join ', ')" }
    $localeFiles = @(Get-ChildItem -LiteralPath (Join-Path $packageRoot "locales") -File)
    if ($localeFiles.Count -ne 1 -or $localeFiles[0].Name -ne "en-US.pak") { throw "The release contains non-required Electron locale packs." }

    $nativeFiles = @(Get-ChildItem -LiteralPath $packageRoot -Recurse -File | Where-Object { $_.Extension -in @('.exe', '.dll', '.node') })
    $wrongArchitecture = @()
    foreach ($file in $nativeFiles) {
        $machine = Get-PeMachine -Path $file.FullName
        $isElectronElevationHelper = $file.Name -eq "elevate.exe" -and $file.Directory.Name -eq "resources"
        if ($machine -ne 0x8664 -and -not ($isElectronElevationHelper -and $machine -eq 0x14C)) {
            $wrongArchitecture += ("{0}=0x{1:X4}" -f $file.FullName, $machine)
        }
    }
    if ($wrongArchitecture) { throw "The Windows x64 release contains incompatible native architectures: $($wrongArchitecture -join ', ')" }
    Write-Host "Verified $($nativeFiles.Count) x64 PE executables, libraries, and native modules."

    foreach ($name in @("PORT", "UEM_SESSION_TOKEN", "UEM_EDITOR_TOKEN", "UEM_CONTENT_ROOT", "UEM_ASSET_MOUNT", "UEM_IDLE_TIMEOUT_MS", "ELECTRON_RUN_AS_NODE")) {
        $oldEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
    }
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
    $listener.Stop()
    $bridgeRoot = Join-Path $extractRoot "bridge-content"
    New-Item -ItemType Directory -Path $bridgeRoot -Force | Out-Null
    $env:PORT = [string]$port
    $env:UEM_SESSION_TOKEN = "release-test-ui-token-0123456789-0123456789"
    $env:UEM_EDITOR_TOKEN = "release-test-editor-token-0123456789-0123456789"
    $env:UEM_CONTENT_ROOT = $bridgeRoot
    $env:UEM_ASSET_MOUNT = "/ReleaseTest"
    $env:UEM_IDLE_TIMEOUT_MS = "120000"
    $env:ELECTRON_RUN_AS_NODE = "1"
    $stdout = Join-Path $extractRoot "bridge.stdout.log"
    $stderr = Join-Path $extractRoot "bridge.stderr.log"
    $bridgeProcess = Start-Process -FilePath $desktop -ArgumentList @(('"' + $server + '"')) -WorkingDirectory $appRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr

    $healthy = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 250
        $bridgeProcess.Refresh()
        if ($bridgeProcess.HasExited) { break }
        try {
            $response = Invoke-WebRequest -Uri ("http://127.0.0.1:$port/api/health") -UseBasicParsing -TimeoutSec 1
            if ($response.StatusCode -eq 200 -and $response.Content -match "UEFN Entitlement Manager Bridge") { $healthy = $true; break }
        }
        catch {}
    }
    if (-not $healthy) {
        throw "The Electron-owned bridge did not become healthy.`nSTDOUT:`n$(Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue)`nSTDERR:`n$(Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue)"
    }
    if ($bridgeProcess.MainWindowHandle -ne [IntPtr]::Zero) { throw "The Electron-owned bridge opened an unexpected console window." }
    $baseUri = "http://127.0.0.1:$port"
    $headers = @{ "X-UEM-Token" = $env:UEM_SESSION_TOKEN }
    $frontend = Invoke-WebRequest -Uri "$baseUri/" -UseBasicParsing -TimeoutSec 3
    if ($frontend.StatusCode -ne 200 -or $frontend.Content -notmatch '<div id="root">') { throw "The extracted release did not serve its production frontend." }
    try {
        Invoke-WebRequest -Uri "$baseUri/api/session/heartbeat" -Method Post -ContentType "application/json" -Body "{}" -UseBasicParsing -TimeoutSec 3 | Out-Null
        throw "The release accepted an unauthenticated API request."
    }
    catch { if ($_.Exception.Response.StatusCode.value__ -ne 401) { throw } }
    $heartbeat = Invoke-RestMethod -Uri "$baseUri/api/session/heartbeat" -Method Post -Headers $headers -ContentType "application/json" -Body "{}" -TimeoutSec 3
    if (-not $heartbeat.success) { throw "The authenticated release heartbeat failed." }

    $editorHeaders = @{ "X-UEM-Editor-Token" = $env:UEM_EDITOR_TOKEN }
    $editorSessionBody = @{ contentRoot = $bridgeRoot; assetMount = "/ReleaseTest"; processId = $PID } | ConvertTo-Json
    $editorSession = Invoke-RestMethod -Uri "$baseUri/api/editor/session" -Method Post -Headers $editorHeaders -ContentType "application/json" -Body $editorSessionBody -TimeoutSec 3
    if (-not $editorSession.success) { throw "The packaged release could not establish its verified editor test session." }

    $generatePngScript = @'
const importedSharp = require(process.argv[2]);
const sharp = importedSharp.default ?? importedSharp;
sharp({ create: { width: Number(process.argv[4]), height: Number(process.argv[5]), channels: 4, background: { r: 24, g: 180, b: 220, alpha: 1 } } })
  .png().toFile(process.argv[3]).catch(error => { console.error(error); process.exitCode = 1; });
'@
    $inspectPngScript = @'
const importedSharp = require(process.argv[2]);
const sharp = importedSharp.default ?? importedSharp;
sharp(process.argv[3]).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => {
  let minX = info.width, maxX = -1, minY = info.height, maxY = -1;
  for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
    if (data[(y * info.width + x) * info.channels + 3] > 0) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  process.stdout.write(JSON.stringify({ width: info.width, height: info.height, minX, maxX, minY, maxY }));
}).catch(error => { console.error(error); process.exitCode = 1; });
'@
    $sharpRoot = Join-Path $appRoot "node_modules\sharp"
    $generatePngPath = Join-Path $bridgeRoot "generate-packaged-png.cjs"
    $inspectPngPath = Join-Path $bridgeRoot "inspect-packaged-png.cjs"
    [IO.File]::WriteAllText($generatePngPath, $generatePngScript, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($inspectPngPath, $inspectPngScript, [Text.UTF8Encoding]::new($false))
    function Invoke-PackagedNode {
        param([string]$ScriptPath, [string[]]$Arguments)
        $stdoutPath = Join-Path $bridgeRoot ("packaged-node-" + [guid]::NewGuid().ToString("N") + ".stdout.log")
        $stderrPath = Join-Path $bridgeRoot ("packaged-node-" + [guid]::NewGuid().ToString("N") + ".stderr.log")
        $quotedArguments = @('"' + $ScriptPath.Replace('"', '\"') + '"') + @($Arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' })
        $nodeProcess = Start-Process -FilePath $desktop -ArgumentList $quotedArguments -WorkingDirectory $appRoot -PassThru -Wait -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
        $stdoutText = Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue
        $stderrText = Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue
        if ($nodeProcess.ExitCode -ne 0) { throw "Packaged Electron Node execution failed with exit $($nodeProcess.ExitCode): $stderrText" }
        return $stdoutText
    }
    function New-PackagedTestPng {
        param([string]$Path, [int]$Width, [int]$Height)
        Invoke-PackagedNode -ScriptPath $generatePngPath -Arguments @($sharpRoot, $Path, [string]$Width, [string]$Height) | Out-Null
        if (-not (Test-Path -LiteralPath $Path)) { throw "The packaged sharp runtime could not create a PNG test fixture." }
    }
    function Send-TextureImport {
        param([string]$Path, [string]$AssetName)
        Invoke-RestMethod -Uri "$baseUri/api/editor/session" -Method Post -Headers $editorHeaders -ContentType "application/json" -Body $editorSessionBody -TimeoutSec 3 | Out-Null
        $client = [Net.Http.HttpClient]::new()
        $multipart = [Net.Http.MultipartFormDataContent]::new()
        try {
            $client.DefaultRequestHeaders.Add("X-UEM-Token", $env:UEM_SESSION_TOKEN)
            $multipart.Add([Net.Http.StringContent]::new("EntitlementIcons"), "assetFolderName")
            $multipart.Add([Net.Http.StringContent]::new($AssetName), "assetName")
            $imageContent = [Net.Http.ByteArrayContent]::new([IO.File]::ReadAllBytes($Path))
            $imageContent.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::new("image/png")
            $multipart.Add($imageContent, "image", [IO.Path]::GetFileName($Path))
            $response = $client.PostAsync("$baseUri/api/texture/import", $multipart).GetAwaiter().GetResult()
            $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
            if (-not $response.IsSuccessStatusCode -or -not $body.success) { throw "Packaged texture import queue failed: $($body.error)" }
            return $body
        }
        finally { $multipart.Dispose(); $client.Dispose() }
    }
    function Complete-TextureImport {
        param([string]$JobId, [string]$AssetName)
        $body = @{ success = $true; destinationPath = "/ReleaseTest/EntitlementIcons"; assetObjectPath = "/ReleaseTest/EntitlementIcons/$AssetName.$AssetName" } | ConvertTo-Json
        $completed = Invoke-RestMethod -Uri "$baseUri/api/texture/import/$JobId/result" -Method Post -Headers $editorHeaders -ContentType "application/json" -Body $body -TimeoutSec 3
        if ($completed.status -ne "completed") { throw "The packaged texture import could not be completed." }
    }

    $powerOfTwoSource = Join-Path $bridgeRoot "power-of-two-source.png"
    New-PackagedTestPng -Path $powerOfTwoSource -Width 256 -Height 512
    $powerOfTwoJob = Send-TextureImport -Path $powerOfTwoSource -AssetName "PowerOfTwoTest"
    $powerOfTwoClaim = Invoke-RestMethod -Uri "$baseUri/api/texture/import/next" -Headers $editorHeaders -TimeoutSec 3
    if ($powerOfTwoClaim.job.jobId -ne $powerOfTwoJob.jobId) { throw "The packaged release claimed the wrong power-of-two texture job." }
    if ((Get-FileHash -LiteralPath $powerOfTwoSource -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $powerOfTwoClaim.job.sourcePath -Algorithm SHA256).Hash) {
        throw "The packaged release modified a PNG whose dimensions were already powers of two."
    }
    Complete-TextureImport -JobId $powerOfTwoJob.jobId -AssetName "PowerOfTwoTest"

    $nonPowerOfTwoSource = Join-Path $bridgeRoot "non-power-of-two-source.png"
    New-PackagedTestPng -Path $nonPowerOfTwoSource -Width 300 -Height 500
    $nonPowerOfTwoJob = Send-TextureImport -Path $nonPowerOfTwoSource -AssetName "NonPowerOfTwoTest"
    $nonPowerOfTwoClaim = Invoke-RestMethod -Uri "$baseUri/api/texture/import/next" -Headers $editorHeaders -TimeoutSec 3
    if ($nonPowerOfTwoClaim.job.jobId -ne $nonPowerOfTwoJob.jobId) { throw "The packaged release claimed the wrong normalized texture job." }
    $inspectionText = (Invoke-PackagedNode -ScriptPath $inspectPngPath -Arguments @($sharpRoot, $nonPowerOfTwoClaim.job.sourcePath)).Trim()
    $inspection = $inspectionText | ConvertFrom-Json
    if ($inspection.width -ne 256 -or $inspection.height -ne 512 -or $inspection.minX -ne 0 -or $inspection.maxX -ne 255 -or $inspection.minY -ne 42 -or $inspection.maxY -ne 468) {
        throw "The packaged 300x500 texture was not proportionally normalized to the expected 256x512 bounds: $inspectionText"
    }
    Complete-TextureImport -JobId $nonPowerOfTwoJob.jobId -AssetName "NonPowerOfTwoTest"
    Write-Host "Verified packaged power-of-two byte preservation and minimal-padding proportional normalization."

    $saveBody = @{ fileName = "release_smoke.verse"; content = "# release smoke test"; createBackup = $true; expectedHash = $null } | ConvertTo-Json
    $saved = Invoke-RestMethod -Uri "$baseUri/api/verse/save" -Method Post -Headers $headers -ContentType "application/json" -Body $saveBody -TimeoutSec 3
    if (-not $saved.success -or $saved.contentHash -notmatch '^[a-f0-9]{64}$') { throw "The release could not save a revision-tracked Verse file." }
    $loaded = Invoke-RestMethod -Uri "$baseUri/api/verse/load" -Method Post -Headers $headers -ContentType "application/json" -Body '{"fileName":"release_smoke.verse"}' -TimeoutSec 3
    if ($loaded.content -ne "# release smoke test" -or $loaded.contentHash -ne $saved.contentHash) { throw "The release did not load its saved Verse revision losslessly." }
    Invoke-RestMethod -Uri "$baseUri/api/session/shutdown" -Method Post -Headers $headers -ContentType "application/json" -Body "{}" -TimeoutSec 3 | Out-Null
    if (-not $bridgeProcess.WaitForExit(5000)) { throw "The Electron-owned bridge did not exit after authenticated shutdown." }
    $bridgeProcess = $null
    [Environment]::SetEnvironmentVariable("ELECTRON_RUN_AS_NODE", $oldEnvironment["ELECTRON_RUN_AS_NODE"], "Process")

    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "verify-electron-lifecycle.ps1") -ApplicationPath $desktop -PackageRoot $packageRoot -Packaged
    if ($LASTEXITCODE -ne 0) { throw "The extracted Electron lifecycle failed with exit code $LASTEXITCODE." }
    Write-Host "Extracted ZIP contents, x64 architecture, image normalization, frontend, authentication, file IO, visible lifecycle, switching, and shutdown checks passed." -ForegroundColor Green
}
finally {
    if ($bridgeProcess -and -not $bridgeProcess.HasExited) { Stop-Process -Id $bridgeProcess.Id -Force }
    foreach ($name in $oldEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $oldEnvironment[$name], "Process") }
    if (-not $KeepTestFiles -and (Test-Path -LiteralPath $extractRoot)) {
        Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    elseif ($KeepTestFiles) { Write-Host "Kept extracted test files at $extractRoot" -ForegroundColor Yellow }
}

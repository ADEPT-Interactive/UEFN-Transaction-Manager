param(
    [switch]$ForceBuild,
    [switch]$PreferPortableRuntime
)

$ErrorActionPreference = "Stop"

$toolRoot = Split-Path -Parent $PSScriptRoot
$appVersion = (Get-Content -LiteralPath (Join-Path $toolRoot "version.json") -Raw | ConvertFrom-Json).version
$desktopFileName = "UEFNEntitlementManager-$appVersion.exe"
$runtimeRoot = Join-Path $toolRoot ".runtime"
$runtimePattern = Join-Path $runtimeRoot "node-*\node.exe"
$desktopProject = Join-Path $toolRoot "desktop\UEFNEntitlementManager.Desktop.csproj"
$desktopPublishRoot = Join-Path $toolRoot "desktop\bin\Release\net48\publish"
$desktopExecutable = Join-Path $desktopPublishRoot $desktopFileName

function Invoke-NativeChecked {
    param(
        [Parameter(Mandatory = $true)] [string]$FilePath,
        [Parameter(Mandatory = $true)] [string[]]$ArgumentList,
        [Parameter(Mandatory = $true)] [string]$Description
    )

    Write-Host "`n> $Description" -ForegroundColor Cyan
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE."
    }
}

function Get-NodeMajorVersion {
    param([Parameter(Mandatory = $true)] [string]$NodePath)

    $versionText = (& $NodePath --version 2>$null | Select-Object -First 1).Trim()
    if ($versionText -notmatch '^v(?<major>\d+)') {
        return $null
    }
    return [int]$Matches.major
}

function Save-VerifiedDownload {
    param(
        [Parameter(Mandatory = $true)] [string]$Uri,
        [Parameter(Mandatory = $true)] [string]$Destination
    )

    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
        # Some Windows installations cannot reach the certificate revocation
        # service even though normal TLS validation succeeds. The archive is
        # still certificate-validated and must pass the independent SHA-256
        # check below before it is ever extracted.
        & $curl.Source --fail --location --http1.1 --ssl-no-revoke --retry 5 --retry-all-errors --retry-delay 2 --silent --show-error --output $Destination $Uri
        if ($LASTEXITCODE -ne 0) {
            throw "Download failed: $Uri"
        }
        return
    }

    Invoke-WebRequest -Uri $Uri -OutFile $Destination -UseBasicParsing
}

function Find-SupportedNode {
    $candidates = @()
    if (Test-Path -LiteralPath $runtimeRoot) {
        $candidates += Get-ChildItem -LiteralPath $runtimeRoot -Directory -Filter "node-*" -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName "node.exe" }
    }
    $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($systemNode) {
        $candidates += $systemNode.Source
    }

    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if ((Test-Path -LiteralPath $candidate) -and (Get-NodeMajorVersion $candidate) -ge 20) {
            return $candidate
        }
    }
    return $null
}

function Install-PortableNode {
    if (-not [Environment]::Is64BitOperatingSystem) {
        throw "This setup helper currently supports 64-bit Windows only. Install Node.js 20+ manually on 32-bit Windows."
    }

    Write-Host "No supported Node.js runtime was found. Downloading the current official LTS runtime..." -ForegroundColor Yellow
    $releases = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json" -UseBasicParsing
    $release = $releases |
        Where-Object { $_.lts -and ([int](($_.version -replace '^v', '').Split('.')[0]) -ge 20) } |
        Select-Object -First 1
    if (-not $release) {
        throw "Could not find a supported Node.js LTS release from nodejs.org."
    }

    $version = $release.version
    $archiveName = "node-$version-win-x64.zip"
    $downloadRoot = Join-Path ([IO.Path]::GetTempPath()) ("uefn-entitlement-manager-" + [guid]::NewGuid().ToString("N"))
    $archivePath = Join-Path $downloadRoot $archiveName
    $extractRoot = Join-Path $downloadRoot "extracted"
    $installRoot = Join-Path $runtimeRoot ($version -replace '^v', 'node-')

    New-Item -ItemType Directory -Path $downloadRoot -Force | Out-Null
    try {
        Save-VerifiedDownload -Uri "https://nodejs.org/dist/$version/$archiveName" -Destination $archivePath
        $checksumPath = Join-Path $downloadRoot "SHASUMS256.txt"
        Save-VerifiedDownload -Uri "https://nodejs.org/dist/$version/SHASUMS256.txt" -Destination $checksumPath
        $checksums = Get-Content -LiteralPath $checksumPath -Raw
        $checksumLine = $checksums -split "`r?`n" | Where-Object { $_.Trim().EndsWith($archiveName) } | Select-Object -First 1
        if (-not $checksumLine) {
            throw "The Node.js checksum list did not contain $archiveName."
        }
        $expectedHash = ($checksumLine -split '\s+')[0].ToLowerInvariant()
        $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualHash -ne $expectedHash) {
            throw "Node.js archive checksum verification failed."
        }

        Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force
        $extractedNode = Join-Path $extractRoot ($archiveName -replace '\.zip$', '')
        $extractedNodeExe = Join-Path $extractedNode "node.exe"
        if (-not (Test-Path -LiteralPath $extractedNodeExe)) {
            throw "The downloaded Node.js archive did not contain node.exe."
        }
        New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
        if (-not (Test-Path -LiteralPath $installRoot)) {
            Move-Item -LiteralPath $extractedNode -Destination $installRoot
        }
    }
    finally {
        if (Test-Path -LiteralPath $downloadRoot) {
            Remove-Item -LiteralPath $downloadRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    return (Join-Path $installRoot "node.exe")
}

if ($PreferPortableRuntime) {
    $nodePath = $null
    if (Test-Path -LiteralPath $runtimeRoot) {
        $nodePath = Get-ChildItem -LiteralPath $runtimeRoot -Directory -Filter "node-*" -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName "node.exe" } |
            Where-Object { (Test-Path -LiteralPath $_) -and ((Get-NodeMajorVersion $_) -ge 20) } |
            Select-Object -First 1
    }
}
else {
    $nodePath = Find-SupportedNode
}
if (-not $nodePath) {
    $nodePath = Install-PortableNode
}
$nodeMajor = Get-NodeMajorVersion $nodePath
Write-Host "Using Node.js $nodeMajor from $nodePath" -ForegroundColor Green

$nodeDirectory = Split-Path -Parent $nodePath
# npm.cmd and npm-run scripts resolve node through PATH. Prepend the selected
# runtime so a private install remains self-contained and never mixes with a
# different system-wide Node.js installation.
$env:Path = "$nodeDirectory;$env:Path"
$npmPath = Join-Path $nodeDirectory "npm.cmd"
if (-not (Test-Path -LiteralPath $npmPath)) {
    throw "The selected Node.js runtime does not include npm.cmd."
}

Push-Location $toolRoot
try {
    Invoke-NativeChecked -FilePath $npmPath -ArgumentList @("ci", "--no-audit", "--no-fund") -Description "Installing locked JavaScript dependencies"
    $serverBundle = Join-Path $toolRoot "dist\server.cjs"
    $frontendEntry = Join-Path $toolRoot "dist\index.html"
    if ($ForceBuild -or -not (Test-Path -LiteralPath $serverBundle) -or -not (Test-Path -LiteralPath $frontendEntry)) {
        Invoke-NativeChecked -FilePath $npmPath -ArgumentList @("run", "build") -Description "Building the manager frontend and bridge"
    }
    else {
        Write-Host "Existing dist build found; use setup.bat /ForceBuild to rebuild it." -ForegroundColor DarkGray
    }

    $dotnet = Get-Command dotnet.exe -ErrorAction SilentlyContinue
    if (-not $dotnet) {
        throw "The standalone desktop shell requires the .NET SDK. Install the .NET SDK, then run scripts\setup.bat again."
    }
    if (-not (Test-Path -LiteralPath $desktopProject)) {
        throw "The standalone desktop shell project is missing: $desktopProject"
    }
    if ($ForceBuild -or -not (Test-Path -LiteralPath $desktopExecutable)) {
        $python = Get-Command python.exe -ErrorAction Stop
        Invoke-NativeChecked -FilePath $python.Source -ArgumentList @((Join-Path $PSScriptRoot "create-icon.py")) -Description "Creating the UEM application icon"
        if (Test-Path -LiteralPath $desktopPublishRoot) {
            Get-ChildItem -LiteralPath $desktopPublishRoot -File -Filter "UEFNEntitlementManager*.exe*" | Remove-Item -Force
        }
        Invoke-NativeChecked -FilePath $dotnet.Source -ArgumentList @(
            "publish",
            $desktopProject,
            "--configuration", "Release",
            "-p:DebugType=None",
            "-p:DebugSymbols=false",
            "--output", $desktopPublishRoot
        ) -Description "Building the standalone desktop manager shell"
    }
    else {
        Write-Host "Existing desktop shell found; use setup.bat /ForceBuild to rebuild it." -ForegroundColor DarkGray
    }
}
finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath (Join-Path $toolRoot "dist\server.cjs")) -or -not (Test-Path -LiteralPath (Join-Path $toolRoot "dist\index.html"))) {
    throw "Setup finished without producing both the bridge bundle and frontend entrypoint."
}
if (-not (Test-Path -LiteralPath $desktopExecutable)) {
    throw "Setup finished without producing the standalone desktop manager shell."
}

Write-Host "`nSetup complete. Open the published $desktopFileName and link a project from its boot menu." -ForegroundColor Green
Write-Host "For native Texture2D imports, UEM installs its project connector automatically; UEFN Python Editor Scripting must be enabled." -ForegroundColor DarkGray

# Shared by setup/build. Every downloaded artifact is pinned before extraction or execution.
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Assert-CrewWindowsX64 {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or -not [Environment]::Is64BitOperatingSystem) {
        throw 'This package supports 64-bit Windows 10/11 only.'
    }
    $crewArchitecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    if ($crewArchitecture -ne 'AMD64') { throw 'This source bootstrap currently supports Windows x64 only.' }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
}

function Assert-CrewHash([string]$Path, [string]$Sha256) {
    if ($Sha256 -notmatch '^[a-fA-F0-9]{64}$' -or -not (Test-Path -LiteralPath $Path -PathType Leaf) -or
        (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $Sha256) {
        throw "Checksum mismatch or missing dependency: $([IO.Path]::GetFileName($Path)). No unverified file will be used."
    }
}

function Get-CrewAsset([string]$Url, [string]$Sha256, [string]$CacheDirectory, [switch]$Offline) {
    $crewUri = [uri]$Url
    if ($crewUri.Scheme -ne 'https' -or $crewUri.UserInfo -or -not $crewUri.IsDefaultPort -or
        $crewUri.Host -notin @('nodejs.org','github.com','raw.githubusercontent.com','api.nuget.org','pkgs.tailscale.com')) {
        throw 'Dependency downloads must use a pinned official HTTPS source.'
    }
    $crewCache = [IO.Path]::GetFullPath($CacheDirectory)
    New-Item -ItemType Directory -Path $crewCache -Force | Out-Null
    $crewName = [IO.Path]::GetFileName($crewUri.AbsolutePath)
    if (-not $crewName) { throw 'Dependency download URL has no filename.' }
    $crewDestination = Join-Path $crewCache $crewName
    if (Test-Path -LiteralPath $crewDestination) {
        Assert-CrewHash $crewDestination $Sha256
        return $crewDestination
    }
    if ($Offline) { throw "Offline dependency is missing: $crewName. Run Setup.ps1 online once with this cache directory." }
    $crewTemporary = Join-Path $crewCache ($crewName + '.' + [guid]::NewGuid().ToString('N') + '.part')
    try {
        Write-Host "Downloading $crewName..."
        Invoke-WebRequest -Uri $Url -OutFile $crewTemporary -UseBasicParsing -TimeoutSec 300
        Assert-CrewHash $crewTemporary $Sha256
        Move-Item -LiteralPath $crewTemporary -Destination $crewDestination
    } finally {
        if (Test-Path -LiteralPath $crewTemporary) { Remove-Item -LiteralPath $crewTemporary -Force }
    }
    return $crewDestination
}

function Expand-CrewZip([string]$Archive, [string]$CacheDirectory) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $crewDestination = Join-Path ([IO.Path]::GetFullPath($CacheDirectory)) ('extract-' + [guid]::NewGuid().ToString('N'))
    [IO.Compression.ZipFile]::ExtractToDirectory($Archive, $crewDestination)
    return $crewDestination
}

function Remove-CrewExtraction([string]$Path, [string]$CacheDirectory) {
    # Only delete this script's disposable extraction directories, inside the explicitly selected cache.
    $crewCache = [IO.Path]::GetFullPath($CacheDirectory).TrimEnd('\') + '\'
    $crewResolved = [IO.Path]::GetFullPath($Path)
    if (-not $crewResolved.StartsWith($crewCache, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($crewResolved) -notmatch '^extract-[a-f0-9]{32}$') { throw 'Unsafe extraction cleanup path.' }
    if (Test-Path -LiteralPath $crewResolved) { Remove-Item -LiteralPath $crewResolved -Recurse -Force }
}

function Assert-CrewSignature([string]$Path, [string]$Publisher) {
    $crewSignature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($crewSignature.Status -ne 'Valid' -or -not $crewSignature.SignerCertificate -or
        $crewSignature.SignerCertificate.Subject -notmatch [regex]::Escape($Publisher)) {
        throw "The publisher signature could not be verified for $([IO.Path]::GetFileName($Path)). Check Windows certificate trust and try again."
    }
}

function Copy-CrewVerifiedFile([string]$Source, [string]$Destination, [string]$Sha256) {
    Assert-CrewHash $Source $Sha256
    if ((Test-Path -LiteralPath $Destination -PathType Leaf) -and (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash -eq $Sha256) { return }
    New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

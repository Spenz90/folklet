# Downloads local, pinned dependencies and builds Crew; no administrator access or system installation.
[CmdletBinding()]
param(
    [string]$CacheDirectory = (Join-Path $PSScriptRoot '.cache\crew-setup'),
    [switch]$Offline,
    [switch]$SkipDesktop,
    [switch]$IncludePhoneInstaller
)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'scripts\Install-Runtime.ps1') -CacheDirectory $CacheDirectory -Offline:$Offline -IncludePhoneInstaller:$IncludePhoneInstaller
& (Join-Path $PSScriptRoot 'native\Build-Windows.ps1')
if (-not $SkipDesktop) {
    & (Join-Path $PSScriptRoot 'desktop\Build.ps1') -CacheDirectory $CacheDirectory -Offline:$Offline
}
Write-Host 'Setup complete. Open Start Crew.cmd. Sign in to ChatGPT inside Crew.' -ForegroundColor Green

[CmdletBinding()]
param(
    [string]$CacheDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) '.cache\crew-setup'),
    [switch]$Offline,
    [switch]$IncludePhoneInstaller
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Dependencies.ps1')
Assert-CrewWindowsX64
$crewRoot = Split-Path -Parent $PSScriptRoot
$crewCache = [IO.Path]::GetFullPath($CacheDirectory)
$crewPins = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'dependencies.json') -Raw | ConvertFrom-Json
$crewProvenance = Get-Content -LiteralPath (Join-Path $crewRoot $crewPins.codex.provenance) -Raw | ConvertFrom-Json
if ($crewProvenance.version -ne $crewPins.codex.version) { throw 'Codex provenance and dependency versions differ.' }
$crewNodeZip = Get-CrewAsset $crewPins.node.url $crewPins.node.sha256 $crewCache -Offline:$Offline
$crewNodeExtract = Expand-CrewZip $crewNodeZip $crewCache
try {
    $crewNodeRoot = Join-Path $crewNodeExtract ('node-v' + $crewPins.node.version + '-win-x64')
    $crewNode = Join-Path $crewNodeRoot 'node.exe'
    Assert-CrewHash $crewNode $crewPins.node.executableSha256
    Assert-CrewSignature $crewNode $crewPins.node.publisher
    Copy-CrewVerifiedFile $crewNode (Join-Path $crewRoot 'runtime\node.exe') $crewPins.node.executableSha256
    Copy-Item -LiteralPath (Join-Path $crewNodeRoot 'LICENSE') -Destination (Join-Path $crewRoot 'runtime\LICENSE.txt') -Force
    $crewPackage = Get-Content -LiteralPath (Join-Path $crewRoot 'package.json') -Raw | ConvertFrom-Json
    if ($crewPackage.dependencies.playwright -ne $crewPins.playwright.version) { throw 'Playwright package and dependency versions differ.' }
    if (-not (Test-Path -LiteralPath (Join-Path $crewRoot 'package-lock.json'))) { throw 'The pinned package-lock.json is missing. Restore the complete source checkout.' }
    $crewOldPath = $env:PATH
    try {
        $env:PATH = $crewNodeRoot + [IO.Path]::PathSeparator + $crewOldPath
        $crewNpmArguments = @((Join-Path $crewNodeRoot 'node_modules\npm\bin\npm-cli.js'), 'ci', '--ignore-scripts', '--omit=optional', '--no-audit', '--fund=false', '--registry=https://registry.npmjs.org/', '--cache', (Join-Path $crewCache 'npm'), '--prefix', $crewRoot)
        if ($Offline) { $crewNpmArguments += '--offline' }
        & $crewNode @crewNpmArguments
        if ($LASTEXITCODE -ne 0) { throw 'Pinned browser library installation failed.' }
    } finally { $env:PATH = $crewOldPath }
} finally { Remove-CrewExtraction $crewNodeExtract $crewCache }

$crewEngineRoot = Join-Path $crewRoot 'runtime\codex'
foreach ($crewEngineFile in @($crewProvenance.files | Where-Object { $_.file -ne 'rg.exe' })) {
    $crewArchiveName = [IO.Path]::GetFileName(([uri]$crewEngineFile.sourceAssetUrl).AbsolutePath) + '.zip'
    $crewArchive = @($crewProvenance.releaseArchives | Where-Object { $_.name -eq $crewArchiveName })
    if ($crewArchive.Count -ne 1) { throw "Pinned archive not found for $($crewEngineFile.file)." }
    $crewZip = Get-CrewAsset $crewArchive[0].url $crewArchive[0].sha256 $crewCache -Offline:$Offline
    $crewExtract = Expand-CrewZip $crewZip $crewCache
    try {
        $crewSource = Join-Path $crewExtract ([IO.Path]::GetFileName(([uri]$crewEngineFile.sourceAssetUrl).AbsolutePath))
        Assert-CrewHash $crewSource $crewEngineFile.sha256
        Assert-CrewSignature $crewSource $crewPins.codex.publisher
        Copy-CrewVerifiedFile $crewSource (Join-Path $crewEngineRoot $crewEngineFile.file) $crewEngineFile.sha256
    } finally { Remove-CrewExtraction $crewExtract $crewCache }
}
foreach ($crewLicense in @($crewProvenance.licenseFiles | Where-Object { $_.file -in @('LICENSE','NOTICE') })) {
    $crewDestination = Join-Path $crewEngineRoot $crewLicense.file
    if (Test-Path -LiteralPath $crewDestination) { Assert-CrewHash $crewDestination $crewLicense.sha256 }
    else {
        $crewSource = Get-CrewAsset $crewLicense.sourceUrl $crewLicense.sha256 $crewCache -Offline:$Offline
        Copy-CrewVerifiedFile $crewSource $crewDestination $crewLicense.sha256
    }
}
$crewRipgrep = @($crewProvenance.files | Where-Object { $_.file -eq 'rg.exe' })[0]
$crewRipgrepZip = Get-CrewAsset $crewRipgrep.upstreamArchiveUrl $crewRipgrep.upstreamArchiveSha256 $crewCache -Offline:$Offline
$crewRipgrepExtract = Expand-CrewZip $crewRipgrepZip $crewCache
try {
    $crewRipgrepRoot = Join-Path $crewRipgrepExtract ('ripgrep-' + $crewRipgrep.version + '-x86_64-pc-windows-msvc')
    Copy-CrewVerifiedFile (Join-Path $crewRipgrepRoot 'rg.exe') (Join-Path $crewEngineRoot 'rg.exe') $crewRipgrep.sha256
    foreach ($crewLicense in @($crewProvenance.licenseFiles | Where-Object { $_.file -like 'RIPGREP-*' })) {
        Copy-CrewVerifiedFile (Join-Path $crewRipgrepRoot $crewLicense.file.Substring(8)) (Join-Path $crewEngineRoot $crewLicense.file) $crewLicense.sha256
    }
} finally { Remove-CrewExtraction $crewRipgrepExtract $crewCache }

if ($IncludePhoneInstaller) {
    $crewInstaller = Get-CrewAsset $crewPins.tailscale.url $crewPins.tailscale.sha256 $crewCache -Offline:$Offline
    Assert-CrewSignature $crewInstaller $crewPins.tailscale.publisher
    Copy-CrewVerifiedFile $crewInstaller (Join-Path $crewRoot 'mobile\Tailscale-Setup.exe') $crewPins.tailscale.sha256
}
Write-Host 'Pinned runtimes are ready. Browser tasks use the installed Microsoft Edge browser.'

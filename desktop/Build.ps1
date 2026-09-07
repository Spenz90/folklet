[CmdletBinding()]
param(
    [Alias('WorkRoot')][string]$CacheDirectory = (Join-Path $PSScriptRoot '..\.cache\crew-setup'),
    [string]$OutputDirectory = $PSScriptRoot,
    [switch]$Offline
)
$ErrorActionPreference = 'Stop'
$crewRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $crewRoot 'scripts\Dependencies.ps1')
Assert-CrewWindowsX64
$crewCache = [IO.Path]::GetFullPath($CacheDirectory)
$crewOutput = [IO.Path]::GetFullPath($OutputDirectory)
$crewPins = Get-Content -LiteralPath (Join-Path $crewRoot 'scripts\dependencies.json') -Raw | ConvertFrom-Json
$crewCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $crewCompiler)) { throw '.NET Framework 4.8 is required to build Folklet on Windows.' }
$crewPackage = Get-CrewAsset $crewPins.webview2.url $crewPins.webview2.sha256 $crewCache -Offline:$Offline
$crewSdk = Expand-CrewZip $crewPackage $crewCache
try {
    New-Item -ItemType Directory -Path $crewOutput -Force | Out-Null
    foreach ($crewLibrary in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll')) {
        Copy-Item -LiteralPath (Join-Path $crewSdk "lib\net462\$crewLibrary") -Destination (Join-Path $crewOutput $crewLibrary) -Force
    }
    Copy-Item -LiteralPath (Join-Path $crewSdk 'runtimes\win-x64\native\WebView2Loader.dll') -Destination (Join-Path $crewOutput 'WebView2Loader.dll') -Force
    $crewIcon = Join-Path $crewRoot 'icons\crew.ico'
    if (-not (Test-Path -LiteralPath $crewIcon)) { throw 'icons/crew.ico is missing. Restore the complete source checkout.' }
    $crewArguments = @(
        '/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/debug-',
        "/out:$crewOutput\Crew.exe", "/win32icon:$crewIcon", "/win32manifest:$PSScriptRoot\Crew.manifest",
        '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll',
        "/reference:$crewOutput\Microsoft.Web.WebView2.Core.dll", "/reference:$crewOutput\Microsoft.Web.WebView2.WinForms.dll",
        "$PSScriptRoot\Crew.cs"
    )
    & $crewCompiler @crewArguments
    if ($LASTEXITCODE -ne 0) { throw "Folklet compilation failed with code $LASTEXITCODE." }
    $crewConfiguration = Join-Path $PSScriptRoot 'Crew.exe.config'
    if ($crewOutput.TrimEnd('\') -ne $PSScriptRoot.TrimEnd('\')) {
        Copy-Item -LiteralPath $crewConfiguration -Destination (Join-Path $crewOutput 'Crew.exe.config') -Force
    }
    foreach ($crewNotice in @('LICENSE.txt','ThirdPartyNotices.txt','LICENSE')) {
        $crewNoticeSource = Join-Path $crewSdk $crewNotice
        if (Test-Path -LiteralPath $crewNoticeSource) { Copy-Item -LiteralPath $crewNoticeSource -Destination (Join-Path $crewOutput "WebView2-$crewNotice") -Force }
    }
} finally { Remove-CrewExtraction $crewSdk $crewCache }
Get-Item -LiteralPath (Join-Path $crewOutput 'Crew.exe') | Select-Object FullName,Length,@{Name='Version';Expression={$_.VersionInfo.FileVersion}}

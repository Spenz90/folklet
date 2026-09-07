param(
    [ValidateSet('Source','Windows')][string]$Kind = 'Source',
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\dist'),
    [string]$DesktopExecutable
)
$ErrorActionPreference = 'Stop'
$crewRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$crewOutput = [IO.Path]::GetFullPath($OutputDirectory)
if ($crewOutput -match '(?i)[\\/](data|profile|browser-profiles)([\\/]|$)') { throw 'Choose a release output directory outside private app data.' }
function Assert-CrewOutputPath([string]$Path) {
    $crewCheckPath = [IO.Path]::GetFullPath($Path)
    while ($crewCheckPath) {
        $crewItem = Get-Item -LiteralPath $crewCheckPath -Force -ErrorAction SilentlyContinue
        if ($crewItem -and ($crewItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Release output cannot contain a link.' }
        $crewCheckPath = [IO.Path]::GetDirectoryName($crewCheckPath)
    }
}
$crewZipPath = Join-Path $crewOutput "Crew-$Kind.zip"
$crewChecksumPath = $crewZipPath + '.sha256'
# Validate every existing ancestor and both final destinations before any write.
foreach ($crewTarget in @($crewOutput, $crewZipPath, $crewChecksumPath)) { Assert-CrewOutputPath $crewTarget }
if ($DesktopExecutable) {
    if ($Kind -ne 'Windows') { throw 'DesktopExecutable is only valid for the Windows archive.' }
    $DesktopExecutable = [IO.Path]::GetFullPath($DesktopExecutable)
    Assert-CrewOutputPath $DesktopExecutable
    if (-not (Test-Path -LiteralPath $DesktopExecutable -PathType Leaf)) { throw 'The staged desktop executable does not exist.' }
    $crewExecutableStream = [IO.File]::OpenRead($DesktopExecutable)
    try { if ($crewExecutableStream.Length -lt 1024 -or $crewExecutableStream.ReadByte() -ne 77 -or $crewExecutableStream.ReadByte() -ne 90) { throw 'The staged desktop file is not a Windows executable.' } }
    finally { $crewExecutableStream.Dispose() }
}
$crewNode = Join-Path $crewRoot 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $crewNode -PathType Leaf)) {
    $crewNodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (-not $crewNodeCommand) { throw 'Run Setup.ps1 or install Node.js 24 first.' }
    $crewNode = $crewNodeCommand.Source
}
$crewFileJson = & $crewNode (Join-Path $PSScriptRoot 'release-files.mjs') $crewRoot $Kind
if ($LASTEXITCODE -ne 0) { throw 'Release file validation failed. No archive was written.' }
# Windows PowerShell 5.1 emits a JSON array as one pipeline object. Assign the
# parsed array directly so each ZIP entry receives one string path.
$crewFiles = ConvertFrom-Json -InputObject ($crewFileJson -join [Environment]::NewLine)
New-Item -ItemType Directory -Path $crewOutput -Force | Out-Null
$crewTempPath = Join-Path $crewOutput ('.crew-package-' + [guid]::NewGuid().ToString('N') + '.tmp')
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$crewStream = [IO.File]::Open($crewTempPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
$crewZip = New-Object IO.Compression.ZipArchive($crewStream, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($crewRelative in $crewFiles) {
        $crewFile = Join-Path $crewRoot $crewRelative
        if ($DesktopExecutable -and $crewRelative -eq 'desktop/Crew.exe') { $crewFile = $DesktopExecutable }
        $crewEntry = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($crewZip, $crewFile, ('Crew/' + $crewRelative), [IO.Compression.CompressionLevel]::Optimal)
        if ($crewRelative.EndsWith('.sh')) { $crewEntry.ExternalAttributes = [int](493 -shl 16) }
    }
} finally { $crewZip.Dispose(); $crewStream.Dispose() }
$crewCheck = [IO.Compression.ZipFile]::OpenRead($crewTempPath)
try {
    $crewActual = @($crewCheck.Entries | ForEach-Object { $_.FullName })
    $crewExpected = @($crewFiles | ForEach-Object { 'Crew/' + $_ })
    if (@(Compare-Object $crewExpected $crewActual).Count -ne 0) { throw 'Archive file list did not match the approved release files.' }
} finally { $crewCheck.Dispose() }
Move-Item -LiteralPath $crewTempPath -Destination $crewZipPath -Force
$crewHasher = [Security.Cryptography.SHA256]::Create()
$crewHashStream = [IO.File]::OpenRead($crewZipPath)
try { $crewHash = [BitConverter]::ToString($crewHasher.ComputeHash($crewHashStream)).Replace('-', '').ToLowerInvariant() }
finally { $crewHashStream.Dispose(); $crewHasher.Dispose() }
[IO.File]::WriteAllText($crewChecksumPath, ($crewHash + '  ' + [IO.Path]::GetFileName($crewZipPath) + [Environment]::NewLine), [Text.Encoding]::ASCII)
Write-Host ("Verified {0} files. Created {1} and its SHA-256 checksum." -f $crewFiles.Count, $crewZipPath)

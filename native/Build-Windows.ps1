param()
$ErrorActionPreference = 'Stop'
$crewCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $crewCompiler -PathType Leaf)) { throw 'The Windows native helper needs the .NET Framework 4.x C# compiler.' }
$crewSource = Join-Path $PSScriptRoot 'windows-control.cs'
$crewOutput = Join-Path $PSScriptRoot 'windows-control.exe'
& $crewCompiler /nologo /target:exe /platform:x64 /optimize+ /debug- "/out:$crewOutput" /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll $crewSource
if ($LASTEXITCODE -ne 0) { throw 'The Windows native helper did not compile.' }
Write-Host 'Built optional Windows native helper. It has not been run.'

$ErrorActionPreference = 'Stop'
try {
    $crewDesktop = Join-Path $PSScriptRoot 'desktop\Crew.exe'
    if (-not (Test-Path -LiteralPath $crewDesktop -PathType Leaf)) {
        throw 'Crew has not been built. Open PowerShell in this folder and run: powershell -ExecutionPolicy Bypass -File .\Setup.ps1'
    }
    Start-Process -FilePath $crewDesktop -WorkingDirectory (Split-Path -Parent $crewDesktop)
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}

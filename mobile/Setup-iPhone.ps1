$ErrorActionPreference = 'Stop'
$crewRoot = Split-Path -Parent $PSScriptRoot
$crewAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $crewAdmin) {
    Start-Process powershell.exe -Verb RunAs -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $PSCommandPath + '"'))
    exit
}
try {
    Write-Host 'Connect Crew to your iPhone' -ForegroundColor Cyan
    Write-Host 'This creates a private Tailscale connection. Keep Crew and this PC running.'
    $crewPage = Invoke-WebRequest 'http://127.0.0.1:4318/' -UseBasicParsing -TimeoutSec 5
    $crewTokenMatch = [regex]::Match($crewPage.Content,"window\.CREW_TOKEN='([a-f0-9]{64})'")
    if (-not $crewTokenMatch.Success) { throw 'Open Crew on this PC, then run this setup again.' }
    $crewLocalHeaders = @{'X-Crew-Token'=$crewTokenMatch.Groups[1].Value}
    $null = Invoke-RestMethod 'http://127.0.0.1:4318/api/mobile-status' -Headers $crewLocalHeaders -TimeoutSec 5
    $crewTailscale = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
    if (-not (Test-Path -LiteralPath $crewTailscale)) {
        $crewInstaller = Join-Path $PSScriptRoot 'Tailscale-Setup.exe'
        if (-not (Test-Path -LiteralPath $crewInstaller)) {
            Start-Process 'https://tailscale.com/download/windows'
            throw 'Install Tailscale using the official download page, then open this setup again.'
        }
        $crewSignature = Get-AuthenticodeSignature -LiteralPath $crewInstaller
        if ($crewSignature.Status -ne 'Valid' -or $crewSignature.SignerCertificate.Subject -notmatch 'Tailscale') { throw 'The Tailscale installer signature could not be verified. Use the official download page.' }
        Write-Host 'Finish installing Tailscale in the installer window.'
        Start-Process -FilePath $crewInstaller -Wait
        if (-not (Test-Path -LiteralPath $crewTailscale)) { throw 'Tailscale is not installed yet. Finish installing it and run this setup again.' }
    }
    $crewStatusText = & $crewTailscale status --json
    $crewStatus = $crewStatusText | ConvertFrom-Json
    if ($crewStatus.BackendState -ne 'Running') {
        Write-Host 'Sign in to Tailscale using the link below. Use the same account on your iPhone.'
        & $crewTailscale up
        if ($LASTEXITCODE -ne 0) { throw 'Finish signing in to Tailscale, then run this setup again.' }
        $crewStatus = (& $crewTailscale status --json) | ConvertFrom-Json
    }
    $crewDns = [string]$crewStatus.Self.DNSName
    $crewDns = $crewDns.TrimEnd('.')
    if (-not $crewDns.EndsWith('.ts.net')) { throw 'Enable MagicDNS in the Tailscale admin console, then run this setup again.' }
    # Preserve any unrelated Serve configuration. Crew uses the dedicated 8443 endpoint.
    $crewServeText = (& $crewTailscale serve status --json) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve status could not be checked.' }
    $crewServe = $crewServeText | ConvertFrom-Json
    $crewEndpoint = $crewDns + ':8443'
    if ($crewServe.Web -and $crewServe.Web.PSObject.Properties[$crewEndpoint]) {
        $crewHandlers = $crewServe.Web.PSObject.Properties[$crewEndpoint].Value.Handlers
        $crewRootHandler = if ($crewHandlers) { $crewHandlers.PSObject.Properties['/'] } else { $null }
        if (-not $crewRootHandler -or @($crewHandlers.PSObject.Properties).Count -ne 1 -or $crewRootHandler.Value.Proxy -cne 'http://127.0.0.1:4320' -or @($crewRootHandler.Value.PSObject.Properties).Count -ne 1) { throw 'Tailscale port 8443 already serves another app. Crew has left that configuration unchanged.' }
    }
    if ($crewServe.TCP -and $crewServe.TCP.PSObject.Properties['8443']) {
        $crewTcp = $crewServe.TCP.PSObject.Properties['8443'].Value
        if (-not $crewTcp.HTTPS) { throw 'Tailscale port 8443 is already in use by a TCP service. Crew left it unchanged.' }
    }
    if ($crewServe.AllowFunnel -and $crewServe.AllowFunnel.PSObject.Properties[$crewEndpoint] -and $crewServe.AllowFunnel.PSObject.Properties[$crewEndpoint].Value) { throw 'Port 8443 is configured for public Funnel. Disable that endpoint before using it for private Crew access.' }
    Write-Host 'Tailscale may display a link to enable HTTPS. Open it and allow HTTPS when prompted.'
    & $crewTailscale serve --bg --https=8443 http://127.0.0.1:4320
    if ($LASTEXITCODE -ne 0) { throw 'Enable HTTPS using the Tailscale link, then run this setup again.' }
    $crewOrigin = 'https://' + $crewDns + ':8443'
    $crewPayload = @{origin=$crewOrigin} | ConvertTo-Json
    $null = Invoke-RestMethod 'http://127.0.0.1:4318/api/mobile-configure' -Method Post -ContentType 'application/json' -Headers $crewLocalHeaders -Body $crewPayload
    Write-Host ''
    Write-Host 'Your private Crew address:' -ForegroundColor Green
    Write-Host $crewOrigin
    Write-Host 'On iPhone: install Tailscale, sign in to the same account, and connect.'
    Write-Host 'Then open this address in Safari. In Crew on the PC, choose My workspace > Connect iPhone > Create pairing code.'
    Write-Host 'Once paired in Safari, choose Share > Add to Home Screen.'
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Yellow
}
Read-Host 'Press Enter to close'

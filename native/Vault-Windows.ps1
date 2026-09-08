$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Security
    $vaultRequest = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $entropy = [Text.Encoding]::UTF8.GetBytes('Folklet credential vault v1')
    if ($vaultRequest.action -eq 'put') {
        if ($vaultRequest.value -notmatch '^[a-f0-9]{64}$') { throw 'Invalid key' }
        $protected = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($vaultRequest.value), $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        @{ value = [Convert]::ToBase64String($protected) } | ConvertTo-Json -Compress
    } elseif ($vaultRequest.action -eq 'get') {
        $plain = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($vaultRequest.value), $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        @{ value = [Text.Encoding]::UTF8.GetString($plain) } | ConvertTo-Json -Compress
    } else { throw 'Invalid action' }
} catch {
    [Console]::Error.WriteLine('The Windows credential protector could not complete the request.')
    exit 1
}

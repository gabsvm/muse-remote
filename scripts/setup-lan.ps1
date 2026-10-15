# Run in PowerShell on the Windows PC, without administrator rights.
# Creates a user-owned self-signed certificate. Android verifies its SHA-256
# fingerprint BEFORE sending a bearer token; never accept unpinned TLS.
param([string]$Hostname = $env:COMPUTERNAME)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pfxFile = Join-Path $root '.lan.pfx'
$passFile = Join-Path $root '.lan.pass'
$fingerprintFile = Join-Path $root '.lan.fingerprint'
if ((Test-Path $pfxFile) -or (Test-Path $passFile) -or (Test-Path $fingerprintFile)) {
    throw 'Ya existen credenciales LAN. NO las reemplaces: los telefonos emparejados confian en su certificado.'
}
$cert = New-SelfSignedCertificate -Subject "CN=$Hostname" -DnsName $Hostname -CertStoreLocation 'Cert:\CurrentUser\My' -Type SSLServerAuthentication -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -NotAfter (Get-Date).AddYears(3) -KeyExportPolicy Exportable
$bytes = New-Object byte[] 36
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$secret = [Convert]::ToBase64String($bytes)
$secure = ConvertTo-SecureString $secret -AsPlainText -Force
Export-PfxCertificate -Cert $cert -FilePath $pfxFile -Password $secure -Force | Out-Null
[System.IO.File]::WriteAllText($passFile, $secret, (New-Object System.Text.UTF8Encoding($false)))
$sha = [System.Security.Cryptography.SHA256]::Create()
$fingerprint = [System.BitConverter]::ToString($sha.ComputeHash($cert.RawData)).Replace('-', '').ToLowerInvariant()
$sha.Dispose()
[System.IO.File]::WriteAllText($fingerprintFile, $fingerprint, (New-Object System.Text.UTF8Encoding($false)))
# Restrict NTFS ACLs to the Windows user and SYSTEM (requires regular folder ACL privileges).
foreach ($file in @($pfxFile, $passFile, $fingerprintFile)) {
    & icacls.exe $file /inheritance:r /grant:r "${env:USERDOMAIN}\${env:USERNAME}:(R,W)" "SYSTEM:(F)" | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warning "Revisa permisos NTFS de $file." }
}
Write-Host ''
Write-Host "Certificado LAN listo. Huella SHA-256:" -ForegroundColor Green
Write-Host $fingerprint
Write-Host "Inicia con: `$env:MUSE_REMOTE_LAN='1'; node server.js"
Write-Host 'La primera vez permite TCP 8788 SOLO en la red privada de Windows, nunca hacia Internet.'
Write-Host 'Para emparejar el movil: npm run lan:pair'

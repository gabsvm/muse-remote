# Generates ONE debug-only QA signing key and configures GitHub repository
# secrets without writing the private key into the repo or terminal output.
param([string]$Repository = 'gabsvm/muse-remote')
$ErrorActionPreference = 'Stop'

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw 'Falta GitHub CLI. Instala: winget install GitHub.cli; inicia sesion con gh auth login.'
}
& gh auth status 1>$null 2>$null
if ($LASTEXITCODE -ne 0) {
    throw 'GitHub CLI no esta autenticado. Ejecuta gh auth login.'
}
$keytool = (Get-Command keytool -ErrorAction SilentlyContinue).Source
if (-not $keytool) {
    if ($env:JAVA_HOME -and (Test-Path "$env:JAVA_HOME\bin\keytool.exe")) {
        $keytool = "$env:JAVA_HOME\bin\keytool.exe"
    } else {
        throw 'Falta keytool. Instala JDK 21 o configura JAVA_HOME.'
    }
}
$homeDir = Join-Path $HOME '.muse-remote'
[IO.Directory]::CreateDirectory($homeDir) | Out-Null
$p12 = Join-Path $homeDir 'muse-qa.p12'
$pwdFile = Join-Path $homeDir 'muse-qa-password.dpapi'
if ((Test-Path $p12) -xor (Test-Path $pwdFile)) {
    throw 'Existe solo uno de los archivos de firma. No generes otra clave: restaura la pareja desde backup.'
}
if (-not (Test-Path $p12)) {
    $bytes = New-Object byte[] 48
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) }
    finally { $random.Dispose() }
    $pass = [Convert]::ToBase64String($bytes)
    $secure = ConvertTo-SecureString $pass -AsPlainText -Force
    & $keytool -genkeypair -keystore $p12 -storetype PKCS12 -alias museqa -keyalg RSA -keysize 3072 -validity 10000 -dname "CN=Muse Remote QA, OU=Development, O=Local QA" -storepass $pass -keypass $pass -noprompt | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'keytool no pudo generar la clave QA.' }
    $secure | ConvertFrom-SecureString | Set-Content -Path $pwdFile -NoNewline
} else {
    $secure = (Get-Content $pwdFile -Raw) | ConvertTo-SecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $pass = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
& $keytool -list -keystore $p12 -storetype PKCS12 -alias museqa -storepass $pass | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'El keystore y la contrasena no coinciden.' }
[Convert]::ToBase64String([IO.File]::ReadAllBytes($p12)) | gh secret set MUSE_QA_KEYSTORE_B64 --repo $Repository
if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear MUSE_QA_KEYSTORE_B64 en GitHub Secrets.' }
$pass | gh secret set MUSE_QA_STORE_PASSWORD --repo $Repository
if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear MUSE_QA_STORE_PASSWORD en GitHub Secrets.' }
Write-Host 'Firma QA configurada en GitHub Secrets.' -ForegroundColor Green
Write-Host "Keystore de respaldo local: $p12"
Write-Host 'No regeneres esta clave; las APK QA futuras conservan la firma.'

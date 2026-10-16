#requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory=$true)]
      [ValidateSet('Pair','Status','Restart')][string] $Action)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Set-Location -LiteralPath $root

function Listeners([int]$port) {
    @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}
function BackendProcess {
    $conns = @(Listeners 8787)
    if ($conns.Count -eq 0) { return $null }
    $owners = @($conns | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($owners.Count -ne 1) { throw 'Puerto 8787 ocupado por varios procesos; no se tocara ninguno.' }
    $processId = [int]$owners[0]
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
    if ($null -eq $proc) { throw 'No se pudo identificar el proceso del puerto 8787.' }
    return $proc
}
function Health {
    try { Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 4 }
    catch { return $null }
}
function IsOurBackend($proc) {
    if ($null -eq $proc -or $proc.Name -notmatch '^node(?:\.exe)?$') { return $false }
    $cmd = [string]$proc.CommandLine
    $full = Join-Path $root 'server.js'
    if ($cmd.IndexOf($full, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
    if ($cmd -notmatch '(?:^|[\s"])server\.js(?:["\s]|$)') { return $false }
    # Los lanzamientos anteriores usan "node server.js": verificar propiedad
    # del servidor mediante el token guardado por ESTE repo, sin mostrarlo.
    $token = [string]$env:MUSE_REMOTE_TOKEN
    if ([string]::IsNullOrWhiteSpace($token)) {
        $file = Join-Path $root '.token'
        if (Test-Path -LiteralPath $file) { $token = (Get-Content -LiteralPath $file -Raw).Trim() }
    }
    if ($token.Length -lt 16) { return $false }
    try {
        $response = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/command-id' -Headers @{Authorization="Bearer $token"} -TimeoutSec 4
        return ($response.ok -eq $true -and [string]$response.commandId -match '^[0-9a-f-]{36}$')
    } catch { return $false }
}
function RequireTools {
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
        throw 'No se encontro Node.js. Instala Node.js 20+ y vuelve a abrir este acceso.'
    }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw 'No se encontro npm. Comprueba la instalacion de Node.js.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $root 'server.js'))) {
        throw "No se encontro server.js en $root"
    }
    if (-not [string]::IsNullOrWhiteSpace($env:META_API_KEY)) {
        throw 'META_API_KEY esta definida: Muse Remote bloquea el inicio para no usar Model API.'
    }
}
function PrepareLan {
    RequireTools
    $files = @('.lan.pfx','.lan.pass','.lan.fingerprint')
    $found = @($files | Where-Object { Test-Path -LiteralPath (Join-Path $root $_) })
    if ($found.Count -gt 0 -and $found.Count -lt 3) {
        throw 'Certificado LAN incompleto. Restaura tus archivos .lan.*, NO generes otros.'
    }
    if ($found.Count -eq 0) {
        Write-Host 'Generando el certificado LAN por primera vez (se reutilizara siempre)...' -ForegroundColor Cyan
        & (Join-Path $root 'scripts\setup-lan.ps1')
        if (@($files | Where-Object { Test-Path (Join-Path $root $_) }).Count -ne 3) {
            throw 'No se pudo generar el certificado. Consulta la salida anterior.'
        }
    }
    if (-not (Test-Path (Join-Path $root 'node_modules\qrcode-terminal'))) {
        Write-Host 'Instalando las dependencias, incluido qrcode-terminal...' -ForegroundColor Cyan
        & npm.cmd install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm install fallo. Verifica Internet y reintenta.' }
    }
}
function CheckLanPort($expectedId) {
    foreach ($conn in @(Listeners 8788)) {
        if ($null -eq $expectedId -or $conn.OwningProcess -ne $expectedId) {
            throw 'El puerto HTTPS LAN 8788 esta ocupado por otro proceso. No se detendra.'
        }
    }
}
function StartBackend {
    PrepareLan
    if ($null -ne (BackendProcess)) { throw 'Puerto 8787 ocupado: usa el acceso Reiniciar.' }
    CheckLanPort $null
    $run = Join-Path $PSScriptRoot '_servidor-lan.cmd'
    # Windows cmd /c con doble comilla externa para rutas que tienen espacios.
    $args = '/c ""' + $run + '""'
    Start-Process -FilePath $env:ComSpec -ArgumentList $args -WorkingDirectory $root
    Write-Host 'Iniciando el servidor en otra ventana...' -ForegroundColor Cyan
    for ($i=0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        $h = Health
        if ($null -ne $h -and $h.ok -eq $true -and @(Listeners 8788).Count -gt 0) {
            Write-Host 'Servidor local y LAN HTTPS iniciados.' -ForegroundColor Green
            return
        }
    }
    throw 'El servidor no inicio en 20 s. Revisa la ventana Muse Remote - Servidor.'
}
function ConfirmRestart {
    Write-Warning 'Reiniciar desconecta la app y puede interrumpir tareas Muse en curso.'
    $answer = Read-Host 'Para continuar escribe REINICIAR'
    if ($answer -cne 'REINICIAR') {
        Write-Host 'Cancelado; ningun proceso fue detenido.'
        return $false
    }
    return $true
}
function RestartBackend {
    $proc = BackendProcess
    $expectedId = if ($null -eq $proc) { $null } else { [int]$proc.ProcessId }
    CheckLanPort $expectedId
    if ($null -ne $proc) {
        if (-not (IsOurBackend $proc)) {
            throw 'No se pudo verificar que 8787 pertenezca a este repo. Cierra manualmente el servidor y reintenta.'
        }
        if (-not (ConfirmRestart)) { return }
        Write-Host "Deteniendo SOLO el backend verificado (PID $expectedId)..." -ForegroundColor Yellow
        & taskkill.exe /PID ([string]$expectedId) /T /F | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo detener el proceso. Cierralo manualmente.' }
        for ($i=0; $i -lt 30; $i++) {
            if ($null -eq (BackendProcess)) { break }
            Start-Sleep -Milliseconds 400
        }
        if ($null -ne (BackendProcess)) { throw 'Puerto 8787 todavia ocupado; no se iniciara un duplicado.' }
    }
    StartBackend
    ShowStatus
}
function ShowStatus {
    Write-Host ''
    Write-Host '========== MUSE REMOTE ==========' -ForegroundColor Cyan
    Write-Host "Repositorio: $root"
    $proc = BackendProcess
    $h = Health
    if ($null -eq $proc) {
        Write-Host 'Backend 8787: DETENIDO' -ForegroundColor Yellow
    } elseif ($null -eq $h -or $h.ok -ne $true) {
        Write-Host "Puerto 8787 ocupado (PID $($proc.ProcessId)); respuesta no valida." -ForegroundColor Yellow
    } else {
        Write-Host "Backend 8787: ACTIVO (PID $($proc.ProcessId))" -ForegroundColor Green
        $msp = if ($h.mspReady) { 'LISTO' } else { 'INICIANDO / SIN CONEXION' }
        Write-Host "Muse MSP: $msp"
        $upload = $false
        if ($null -ne $h.PSObject.Properties['features']) {
            $upload = $h.features.fileUpload -eq $true
        }
        $up = if ($upload) { 'ACTIVO' } else { 'REQUIERE REINICIAR DESDE LA RAMA NUEVA' }
        Write-Host "Adjuntos de documentos: $up"
    }
    if (@(Listeners 8788).Count -gt 0) {
        Write-Host 'LAN HTTPS 8788: ACTIVA' -ForegroundColor Green
    } else {
        Write-Host 'LAN HTTPS 8788: DETENIDA' -ForegroundColor Yellow
    }
    if (Get-Command tailscale.exe -ErrorAction SilentlyContinue) {
        Write-Host 'Tailscale Serve:'
        try { & tailscale.exe serve status 2>&1 | Select-Object -First 12 }
        catch { Write-Host 'No se pudo consultar Tailscale Serve.' }
    }
    Write-Host '================================='
    Write-Host 'Mantiene intactos el certificado LAN, el token y Tailscale Serve.'
    Write-Host ''
}
function IncludeTailscaleFallback {
    if (-not [string]::IsNullOrWhiteSpace($env:MUSE_REMOTE_TAILSCALE_URL)) { return }
    if (-not (Get-Command tailscale.exe -ErrorAction SilentlyContinue)) { return }
    try {
        $serve = & tailscale.exe serve status --json 2>$null | Out-String | ConvertFrom-Json
        if ($null -eq $serve.Web -or @($serve.Web.PSObject.Properties).Count -eq 0) { return }
        $status = & tailscale.exe status --json 2>$null | Out-String | ConvertFrom-Json
        $dns = [string]$status.Self.DNSName
        if ($dns.Contains('.')) {
            $env:MUSE_REMOTE_TAILSCALE_URL = 'https://' + $dns.TrimEnd('.')
            Write-Host "URL Tailscale incluida como respaldo: $env:MUSE_REMOTE_TAILSCALE_URL"
        }
    } catch { }
}
function PairLan {
    $proc = BackendProcess
    if ($null -eq $proc) {
        StartBackend
    } else {
        if (-not (IsOurBackend $proc)) {
            throw 'El servidor actual no se pudo verificar. No se mostrara el QR privado.'
        }
        if (@(Listeners 8788).Count -eq 0) {
            Write-Host 'El servidor actual no tiene LAN HTTPS: hace falta reiniciar.' -ForegroundColor Yellow
            RestartBackend
            if (@(Listeners 8788).Count -eq 0) { throw 'LAN no habilitada.' }
        } else { PrepareLan }
    }
    IncludeTailscaleFallback
    Write-Host ''
    Write-Host '==== EMPAREJAMIENTO LOCAL ====' -ForegroundColor Cyan
    Write-Host 'En Android: Emparejar con QR de mi PC.'
    Write-Warning 'Este QR contiene un token privado: no compartas capturas.'
    & node.exe (Join-Path $root 'scripts\lan-pair.js')
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo generar el QR.' }
}
try {
    switch ($Action) {
        'Pair' { PairLan }
        'Status' { ShowStatus }
        'Restart' { RestartBackend }
    }
    exit 0
} catch {
    Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}

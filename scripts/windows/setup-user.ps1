# Muse Remote beta: Windows first-run and diagnostics.
# Deliberately does not invoke Muse CLI, run a coding model, configure
# an external tunnel, change firewall settings or expose credentials.
[CmdletBinding()]
param(
    [ValidateSet('Install','Doctor','Start')][string]$Action='Install',
    [switch]$Json,
    [switch]$NoBrowser
)
$ErrorActionPreference='Stop'
$Root=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$Checks=[ordered]@{}
function Check([string]$Name,[bool]$Ok,[string]$Detail) {
    $script:Checks[$Name]=@{ok=$Ok;detail=$Detail}
}
function Check-Environment {
    $node=Get-Command node -ErrorAction SilentlyContinue
    $npm=Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($node) {
        $version=(& node --version 2>$null).Trim()
        $major=0
        if($version -match '^v(\d+)'){ $major=[int]$Matches[1] }
        Check 'node' ($major -ge 22) "Node $version (22+ required)"
    } else {Check 'node' $false 'Node.js missing: https://nodejs.org/'}
    Check 'npm' ([bool]$npm) $(if($npm){'npm.cmd available'}else{'npm not found'})
    $candidate=Get-Command muse -ErrorAction SilentlyContinue
    $installed=([bool]$candidate)
    $localMuse=Join-Path $env:LOCALAPPDATA 'Programs\muse'
    if(-not $installed -and (Test-Path $localMuse)) {
        $installed=([bool](Get-ChildItem $localMuse -Filter 'muse-bin-*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1))
    }
    Check 'muse_cli' $installed $(if($installed){'Muse CLI found (authentication not checked)'}else{'Install/authenticate Muse Code CLI separately'})
    Check 'dependencies' (Test-Path (Join-Path $Root 'node_modules\bonjour-service')) $(if(Test-Path (Join-Path $Root 'node_modules\bonjour-service')){'Installed'}else{'Run Install to download'})
    $tokenPath=Join-Path $Root '.token'
    $hasToken=Test-Path $tokenPath
    Check 'local_token' $hasToken $(if($hasToken){'Local token exists (value not displayed)'}else{'Will be generated on first server start'})
    $fp=Test-Path (Join-Path $Root '.lan.fingerprint')
    $pfx=Test-Path (Join-Path $Root '.lan.pfx')
    Check 'lan_pairing' ($fp -and $pfx) $(if($fp -and $pfx){'LAN TLS artifacts present'}else{'Optional: see native/LAN.md for secure LAN setup'})
    $tailscale=[bool](Get-Command tailscale -ErrorAction SilentlyContinue)
    Check 'tailscale' $tailscale $(if($tailscale){'Installed (connection not checked)'}else{'Optional: https://tailscale.com/'})
    $port=8787
    $listener=Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    Check 'loopback_service' ([bool]$listener) $(if($listener){'Service listening on 127.0.0.1:8787'}else{'Service not running'})
}
Push-Location $Root
try {
    if($Action -eq 'Install'){
        Write-Host '[Muse Remote] First-time setup' -ForegroundColor Cyan
        Check-Environment
        if(-not $Checks.node.ok -or -not $Checks.npm.ok){throw 'Node.js 22+ and npm are required.'}
        & npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund
        if($LASTEXITCODE -ne 0){throw 'Dependency installation failed'}
        Write-Host 'Dependencies installed. Checking credential-free tests ...'
        & npm.cmd test
        if($LASTEXITCODE -ne 0){throw 'Unit tests failed; setup will not claim success'}
        Write-Host 'Setup verified. Run 02_Iniciar_PWA.cmd to start the local service.' -ForegroundColor Green
        Write-Host 'For Android pairing see native/LAN.md. The app never opens a public port by itself.'
    } elseif($Action -eq 'Doctor') {
        Check-Environment
        if($Json){ $Checks | ConvertTo-Json -Depth 4 }
        else {
            Write-Host '[Muse Remote] Local diagnostics (no credentials shown)' -ForegroundColor Cyan
            foreach($entry in $Checks.GetEnumerator()){
                Write-Host ("  {0}: {1} - {2}" -f $entry.Key,$(if($entry.Value.ok){'OK'}else{'INFO'}),$entry.Value.detail)
            }
        }
    } else {
        Check-Environment
        if(-not $Checks.node.ok){throw 'Install Node.js 22+ first.'}
        if(-not $Checks.dependencies.ok){throw 'Run 01_Instalar.cmd first.'}
        if(-not $NoBrowser){Start-Process 'http://127.0.0.1:8787/'}
        Write-Host 'Starting loopback-only server. Close this window to stop.' -ForegroundColor Cyan
        & node server.js
        if($LASTEXITCODE -ne 0){throw "Server exited with status $LASTEXITCODE"}
    }
} catch {
    Write-Error $_.Exception.Message
    exit 1
} finally {Pop-Location}

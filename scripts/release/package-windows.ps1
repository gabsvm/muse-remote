param([string]$Output = '')
$ErrorActionPreference = 'Stop'
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not $Output) { $Output = Join-Path $Root 'dist-packages\muse-remote-windows-beta.zip' }
$stageRoot=Join-Path $env:TEMP ('muse-remote-beta-'+[Guid]::NewGuid().ToString('N'))
$Stage=Join-Path $stageRoot 'muse-remote-windows'
New-Item -ItemType Directory -Path $Stage -Force | Out-Null
# Deliberate file selection: no developer working data or unlisted files.
$Paths=@('package.json','package-lock.json','README.md','SECURITY.md','CONTRIBUTING.md','CODE_OF_CONDUCT.md','GOVERNANCE.md','LICENSE','ARCHITECTURE.md','THIRD_PARTY_NOTICES.md','server.js','lan.js','push.js','uploads.js','contributor.js','usage-diagnostics.js')
$Paths+=@('public/app.js','public/global-search.js','public/icon.svg','public/icon-192.png','public/icon-512.png','public/apple-touch-icon.png','public/muse-remote-wordmark.png','public/index.html','public/manifest.webmanifest','public/styles.css','public/sw.js','public/theme.js')
$Paths+=@('scripts/lan-pair.js','scripts/tunnel.js','scripts/setup-lan.ps1','scripts/setup-android-qa-signing.ps1','scripts/windows/01_Emparejar_LAN.cmd','scripts/windows/02_Ver_estado.cmd','scripts/windows/03_Reiniciar_servidor.cmd','scripts/windows/_servidor-lan.cmd','scripts/windows/muse-control.ps1','scripts/windows/README.md','scripts/windows/setup-user.ps1','scripts/windows/01_Instalar.cmd','scripts/windows/02_Iniciar_PWA.cmd','scripts/windows/03_Diagnostico.cmd','scripts/windows/04_Revocar_dispositivos.cmd','scripts/security/rotate-token.js','scripts/release/package-windows.ps1')
$Paths+=@('native/README.md','native/LAN.md','native/QA_SIGNING.md')
$Paths+=@(Get-ChildItem (Join-Path $Root 'docs') -File -Filter '*.md' | ForEach-Object {'docs/'+$_.Name})
$Paths+=@('test/push.test.js','test/tunnel.test.js','test/client.test.js','test/security.test.js','test/bootstrap-security.test.js','test/rotation.test.js','test/contributor.test.js','test/contributor-http.test.js','test/usage-diagnostics.test.js','test/brand-assets.test.js','test/global-search.test.js','test/timeout.test.js','test/lan.test.js','test/upload.test.js','test/msp.test.js','test/api.test.js','test/image.test.js')
foreach($rel in $Paths){
  $src=Join-Path $Root $rel
  if(-not(Test-Path -LiteralPath $src)){throw ('Missing required package file '+$rel)}
  $dest=Join-Path $Stage $rel
  New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
  Copy-Item -LiteralPath $src -Destination $dest -Force
}
$Version=(Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version
$Manifest=[ordered]@{version=$Version; platform='Windows'; distribution='portable source setup'; files=@{}}
foreach($item in Get-ChildItem $Stage -Recurse -File){
  $key=$item.FullName.Substring($Stage.Length+1).Replace('\','/')
  $sha=[System.Security.Cryptography.SHA256]::Create()
  $stream=[System.IO.File]::OpenRead($item.FullName)
  try { $Manifest.files[$key]=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
  finally { $stream.Dispose();$sha.Dispose() }
}
$Manifest | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Stage 'MANIFEST.json') -Encoding utf8
New-Item -ItemType Directory -Path (Split-Path $Output) -Force | Out-Null
Compress-Archive -Path $Stage -DestinationPath $Output -CompressionLevel Optimal -Force
Get-Item $Output | Select-Object FullName,Length

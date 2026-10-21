# Muse Remote — conexión directa LAN + Tailscale

Este cliente puede trabajar **sin Cloudflare**. Requiere el backend Node en Windows
porque `muse serve` se comunica con él por MSP mediante stdio.

La conexión tiene dos vías:

1. **LAN HTTPS directa:** `https://IP_PRIVADA_PC:8788` cifrada con un
   certificado autofirmado cuya huella SHA-256 se verifica en Android.
2. **Respaldo remoto:** URL HTTPS de **Tailscale Serve**. Tailscale debe estar
   conectado en Windows y Android. Cuando el enlace LAN inicial no está
   disponible, el cliente prueba la URL de respaldo durante la conexión.

No se abren puertos en el router y no se exponen los endpoints MSP a Internet.
El antiguo HTTP en `127.0.0.1:8787` sigue exclusivamente local.

## Primera instalación Windows (PowerShell)

Abre PowerShell en la carpeta raíz de `muse-remote`:

```powershell
npm install
powershell -ExecutionPolicy Bypass -File .\scripts\setup-lan.ps1
```

El segundo comando genera un certificado TLS autofirmado y un PIN **de
certificado** (huella SHA-256), no una clave de API ni tu token de sesión.

En PowerShell **elevado como administrador**, permitir acceso SOLO desde tu
subred privada (sin `0.0.0.0` público en Windows Firewall):

```powershell
New-NetFirewallRule -DisplayName "Muse Remote LAN HTTPS" `
  -Direction Inbound -Protocol TCP -LocalPort 8788 `
  -Profile Private -RemoteAddress LocalSubnet -Action Allow
```

Comprueba que el perfil de tu Wi-Fi/Ethernet de Windows es **Privado**.
Para descubrir automáticamente la PC, habilita **Detección de redes** de
Windows para redes privadas si el firewall bloquea mDNS (UDP 5353).
En ciertas redes Wi-Fi públicas o con aislamiento entre dispositivos el
descubrimiento y la conexión LAN no funcionarán.

Para iniciar el servidor (mantén abierta la ventana):

```powershell
cd C:\Dev\muse-remote
$env:MUSE_REMOTE_LAN='1'
node server.js
```

El servidor anunciará `Muse Remote NOMBRE-PC` por mDNS
`_museremote._tcp.local`. mDNS **no prueba la identidad** de la PC.
Solo el certificado emparejado y el token la prueban.

## Emparejar el APK con QR

En otra ventana PowerShell, desde la raíz:

```powershell
npm run lan:pair
```

Verás un QR en el terminal. En el teléfono abre Muse Remote y pulsa
**Emparejar con QR de mi PC**. El QR transmite localmente la URL,
el token y la huella TLS. **No publiques ni compartas una captura del QR**.

La primera ejecución del escáner Android puede descargar su módulo
desde Google Play Services. Puedes introducir URL, token y huella
manualmente en «Opciones de conexión segura» si el lector no está disponible.

Puedes comprobar la huella manual con:

```powershell
Get-Content .lan.fingerprint
```

No borres `.lan.pfx`, `.lan.pass` ni `.lan.fingerprint`:
regenerarlos rompe la confianza de los teléfonos ya emparejados.
Estos archivos están ignorados por git y limitados por ACL de Windows
al usuario propietario y SYSTEM.

## Configurar el respaldo Tailscale (sin Cloudflare)

Con Tailscale instalado, conectado a tu cuenta en PC y teléfono:

```powershell
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

Copia la dirección HTTPS `https://nombre.tailnet.ts.net`. Para incluirla
en el QR antes de ejecutar `npm run lan:pair`, define:

```powershell
$env:MUSE_REMOTE_TAILSCALE_URL='https://TU-PC.TU-TAILNET.ts.net'
npm run lan:pair
```

La app intenta primero la PC en LAN (descubierta por mDNS, validando el
mismo certificado). Si no responde durante **la conexión o el arranque**,
prueba Tailscale Serve con validación TLS normal.

Por ahora no hay un conmutador sin interrupción durante un turno MSP:
si la red cambia con una conversación abierta, regresa a sesiones y
reconecta o reinicia la app para elegir la nueva ruta. La resiliencia
de red y entrega idempotente sigue pendiente de pruebas en dispositivo.

## Notas de seguridad

- LAN no se habilita a menos que `MUSE_REMOTE_LAN=1` y haya PFX y contraseña.
- El puerto 8788 solo acepta solicitudes API desde IP privadas, y Windows
  Firewall debe limitarlo también a `LocalSubnet` en perfil Privado.
- El certificado del PC no tiene que estar firmado por una CA; Android
  confía *solo* en la huella de certificado recibida mediante QR de la PC.
- Un anuncio mDNS falso jamás puede autorizar la entrega del token.
- El token se almacena cifrado mediante Android Keystore, como antes.
- No usar `--public`, abrir 8788 en el router ni reenviar un token por HTTP.
- Android 17 restringe la red local para apps con `targetSdk >= 37`.
  Esta versión conserva `targetSdk 36`; el siguiente salto requiere
  adaptar la detección a los permisos/selector de servicios de Android 17.

## Diagnóstico

- Sin PC detectada: comprobar red Wi-Fi común, red Privada de Windows,
  UDP 5353/mDNS y ausencia de «aislamiento de cliente» en el router.
  Prueba introducir la URL del PC manualmente.
- «Huella incorrecta»: nunca aceptar un certificado nuevo silenciosamente;
  revisa QR y huella de `.lan.fingerprint`.
- «Conexión rechazada»: verificar `Get-NetTCPConnection -LocalPort 8788`
  y regla del firewall.
- Fuera de casa: activar Tailscale en ambos dispositivos, verificar
  `tailscale serve status` y utilizar URL HTTPS correcta.
- Para quitar LAN sin afectar al remoto viejo: quitar
  `$env:MUSE_REMOTE_LAN` y reiniciar el backend.

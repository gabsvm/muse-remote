# Muse Remote — accesos directos Windows

No es necesario escribir comandos cada vez. Estos archivos se abren con
**doble clic** desde el Explorador de Windows.

Primero actualiza la carpeta del proyecto con Git (`git pull` en la rama
`feat/kmp-compose-native`). Luego abre `scripts\\windows`.

| Archivo | Qué hace |
| --- | --- |
| **01_Emparejar_LAN.cmd** | Inicia Muse Remote si estaba apagado, conserva el certificado existente y muestra el QR en la ventana. Instala `qrcode-terminal` mediante `npm install` solo cuando faltan dependencias. |
| **02_Ver_estado.cmd** | Consulta backend/MSP, conexión HTTPS LAN, disponibilidad de adjuntos y Tailscale Serve. No detiene ni modifica el servidor. |
| **03_Reiniciar_servidor.cmd** | Detecta el proceso que escucha en 8787, comprueba que pertenece a este repositorio, pide confirmación antes de detenerlo, y abre el servidor actualizado en una ventana nueva con HTTPS LAN. Si no estaba funcionando, lo inicia directamente. |

El servidor sigue funcionando **en su propia ventana** después de cerrar
la ventana del lanzador. No cierres la ventana titulada
`Muse Remote - Servidor LAN y Tailscale` mientras quieras acceso desde
el teléfono.

## Casos comunes

- **Acabas de actualizar el código para permitir adjuntos**: abre
  `03_Reiniciar_servidor.cmd` y escribe `REINICIAR`. Después comprueba
  `02_Ver_estado.cmd`: «Adjuntos de documentos: ACTIVO».
- **Quieres emparejar otro teléfono**: abre `01_Emparejar_LAN.cmd`,
  escanea el QR en la APK. El QR contiene el token; **no hagas capturas
  ni lo compartas**.
- **No aparece el QR**: el acceso instalará dependencias de npm si no
  existe `qrcode-terminal` y dejará el error visible en pantalla.
- **LAN no conecta desde Android**: ambos dispositivos deben estar en
  la misma red local y el firewall de Windows debe permitir TCP 8788
  exclusivamente en perfil **Privado** para `LocalSubnet`. El script no
  modifica el firewall automáticamente ni abre puertos en el router.
  Consulta [native/LAN.md](../../native/LAN.md).
- **Desde fuera de casa**: mantén Tailscale conectado en PC y teléfono.
  Estos accesos no borran ni reconfiguran Tailscale Serve; si está
  configurado, el QR intentará incluir su URL como respaldo.
- **Servidor iniciado desde otra ventana**: el reinicio lo detecta y
  verifica mediante el token del repositorio antes de finalizarlo. Si
  no puede comprobar que pertenece a Muse Remote, se niega a matar
  el proceso y solicita cerrarlo manualmente.

## Protección de datos y sesiones

**Ninguno de estos accesos cambia** `.token`, `.lan.pfx`,
`.lan.pass`, `.lan.fingerprint`, la configuración de Tailscale
ni las claves de firma de Android. Solo la primera instalación,
si aún no existe ningún certificado LAN, ejecuta
`scripts/setup-lan.ps1` una vez y conserva los archivos generados.

**Reiniciar interrumpe las conexiones** y puede cancelar trabajos de
Muse en ese servidor. Por eso exige escribir `REINICIAR` antes de
detener un proceso. Se detiene solo el proceso Node identificado y sus
procesos hijos; nunca se matan indiscriminadamente todos los
`node.exe`.

La carpeta `_servidor-lan.cmd` y `muse-control.ps1` son archivos
auxiliares usados por los accesos; no es necesario abrirlos directamente.

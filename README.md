# muse-remote

PWA mobile-first para controlar el **Muse Code CLI oficial** (tu login/
subscription del navegador) desde el telefono. No implementa ningun
cliente de Model API ni usa API keys PAYG: toda la inferencia la ejecuta
`muse serve` en este PC a traves de su protocolo oficial MSP.

## Arranque

```powershell
cd C:\Dev\muse-remote
node server.js
```

Abre en el navegador: **http://127.0.0.1:8787**

El primer arranque imprime el **token local** (tambien en `.token`).
Introducelo en la PWA del telefono. Acceso remoto: exponlo tu con
**Tailscale Serve**; este backend solo escucha en `127.0.0.1`.

Variables opcionales: `MUSE_REMOTE_PORT` (def. 8787),
`MUSE_REMOTE_TOKEN` (token propio ≥16 caracteres), `MUSE_BIN`
(ruta al `muse-*.exe` si la autodeteccion falla).

## Tests

```powershell
npm test   # node --test test/ : handshake, model/list, session/list reales + HTTP/auth
```

## Que cubre la app

Sesiones (listar/crear con carpeta/continuar), prompts de texto,
imagen (galería/cámara), skills, `ifBusy` y effort por turno,
streaming en vivo (fetch) + modo poll + reconexión, tool calls con
salida completa y control de tasks, subagentes (ver/mensaje/seguir/
detener), workflows (vista; `workflow/cancel` vía proxy, pide
`workflowRunId`), approvals (aprobar/rechazar), preguntas
interactivas (responder), cancelar/interrumpir/dirigir/desencolar,
shell en la carpeta (`session/userShell`), modelo + effort +
approval-mode (ver/cambiar), historial completo (`view/page`),
compactar, uso de subscripción, dictado por voz, share-target de
Android, estado idle/running/waiting/poll, última sesión retomada,
instalable, dark mode.

Límites honestos del protocolo en este PC: `session/rename` no
soportado en Windows; adjuntos solo imagen (archivos como texto o
`@ruta`); sin borrado de sesiones; sin parámetros de modelo más allá
de modelo/effort; sin push nativo.

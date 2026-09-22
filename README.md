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

## Seguridad

- **Fail-closed contra `META_API_KEY`**: si esa variable está definida
  (no vacía), el backend se niega a arrancar con error. El hijo
  `muse serve` se lanza además con entorno saneado (sin heredar
  `META_API_KEY`). Este backend no usa ninguna Model API.
- **Verificación separada**: una API key almacenada *dentro* de la
  configuración interna de Muse (ficheros del CLI / login persistido)
  no la detecta ni la elimina este saneado de entorno. Verifícalo por
  separado (config/auth del CLI; `model/list` debe responder provider
  `meta` por subscription).
- **Auth del streaming**: `GET /api/events` exige
  `Authorization: Bearer <token>`; un `?token=` en query se ignora
  (nunca viaja el token en URL/logs).
- **Límites**: cuerpo `/api/rpc` máx 5 MiB; parte `image` máx 4 MiB en
  base64. El cliente genera JPEG (lado mayor 1568 px, q0.85) y rechaza
 Adjuntos mayores antes de enviar. Cuerpos mayores responden 413.
- **RPC**: allowlist estricta de métodos MSP usados por la PWA
  (ver `ALLOWED_METHODS` en `server.js`); resto → 403.
- **Cabeceras**: CSP + `nosniff`, `SAMEORIGIN`, `same-origin`,
  `Permissions-Policy` en API, estáticos y SSE.
- **Timeouts MSP**: `session/list` 180 s (el primer listado puede tardar
  ~100 s); resto de métodos 90 s. La UI no lanza listados en paralelo y
  muestra reintento si expira.

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

# muse-remote — arquitectura (derivada del protocolo real)

> **Nota de mantenimiento (2026-10-22):** este archivo contiene hitos históricos y observaciones del CLI 1.3.0. Algunos apartados marcados como «siguiente/no incluido» describen el estado de septiembre, no el estado actual. Para la matriz vigente consultar [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md), [native/README.md](native/README.md) y [docs/ROADMAP.md](docs/ROADMAP.md).

CLI auditado: `Muse Code 1.3.0`. Todo lo de abajo se observo en esta
instalacion (`muse serve --help`, `muse schema generate-json-schema`,
pruebas live por stdio). Nada inventado, nada de scraping de TUI.

## 1. Auditoria del protocolo real (MSP v1)

- `muse serve` = **host de sesiones MSP por stdio** (un solo cliente dueno
  de stdin/stdout). No es HTTP. Transporte: **JSON-RPC 2.0 NDJSON**
  (una linea = un frame), verificado live.
- Handshake: `initialize` {clientInfo} -> result {serverInfo, schema,
  sessionDurability, grantedCapabilities…} + notificacion `initialized`.
- Fingerprint estable observado:
  `sha256:7469c9e352e67def4a59df7e439984d7194fa351e1c8b7abb34060fd977ced81`
  (`sessionDurability: "durable"`).
- Schema exportado: **47 metodos**, 2 server-requests, ~30 notificaciones.
- `session/list` verificado live (pagina, `nextCursor`; filas con
  `status: notLoaded|idle|running`). Primera llamada lenta (~10 s).
- `model/list` verificado live: provider `meta`, 4 modelos `muse-spark-*`
  (usa el login/subscription local; **cero API keys**).
- Cobertura de los requisitos con metodos reales:
  - sesiones: `session/list|start|resume|read|rename|fork|compact`
  - prompts/streaming: `turn/start` + `view/subscribe|page` +
    `item/started|delta|updated|completed`, `turn/started|completed|…`
  - tool calls: items `kind: toolCall|userShell` (args verbatim)
  - subagentes/workflows: `subagent/*` (8 metodos) + items `subagent`,
    `workflow/cancel`, `workflow/childControl`, items `workflow`
  - approvals: server-request `approval/request`, notificaciones
    `approval/requested|updated|resolved`, `approval/decide`
    (guardia `requirementId`), `approval/listPending`
  - userInput (preguntas al usuario): `userInput/request|answer|…`
  - cancelar/steer: `turn/cancel`, `turn/interrupt` (+`retract`),
    `turn/steer` (objetivo exacto `expectedTurnId`), `turn/unqueue`
  - modelo/effort: `session/setModel`, `session/setReasoningEffort`
    (vocabulario cerrado de 8 tiers), `session/*Changed`
  - estado: `session/statusChanged` + `Session.status`
    (`notLoaded|idle|running`) + `attention`/`pendingRequests`
    (= "waiting" en la UI)

## 2. Arquitectura MVP

```
Telefono (PWA) --HTTPS--> Tailscale Serve --HTTP--> 127.0.0.1:8787
  backend (server.js, sin dependencias) --stdio NDJSON--> `muse serve`
  (un proceso hijo propiedad del backend; sesiones durables en disco)
```

- El backend es el **unico cliente** del host MSP: multiplexa a N
  pestañas via SSE (`GET /api/events?sessionId=`).
- `POST /api/rpc` = proxy de metodos MSP con allowlist (ALLOWED_METHODS; resto -> 403)
  (`initialize`, `initialized` los gestiona el puente).
- Auth: Bearer token local fuerte (generado en `.token`, o
  `MUSE_REMOTE_TOKEN`). SSE usa `Authorization: Bearer` por fetch (el `?token=` se ignora). (Streaming migrado de EventSource,
  admite cabeceras).
- Persistencia con navegador cerrado: el hijo `muse serve` y las
  sesiones viven en el PC; al reabrir, la PWA hace `session/resume` +
  `view/subscribe?after=cursor` (gapless).
- Bind fijo `127.0.0.1` (constante `HOST`; sin flag para cambiarlo).

## 3. Fases

1. ✅ Auditoria + validacion live (este doc).
2. ✅ MVP: puente + PWA instalable + dark mode + tests.
- Comportamiento observado (2026-09-22): `model/list` con `sessionId`
  de sesion no cargada en ese host falla `-32024 sessionNotLoaded`;
  `session/resume` de sesion cargada en otro host falla `-32021
  sessionInUse`. La UI reintenta sin `sessionId` y muestra el error.
- Sesiones antiguas pueden cargar sin sidecar de vista en vivo:
  `resume` devuelve `history.mode: "none"` (`projectionUnavailable`,
  `viewCursor: ""`) y `view/subscribe` rechaza con "no materialized
  sidecar… use view/page". La UI entra en modo poll (`session/read`
  cada 10 s, badge "poll") en vez de reintentar el SSE.
- Transporte web: `EventSource` falla en algunos navegadores aun con
  HTTP 200 mientras `fetch` a la misma URL llega (probado con sonda).
  La UI usa streaming con `fetch` + parseo SSE manual (`parseFrame`,
  con tests en `test/client.test.js` sobre el codigo servido).
- Lote "todo lo permitido" (2026-09-22): imagen (`image` part),
  `userInput/answer` (verificado live), approval-mode, skills,
  `ifBusy`, steer/unqueue, shell (`userShell` con capability),
  readOutput, tasks, controles subagente, view/page, fork (rechaza
  `forkBoundaryInvalid` en vacias), compact, usage, voz, share-target.
  `rename` no soportado en Windows (`UnsupportedPlatform`).
3. Siguiente (no incluido): multi-host, adjuntar imagenes (`image` parts),
   skills (`skill/list`), goals, compact, fork/rename en UI, notificaciones
   push, modo offline con cola de prompts.

## 4. Endurecimiento (2026-09-22)

- Fail-closed `META_API_KEY`: el backend no arranca si esta definida; el hijo `muse serve` se lanza con env saneado (sin heredarla). Sin Model API. Una key guardada dentro de la config interna de Muse no la cubre este saneado: requiere verificacion separada (auth del CLI, `model/list` con provider `meta`).
- Limites: `/api/rpc` 5 MiB; parte `image` 4 MiB base64; cliente JPEG 1568 px q0.85 con chequeo previo (413 si excede).
- Estaticos con containment estricto + `decodeURIComponent` invalido -> 400 sin tumbar el servidor.
- CSP y headers (`nosniff`, `SAMEORIGIN`, `same-origin`, `Permissions-Policy`) en API, estaticos y SSE.

## 5. Auditoria de bugs + UI/UX mobile (2026-10-02)

Bugs corregidos:
- Backend: un `EPIPE` al escribir en el stdin de un `muse serve` muerto
  tumbaba todo el proceso (error asincrono sin handler). Ahora se captura.
- SSE: limpieza con `res.on('close')` (en Node moderno `req` puede emitir
  `close` al terminar de leer la peticion) y sin escribir tras desconexion.
- Handler HTTP con `catch` global (500 en vez de rechazo no capturado);
  `HEAD` soportado y `405` con `Allow`.
- Estaticos `cache-control: no-cache` + SW red-primero: la PWA ya no se
  queda con un `app.js` viejo (antes cache-first).
- Cliente: 401 -> vuelve al login (antes un token invalido guardado dejaba
  la lista en error); respuestas no JSON y errores de red con mensaje claro;
  logout ya no deja el watchdog reconectando con token vacio; doble envio
  por doble toque; aperturas de sesion concurrentes (gana la ultima);
  estado de turno/encolado no se arrastra entre sesiones; aprobaciones se
  retiran al decidir (en modo poll no llega `approval/resolved`); estado
  `waiting` correcto con varias pendientes; selects que revierten si el
  servidor rechaza el cambio; watchdog sin bucle SSE<->poll; tema que no
  cambiaba al primer toque con el sistema en oscuro; radios de preguntas
  con nombres unicos; toasts de reconexion sin spam; re-suscripcion tras
  reinicio del host MSP.

UI/UX:
- Topbar compacta (titulo de sesion, estado, conexion) y opciones de la
  sesion en un bottom sheet (`<dialog>` nativo, deslizar para cerrar).
- `prompt/confirm/alert` sustituidos por dialogos accesibles propios.
- Chat: burbujas, markdown ligero y seguro (solo nodos de texto: codigo,
  negrita, enlaces, titulos), bloques de codigo con copiar, herramientas y
  razonamiento plegables, autoscroll que respeta la lectura + boton "ir al
  final" con contador, render por lotes (rAF) para el streaming.
- Composer: textarea auto-ajustable, enviar/Stop/dictado con estados,
  pegar imagenes, borrador por sesion, Enter envia en escritorio.
- Lista: cache local (pestañas/busqueda/ocultar sin red), busqueda,
  skeleton, estados vacios, barras de uso de la suscripcion.
- Navegacion con el gesto/boton atras del sistema (history API).
- Accesibilidad: objetivos >= 44 px, foco visible, patron ARIA de
  pestañas con flechas, live region para respuestas/aprobaciones, contraste
  AA, safe areas, `prefers-reduced-motion` y `forced-colors`.

## 6. Paridad con remotos de referencia (Claude Code / Codex) (2026-10-02)

- Herramientas legibles: `args` JSON -> resumen en una linea (`$ comando`,
  ruta, patron) y diff coloreado con `+N −M` para ediciones/escrituras;
  salidas con formato diff tambien se colorean. Estados traducidos y
  acciones de tarea solo mientras la herramienta sigue viva.
- Indicador "trabajando" con cronometro y ultima actividad (Pensando,
  Usando <tool>, Escribiendo); al terminar, aviso "Trabajó N s"; turnos
  fallidos/detenidos como aviso en la conversacion.
- Notificaciones del sistema (aprobaciones, preguntas, turno terminado o
  fallido) y badge de la app con pendientes. Solo mientras la PWA sigue
  viva en segundo plano: push real con la app cerrada requeriria Web Push
  (VAPID) en el backend.
- Banner persistente de reconexion/sin red en vez de toasts.
- Composer: menu `/` (skills + /compactar, /duplicar, /historial,
  /detener, /shell <cmd>) con teclado y ARIA; chip de modelo/esfuerzo
  siempre visible; chip de mensaje en cola con Desencolar.
- Chat vacio con sugerencias; mensajes largos del usuario plegados;
  listas markdown; teclado de iOS via `visualViewport`.
- Lista: pull-to-refresh y refresco silencioso cada 30 s si el listado
  es rapido; el historial del navegador no apila entradas de chat.

## 7. Push con la app cerrada, imagenes, cola offline y resaltado (2026-10-02)

- **Web Push sin dependencias** (`push.js`): VAPID ES256 (RFC 8292) y
  cifrado aes128gcm (RFC 8291) con `crypto` de Node. Claves en
  `.vapid.json` y suscripciones en `.push-subs.json` (0600, gitignored).
  Endpoints `GET /api/push/key`, `POST /api/push/subscribe|unsubscribe`
  (Bearer). El puente avisa de `approval/request`, `userInput/request`
  (siempre llegan al puente) y `turn/completed` (mientras haya una vista
  suscrita); deduplica por id y purga suscripciones 404/410. Solo acepta
  endpoints https publicos (sin IPs ni nombres locales: anti-SSRF).
  El SW no duplica el aviso si la app esta visible y enfocada; tocarlo
  abre la sesion. Requisitos: HTTPS (Tailscale Serve) y, en iOS 16.4+,
  la PWA instalada en la pantalla de inicio. Remitente VAPID configurable
  con `MUSE_REMOTE_VAPID_SUB` (p. ej. `mailto:tu@correo`).
- **Imagenes en el historial**: partes `image` de los items (formas
  habituales, solo `data:image/*`) y, si el host no las devuelve, una
  miniatura local (320 px, ~40 recientes) del envio propio. Visor a
  pantalla completa.
- **Cola sin conexion**: un envio que falla por red (o 503 del host) se
  guarda en el dispositivo, se muestra como "Pendiente" y se reenvia al
  reconectar (evento `online`, SSE suscrito, apertura de la sesion, poll).
  El `commandId` se fija en el primer intento para que MSP deduplique.
  Las imagenes no se encolan (tamaño).
- **Resaltado de sintaxis** ligero sin dependencias (JS/TS, Python, Go,
  Rust, shell, SQL, familia C, YAML/TOML) con paleta clara/oscura.

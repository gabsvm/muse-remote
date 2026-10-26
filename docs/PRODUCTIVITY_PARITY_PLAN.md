# Muse Remote — paridad operacional y entregas progresivas

Corte de trabajo: 2026-10-25. Objetivo: acercar la experiencia remota Android/PWA a las funciones expuestas por Muse Code 1.4.13; no emular ni ejecutar herramientas de Codex/Claude.

## Primer bloque implementado en la rama feat/native-productivity-parity

| Función | Implementación | Límite honesto |
|---|---|---|
| Borradores por conversación | Android Keystore AES-GCM; guardado con debounce y al salir | Solo texto del composer, local a esta instalación; adjuntos binarios no persistidos |
| Cola de envíos | Visualización de `session/read.queuedInputs`, IDs propios extraídos de `turn/start`, cancelación selectiva `turn/unqueue` | **No cancelar** filas remotas que no traen ID. Rechazos al competir con lanzamiento no se presentan como éxito |
| Tareas activas | `task/list`, `task/stop` confirmado sobre tarea background individual | Lista puntual; no daemon de seguimiento ni botón para detener todas |
| Visor de parches | `patchRef` y `patchSummary` desde transcript/eventos, `item/readOutput` con límite de lectura | V1 inspección de cuerpo estructurado; todavía sin diffs renderizados por archivo/hunk |
| Skills ejecutables | `skill/list` por sesión; `turn/start` tipo `skill` con selector validado y argumentos | El envío es **una llamada de inferencia cuando el usuario confirma**; nunca se invoca al cargar la interfaz |
| Consulta Git/worktrees | `worktree/list` solo lectura, sin shell | Operación experimental/capability-gated; el host puede rechazarla |
| Buscar en chat | Filtrado instantáneo de mensajes y actividad ya cargados | No indexa todas las sesiones remotas |
| Centro de trabajo | Modal ampliado con pestañas Cola, Tareas, Cambios, Skills y Git | El diálogo de herramientas de sesión anterior sigue existiendo |

Seguridad: el gateway solo usa endpoints MSP permitidos explícitamente en el puente; `task/list` y `worktree/list` fueron añadidos como **métodos read-only**. Ninguna prueba llama modelos o servicios de suscripción. Las funciones que pueden consumir cuota requieren una interacción y confirmación del usuario.

## Segunda etapa (todavía NO implementada)

1. **Diff renderizado de primera clase**: decodificar y validar documento `tool_patch`, agrupar archivos/hunks, colorear líneas, copy/compartir, carga paginada.
2. **Sincronización cifrada entre dispositivos**: modelo de ownership por identidad de dispositivo, backups de metadatos con cifrado end-to-end, control de conflictos y revocación; no guardar borradores de código en texto plano.
3. **Notificaciones Android**: permisos `POST_NOTIFICATIONS`, canales de aprobaciones y finalización, reconexión respetuosa con Doze, foreground service solo si hay una necesidad explícita, sin conexión permanente abusiva.
4. **Búsqueda global**: índice local por sesión con ingestión paginada, opt-in para incluir contenido, presupuesto estricto de CPU/disco y exclusión de secretos.
5. **Subagentes**: vista de `subagent` por ID, estado y resultados; acciones tipadas de seguimiento y cancelación con confirmación.
6. **Worktrees mutables**: creación/checkout/remoción detrás de permisos restrictivos y confirmación, respetando límites de sandbox/trust del host, nunca `git` arbitrario por RPC.
7. **Optimización del historial**: tamaño límite de batches en Compose, lazy snapshot restore y lectura incremental, métricas de scroll y RAM; pruebas de dispositivos de gama media.
8. **Accesibilidad y navegación**: estados accesibles, pruebas TalkBack, mejor separación entre permisos, uso y productividad.

## Control de release

- Publicar QA solo tras CI en verde y firma estable verificada (`apksigner`).
- No reiniciar el puente durante compilaciones/pruebas; aplicar cambios de servidor separadamente con respaldo y health check.
- Mantener `.token`, `.lan.*`, `.vapid.json`, los proyectos/pines y la clave QA sin cambios.
- Pruebas físicas y permisos reales de dispositivo siguen pendientes hasta que el usuario use la nueva beta.

## Segundo bloque: interfaz de revisión y subagentes (beta.8)

- **Parches por archivo y líneas**: nuevo parser acotado para unified diff y representación JSON \`{files:[{path,hunks:[{lines:[...]}]}]}\`. Lista de archivos con recuentos de adiciones/eliminaciones y lectura coloreada con selección de texto. Los parches de formato desconocido **se muestran en bruto**, sin inventar hunks.
- **Subagentes**: se extraen únicamente ítems \`kind=subagent\` con \`subagentId\` explícito, incluyendo nombre, estado y resultado. Sexta pestaña de Centro de trabajo: **Agentes**. \`subagent/sendMessage\`, \`subagent/followupTask\` y \`subagent/stop\` dirigidos al ID opaco confirmado, con confirmación y advertencia sobre posible consumo de cuota.
- **Historial compactado**: \`history.snapshot.state.items\` ahora se trata igual que \`history.items\` para el historial y la recuperación de metadatos. Las revisiones nuevas de parches/subagentes sustituyen a las antiguas por ID; las notificaciones \`item/started\`, \`item/updated\` y \`item/completed\` se incorporan.
- No requiere actualizar el backend beta.7: ya estaban autorizados los RPC de subagentes y \`item/readOutput\`.
- La búsqueda global indexada, sincronización, notificaciones Android/Doze, worktrees editables y pruebas en dispositivo físico siguen pendientes.
- Toda ejecución potencial de un modelo requiere interacción explícita en la app. Los tests son MockEngine y parser puro; no llaman a suscripciones.

## Beta 0.2.0-beta.9 — Branding y avisos nativos

- Se reemplazó el launcher genérico por el icono aprobado Muse Remote: símbolo M verde/cian con señal, formato normal y `adaptive-icon` (incluye monocromo para launchers con iconos temáticos).
- Se añadió marca coherente a la pantalla de conexión y encabezado Android, así como PWA: favicon, manifest instalable, iconos maskable/apple-touch y caché `muse-remote-v24`. Las imágenes no contienen archivos de fuentes.
- **Avisos Android de actividad (primera fase)**: opción desactivada por defecto en **Tus sesiones**, activación expresa y permiso `POST_NOTIFICATIONS` en Android 13+. Canales para solicitudes de aprobación nuevas y turnos completados, sin mostrar contenido privado del prompt.
- Los avisos se entregan **solo cuando la aplicación queda en segundo plano pero su proceso sigue activo y conectado**. No hay servicio persistente, WebSocket adicional, FCM, arranque al encender ni notificaciones garantizadas después de que Android cierre el proceso.
- Un tracker independiente evita alertas duplicadas de snapshots antiguos, evita avisar por cambiar de sesión y no confunde un turno en pausa por aprobación con uno finalizado. Cuatro pruebas unitarias.
- El puente beta.7 no necesita una migración de autenticación para usar la APK; para actualizar el branding de la PWA se debe actualizar el paquete web y su service worker. No cambian `.token`, certificados TLS ni los nombres/proyectos/pines locales de Android.

### Pendientes, sin afirmar paridad completa

- Notificaciones en segundo plano tras finalizar el proceso Android: requiere elección explícita de arquitectura de entrega (por ejemplo, infraestructura push, credenciales/revocación por dispositivo y límites de privacidad/Doze).
- Sincronización cifrada entre dispositivos: esquema de metadatos y política de conflictos E2EE.
- Búsqueda global por contenido: índice seguro opt-in, procesamiento incremental y cuota de almacenamiento.
- Worktrees Git con operaciones controladas, accesibilidad TalkBack y rendimiento Android instrumentado.

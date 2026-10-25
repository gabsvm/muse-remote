# Paridad remota — auditoría 2026-10-25

Comparación de experiencia con Codex Remote (control de sesiones, side chats, permisos, uso y revisión) y Claude Code Remote (reanudar/controlar CLI desde móvil). La paridad depende de lo que ofrece el **Muse Code CLI**. No significa que Muse Remote pueda controlar Codex ni Claude, ni que incluya sus suscripciones.

## Disponible en Muse Remote Android 0.2.0-beta.4

| Capacidad | Estado | Aclaración |
| --- | --- | --- |
| Emparejamiento TLS y acceso por Tailscale | Implementado | El servidor PC y su CLI deben seguir activos |
| Retomar conversaciones e historial | Implementado | Sesiones abiertas en Terminal pueden estar en solo lectura |
| Modelo, razonamiento | Implementado | MSP `model/list`, `session/setModel`, `session/setReasoningEffort` |
| Permisos y preguntas | Implementado | Aprobar/rechazar y responder a preguntas pendientes |
| Adjuntar imagen y documentos | Implementado | Una adjunción por mensaje desde Android |
| Proyectos y chats fijados | Implementado, **local** | No se sincronizan entre dispositivos ni con la PWA |
| Modo Contributor | Implementado (host >= beta.3) | Preferencia **global de PC**; requiere reiniciar el servidor para aplicarse |
| Redirigir turno activo | **Nuevo** | `turn/steer` con `expectedTurnId`; solo texto, requiere un ID observado |
| Enviar a la cola | Implementado | `turn/start ifBusy=queue`; **cancelar un elemento concreto de la cola no está disponible en UI** |
| Crear rama de conversación | **Nuevo** | `session/fork` sobre turnos completados; conserva la sesión fuente y el proyecto local |
| Compactación de contexto | **Nuevo** | `session/compact`: el ACK solo significa que fue **admitida**, no que terminó |
| Política de aprobación | **Nuevo** | Selección de modos oficiales; `allowAll` exige confirmación explícita |
| Ver consumo de la suscripción | **Nuevo** | `usage/read`, lectura **cacheada/observada**, no actualización en vivo |
| Catálogo de skills del host | **Nuevo** | `skill/list`, **solo lectura**; no implica ejecución o soporte de todas las skills |
| Agrupar actividad de herramientas | Implementado | Actividad colapsada y detalle a petición |
| Notificaciones | Parcial | PWA push; verificar paridad nativa en segundo plano |
| Reconexión SSE con polling | Implementado con limitaciones | Falta matriz exhaustiva Wi-Fi / celular / suspensión |

## Brechas reales para próximas versiones

1. **Revisión nativa de código**: diffs por archivo, imágenes/snapshots, resultados de tests y comentarios inline, con manejo correcto de archivos grandes. MSP no garantiza un diff estructurado como Codex Remote.
2. **Worktrees y Git**: crear/cambiar ramas aisladas desde la app, y múltiples entornos/hosts. Requiere definir límites de seguridad y un protocolo host adicional; no es correcto simular `git` sin pedir acceso.
3. **Sincronización de proyectos, pines y borradores entre dispositivos**: requiere backend privado autenticado y control de conflictos; por ahora son datos locales Android.
4. **Cola avanzada**: ver/cancelar un envío concreto (`turn/unqueue` con `turnId`) y navegar prioridades, con feedback correcto al usuario.
5. **Skills interactivos y plugins**: invocar skills como un `TurnInputPart` tipado, mostrar parámetros y resultados, no solo una lista de nombres.
6. **Notificaciones nativas + Live Updates**: seguimiento en Android moderno con permisos y comportamiento en Doze/batería optimizada.
7. **Seguridad de producto**: credenciales por dispositivo, revocación individual, auditoría de conexiones y evaluación de amenazas del puente.
8. **Calidad de vida**: borradores cifrados por sesión, búsqueda de contenido entre conversaciones, accesibilidad, copy/share, previsualización de diffs y resultados.

## Validación y límites

- Se incluyen pruebas MSP con `MockEngine` para que CI **no invoque modelos ni consuma cuotas**.
- La compatibilidad corresponde al esquema MSP exportado del CLI local **Muse Code 1.4.13**, no a versiones arbitrarias.
- La interacción táctil en Android, las sesiones reales y las transiciones de red requieren todavía una prueba en dispositivo físico con decisión del usuario sobre cuándo ejecutar modelos.
- El APK QA debug firmado es para pruebas; no una versión Play Store ni una garantía de paridad completa.

Fuentes de comparación: [Codex Remote](https://developers.openai.com/blog/mastering-codex-remote-for-engineering), [Codex mobile](https://learn.chatgpt.com/docs/mobile), [Claude Code Remote Control](https://support.claude.com/en/articles/14554000-claude-code-power-user-tips).

# Muse Remote — Kotlin Multiplatform

Migración **incremental**: la PWA y el backend Node.js/MSP permanecen funcionales;
el backend suma un listener HTTPS opcional para LAN (sin modificar el puerto loopback).
La aplicación Compose habla con los endpoints existentes del backend, nunca directamente con la Model API.

## Estructura

- `shared/` — protocolo, cliente Ktor (RPC + SSE), modelos, controlador y UI Compose Material 3; objetivos Android, Desktop JVM e iOS (biblioteca preparada).
- `androidApp/` — APK con Activity nativa, red HTTPS y token cifrado con Android Keystore (AES-GCM).
- `desktopApp/` — cliente Compose Desktop para Windows/Linux/macOS (credenciales solo en memoria).

`com.android.kotlin.multiplatform.library` y un módulo `com.android.application` separado: arquitectura compatible con AGP 9.

## Conexión sin Cloudflare

Consulta [**LAN.md**](LAN.md): configuración segura de Windows, QR,
detección automática y Tailscale como respaldo.

## APK actualizable y firma estable

Consulta [QA_SIGNING.md](QA_SIGNING.md) para configurar una sola clave
privada de QA mediante GitHub Secrets. GitHub Actions **no publica** nuevos
APK firmados con la clave aleatoria del runner.

## Primer arranque Android

Requisitos: Android Studio reciente con SDK 36, JDK 21, Gradle 9.3+.
En la carpeta `native`:

```powershell
.\gradlew.bat :androidApp:assembleDebug
```

Puedes ejecutar también `androidApp` desde Android Studio. El APK se genera en `androidApp/build/outputs/apk/debug/`.

1. Configura el servidor LAN HTTPS opcional y el QR según [LAN.md](LAN.md), o utiliza Tailscale Serve con HTTPS estable.
2. En el teléfono asegúrate de que el servidor es accesible (Tailscale conectado si procede).
3. Abre Muse Remote, pega URL HTTPS + token local. El token se cifra antes de persistirse en Android.
4. Abre o crea una sesión; el texto, streaming, estados y aprobaciones usan el backend preexistente.

**Importante:** el APK admite LAN HTTPS con certificado fijado por QR o HTTPS de Tailscale Serve. Cloudflare Access con login interactivo no está integrado. Nunca expongas el puerto LAN al Internet público.

## Selector de modelo y razonamiento (beta 0.2.0-beta.2)

En una conversación **reanudada y editable**, bajo el título aparecen dos controles:
**Modelo** y **Razonamiento**. El catálogo de modelos se obtiene del mismo
`model/list` MSP que utiliza la PWA; no se inventa la disponibilidad de una
suscripción. El modelo activo se identifica por la respuesta del servidor.

El ajuste se realiza **por sesión**, con `session/setModel` y
`session/setReasoningEffort`, y requiere confirmación del backend. Si Muse
rechaza el cambio, la app conserva el último valor confirmado y muestra
un error. Los selectores se bloquean durante un turno activo, durante
sincronización de catálogo o mientras se guarda un cambio.

Los niveles que ofrece el cliente coinciden con la PWA (none, minimal,
low, medium, high, xhigh, max, ultra), pero cada modelo puede aceptar
solo un subconjunto. El servidor decide qué niveles son compatibles.
Cuando el estado actual no se recibe de MSP se muestra **Sin confirmar**,
nunca un nivel inventado. Al cambiar de modelo se vuelve a indicar
**Sin confirmar** hasta que el usuario elige un esfuerzo nuevo.

La APK no consulta Model API ni lanza peticiones de inferencia al mostrar
el catálogo. El control solo funciona si la sesión está disponible para
Muse Remote; una sesión abierta simultáneamente en Terminal sigue en
modo lectura.

## Desktop

```powershell
.\gradlew.bat :desktopApp:run
```

Las credenciales Desktop se mantienen solo en memoria por ahora. El escritorio puede conectar a `http://127.0.0.1:8787`, Android exige HTTPS.

## Calidad y alcance actual

> **Nota 2026-10-22:** las listas de características pendientes en esta sección documentan la primera versión Kotlin; posteriormente se añadieron recuperación de sesiones, agrupación de herramientas y adjuntos, descritos al final de este mismo archivo. Para comparar con la PWA, consultar [compatibilidad](../docs/COMPATIBILITY.md).

Esta es la **primera vertical funcional**, no la migración completa ni una versión de producción. Incluye acceso, listado paginado, recuperación inmediata de sesión reciente, nueva sesión, historial, envío de texto, estado de turno, interrupción, recepción SSE y sincronización de respaldo, aprobaciones y una pregunta de entrada simple. Las miniaturas, adjuntos, múltiples preguntas, diffs avanzados, prompts offline persistentes, cambio de modelo/effort, subagentes, configuración de notificaciones, QR de emparejamiento y distribución de iOS permanecen pendientes. No se han eliminado de la PWA.

### Tareas de cierre antes de producción

- CI verde para Android + Desktop + pruebas Kotlin (no asumir sin ejecutarlo).
- Verificación en dispositivo físico (rotación, redes móviles, suspensión, reanudación, teclado IME).
- Migrar a un flujo de eventos y cache robusto bajo reconexiones prolongadas; deduplicación por commandId con confirmación de entrega.
- Añadir vistas y acciones de todas las capacidades MSP relevantes, accesibilidad y localización.
- Autenticación avanzada para túnel Cloudflare (Access web login) y emparejamiento QR con revocación de dispositivos.
- Android push nativo y Live Updates solo en casos compatibles con las políticas del sistema.
- Añadir entry point iOS mediante Xcode en macOS; la biblioteca ya declara objetivos iOS.

No publicar este APK como versión final hasta cerrar estas pruebas.

## Sesiones antiguas y organización local

Al tocar una conversación, la app abre su pantalla inmediatamente y muestra
el progreso de `session/resume`. Las conversaciones grandes pueden tardar.
Si Muse rechaza la reanudación, la app intenta mostrar el historial mediante
`session/read`, con envío de mensajes deshabilitado y botón **Reintentar**.

En el menú ⋮ de cada sesión se puede **Ocultar en este dispositivo** y desde
la pestaña **Ocultas** restaurar la sesión. Es una función reversible local,
NO elimina ningún dato en Muse. La versión MSP actual no expone
`session/delete`, por lo que no se ofrece un botón que simule borrado real.

## Conversación limpia y actividad técnica

El historial MSP se conserva completo en el controlador. La UI presenta
mensajes reales del usuario y Muse en orden, descarta únicamente burbujas
vacías o marcadores de texto de suspensión (`...`/`…`) y agrupa
herramientas, razonamientos y otros eventos técnicos en **una actividad
contraíble por turno de usuario**, aunque estén intercalados con mensajes
de progreso del asistente.

Cada actividad permanece contraída por defecto, muestra cantidad de pasos y
errores, y permite inspeccionar todos los pasos por lotes de 16, con detalles
individuales opcionales. Los mensajes intermedios, comandos y resultados
originales no se eliminan del estado MSP ni se modifican en el backend.

El scroll al último mensaje utiliza el número de bloques visuales, no el
número de llamadas a herramientas sin agrupar. Si el usuario se desplaza
hacia arriba, se mantiene su posición y aparece «Último mensaje».

Las pruebas compartidas validan 50 herramientas en un único bloque, mensajes
intercalados, supresión de globos vacíos, separación por turnos y claves
estables durante streaming. Falta validación visual manual en Android.

## Adjuntar imágenes y documentos en Android

El botón **+** del compositor nativo abre el selector de fotos/imágenes o
el selector de archivos de Android. Solo se adjunta un elemento a la vez
en esta versión inicial.

- **Imagen:** Android decodifica, reduce a máximo 1568 px por lado,
  aplana transparencia sobre blanco y comprime a JPEG de forma local.
  `turn/start.input` incluye una parte MSP `image` con base64 y dimensiones
  reales. Límite del puente: 4 MiB base64. Se muestra miniatura previa.
- **Archivo** (PDF, código, ZIP, documentos y otros): Android lee como
  máximo 10 MiB, autentica una transferencia binaria `POST /api/upload`
  al puente Node en la PC y obtiene una ruta **local**. Muse recibe una
  referencia textual a esa ruta en `turn/start`. El MSP actual NO tiene
  un tipo de entrada general `file`: la capacidad real de abrir/interpretar
  cada formato depende de las herramientas disponibles de Muse en Windows.
- El servidor guarda los archivos en `.muse-uploads` (ignorado por Git y
  fuera de `public`), con nombre sanitizado, identificador aleatorio y
  límites por archivo (10 MiB) y bandeja (256 MiB). No permite rutas
  arbitrarias ni hace públicos los archivos. Su limpieza se realiza
  manualmente cuando ya no se necesiten.
- El mensaje y el adjunto permanecen en el compositor si falla la
  transferencia o si no se confirma el envío.
- Solo disponible para sesiones reanudadas por el cliente nativo. Una
  sesión abierta en Terminal sigue en modo lectura y no acepta envíos
  simultáneos; ciérrala allí y reintenta su reanudación.

**Necesario:** actualizar y reiniciar también `node server.js` en la PC
para habilitar `/api/upload`. Las fotos mediante MSP no necesitan el
endpoint nuevo.

### Enlaces con la sesión abierta en Terminal

El error MSP `session is already in use` significa que Terminal posee la
sesión. La app recupera el historial mediante `session/read`, etiqueta
la sesión como **Abierta en Terminal** y mantiene el compositor bloqueado,
sin lanzar un diálogo alarmante. Al liberar la sesión en Terminal puedes
pulsar **Reintentar conexión** en Android. No se fuerza un takeover.

## Proyectos, chats fijados y Contributor (0.2.0-beta.3)

- En **Tus sesiones**, tocá **+ Proyecto** para crear una colección con nombre y carpeta de trabajo opcional de la PC.
- Tocá el proyecto para filtrar sus conversaciones. El menú de cada chat permite **Fijar arriba**, **Desfijar**, **Mover a proyecto**, **Ocultar** o restaurar.
- Los chats fijados se ordenan primero. **Administrar** permite editar el nombre/carpeta y quitar la agrupación. Quitar un proyecto **nunca elimina las sesiones de Muse**.
- Al crear una conversación desde la lista, elegí su proyecto; si no introducís otra carpeta, utiliza la carpeta predeterminada de ese proyecto en la PC.
- **Importante:** esta primera versión del organizador se guarda en preferencias locales privadas de **esta instalación Android**. No sincroniza con la PWA ni otros teléfonos. La carpeta del proyecto controla **únicamente las sesiones nuevas**, no mueve archivos ni cambia el workspace de sesiones previas. Desinstalar la app borra esta organización local.
- El icono de ajustes de la lista abre el estado **Contributor** guardado en Muse Code de esa PC. **No es un ajuste por chat ni por modelo.** Activarlo requiere consentimiento explícito porque Meta podrá utilizar contenido de conversaciones, código y archivos para entrenamiento. Ver [documentación oficial](https://dev.meta.ai/docs/muse-code/subscriptions).
- Para cambiar Contributor desde la APK, el servidor Windows debe tener la versión 0.2.0-beta.3 o superior. Se guarda en el archivo de preferencias real del CLI y se muestra la necesidad de **reiniciar Muse Remote en la PC**; el proceso existente puede mantener el estado previo. La configuración con overrides de entorno o cuentas gestionadas puede bloquear el cambio.
- Si solo actualizás Android, los proyectos y pines funcionan, pero el panel Contributor indicará que el servidor de tu PC necesita actualización.

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

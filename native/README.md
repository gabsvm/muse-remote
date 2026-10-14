# Muse Remote — Kotlin Multiplatform

Migración **incremental**: la PWA y el backend Node.js/MSP permanecen sin cambios.
La aplicación Compose habla con los endpoints existentes del backend, nunca directamente con la Model API.

## Estructura

- `shared/` — protocolo, cliente Ktor (RPC + SSE), modelos, controlador y UI Compose Material 3; objetivos Android, Desktop JVM e iOS (biblioteca preparada).
- `androidApp/` — APK con Activity nativa, red HTTPS y token cifrado con Android Keystore (AES-GCM).
- `desktopApp/` — cliente Compose Desktop para Windows/Linux/macOS (credenciales solo en memoria).

`com.android.kotlin.multiplatform.library` y un módulo `com.android.application` separado: arquitectura compatible con AGP 9.

## Primer arranque Android

Requisitos: Android Studio reciente con SDK 37, JDK 21, Gradle 9.3+.
En la carpeta `native`:

```powershell
.\gradlew.bat :androidApp:assembleDebug
```

Puedes ejecutar también `androidApp` desde Android Studio. El APK se genera en `androidApp/build/outputs/apk/debug/`.

1. En tu PC ejecuta el backend de la raíz: `npm run tunnel -- --name muse --hostname muse.tudominio.com` y protege esa URL mediante Cloudflare Access; **o, recomendado para esta primera versión**, utiliza Tailscale Serve con HTTPS estable.
2. En el teléfono asegúrate de que el servidor es accesible (Tailscale conectado si procede).
3. Abre Muse Remote, pega URL HTTPS + token local. El token se cifra antes de persistirse en Android.
4. Abre o crea una sesión; el texto, streaming, estados y aprobaciones usan el backend preexistente.

**Importante:** un login interactivo de Cloudflare Access que redirija a un formulario web todavía no está integrado en el cliente Ktor; para la primera validación usar Tailscale HTTPS evita ese obstáculo. El backend no debe exponerse sin seguridad adicional.

## Desktop

```powershell
.\gradlew.bat :desktopApp:run
```

Las credenciales Desktop se mantienen solo en memoria por ahora. El escritorio puede conectar a `http://127.0.0.1:8787`, Android exige HTTPS.

## Calidad y alcance actual

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

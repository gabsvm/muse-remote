# Muse Remote beta.11 — sincronización E2EE de organización

La beta.11 habilita **transferencia cifrada y manual** de la organización entre la PWA y Android, siempre que los dos clientes estén conectados al **mismo puente Muse Remote actualizado**.

## Datos compartidos
Solo se incluyen los metadatos:
- Proyectos: identificador, nombre y carpeta de trabajo.
- Asignaciones de sesiones a proyectos.
- Nombres locales personalizados de las sesiones.
- Chats fijados.

**No se incluyen** tokens de acceso, archivos adjuntos, mensajes del historial, prompts, cuotas, modelos, preferencias de Contributor, contraseñas, borradores ni certificados TLS. Los chats ocultos siguen siendo locales.

## Funcionamiento

1. En Android, abrir **Tus sesiones > Sincronización cifrada · proyectos y chats**. En la PWA, abrir **Proyectos y sincronización**.
2. Elegir una **frase de cifrado de 12–128 caracteres ASCII** (preferentemente única y aleatoria) y guardarla en un gestor de contraseñas. La frase nunca se envía al servidor ni se guarda en la app.
3. En el dispositivo con organización más actual, introducir y repetir la frase, tocar **Subir copia cifrada** y confirmar. Los metadatos se cifran localmente (PBKDF2-HMAC-SHA256, 310.000 iteraciones; AES-256-GCM, salt de 16 bytes, IV de 12 bytes y AAD Muse Remote v1).
4. En el otro dispositivo, introducir la **misma frase**, elegir **Previsualizar copia** y revisar los conteos. La importación no sucede hasta **Confirmar importación y combinar**.
5. Por defecto los valores locales prevalecen en conflictos y se incorporan proyectos, alias, asignaciones y fijados nuevos. Se puede optar por preferir los valores remotos; jamás se borran elementos locales que solo existan localmente.
6. Para transferir actualizaciones en dirección inversa, publicar manualmente una nueva copia y repetir el proceso de previsualización/importación. **No hay sincronización automática en segundo plano**.

El puente solo guarda un documento JSON con una *envoltura cifrada* y número de revisión; **no puede descifrarlo** sin conocer la frase. `GET /api/organizer-sync` y `PUT /api/organizer-sync` requieren el token Bearer. Los PUT usan revisión esperada (*compare-and-swap*, HTTP 409 ante cambios concurrentes) y el archivo se reemplaza de forma atómica. Un archivo cifrado corrupto genera error, no borra la organización.

## Seguridad y limitaciones

- La protección E2EE se aplica a **la copia en tránsito y almacenada por el puente**. Los metadatos originales locales siguen el almacenamiento existente de cada cliente; en PWA se guardan en el almacenamiento del navegador y en Android se conservan en las preferencias del sistema (los borradores y tokens conservan su protección previa).
- HTTPS/Tailscale es obligatorio para accesos remotos. WebCrypto también exige contexto seguro.
- Una persona con acceso al token y a las funciones de sincronización podría reemplazar el blob cifrado, pero no descifrar una copia existente sin la frase. Utilizar una frase fuerte; el cifrado no impide ataques de rollback realizados directamente sobre el archivo de backup.
- El único archivo de copia del puente se guarda en `.organizer-sync.v1.json`, **fuera de public/** y excluido de Git/paquetes. Respaldarlo antes de reinstalar o limpiar la carpeta del servidor Windows.
- Publicar una nueva copia reemplaza la anterior: la aplicación lo solicita expresamente. La revisión evita sobreescrituras *concurrentes* pero no sustituye un historial de versiones.
- Los nombres en PWA son locales a ese navegador hasta que el usuario publique/importe. La ruta de sesiones MSP no se renombra: la UI utiliza alias locales.
- No hay sincronización de borradores; se excluyeron deliberadamente por su mayor sensibilidad.
- La interoperabilidad WebCrypto ↔ Java JCE se comprobó con una prueba de descifrado AES-GCM real. Android/desktop compilan; falta la validación manual de ida/vuelta en dos dispositivos físicos.

## Próximos bloques
- Historial de versiones cifradas y recuperación/reversión.
- Sincronización incremental y resolución visual por campo con registro de conflictos, preservando el consentimiento.
- Búsqueda de contenido exhaustiva paginada o índice local cifrado opt-in.
- Notificaciones fiables bajo Doze/Android 17 sin mantener servicios innecesarios.
- Accesibilidad TalkBack, emuladores de gama media, rendimiento de historial largo.

## Pruebas
- 96 tests Node/PWA/seguridad; 4 nuevas pruebas de E2EE/HTTP, 3 nuevas de organización local y 4 nuevas de merge/validación Kotlin.
- Android y Desktop Kotlin compilados; verificación de E2EE Java/WebCrypto completada.
- La APK se firma exclusivamente con la clave QA de GitHub al integrar `main`; nunca instalar el debug local encima de otra beta QA.

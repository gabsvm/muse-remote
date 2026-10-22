# Muse Remote — instalar y empezar

Muse Remote es un proyecto **independiente y no oficial**. Necesitás instalar y autenticar **Muse Code CLI por separado**. El cliente no incluye una suscripción ni acceso a modelos.

## Windows y PWA

1. Instalá [Node.js 22 o superior](https://nodejs.org/) y el [Muse Code CLI oficial](https://dev.meta.ai/docs/muse-code). Autenticá el CLI localmente.
2. Descargá el ZIP beta de Windows desde los artefactos verificados de GitHub Actions (si está publicado) o cloná el repositorio. Extraé los archivos en una carpeta tuya.
3. Ejecutá `scripts/windows/01_Instalar.cmd` con doble clic. Instala las dependencias y ejecuta pruebas **sin consumir modelos ni suscripciones**.
4. Abrí `scripts/windows/02_Iniciar_PWA.cmd` y entrá a http://127.0.0.1:8787/ **desde la PC**.
5. Si te lo solicita, ingresá el token mostrado en la terminal **local**. Es una credencial sensible, no publiques capturas con ella.
6. Para revisar el sistema, abrí `scripts/windows/03_Diagnostico.cmd`; nunca imprime tokens.

El ZIP es un **paquete portable con asistente de instalación**, no un instalador MSI. Requiere Node y Muse Code CLI separados; la primera instalación de dependencias necesita internet.

## Android y conexión segura

Seguí [la guía de LAN HTTPS y Tailscale](../native/LAN.md). Para la LAN, emparejá mediante el QR de la PC y comprobá la huella TLS; para fuera de casa preferí Tailscale Serve. No abras los puertos 8787/8788 hacia internet.

Las APK firmadas para QA deben salir de un workflow confiable. La publicación `v0.1.0-pre.1` **no incluye APK**. La aplicación nativa todavía es beta y no tiene todas las funciones de la PWA.

## Preguntas frecuentes

- **¿Por qué aparece 401?** El token no coincide con el del servidor. Comprobá la terminal local; no lo envíes por chat.
- **¿Por qué no puedo escribir en una sesión de Terminal?** MSP no permite dos dueños simultáneos; cerrá esa sesión en Terminal y reintentá.
- **¿Por qué falla un Quick Tunnel?** Cloudflare no admite SSE en Quick Tunnels; usá LAN HTTPS o Tailscale.
- **¿Se necesita pagar una API?** Este puente no llama a la Model API: utiliza tu CLI autenticado; los límites de la suscripción original siguen aplicando.
- **¿Y si pierdo el teléfono?** Revocá primero el acceso a tu red privada, luego rotá el token de todos los dispositivos según [SECURITY.md](../SECURITY.md).
- **¿Cómo diagnostico?** Ejecutá `03_Diagnostico.cmd`; no necesitás publicar logs con datos privados.

Más detalles: [compatibilidad](COMPATIBILITY.md), [seguridad](../SECURITY.md), [proyecto](../README.md).
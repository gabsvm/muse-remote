# Muse Remote beta.10 — búsqueda global bajo demanda

La búsqueda de contenido funciona como primera implementación en PWA y Android. Es una búsqueda acotada, bajo demanda, sin índice persistente ni llamadas a modelos.

## Uso
- Android: Tus sesiones > Buscar dentro de conversaciones > introducir al menos 3 caracteres > Buscar.
- PWA: Sesiones > Buscar en mensajes > consulta > Buscar.
- En ambos clientes se pueden incluir expresamente conversaciones ocultas y cancelar la operación. Tocar una coincidencia abre su conversación.
- Se informa el número de sesiones leídas y las fallas. No encontrar una coincidencia no prueba su ausencia: el protocolo MSP puede devolver únicamente el historial disponible en esa lectura.

## Límites y privacidad
- Android: 20 sesiones recientes como máximo, lectura secuencial y timeout de 8 segundos por sesión.
- PWA: 30 sesiones como máximo; hasta 2 peticiones concurrentes.
- Cinco fragmentos por conversación y 80 en total, con extractos de hasta 220 caracteres.
- Solo se analiza el texto de mensajes de usuario y asistente; se excluyen razonamientos, entradas y salidas de herramientas y adjuntos. Se omiten textos mayores de 250.000 caracteres.
- Los resultados se conservan únicamente en memoria y desaparecen al cerrar la búsqueda. No se utiliza IndexedDB, localStorage, índice en disco ni servicios externos.
- Solo lectura autenticada mediante MSP session/read; nunca session/resume, turn/start ni comandos mutables.
- Android cancela búsquedas al salir del cuadro, desconectarse o abrir otra sesión; identificadores de generación impiden que resultados tardíos sobrescriban búsquedas nuevas.
- La PWA usa service worker v25 y empaqueta global-search.js en el bundle portable Windows.

## Pendiente
Búsqueda exhaustiva con paginación completa cuando el host lo soporte, índice local cifrado opt-in, sincronización E2EE de metadatos entre dispositivos, notificaciones Android después de terminar su proceso y pruebas físicas de rendimiento.

## Requisito de distribución
CI de Node, seguridad, navegador, Android y Desktop debe pasar. Una APK apta para instalar sobre beta.9 requiere firma QA estable. Un APK de PR con firma de depuración no puede presentarse como actualización compatible.

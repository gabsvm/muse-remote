# Firma estable para APK Android QA

## ¿Por qué cambia la firma?

`assembleDebug` utiliza la clave de depuración predeterminada del usuario
que ejecuta Gradle. GitHub Actions crea runners nuevos, con claves distintas.
Android **no puede actualizar una instalación firmada con otra clave**.

## Solución

Genera una única clave **exclusiva de QA** desde tu PC, guárdala en privado
y registra **dos secretos** en GitHub Actions del repositorio. Funcionan también en repositorios públicos, pero nunca deben imprimirse ni incluirse en artefactos:

- `MUSE_QA_KEYSTORE_B64`: contenido PKCS#12 codificado en base64
- `MUSE_QA_STORE_PASSWORD`: contraseña de la clave/almacén

El alias es `museqa`. La contraseña de la clave y del almacén es la misma.

Ejecuta PowerShell con GitHub CLI autenticado (una sola vez):

```powershell
cd C:\Dev\muse-remote
git switch feat/kmp-compose-native
git pull
gh auth status
powershell -ExecutionPolicy Bypass -File .\scripts\setup-android-qa-signing.ps1
```

Para instalar GitHub CLI en Windows si falta: `winget install GitHub.cli`.
Después inicia sesión con `gh auth login` y ejecuta de nuevo el script.

El script:

1. Genera la clave RSA-3072/PKCS12 exclusivamente para QA;
2. la guarda en `$HOME\.muse-remote\muse-qa.p12` (fuera del repositorio);
3. guarda la contraseña protegida por DPAPI en el perfil de Windows;
4. crea los dos secretos en GitHub con `gh secret set` a través de stdin;
5. **nunca imprime** la contraseña, la clave ni su contenido base64.

No borres ni regeneres esa clave. Guarda una copia de seguridad de la
carpeta privada; DPAPI impide recuperar la contraseña cifrada desde otra
cuenta de Windows, por lo que sería imposible reconfigurarla tras perder
el perfil de Windows.

Cuando los secretos estén listos, vuelve a ejecutar el workflow
[Muse Remote KMP](https://github.com/gabsvm/muse-remote/actions/workflows/kmp-native.yml)
en `feat/kmp-compose-native`. Si no aparece «Run workflow», haz un nuevo
push a esa rama (solo un commit vacío basta). Los PR comprueban
compilación sin publicar un APK firmado de manera aleatoria.

**Una última transición será necesaria**: los APK anteriores fueron
firmados con claves desechables y no pueden actualizarse con la nueva.
Desinstala el anterior **una sola vez** antes de instalar la primera APK
`muse-remote-qa-signed`. Desde ahí, cada APK compilada con estos secretos
tendrá la misma firma y conservará el token cifrado y los datos de la app.

### Límites de seguridad

- **Nunca** subas `.p12`, la contraseña ni el contenido base64 a Git,
  issues, pull requests, chats o artefactos públicos.
- Usa esta clave **solo** para `debug` / pruebas: no para publicación en Play.
- Para `release` se necesitará otra clave, con custodia separada.
- El workflow no publicará APK QA si faltan los secretos (fail closed).
- GitHub Secrets protege los valores de los logs estándar; aun así,
  solo deben tener acceso de escritura personas de confianza y los
  workflows de PRs no reciben secretos de forks.

**Repositorio público:** los workflows, sus logs y los APK subidos como artifacts pueden ser visibles a terceros. La clave privada y la contraseña nunca deben salir de GitHub Secrets ni aparecer en logs o paquetes. No habilites firma QA para pull requests externos.

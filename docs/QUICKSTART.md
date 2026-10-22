# Muse Remote — first 10 minutes

Muse Remote is an **unofficial, independent** open-source client for a **separately installed and authenticated Muse Code CLI**. It does not provide a Muse subscription or model access. **Beta / experimental**: do not use on production machines.

## Windows + PWA (recommended first experience)

1. Install [Node.js 22+](https://nodejs.org/), and install and sign in to the [official Muse Code CLI](https://dev.meta.ai/docs/muse-code) **separately**.
2. Download the `muse-remote-windows-beta.zip` artifact from the [GitHub Actions](../.github/workflows/beta-bundle.yml) workflow, if available, or clone this repository. Extract the ZIP to a directory you own. Do not run scripts from unknown copies.
3. Double-click `scripts/windows/01_Instalar.cmd`. This installs pinned dependencies and runs credential-free tests. No coding models are invoked.
4. Double-click `scripts/windows/02_Iniciar_PWA.cmd`. The Node bridge listens only on `127.0.0.1:8787`; open http://127.0.0.1:8787/ on **that PC**.
5. If requested, enter the local token shown in the bridge's **local terminal**. Treat this as a secret. Never post terminal screenshots with the token.
6. Double-click `scripts/windows/03_Diagnostico.cmd` for non-secret diagnostics. This script does not run the Muse CLI or alter firewall/tunnels.

The Windows archive is **a portable source/setup bundle, not an MSI installer**. Node and the official Muse CLI must be installed separately. The first `npm ci` requires internet access.

## Android: choose a private connection

1. Start the PC bridge; see [LAN + Tailscale setup](../native/LAN.md).
2. For home Wi-Fi, set up LAN HTTPS and certificate pinning; install a QA-signed APK **only from an explicitly published beta artifact**. Never pass a QR/pairing token to untrusted people.
3. For access away from home, use [Tailscale Serve](https://tailscale.com/kb/1312/serve) from the PC, and keep the same private tailnet on Android.
4. Open the Android app, pair using the locally generated QR or HTTPS URL + bearer token and fingerprint.

**An APK downloaded from an arbitrary CI run may be unsigned with your QA key or may have a different signing identity.** See [QA signing](../native/QA_SIGNING.md). GitHub release `v0.1.0-pre.1` contains source only.

## Security rules

- A remote client can trigger shell commands and access files through the host account. Use a non-admin account; never expose 8787 or 8788 directly on a public router.
- Prefer Tailscale; keep the LAN listener restricted to your private subnet.
- Stop using a device? Disconnect its network access. To revoke **every** previously paired device, use the explicit local token-rotation procedure in [Security](../SECURITY.md).
- Protected **Cloudflare Quick Tunnels are for experiments only**. They do **not** support SSE; email PIN login also requires an interactive browser, so they are not a stable solution for the native Android client.
- Browser PWA behavior and native Kotlin Android parity differ: read [supported capabilities](../native/README.md) and [compatibility](COMPATIBILITY.md).

## Troubleshooting

| Symptom | Likely cause / action |
| --- | --- |
| Muse CLI not detected | Install official CLI and add it to PATH; the app does not distribute it |
| 401 Unauthorized | Re-enter the bearer token generated on **this** PC; avoid posting it |
| Android certificate mismatch | Stop, verify the PC certificate and re-pair; never blindly accept a new certificate |
| Sessions in Terminal are read-only | Close the session in Terminal, then retry from the mobile app |
| Delayed/absent streaming on Quick Tunnel | Use Tailscale Serve or LAN HTTPS; Quick Tunnels do not support SSE |
| New native APK cannot replace installed one | Signing key changed; see QA signing guide; don't silently wipe app data |
| Lost server access | Run the local diagnostic command; check firewall and private tunnel before changing token |

See [Inicio rápido en español](INICIO_RAPIDO.md).
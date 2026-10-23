# Compatibility and verified scope

Muse Remote is an unofficial companion for a separately installed Muse Code CLI. The upstream MSP protocol may change independently.

| Area | Implemented | Evidence / limitation |
| --- | --- | --- |
| Node bridge | Node 22+, Windows and Linux | Credential-free unit tests and CI |
| PWA | Sessions, tools, approvals, SSE, reconnect and push | Feature coverage differs from Android |
| Android | TLS certificate pinning, Keystore, sessions and attachments | Fresh-device and long-running QA still required |
| Compose Desktop | Basic shared Kotlin client | Desktop credentials are currently memory-only |
| LAN | Opt-in HTTPS | Pair only using a trusted QR / TLS fingerprint |
| Tailscale | Recommended remote path | Private tailnet is managed by the user |
| Cloudflare Quick Tunnel | Experimental | Quick Tunnels do not support SSE |
| Muse Code MSP | Documented observations against CLI 1.3.0 | Other CLI versions not yet certified |

## Validation protocol

1. Record CLI version, OS and public protocol capability names without private session content.
2. Run `npm test` without credentials. Only in a trusted environment run optional `npm run test:integration` using disposable sessions.
3. Check session listing, resumptions, active Terminal ownership, streaming, approvals, attachments and reasoning selection.
4. Validate Android state after backgrounding and network changes.
5. Record each tested version and failures, instead of claiming universal compatibility.

## Known limitations

The CLI can own a session in Terminal, making it read-only in the remote app. Certain MSP features vary by CLI and OS. Android has fewer features than the PWA and supports one attachment at a time. Shared token rotation currently disconnects all devices; device-specific revocation is future work.

See [roadmap](ROADMAP.md) and [security](../SECURITY.md).

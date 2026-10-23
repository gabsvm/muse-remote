# Security policy

Muse Remote bridges an authenticated coding agent to other devices. **Anyone with valid remote access could potentially read sessions, trigger commands and access the host filesystem with the same privileges as the running Muse Code CLI.** Treat this as a remote administration surface, not a harmless chat frontend.

## Report a vulnerability privately

Use GitHub private vulnerability reporting / security advisory flow when available:

https://github.com/gabsvm/muse-remote/security/advisories/new

If private reporting is not available, contact the maintainer privately through their GitHub profile. Do not disclose exploits, tokens, QR codes, transcripts or credentials in a public issue or pull request.

## Safe deployment

- The Node backend listens on 127.0.0.1 by default. Never expose its local HTTP port to the public Internet.
- For LAN, use HTTPS certificate fingerprint pinning, local-subnet firewall restrictions, and a bearer token. Pair only trusted devices.
- For remote connections, prefer Tailscale Serve with a private tailnet, or Cloudflare Access in front of a named tunnel, plus the app token. Do not use public/unprotected tunnels for sensitive projects.
- Keep .token, .lan.pfx, .lan.pass, .lan.fingerprint, .vapid.json, .push-subs.json, .muse-uploads/, signing credentials and Muse CLI authentication private.
- QR codes contain credentials. Never upload screenshots containing them.
- Run as a normal unprivileged user, not as Administrator. Follow least privilege for filesystems and model credentials.
- Do not publish private conversations, uploaded files, or logs. Inspect artifacts before attaching them to issues or releases.
- If a token or certificate private key is exposed, rotate/revoke it, re-pair devices, and investigate.

## Lost device or shared-token revocation

Current beta uses **one bearer token across paired devices**. Individual per-device revocation is not yet implemented.

To invalidate every previous pairing:

1. Disable lost-device access to your private Tailscale network, if applicable.
2. Stop **all** Muse Remote backend instances and confirm the local 8787 service is no longer listening.
3. On the host, run `scripts/windows/04_Revocar_dispositivos.cmd` and type `REVOCAR`, or run `node scripts/security/rotate-token.js --confirm-revoke-all`.
4. The rotation tool refuses to operate while the default loopback service is running, or when `MUSE_REMOTE_TOKEN` overrides the file. It does **not** show the new token.
5. Restart the bridge, securely obtain the new token from the local console, and re-pair trusted devices.

This rotates the bearer credential, not the TLS certificate. If the device had access to the tailnet, revoke the tailnet device separately. Keep backups of pairing TLS material only in trusted private storage.

## Supported versions

Pre-1.0 software: no production-hardening or long-term support guarantee. Fixes target the latest development branch and then default branch when appropriate.

## Scope and upstream

Muse Remote depends on the separate Meta Muse Code CLI and its evolving MSP protocol. Report upstream flaws through Meta's official channels.

This is an unofficial independent community project, not affiliated with, endorsed by or sponsored by Meta.

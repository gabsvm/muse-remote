# Release verification checklist

Muse Remote controls an authenticated coding-agent session on the host. External access requires explicit attention to privacy and authorization.

## Repeatable checks

- [ ] Run `npm ci --ignore-scripts` and `npm test` on Windows and Linux.
- [ ] Confirm Kotlin desktop/shared tests and Android compile in isolated CI.
- [ ] Review CodeQL and dependency-update checks.
- [ ] Verify anonymous health response exposes only readiness, not internal protocol metadata.
- [ ] Verify API authentication and large-upload limit tests.
- [ ] Verify independent processes share a single local token; an invalid token must fail closed.
- [ ] Inspect ZIP contents and manifest for expected code/docs only; exclude local generated runtime files.
- [ ] Inspect Android signing provenance and fingerprint before distributing binaries.

## Human checks before distribution

- [ ] Review public repository history, tags, release assets and Actions output for material that should not be public.
- [ ] Confirm legal redistribution status for third-party components.
- [ ] Test first-run Windows installation in a clean profile.
- [ ] Validate pairing and mismatch handling on a physical Android device.
- [ ] Validate reconnection through LAN/Tailscale and a session already opened in Terminal.
- [ ] Verify user-visible version numbers and update paths, especially the APK signing identity.
- [ ] Check the user's network has no router forwarding of the local backend ports.

The automated checks do not replace physical-device or maintainer review. See [SECURITY.md](../SECURITY.md) and [releasing](RELEASING.md).

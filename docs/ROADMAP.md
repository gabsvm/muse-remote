# Public roadmap

Muse Remote helps people with their own separately installed Muse Code CLI. The features below are milestones, not release date promises.

## 0.2 beta — first-run experience

- [x] MIT, contributor guide, security policy, bug templates.
- [x] Windows, Linux, Node and Kotlin CI.
- [x] Portable Windows setup and diagnostic scripts.
- [x] Safe concurrent token bootstrap and regression tests.
- [x] Explicit local all-device token rotation.
- [x] English and Spanish quickstarts.
- [ ] Publish a QA-signed APK from the trusted manual workflow after verification.
- [ ] Validate installation on a fresh Windows account and physical Android phone.
- [ ] Complete third-party licensing and history checks.

## Next beta — reliability

- [ ] Android background/foreground, rotation, cellular/Wi-Fi and sleep trials.
- [ ] Mocked MSP contract scenarios for delayed streams and reconnect.
- [ ] Per-device authorization and individual revocation.
- [x] Initial browser smoke tests for desktop/mobile login and unauthorized API handling (no live credentials).
- [ ] Full mocked sessions/streaming browser coverage.
- [ ] Improved LAN/Tailscale diagnostics and actionable error messages.

## 1.0 candidate — community

- [ ] Documented cross-client feature parity and accessibility QA.
- [ ] Consistent Spanish/English localization.
- [ ] Public release checksums and stable updates.
- [ ] Independent installation feedback and community-reviewed contributions.

See [CONTRIBUTING.md](../CONTRIBUTING.md), [release steps](RELEASING.md) and [compatibility](COMPATIBILITY.md).

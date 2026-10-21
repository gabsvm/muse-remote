# Open-source release checklist

Status: **public MIT-licensed source preview v0.1.0-pre.1**. Native APK is not claimed production-ready; further verification is required before stable binary releases.

## Remaining checks before stable binary distribution

- [ ] Confirm rights to distribute all code, icons, bundled assets and dependencies. MIT covers only code you own.
- [ ] Inspect all reachable Git history, tags, branches, release assets, PR attachments and Actions logs for credentials, personal data, private endpoints, QR codes and customer content. Rotate any leaked secret.
- [ ] Review GitHub Actions secrets, logs and publicly accessible build artifacts.
- [ ] Confirm no production-only service endpoints or company materials are in source.
- [ ] Verify Node unit suite, optional Muse CLI integration suite, Android/Desktop CI independently. Never run authenticated live tests on untrusted PRs.
- [ ] Test LAN, Tailscale, pairing, authentication failure, upload constraints, reconnect and revocation on a fresh physical device.
- [ ] Decide if v0.x distribution is source-only or a clearly marked QA APK. Do not advertise the current QA APK as production-ready.
- [x] Publish independence notice, repository metadata, issue templates, and enable private vulnerability reporting.
- [x] Merge current Kotlin/Compose branch into main (PR #2).
- [x] Publish pre-release source notes and installation/limitations documentation; confirm MIT license in main.

## First-pass findings (2026-10-21)

- Development branch: feat/kmp-compose-native; the default main does not yet include all Kotlin/native work.
- Generated secrets are ignored and a local targeted scan across 32 reachable commits found no token/private-key signatures or history paths named for secrets. This is not a comprehensive audit.
- Existing live MSP integration tests hard-code an outdated schema fingerprint and can fail against newer CLI versions. They need version-tolerant assertions and should be opt-in.
- External usage or adoption metrics have not been verified. Never invent them for a grant application.

## Codex for OSS

OpenAI considers meaningful use, ecosystem relevance, and demonstrated maintenance. A public repository with a license is necessary but insufficient to establish eligibility. Collect real evidence from releases, issues, PRs, contributors and users.

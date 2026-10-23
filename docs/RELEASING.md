# Beta release process

This project is experimental. Public packaging must match the exact reviewed code and documented limits.

## Source gate

1. Submit a PR based on current `main`.
2. Run `npm ci --ignore-scripts`, `npm test` and `npm run package:windows`.
3. Confirm CI checks on Windows, Linux, Android/Kotlin and dependency/security analysis.
4. Complete [release verification](SECURITY_VERIFICATION.md) and [OSS checklist](OSS_RELEASE_CHECKLIST.md) before making a stable claim.

## Windows beta bundle

`npm run package:windows` generates `dist-packages/muse-remote-windows-beta.zip`. It contains application source, reproducible dependencies, a manifest of SHA-256 file hashes and first-run scripts. It is not a compiled installer: Node 22+ and the official separately authenticated Muse Code CLI are required. The beta-bundle workflow can also generate this artifact.

## Android QA builds

Only trusted manual `workflow_dispatch` runs on `main` can publish a QA-signed APK through the existing Kotlin workflow, using protected GitHub Secrets. Other CI runs validate compilation but must not distribute signing credentials.

A QA-signed APK is not a production app-store build. Verify the signature with `apksigner`, then test installation and update behavior on a physical device. Do not promise an in-place upgrade if signing keys differ.

## Release and rollback

After closing release gates, tag a reviewed commit `v0.2.0-beta.N`. Publish actual tested artifacts, their checksums, supported clients, security warnings and links to [Quickstart](QUICKSTART.md). When a regression is confirmed, document the affected version and correction; users must retain control of their sessions and local files.

Existing `v0.1.0-pre.1` is a source-only preview and does not include a signed APK.

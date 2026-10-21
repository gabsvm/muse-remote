# Contributing to Muse Remote

Muse Remote is an **independent, community-maintained** client for Meta Muse Code.

## Before you start

1. Check existing issues and pull requests to avoid duplicate work.
2. For large changes or protocol changes, open an issue describing the proposed behavior.
3. Keep changes small and include a test where practical.
4. Never share login sessions, pairing QR codes, tokens, certificates, keystores, cloud credentials, identifiers, or live conversation contents.

## Local development

Prerequisites: Node.js 22+ recommended. Install Meta Muse Code CLI separately and authenticate only if you want to run *optional* live integration testing.

    git clone https://github.com/gabsvm/muse-remote.git
    cd muse-remote
    npm install
    npm test
    npm start

The PWA backend listens on 127.0.0.1:8787 by default. For LAN HTTPS, Android, Desktop, and signing, read [native/README.md](native/README.md) and [native/LAN.md](native/LAN.md).

**npm test** should be safe to run without credentials or model access. Only run **npm run test:integration** when you intentionally want to exercise an installed and authenticated Muse CLI. Integration tests may create local sessions.

Kotlin Multiplatform builds require the SDK/JDK/Gradle versions described in native/README.md. Never commit APKs, keystores, caches, settings, or dependencies.

## Pull requests

Explain the issue, solution and tests run; attach *sanitized* UI screenshots; mention MSP protocol assumptions. Validate Windows/Android for pairing or authentication changes.

We prioritize secure defaults, minimal permissions, cross-platform support, reconnect resilience, accessibility, and clear failure states.

## Security disclosures

Do not file security vulnerabilities as public issues. Follow [SECURITY.md](SECURITY.md).

## Scope

This project does not ship the Muse Code binary, grant a subscription, bypass provider authentication, or provide an independent inference API. The CLI and its terms are managed by Meta.

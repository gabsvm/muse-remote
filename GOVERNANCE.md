# Project governance

Muse Remote is an independent, unofficial community project maintained through GitHub.

## Decision-making

- The repository owner is responsible for releases, permissions, security-response decisions and merge approval.
- Changes affecting the MSP protocol, authorization, remote access, or user data require an issue explaining intended behavior and a regression test.
- Prefer small PRs. A successful test run is required, but does not automatically authorize publishing a binary.
- Maintainers may decline features that substantially expand permissions, depend on private APIs or cannot be supported safely.

## Releases

Version numbers and release notes must match the built artifact. QA Android signing is separate from production. See [release guide](docs/RELEASING.md).

## Contributing

New contributors should check [good first issues](https://github.com/gabsvm/muse-remote/labels/good%20first%20issue) or propose a small testable task. Never include real sessions or credentials in a public PR.

This process will evolve as maintainers and external contributors join.
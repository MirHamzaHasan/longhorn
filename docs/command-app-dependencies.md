# Locked application dependencies

Owner: `scripts/package-command-app.mjs` and the archive's pnpm-lock.yaml.
Connects [distribution](command-app-distribution.md), [upgrades](command-app-upgrades.md)
and [independent verification](command-app-testing.md).

Packaging resolves the archive's own dependency graph with pinned pnpm 12.6.0,
using lockfile-only mode with dependency hooks disabled. It explicitly permits
creating the lock when packaging runs inside CI. No packages are installed in the
staging application. The archive includes that lock, and .longhorn/distribution.json
records its SHA-256 and package-manager identity. Paths remain relative to the
archive, including every local @longhorn framework override. No workspace link or
original absolute directory is allowed in the shipped lock.

The recipient runs `pnpm install --frozen-lockfile` for the first installation
and subsequent deployments. pnpm consumes the packaged resolution and refuses
manifest changes that require a new lock. Registry access is still needed when
the package store lacks a locked archive; a lockfile does not make this an offline
bundle. Platform-specific optional packages remain selected by pnpm on the host.

Application source remains editable. Deliberate dependency changes use an explicit
non-frozen resolution, review of the changed lock, and the app's type/test/build
and native workflow gates before redeployment. Keep the old artifact and lock
with the state checkpoint. Packaging a new artifact may resolve newer versions
within its declared ranges; the guarantee is a fixed graph per produced artifact,
not identical archives across packaging dates or automatic dependency updates.

The native gate checks the packaged lock hash, relocates the actual archive,
installs in CI mode with frozen resolution and requires the lock bytes to remain
unchanged. It changes one dependency manifest entry and requires an offline frozen
install to reject the drift without rewriting the lock, then restores the manifest
and proves the real browser/SQL/receiver/recovery/restore workflow. The existing
archive checksum covers the lock and its metadata together. Checksums are integrity
evidence, not a signature. See [pnpm install](https://pnpm.io/cli/install) for
lockfile-only and frozen installation semantics.

The [CLI command profile](command-project.md) shares the application recipe but
resolves external dependencies only at its first install (including --install).
Retain/review that generated lock and freeze subsequent installs. Archive packaging
still resolves and hashes its own graph before distribution.

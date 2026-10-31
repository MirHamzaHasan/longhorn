# Locked dependencies

CLI-created projects resolve their dependency graph on the first `pnpm install`
(or creation with --install). Retain/review the resulting pnpm-lock.yaml and use
frozen resolution thereafter. Generation itself does not contact a registry.

A packaged archive contains pnpm-lock.yaml for its resolved graph and a lock hash
in .longhorn/distribution.json. Use pinned pnpm 12.6.0 and
`pnpm install --frozen-lockfile` from the project root. First and repeat installs
use that resolution; the lock must remain unchanged. All unpublished @longhornjs
dependencies resolve to .longhorn/framework through the local file overrides.
Registry access is still needed for packages absent from the local package store.

Edit application source freely. For an intentional dependency update, preserve the
old artifact and lock, resolve explicitly using `pnpm install --no-frozen-lockfile`
or a deliberate pnpm update, review the resulting lock, then typecheck/test/build
and repeat the real workflow before deploying it. Do not silently update the lock
inside a deployment. Hash metadata describes the original packaged graph; after
deliberate dependency updates, preserve that origin record with your reviewed diff.

The native distribution gate verifies frozen install after relocation in CI mode,
rejects manifest drift without changing the lock and exercises actual receipts,
outage/recovery and backup/restore. The lock fixes a produced artifact's graph;
future packaging may resolve newer versions within declared ranges. Platform and
runtime support still follows deployment.md. Connects [setup](setup.md),
[schema](schema.md) and [deployment](deployment.md).

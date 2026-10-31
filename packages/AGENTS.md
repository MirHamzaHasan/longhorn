# packages

Runtime-neutral contracts and feature services. The responsibility of each package
is in the module table of [docs/project-guide.md](../docs/project-guide.md).

- No Node, Bun, Deno or Workers APIs in portable entrypoints. Native code goes in
  `runtimes/`, or in an optional subpath such as `@longhornjs/ratelimit/redis`.
- A new subpath needs three things together: the package's `exports` and build entry,
  an alias in the root `vitest.config.ts`, and a mention in its guide.
- A package used by generated apps must also be in `directories` in
  `cli/scripts/snapshot.mjs`.
- SQL providers are explicit dialect implementations, not a translation layer. D1
  predeclares batches and does not emulate callback transactions.
- Effects from queues and the outbox are at-least-once. Never document otherwise.
- Test with `pnpm vitest run packages/<name>`. If native behaviour changed, also run
  the provider's gate.
- Update the guide for what you changed; find it through `docs/features.md`.

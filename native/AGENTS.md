# native

Optional Rust report service with a locked Cargo graph on Rust 1.97.1. Guide:
[docs/rust-reports.md](../docs/rust-reports.md).

- Computation only. Queue and database ownership stay in the TypeScript application.
- The protocol is versioned and bounded, on authenticated loopback HTTP.
- Ordinary apps compute locally unless they explicitly configure this backend.
- `target/` is about 220 MB per worktree and is ignored.
- Test with `pnpm test:rust-service`, then `pnpm test:rust-reports` and
  `pnpm test:owned-native`.

# Optional Rust services

The reports service is the first implemented native integration. It is a separate
loopback HTTP process with a versioned authenticated JSON protocol; it is not a
JavaScript runtime adapter or a required TypeScript build dependency.

Run `pnpm demo:rust-reports` from the repository root for an actual computed and
persisted job. Rust 1.97.1 is pinned for native commands; Cargo.lock fixes the
service graph. The repository [MIT license](../../LICENSE) applies.

See [service/configuration](../../docs/rust-reports.md),
[portable client](../../docs/native-report-client.md),
[jobs integration](../../docs/jobs-native-reports.md),
[owned demo](../../docs/rust-reports-demo.md) and
[native verification](../../docs/rust-reports-testing.md).

# Run the native report workflow

Owner: [demo-rust-reports.mjs](../scripts/demo-rust-reports.mjs). It builds on the
existing jobs API and optional Rust binary, using one owned temporary SQLite file.

```sh
pnpm install --frozen-lockfile
rustup toolchain install 1.97.1 --profile minimal --component rustfmt
pnpm demo:rust-reports
```

The command builds TypeScript and the locked Rust service, generates a random
service credential, starts loopback Rust and the Node jobs host, then enqueues
[3,-1,9]. Rust computes count 3, sum 11, min -1 and max 9; the worker persists the
result. The ready record prints the actual API/report URL so you can inspect it
and the native service's completed-computation count confirms the work ran there.
Enqueue more work at POST /reports with JSON `{ "numbers": [2,4] }`.

The service credential stays in owned process environment. The public demo API
uses the existing local jobs example policy. There are no cloud accounts, receiver
credentials or seeded result rows. Temporary data is scoped to this run; use the
ordinary persistent jobs host and explicit native configuration to retain your own
state. Native endpoints use a separate authenticated loopback listener.

Ctrl+C/SIGTERM joins startup, drains the jobs host, then the native service, and
removes the owned temporary directory. A failed forced child shutdown reports
failure. The verifier runs the same demo, checks its computed result and asserts
storage removal and process cleanup. See [native service](rust-reports.md),
[jobs wiring](jobs-native-reports.md) and [verification](rust-reports-testing.md).

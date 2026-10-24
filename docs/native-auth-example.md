# Authentication hosts on Node, Bun and Deno

Owner: `examples/auth/src/index.ts`, `bun.ts` and `deno.ts`. All three compose
`createAuthApp` from `app.ts` with the same configuration schema, credential/session
service, cookie/origin guards and [SQLite auth store](auth-sqlite.md). Each selects
its native listener, SQLite driver and [password adapter](scrypt-password-policy.md).
Core/shared packages do not choose a runtime or enable authentication automatically.

```sh
pnpm dev:auth       # Node source watcher
pnpm dev:auth:bun   # build, then native Bun
pnpm dev:auth:deno  # build, then native Deno with scoped permissions
```

The native Bun/Deno commands start the compiled host; edit and rerun to rebuild.
The independent [auth starter](auth-starter.md) now copies these actual sources
and supplies its own configured launcher and source-reload supervisor.
The default address is `http://127.0.0.1:3001` and the default database is
`examples/auth/data/auth.sqlite`, resolved relative to the example, not the shell.
No seed account is created. See the [auth example](auth-example.md) for HTTP usage.
To run several hosts against one file, select different ports and set the same
explicit public `AUTH_ORIGIN` for the requests you will send.

## Configuration and native permissions

The schema accepts `HOST`, `PORT`, `AUTH_ORIGIN`, `AUTH_COOKIE_SECURE`,
`SESSION_TTL_SECONDS`, `DATABASE_PATH` and `LOG_LEVEL`. The Node host uses optional
`.env`/`.env.local` files then process overrides. Bun uses its native `Bun.env`
snapshot; Bun controls its own environment-file loading. Deno reads only these
seven keys from its granted environment and does not load environment files.

The Deno command runs from `examples/auth` and grants only loopback networking,
those seven environment keys and `data` read/write access. Changing the host or
data directory requires matching native grants in your own launch command;
changing the public origin requires matching `AUTH_ORIGIN`. There is no `--allow-all`,
FFI grant or automatic permission expansion. In-memory storage uses `:memory:`.
The loopback example explicitly uses insecure cookies. HTTPS deployment requires
the exact HTTPS public origin and `AUTH_COOKIE_SECURE=true`.

## Retained state and ownership

The original auth and private-note migration SQL is unchanged. All three native
drivers use the same retained schema and scrypt format. Accounts, current roles,
sessions, rotation, all-device revocation and throttling are visible through the
shared SQLite file. This is same-machine file interoperability, not a distributed
database/session service. Other native SQL providers remain independently scoped.

Signals close the listener, drain accepted request/password work, then release
storage. Repeated shutdown uses the same promise. This does not promise password
cancellation, process supervision or crash-safe completion of an uncommitted request.
Private notes now use [bounded owner-scoped pages](auth-note-pages.md).

`pnpm test:native-auth` builds and runs the [native password gate](native-password-testing.md)
plus mixed Bun/Node/Deno authentication against one temporary file. The ordinary
`pnpm test:auth` retains Node HTTP and real workerd shared-auth coverage.

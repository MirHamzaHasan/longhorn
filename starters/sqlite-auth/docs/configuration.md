# Configuration and native permissions

Owner: `src/config.ts` and the Node parent `host.mjs`. The launcher reads optional
project `.env`, then `.env.local`, then defined process overrides for exactly:
`HOST`, `PORT`, `AUTH_ORIGIN`, `AUTH_COOKIE_SECURE`, `SESSION_TTL_SECONDS`,
`DATABASE_PATH` and `LOG_LEVEL`. Other parent environment values are not forwarded.
Node 20.19+ tooling is required for every runtime profile.

The actual compiled application schema validates before native spawn or data
directory creation. Field-only configuration errors omit input values. Defaults
are loopback port 3001, matching HTTP origin, insecure development cookies,
eight-hour sessions and `./data/auth.sqlite`. `PORT=0` binds an ephemeral socket;
the explicit request Origin still must match `AUTH_ORIGIN`.

Data paths resolve relative to the project even when started from another shell
directory. Bun/Deno executables are pinned project dependencies. Deno gets only
the selected hostname's network access, these seven environment keys and read/write
access to the configured database directory. `:memory:` receives no data grants.
Literal path arrays in a unique private named-permissions JSON preserve spaces
and commas. The file is removed after actual child close, including failed spawn
and normal shutdown. Deno currently marks named permissions experimental.

These grants include the configured data directory, not only one SQLite file,
because SQLite uses sidecar files. Native Node/Bun do not provide a permission
sandbox here. There is no FFI or allow-all grant. Avoid putting unrelated secrets
in the selected directory. HTTPS ingress/cookie/origin policy is deployment-owned.

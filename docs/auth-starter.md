# Independent native SQLite auth projects

Owner: `cli/src/auth-template.ts`, composed by the existing project generator.
The public `sqlite-auth` profile selects Node, Bun or Deno; Workers is rejected
before filesystem output because this profile needs callback SQLite and native
password work. Generic `api` and existing task profiles retain their identities.

```sh
pnpm create:app ../accounts-api --runtime node --template sqlite-auth --install
# Or select --runtime bun or --runtime deno.
cd ../accounts-api
pnpm typecheck
pnpm test
pnpm test:persistence
pnpm dev
```

Both `longhorn create` and `create-longhorn` accept this selection. The project
contains the actual editable auth app/config/notes and selected native host from
`examples/auth`, its source tests, environment example, license, feature guides
and selected local framework snapshot. It runs after relocation without this
checkout or unpublished framework registry packages. Node 20.19+ and pnpm 12.6.0
are development tools for all profiles; Bun/Deno are pinned project dependencies.

Default address is `http://127.0.0.1:3001`, with `data/auth.sqlite` relative to the
project. There is no seed user. Native signup/login, hash-only sessions, current
roles, all-device revocation, durable throttle and private-note cursor pages use
the same [auth application](native-auth-example.md). The loopback profile explicitly
uses insecure cookies; an HTTPS deployment must select a secure cookie and exact
HTTPS public origin. Account recovery/OAuth/MFA remain application extensions.

Each generated feature has its own Markdown guide and connection table. See
[source distribution](auth-starter-snapshot.md), [configuration](auth-starter-launcher.md),
[development](auth-starter-development.md) and [native proof](auth-starter-testing.md).
`pnpm test:auth-project` builds the repository and runs all three installed profiles.

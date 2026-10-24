# Checked auth source and selected package distribution

Owner: the auth section of `cli/scripts/snapshot.mjs`, `cli/src/auth-template.ts`
and the existing trusted asset reader/generator. Internal asset directories are
`node-sqlite-auth`, `bun-sqlite-auth` and `deno-sqlite-auth`; public metadata remains
`{ schemaVersion: 1, runtime, framework: 'snapshot', template: 'sqlite-auth' }`.

The builder copies `app.ts`, `config.ts` and `notes.ts` without rewriting them.
It selects the actual Node/Bun/Deno host as `src/index.ts`. All five application
source cases are retained. Native variants map only the test-runner import and
SQLite adapter import, with checked expected counts; unexpected Node-only imports
or host/storage/password selection fail the build. Node uses Vitest, Bun uses
`bun:test`, and Deno compiles cases then uses native `node:test` with pinned real
assertions. No fake password backend is introduced into application source.
The Deno source test process grants environment access for its assertion libraries'
CI/vendor detection. This is separate from the app launcher's seven allowed keys.

The common assets under `starters/sqlite-auth` supply build/start/watch tools,
native persistence checks and per-feature documentation. Deno additionally copies
the existing test adapter/build tool and permission-denial fixture. All output is
regular checked UTF-8 files: descriptor v1 retains the existing hash/path/count/size
bounds and rejects incomplete/corrupt assets before project staging. Hashes detect
corruption in a trusted local distribution; they are not artifact signatures.

Dependencies come from the auth example with only the selected native runtime.
Transitive package closure is copied through the existing framework manifest;
relative `file:` dependencies and overrides make the app independent. Other native
runtime packages, caches, queues and browser console features are not selected
by this profile. It imports the new shared scrypt export through native adapters,
but that passive export does not enable auth in generic starters.

The [installed gate](auth-starter-testing.md) compares shipped source byte-for-byte
(or to the explicit native test mappings), relocates the generated app, performs
an unchanged frozen install and executes native source/persistence behavior.
See [profile](auth-starter.md) and [launcher](auth-starter-launcher.md).

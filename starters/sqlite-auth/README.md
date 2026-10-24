# {{PROJECT_NAME}}

A persistent LongHorn authentication API using the selected native Node, Bun or
Deno runtime. Accounts, hash-only sessions, throttle counters and private notes
live in `data/auth.sqlite`. No seed account or default password is created.
The editable application is in `src`; its selected framework snapshot is in
`.longhorn/framework`. Development tooling uses Node 20.19+ and pnpm 12.6.0.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm test:persistence
pnpm dev
```

Default address: `http://127.0.0.1:3001`. Copy `.env.example` to `.env` for local
settings. The launcher reads `.env`, `.env.local`, then the seven process settings
described in [configuration](docs/configuration.md). It validates the actual app
schema before launching the native host. Deno receives explicit named permissions;
the pinned runtime currently labels that permission mechanism experimental.

Use your own passphrase when registering:

```sh
curl http://127.0.0.1:3001/auth/register \
  -H 'Origin: http://127.0.0.1:3001' -H 'Content-Type: application/json' \
  -d '{"username":"alex","password":"a long unique passphrase"}'
curl http://127.0.0.1:3001/auth/login -c /tmp/longhorn-auth-cookies.txt \
  -H 'Origin: http://127.0.0.1:3001' -H 'Content-Type: application/json' \
  -d '{"username":"alex","password":"a long unique passphrase"}'
curl http://127.0.0.1:3001/notes -b /tmp/longhorn-auth-cookies.txt \
  -H 'Origin: http://127.0.0.1:3001' -H 'Content-Type: application/json' \
  -d '{"title":"My private note"}'
curl 'http://127.0.0.1:3001/notes?limit=20' -b /tmp/longhorn-auth-cookies.txt
```

The cookie file is a credential; remove it when finished. Registration creates a
member and does not sign in automatically. Follow `nextCursor` to read later note
pages. For a compiled host, run `pnpm build` then `pnpm start`.
POST `/auth/password` changes the authenticated user's password with current-password
verification and all-session revocation; see [the flow](docs/password-changes.md).

The loopback example explicitly uses insecure development cookies. An HTTPS
deployment requires `AUTH_COOKIE_SECURE=true`, the exact HTTPS `AUTH_ORIGIN` and
application-owned ingress. The app provides local credentials, not account
recovery, email verification, OAuth or MFA. See [all features](docs/features.md),
[HTTP boundaries](docs/http.md), [lifecycle](docs/lifecycle.md) and
[testing](docs/testing.md) for the contracts and connections.

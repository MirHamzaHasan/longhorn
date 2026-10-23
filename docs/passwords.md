# Node password hashing

Owner: `createScryptPasswordHasher` from `@longhorn/node/passwords`. Implements the
runtime-neutral `PasswordHasher` contract from `@longhorn/auth`. Native crypto stays
in the Node runtime entrypoint; importing core or shared auth does not import it.

```ts
const passwords = createScryptPasswordHasher({ concurrency: 1, maxQueue: 8 })
const encoded = await passwords.hash(password)
const valid = await passwords.verify(password, encoded)
```

The adapter uses Node's asynchronous scrypt with `N=131072`, `r=8`, `p=1`, a fresh
16-byte random salt, and a 64-byte derived key. The native memory cap is 256 MiB
per job; the algorithm's base memory cost is about 128 MiB. These fixed work factors
match an [OWASP scrypt configuration](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
[Node's crypto API](https://nodejs.org/download/release/v20.19.0/docs/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)
provides scrypt and `timingSafeEqual`; this module does not implement a KDF itself.

The encoded format is:

```text
scrypt$v=1$n=131072,r=8,p=1$<32 hex salt characters>$<128 hex key characters>
```

Verification accepts exactly this version/parameter/length format. Stored hashes
cannot request arbitrary memory or CPU costs. Missing, malformed, and unsupported
hashes still run one scrypt job against a per-instance dummy salt/key and return
false. Valid encodings use `timingSafeEqual` on equal-length keys. Passwords are not
trimmed or truncated; the adapter rejects more than 1024 UTF-8 bytes. The higher
level [credential service](authentication.md) applies its registration policy.

## Resource ownership

Create one shared hasher per application/process. The default permits one active
job and eight waiting jobs; excess work throws `AuthError('CAPACITY')`. Configurable
concurrency is 1–4 and queue size 0–100. Each instance has its own bound, so creating
a hasher per request defeats the process memory policy. Multiple processes have
independent memory budgets.

Native work uses Node's crypto threadpool rather than synchronously blocking the
event loop. The hasher has no listener or persistent connection to close. In the
auth example, application shutdown waits for active HTTP handlers, including their
password work, before closing storage. Client disconnects do not cancel a started
native crypto operation.

## Verification and limits

Native tests verify independent salts, correct/wrong passwords, preservation of
whitespace, dummy-work capacity, queue admission, and bounded input. The auth
process verifier checks real registrations/login and database contents.

Work factors are intentionally not caller-controlled. Other algorithms and runtime
password adapters can implement `PasswordHasher`; they must retain dummy work for
unknown accounts. This version does not migrate legacy hash formats, rehash
automatically, apply a pepper, or provide a Bun/Deno/Worker password adapter.

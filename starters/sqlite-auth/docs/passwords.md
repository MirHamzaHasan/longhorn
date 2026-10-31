# Native passwords

Owner: `@longhornjs/<selected runtime>/passwords`, injected once in `src/index.ts`.
The adapter uses native asynchronous `scrypt` and timing-safe comparison through
the runtime's crypto API. Shared `@longhornjs/auth/scrypt` supplies policy, not a KDF.

The existing fixed v1 encoding has `N=131072`, `r=8`, `p=1`, a random 16-byte salt
and a 64-byte derived key. Node, Bun and Deno adapters share the format; passwords
need no rewrite when moving the retained database between verified native hosts.
Missing/malformed hashes still run dummy native work with those fixed parameters.
Stored encodings cannot request arbitrary work factors.

One active job and eight waiting jobs are allowed by default. Each job has a
256 MiB native cap (about 128 MiB base algorithm memory). Additional hasher
instances/processes have independent budgets. Oversized input above 1024 UTF-8
bytes is rejected, not truncated; the credential service applies stricter signup
policy. Native work retains its reservation until it actually settles. Native
errors are sanitized; callers must also avoid logging secrets themselves.

The hasher has no close/cancel API. [Application drain](lifecycle.md) waits for
accepted HTTP/password work before releasing SQL. Source tests use explicit fake
passwords for deterministic policy assertions; `pnpm test:persistence` executes
the actual selected native provider. No Workers password backend is included.

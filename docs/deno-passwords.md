# Native Deno passwords

Owner: `runtimes/deno/src/passwords.ts`, exported as `@longhornjs/deno/passwords`.
Import it explicitly in a Deno host and create one shared hasher:

```ts
import { createScryptPasswordHasher } from '@longhornjs/deno/passwords'
const passwords = createScryptPasswordHasher({ concurrency: 1, maxQueue: 8 })
```

The factory requires Deno. It invokes Deno's native asynchronous
`node:crypto.scrypt` compatibility API and native `timingSafeEqual`. The
[shared policy](scrypt-password-policy.md) owns fixed wire parameters, dummy work,
input limits, failure sanitization and admission. There is no synchronous crypto,
JavaScript KDF or native import in shared auth/core.

Hashes are compatible with the existing [Node](passwords.md) and
[Bun](bun-passwords.md) adapters. Verification of a legacy Node account requires
no stored-data rewrite. A hasher has no persistent connection to close; accepted
HTTP work retains ownership through native completion and application drain.
Creating additional hashers/processes creates additional memory/queue budgets.

The [native host](native-auth-example.md) grants environment, loopback networking
and the chosen SQLite directory explicitly. Native password-only fixtures run
without environment, FFI or system permissions; file permissions there belong to
the test record protocol. The [gate](native-password-testing.md) executes Deno
2.9.6, independent raw crypto vectors, event-loop progress and actual signal drain.
Compatibility on other Deno versions and operating systems needs its own gate.
This is separate from any Workers backend, account recovery or automatic rehash.

# Native Bun passwords

Owner: `runtimes/bun/src/passwords.ts`, exported as `@longhorn/bun/passwords`.
Import it explicitly in a Bun host and create one shared hasher:

```ts
import { createScryptPasswordHasher } from '@longhorn/bun/passwords'
const passwords = createScryptPasswordHasher({ concurrency: 1, maxQueue: 8 })
```

The factory requires Bun. Its adapter invokes Bun's native asynchronous
`node:crypto.scrypt` compatibility API and native `timingSafeEqual`, then delegates
wire encoding, dummy verification, input limits and bounded admission to the
[shared policy](scrypt-password-policy.md). It uses no synchronous crypto and no
JavaScript KDF. The adapter is separate from the listener and SQLite entrypoints;
importing shared auth never imports Bun/native APIs.

The fixed format and parameters match the existing [Node adapter](passwords.md)
and the [Deno adapter](deno-passwords.md), so existing accounts need no password
rewrite. A hasher has no persistent resource to close; application drain waits for
accepted handlers before closing the database. Native jobs keep their reservation
until completion, even if the caller disconnects. Each process has its own memory
and queue budget.

The [native auth host](native-auth-example.md) uses this adapter with `bun:sqlite`.
The [native gate](native-password-testing.md) executes pinned Bun 1.4.4, independent
legacy/peer vectors, event-loop progress and SIGTERM during real registration.
Other Bun versions and operating systems require their own execution evidence.
This does not add password resets, automatic rehashing or a Worker backend.

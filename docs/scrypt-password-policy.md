# Shared scrypt policy

Owner: `packages/auth/src/scrypt.ts`, exported separately as `@longhorn/auth/scrypt`.
It implements `PasswordHasher` policy while a trusted runtime adapter supplies
asynchronous native `derive` and equal-length native `equal` operations.
It imports no native APIs and does not implement a JavaScript KDF.

The [Node](passwords.md), [Bun](bun-passwords.md) and [Deno](deno-passwords.md)
factories all use this policy. Applications should select one of those factories;
the low-level driver interface is an adapter boundary, not a user-selectable cipher.
Drivers must derive exactly 64 bytes with the supplied fixed parameters and use
their native constant-time comparison. The policy cannot establish those properties
for an arbitrary caller-supplied driver.

## Wire format and input

The existing Node format remains byte-for-byte compatible:

```text
scrypt$v=1$n=131072,r=8,p=1$<32 lowercase hex salt characters>$<128 lowercase hex key characters>
```

Native parameters are fixed at `N=131072`, `r=8`, `p=1`, `maxmem=268435456`.
Each hash gets 16 random salt bytes from Web Crypto. Stored parameters cannot
request different work factors. Missing, malformed or unsupported hashes still
derive once against a per-instance dummy salt, compare 64-byte buffers and return
false. Verification preserves whitespace and Unicode exactly; neither operation
normalizes, trims or truncates the password. Input must be a string of at most
1024 UTF-8 bytes, otherwise it throws `AuthError('INVALID_INPUT')` before admission.
The credential service has its own stricter registration policy.

## Admission and failure

Create one shared hasher per application. The defaults are one active derivation
and eight queued operations; `concurrency` accepts 1–4 and `maxQueue` accepts 0–100.
Both are copied at construction. Excess work throws `AuthError('CAPACITY')`.
The queue hands reservations to waiting calls in FIFO order and releases them only
when the actual native promise settles, including failure. A caller disconnect,
timeout or shutdown request does not release a still-running derivation.

Native derivation failures, invalid native result lengths/types and comparison
failures produce the fixed error `Native password operation failed`, without
retaining a native cause or including input. Adapters and applications must still
avoid logging passwords, hashes and session credentials themselves.

There is no hasher close/abort/rehash API or process-wide global semaphore. A
native job's memory cap is 256 MiB, with about 128 MiB base algorithm memory.
Additional instances/processes have independent budgets. The application owns
accepted HTTP work and drains it before releasing SQL resources.

## Connections and proof

The [native password gate](native-password-testing.md) checks independent raw
crypto vectors, peer hashes and actual signal drain. Source tests use explicit
fake drivers to test queue/failure policy without claiming native cryptography.
A workerd fixture only proves that this policy bundles and executes with a
test driver; this feature supplies no Workers password backend.

# Explicit bearer service capabilities

Owner: createBearerVerifier from `@longhornjs/auth/bearer`. Connects
[service operations](outbox-operations-authorization.md),
[HTTP receiver](http-message-receiver.md) and the existing Web Crypto auth boundary.

```ts
const verify = createBearerVerifier(configuredSecret)
if (!await verify(request.headers.get('Authorization') ?? undefined)) {
  return Response.json({ error: 'Authentication required' }, { status: 401 })
}
```

Configuration accepts 32–256 ASCII alphanumeric/underscore/hyphen characters;
use a cryptographically random secret. The verifier accepts exactly one Bearer
header with that token grammar. Missing, malformed, combined or incorrect
credentials fail. The scheme is case-insensitive; token bytes remain exact.

An instance-local nonextractable HMAC key is generated lazily. Native MAC
verification compares the candidate against the configured credential's MAC.
The key/signature are not persisted and no token is returned, logged or derived
into an audit actor. Replace the verifier when deployment credentials rotate.
Configuration errors contain no supplied secret value.

This capability identifies a service credential holder. The host still chooses
route/resource policy, transport security, Vary: Authorization, no-store,
WWW-Authenticate and any service actor label. It does not introduce an account,
role hierarchy or human identity. [Account operations](account-operations.md)
continue to use individual cookie sessions and transaction-locked roles.

The existing Worker operations guard now shares this helper without changing
its token format or disabled-route behavior. The receiver requires configuration
and protects every route before validation. Native verification proves old
credential denial after rotation while SQL effects survive; the existing audit
gate still checks service attribution/rotation. Keep capability values in host
secret configuration, separate from public account responses.

# Dependency injection

Owner: `@longhornjs/container`. No HTTP or runtime dependencies. Core creates one
container per application and exposes it to [HTTP handlers](http.md). Configuration,
resource startup, and application services can register providers in that container.

```ts
import { Container, token, provide } from '@longhornjs/container'

const Database = token<{ query(): string }>('database')
const Users = token<{ list(): string }>('users')
const container = new Container()

container.register(provide(Database, { factory: () => ({ query: () => 'rows' }) }))
container.register(provide(Users, {
  deps: [Database],
  factory: (db) => ({ list: () => db.query() }),
}))
container.resolve(Users).list()
```

Tokens use unique symbols; matching descriptions do not make two tokens equal.
Providers are lazy and cached as application singletons. Dependencies are resolved
before invoking a factory. Duplicate registrations, missing tokens, and dependency
cycles throw errors. Factories are synchronous; acquire async resources in a
[startup hook](lifecycle.md) and register the result.

`container.override(provider)` replaces that token's provider and clears its cached
instance. It does not rebuild other singleton instances that have already captured
the old dependency. Override before resolving dependents or use a fresh container.
Request scopes and automatic resource disposal are not implemented. Resource owners
register cleanup through the application lifecycle.

With LongHorn, use `app.container` and `c.get('container')`. Containers are isolated
between application instances. [Configuration](configuration.md) demonstrates an
application-owned settings token; [the tasks example](tasks-example.md) uses a lazy
service provider.

Verification: [container tests](../packages/container/src/container.test.ts),
[provider tests](../packages/container/src/provide.test.ts),
[token tests](../packages/container/src/token.test.ts), and
[HTTP/DI integration](../packages/core/src/http.test.ts).

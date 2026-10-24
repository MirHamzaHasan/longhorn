# Features and connections

| Feature | Guide | Owner and connection |
| --- | --- | --- |
| Accounts and login | [Accounts](accounts.md) | AuthService, account/attempt stores and native password provider |
| Native password work | [Passwords](passwords.md) | Selected runtime/passwords and shared fixed scrypt policy |
| Password replacement | [Session controls](session-controls.md) | AuthService, account routing and SQL session-control port | Token-owned others/all scopes, live counts, post-ownership expiry and atomic revocation |
| [Password changes](password-changes.md) | Current-password reauthentication, fenced login and atomic all-session revocation |
| Durable sessions | [Sessions](sessions.md) | SessionManager and SQLite hash-only session records |
| Cookies and origin guards | [HTTP](http.md) | Typed Hono auth subrouter and current-principal guards |
| Owner-scoped note pages | [Notes](notes.md) | Authenticated user, bound SQLite predicates and exact cursors |
| Configuration and permissions | [Configuration](configuration.md) | Compiled schema, seven environment keys and native launch grants |
| Startup, reload and drain | [Lifecycle](lifecycle.md) | Longhorn resources, owned host and Node/esbuild watcher |
| Retained schema | [Migrations](migrations.md) | Shared checksummed auth migrations and original note index |
| Real source/native proof | [Testing](testing.md) | Selected native tests, persistent HTTP processes and temporary state |

`src/index.ts` selects the runtime, SQLite and password providers. `src/app.ts`
composes DI, migrations and Hono routes. `src/notes.ts` owns bounded SQL reads;
`src/config.ts` is the shared launcher/host schema. Framework code stays in its
local package snapshot. These files do not reference the original monorepo.

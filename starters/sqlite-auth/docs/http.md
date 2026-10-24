# Authentication HTTP boundaries

Owner: `src/app.ts`, using `@longhorn/auth/hono`, Hono validation and application DI.

| Route | Behavior |
| --- | --- |
| GET `/health` | Public health response |
| POST `/auth/register` | Strict signup, member role, no automatic login |
| POST `/auth/login` | Native password verification, session issue/rotation |
| GET `/auth/session` | Current principal and expiry, or 401 |
| POST `/auth/logout` | Idempotent token revocation and cookie clear |
| POST `/auth/logout-all` | Authenticated all-device revocation |
| POST `/auth/password` | Current-password verification, atomic replacement/revocation and cookie clear |
| GET `/admin` | Current admin role required |
| GET/POST `/notes` | Owner-scoped page/create |
| DELETE `/notes/:id` | Owned delete; missing/other-owner IDs return 404 |

Covered responses use `Cache-Control: no-store`. Unsafe methods require the exact
configured `AUTH_ORIGIN`, even before login. Bodies are capped at 8 KiB before
parsing; JSON fields and note queries are strict. Cookies are HTTP-only,
SameSite=Strict and scoped to `/`; insecure loopback cookies are an explicit
development choice. HTTPS hosts require secure cookies and the matching HTTPS
origin. Cookie authentication does not itself filter SQL: [note queries](notes.md)
bind the current user's ID explicitly. Logs exclude bodies and cookies.

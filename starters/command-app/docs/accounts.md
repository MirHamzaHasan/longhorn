# Account access

Owner: src/accounts.ts and the snapshot's auth/native-password entries. Native
scrypt hashes passwords; PostgreSQL stores account roles and hash-only session
tokens. Browser cookies are HttpOnly and SameSite Strict; production uses Secure
cookies and an exact HTTPS Origin. Private reads derive ownership from a fresh
server principal. Mutations reauthenticate inside their managed transaction.
Role changes through the trusted operator CLI revoke previous sessions. There
is no public role-management endpoint or default operator/password.

Connects [commands](commands.md), [console](console.md) and [deployment](deployment.md).

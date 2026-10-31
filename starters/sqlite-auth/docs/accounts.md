# Accounts and login

Owner: `AuthService` from `@longhornjs/auth`, composed in `src/app.ts` with
`SqliteAuthStore` and the selected [password adapter](passwords.md). Shared auth
contains no native crypto or SQL driver imports.

POST `/auth/register` accepts strict username/password input, creates a `member`
and returns only public user fields. Client role fields are rejected. Registration
does not log in automatically. The service normalizes usernames and applies its
15–128 Unicode-code-point registration password policy without trimming passwords.

POST `/auth/login` performs password verification for both present and missing
accounts. Wrong and unknown credentials have the same public response. Valid
login issues a fresh [session](sessions.md); a supplied prior token rotates
atomically. Durable account-based attempt windows survive process restart. They
are separate from the password adapter's bounded native work queue and do not
provide network-wide rate limiting.

Roles reload from storage for each request. `/admin` requires a current admin;
signup cannot grant that role. This starter supplies no public role-management,
password reset, email-verification or recovery endpoints. Authenticated
[password changes](password-changes.md) use current-password verification and atomic
all-session revocation. Trusted account
administration and deployment policy remain application-owned.

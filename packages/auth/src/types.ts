import type { SqlExecutor } from '@longhornjs/database'
export type AuthUser = { readonly id: string; readonly username: string; readonly roles: readonly string[] }
export type CredentialUser = AuthUser & { readonly passwordHash: string }
export interface PasswordHasher {
  hash(password: string): Promise<string>
  /** Missing/malformed hashes must still perform dummy password verification work. */
  verify(password: string, encodedHash: string | undefined): Promise<boolean>
}
export interface CredentialStore {
  createUser(user: CredentialUser): Promise<boolean>
  findUserByUsername(username: string): Promise<CredentialUser | undefined>
  findUserById(id: string): Promise<AuthUser | undefined>
}
export type StoredSession = { readonly tokenHash: string; readonly userId: string; readonly expiresAt: number }
export type IssuedSession = { readonly token: string; readonly expiresAt: number }
export interface SessionStore {
  /** Atomically insert a session and revoke a previous hash, if supplied. */
  createSession(session: StoredSession, previousHash?: string): Promise<void>
  findSession(tokenHash: string): Promise<StoredSession | undefined>
  deleteSession(tokenHash: string): Promise<void>
  deleteUserSessions(userId: string): Promise<void>
  deleteExpiredSessions(now: number): Promise<number>
}
export interface LoginAttemptStore {
  /** Atomically reserve an attempt. Return the window end when throttled. */
  consumeLoginAttempt(key: string, now: number, limit: number, windowMs: number): Promise<number | undefined>
  clearLoginAttempts(key: string): Promise<void>
}
export type PasswordSessionInput = {
  readonly session: StoredSession; readonly previousHash?: string
  readonly expectedPasswordHash: string; readonly attemptKey: string
}
export type PasswordChangeInput = {
  readonly userId: string; readonly tokenHash: string
  readonly expectedPasswordHash: string; readonly nextPasswordHash: string; readonly attemptKey: string
}
/** One borrowed account/session database; all mutations commit together or have no effect. */
export interface PasswordChangeStore {
  createSession(input: PasswordSessionInput): Promise<boolean>
  /** Sample the trusted synchronous clock after obtaining user/session ownership. */
  replacePassword(input: PasswordChangeInput, now: () => number): Promise<boolean>
}
export type SessionControlScope = 'others' | 'all'
export type SessionControlInput = { readonly tokenHash: string; readonly scope: SessionControlScope }
/** Reauthenticate the initiating token after ownership; atomically delete live subject sessions.
 * undefined means invalid/expired initiation, with no writes. Counts exclude already expired rows. */
export interface SessionControlStore {
  revoke(input: SessionControlInput, now: () => number): Promise<number | undefined>
}
export interface AuthStore extends CredentialStore, SessionStore, LoginAttemptStore {
  readonly passwordChanges?: PasswordChangeStore
  readonly sessionControls?: SessionControlStore
}
export interface TransactionalAuthStore extends AuthStore {
  /** Retain native/coordinated authorization ownership until the caller's transaction finishes. */
  readAuthenticationInTransaction(transaction: SqlExecutor, tokenHash: string): Promise<{ readonly user: AuthUser; readonly session: StoredSession } | undefined>
}
export type RoleChangeResult = { readonly status: 'missing' } | { readonly status: 'updated' | 'unchanged'; readonly user: AuthUser; readonly revokedSessions: number }
export type Authenticated = { readonly user: AuthUser; readonly session: { readonly expiresAt: number } }

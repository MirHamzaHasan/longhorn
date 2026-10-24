import type { AuthStore, AuthUser, CredentialUser, PasswordHasher, StoredSession, PasswordChangeStore } from './types.js'
import { passwordTimestamp, snapshotPasswordChange, snapshotPasswordSession } from './password-store.js'

/** Explicit test fixture. It is not exported by the package. */
export class MemoryAuthStore implements AuthStore {
  users = new Map<string, CredentialUser>()
  sessions = new Map<string, StoredSession>()
  attempts = new Map<string, { count: number; end: number }>()
  readonly passwordChanges: PasswordChangeStore = {
    createSession: async input => {
      const { session, previousHash, expectedPasswordHash, attemptKey } = snapshotPasswordSession(input)
      if (this.users.get(session.userId)?.passwordHash !== expectedPasswordHash) return false
      this.sessions.set(session.tokenHash, structuredClone(session))
      if (previousHash !== undefined) this.sessions.delete(previousHash)
      this.attempts.delete(attemptKey); return true
    },
    replacePassword: async (input, now) => {
      const { userId, tokenHash, expectedPasswordHash, nextPasswordHash, attemptKey } = snapshotPasswordChange(input)
      const user = this.users.get(userId), session = this.sessions.get(tokenHash)
      if (!user || user.passwordHash !== expectedPasswordHash || !session || session.userId !== userId || session.expiresAt <= passwordTimestamp(now())) return false
      this.users.set(userId, { ...user, passwordHash: nextPasswordHash })
      for (const [key, session] of this.sessions) if (session.userId === userId) this.sessions.delete(key)
      this.attempts.delete(attemptKey); return true
    },
  }
  async createUser(user: CredentialUser) {
    if ([...this.users.values()].some((value) => value.username === user.username)) return false
    this.users.set(user.id, structuredClone(user)); return true
  }
  async findUserByUsername(username: string) { return [...this.users.values()].find((user) => user.username === username) }
  async findUserById(id: string): Promise<AuthUser | undefined> { return this.users.get(id) }
  async createSession(session: StoredSession, previous?: string) {
    this.sessions.set(session.tokenHash, structuredClone(session))
    if (previous) this.sessions.delete(previous)
  }
  async findSession(hash: string) { return this.sessions.get(hash) }
  async deleteSession(hash: string) { this.sessions.delete(hash) }
  async deleteUserSessions(id: string) { for (const [key, session] of this.sessions) if (session.userId === id) this.sessions.delete(key) }
  async deleteExpiredSessions(now: number) {
    let count = 0
    for (const [key, session] of this.sessions) if (session.expiresAt <= now) { this.sessions.delete(key); count++ }
    return count
  }
  async consumeLoginAttempt(key: string, now: number, limit: number, windowMs: number) {
    const attempt = this.attempts.get(key)
    const current = attempt && attempt.end > now ? attempt : { count: 0, end: now + windowMs }
    current.count++; this.attempts.set(key, current)
    return current.count > limit ? current.end : undefined
  }
  async clearLoginAttempts(key: string) { this.attempts.delete(key) }
}

/** No real password security; only for service/HTTP tests. Native tests use scrypt. */
export const testPasswords: PasswordHasher = {
  hash: async (password) => `fixture:${password}`,
  verify: async (password, hash) => hash !== undefined && hash === `fixture:${password}`,
}

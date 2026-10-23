import { SessionManager, tokenHash, validSessionToken } from './sessions.js'
import type { SqlExecutor } from '@longhorn/database'
import type { Authenticated, AuthStore, AuthUser, IssuedSession, PasswordHasher, TransactionalAuthStore } from './types.js'

export class AuthError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'USERNAME_TAKEN' | 'INVALID_CREDENTIALS' | 'RATE_LIMITED' | 'CAPACITY', readonly retryAfterMs?: number) {
    super({ INVALID_INPUT: 'Invalid account input', USERNAME_TAKEN: 'Username is unavailable',
      INVALID_CREDENTIALS: 'Invalid credentials', RATE_LIMITED: 'Too many login attempts',
      CAPACITY: 'Authentication temporarily unavailable' }[code])
    this.name = 'AuthError'
  }
}
export function normalizeUsername(username: string): string {
  if (typeof username !== 'string' || username.length > 256) throw new AuthError('INVALID_INPUT')
  const normalized = username.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(normalized)) throw new AuthError('INVALID_INPUT')
  return normalized
}
function passwordInput(password: string, registration = false): void {
  if (typeof password !== 'string' || password.length > 256 || [...password].length > 128 || new TextEncoder().encode(password).length > 1024
    || (registration && [...password].length < 15)) throw new AuthError('INVALID_INPUT')
}
function publicUser(user: AuthUser): AuthUser {
  if (typeof user.id !== 'string' || !user.id || typeof user.username !== 'string' || !Array.isArray(user.roles)
    || user.roles.some((role) => typeof role !== 'string' || !role)) throw new Error('Invalid user store record')
  return Object.freeze({ id: user.id, username: user.username, roles: Object.freeze([...user.roles]) })
}

export class AuthService {
  readonly sessions: SessionManager
  private readonly clock: () => number
  private readonly loginLimit: number
  private readonly loginWindowMs: number
  constructor(private readonly store: AuthStore, private readonly passwords: PasswordHasher,
    options: { sessionTtlMs?: number; clock?: () => number; loginLimit?: number; loginWindowMs?: number } = {}) {
    this.clock = options.clock ?? Date.now
    this.sessions = new SessionManager(store, { clock: this.clock, ...(options.sessionTtlMs === undefined ? {} : { ttlMs: options.sessionTtlMs }) })
    this.loginLimit = options.loginLimit ?? 10
    this.loginWindowMs = options.loginWindowMs ?? 15 * 60 * 1000
    if (!Number.isSafeInteger(this.loginLimit) || this.loginLimit < 1 || this.loginLimit > 1000
      || !Number.isSafeInteger(this.loginWindowMs) || this.loginWindowMs < 1000 || this.loginWindowMs > 24 * 60 * 60 * 1000) {
      throw new Error('Invalid login throttle settings')
    }
  }
  async register(username: string, password: string): Promise<AuthUser> {
    const normalized = normalizeUsername(username)
    passwordInput(password, true)
    const user = { id: crypto.randomUUID(), username: normalized, roles: ['member'], passwordHash: await this.passwords.hash(password) }
    if (!await this.store.createUser(user)) throw new AuthError('USERNAME_TAKEN')
    return publicUser(user)
  }
  async login(username: string, password: string, previousToken?: string): Promise<{ user: AuthUser; session: IssuedSession }> {
    const normalized = normalizeUsername(username)
    passwordInput(password)
    const now = this.clock()
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + this.loginWindowMs)) throw new Error('Invalid authentication clock')
    const key = await tokenHash(normalized)
    const retryAt = await this.store.consumeLoginAttempt(key, now, this.loginLimit, this.loginWindowMs)
    if (retryAt !== undefined) throw new AuthError('RATE_LIMITED', Math.max(1000, retryAt - now))
    const user = await this.store.findUserByUsername(normalized)
    const verified = await this.passwords.verify(password, user?.passwordHash)
    if (!verified || !user) throw new AuthError('INVALID_CREDENTIALS')
    await this.store.clearLoginAttempts(key)
    const safe = publicUser(user)
    return { user: safe, session: await this.sessions.create(safe.id, previousToken) }
  }
  async authenticate(token: string | undefined): Promise<Authenticated | undefined> {
    const session = await this.sessions.authenticate(token)
    if (!session) return undefined
    const user = await this.store.findUserById(session.userId)
    if (!user) { await this.sessions.revoke(token); return undefined }
    return Object.freeze({ user: publicUser(user), session: Object.freeze({ expiresAt: session.expiresAt }) })
  }
  async authenticateInTransaction(transaction: SqlExecutor, token: string | undefined): Promise<Authenticated | undefined> {
    if (!validSessionToken(token)) return undefined
    const store = this.store as Partial<TransactionalAuthStore>
    if (typeof store.readAuthenticationInTransaction !== 'function') throw new Error('Auth store does not support transactional authentication')
    const hash = await tokenHash(token), record = await store.readAuthenticationInTransaction(transaction, hash)
    const now = this.clock()
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid authentication clock')
    if (!record) return undefined
    if (record.session.tokenHash !== hash || record.session.userId !== record.user.id || !Number.isSafeInteger(record.session.expiresAt)) throw new Error('Invalid transaction authentication record')
    // Check after waiting for ownership. Expired rows are cleaned separately, without upgrading read locks here.
    if (record.session.expiresAt <= now) return undefined
    return Object.freeze({ user: publicUser(record.user), session: Object.freeze({ expiresAt: record.session.expiresAt }) })
  }
  logout(token: string | undefined): Promise<void> { return this.sessions.revoke(token) }
  revokeAll(userId: string): Promise<void> { return this.sessions.revokeAll(userId) }
}

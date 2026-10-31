import { AuthError, normalizeUsername, passwordInput } from './credentials.js'
import { tokenHash, validSessionToken } from './sessions.js'
import type { AuthStore, AuthUser, PasswordHasher } from './types.js'

export class PasswordResetError extends Error {
  readonly code = 'INVALID_RESET_TOKEN'
  constructor() { super('Invalid or expired reset token'); this.name = 'PasswordResetError' }
}
export type PasswordResetIssue = { readonly userId: string; readonly tokenHash: string; readonly expiresAt: number }
export type PasswordResetConfirm = { readonly tokenHash: string; readonly nextPasswordHash: string }
/** One borrowed account database. Every method commits as one transaction or has no effect. */
export interface PasswordResetStore {
  /** Replace the user's outstanding token and bind the new one to their current credential. False means no such user. */
  issue(input: PasswordResetIssue): Promise<boolean>
  /** Spend the token. On success replace the password and revoke every session, and return the user ID.
   * undefined means unusable: unknown, expired, or issued against a credential that has since changed. */
  consume(input: PasswordResetConfirm, now: () => number): Promise<string | undefined>
  prune(now: number): Promise<number>
}
/** The raw token exists only here and in the link you send. Never log or persist it. */
export type PasswordResetDelivery = { readonly user: AuthUser; readonly token: string; readonly expiresAt: number }
export type PasswordResetOptions = {
  readonly deliver: (delivery: PasswordResetDelivery) => void | Promise<void>
  readonly ttlMs?: number
  readonly clock?: () => number
  /** Requests per username per window. Extra requests do nothing, and look the same to the caller. */
  readonly requestLimit?: number
  readonly requestWindowMs?: number
}

export function snapshotResetIssue(input: PasswordResetIssue): PasswordResetIssue {
  const { userId, tokenHash: hash, expiresAt } = input
  if (typeof userId !== 'string' || !userId || !validSessionToken(hash) || !Number.isSafeInteger(expiresAt) || expiresAt < 0) throw new Error('Invalid password reset input')
  return Object.freeze({ userId, tokenHash: hash, expiresAt })
}
export function snapshotResetConfirm(input: PasswordResetConfirm): PasswordResetConfirm {
  const { tokenHash: hash, nextPasswordHash } = input
  if (!validSessionToken(hash) || typeof nextPasswordHash !== 'string' || !nextPasswordHash) throw new Error('Invalid password reset input')
  return Object.freeze({ tokenHash: hash, nextPasswordHash })
}
function randomToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Forgotten-password recovery. Delivery is the application's: LongHorn holds no contact details. */
export class PasswordResets {
  private readonly deliver: PasswordResetOptions['deliver']
  private readonly ttlMs: number
  private readonly clock: () => number
  private readonly requestLimit: number
  private readonly requestWindowMs: number
  constructor(private readonly accounts: AuthStore, private readonly resets: PasswordResetStore, private readonly passwords: PasswordHasher, options: PasswordResetOptions) {
    if (typeof options?.deliver !== 'function') throw new Error('A password reset delivery function is required')
    this.deliver = options.deliver
    this.ttlMs = options.ttlMs ?? 30 * 60 * 1000
    this.clock = options.clock ?? Date.now
    this.requestLimit = options.requestLimit ?? 5
    this.requestWindowMs = options.requestWindowMs ?? 60 * 60 * 1000
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs < 60 * 1000 || this.ttlMs > 24 * 60 * 60 * 1000) throw new Error('Reset token lifetime must be between one minute and one day')
    if (!Number.isSafeInteger(this.requestLimit) || this.requestLimit < 1 || this.requestLimit > 1000
      || !Number.isSafeInteger(this.requestWindowMs) || this.requestWindowMs < 1000 || this.requestWindowMs > 24 * 60 * 60 * 1000) throw new Error('Invalid reset request throttle settings')
  }
  private now(): number {
    const now = this.clock()
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + this.ttlMs)) throw new Error('Invalid password reset clock')
    return now
  }
  /** Resolves the same way for known, unknown and throttled accounts. Its duration still differs,
   * so an HTTP route must respond first and run this as background work. Rejects on store or delivery failure. */
  async request(username: string): Promise<void> {
    let normalized: string
    try { normalized = normalizeUsername(username) } catch (error) { if (error instanceof AuthError) return; throw error }
    const now = this.now(), key = await tokenHash('password-reset:' + normalized)
    if (await this.accounts.consumeLoginAttempt(key, now, this.requestLimit, this.requestWindowMs) !== undefined) return
    const user = await this.accounts.findUserByUsername(normalized)
    if (!user) return
    const token = randomToken(), expiresAt = now + this.ttlMs
    if (!await this.resets.issue({ userId: user.id, tokenHash: await tokenHash(token), expiresAt })) return
    await this.deliver(Object.freeze({ user: Object.freeze({ id: user.id, username: user.username, roles: Object.freeze([...user.roles]) }), token, expiresAt }))
  }
  /** Spends the token, replaces the password and revokes every session in one commit. */
  async confirm(token: string, nextPassword: string): Promise<void> {
    passwordInput(nextPassword, true)
    if (!validSessionToken(token)) throw new PasswordResetError()
    const nextPasswordHash = await this.passwords.hash(nextPassword)
    const userId = await this.resets.consume({ tokenHash: await tokenHash(token), nextPasswordHash }, () => this.now())
    if (userId === undefined) throw new PasswordResetError()
    // The account is recovered at this point. A leftover lockout must not turn that into an error.
    try {
      const user = await this.accounts.findUserById(userId)
      if (user) await this.accounts.clearLoginAttempts(await tokenHash(user.username))
    } catch { /* The window expires by itself. */ }
  }
  /** Remove expired tokens. Spent ones are already gone. */
  prune(): Promise<number> { return this.resets.prune(this.now()) }
}

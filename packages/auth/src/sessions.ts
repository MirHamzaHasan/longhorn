import type { IssuedSession, SessionStore, StoredSession } from './types.js'

export async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
export function validSessionToken(token: string | undefined): token is string { return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) }
/** Return false without writes when the candidate's credential snapshot is no longer current. */
export type SessionCommit = (session: StoredSession, previousHash?: string) => Promise<boolean>

export class SessionManager {
  private readonly ttlMs: number
  private readonly clock: () => number
  constructor(private readonly store: SessionStore, options: { ttlMs?: number; clock?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? 8 * 60 * 60 * 1000
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs < 1000 || this.ttlMs > 30 * 24 * 60 * 60 * 1000) {
      throw new Error('Session lifetime must be between one second and 30 days')
    }
    this.clock = options.clock ?? Date.now
  }
  private now(): number {
    const now = this.clock()
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + this.ttlMs)) throw new Error('Invalid session clock')
    return now
  }
  async create(userId: string, previousToken?: string): Promise<IssuedSession> {
    const issued = await this.createIf(userId, async (session, previousHash) => {
      await this.store.createSession(session, previousHash); return true
    }, previousToken)
    return issued!
  }
  async createIf(userId: string, commit: SessionCommit, previousToken?: string): Promise<IssuedSession | undefined> {
    if (typeof userId !== 'string' || !userId) throw new Error('Session user ID must not be empty')
    if (typeof commit !== 'function') throw new Error('A session commit operation is required')
    const token = [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    const expiresAt = this.now() + this.ttlMs
    const candidate = Object.freeze({ tokenHash: await tokenHash(token), userId, expiresAt })
    const accepted = await commit(candidate,
      validSessionToken(previousToken) ? await tokenHash(previousToken) : undefined)
    if (typeof accepted !== 'boolean') throw new Error('Invalid session commit result')
    return accepted ? Object.freeze({ token, expiresAt }) : undefined
  }
  async authenticate(token: string | undefined): Promise<StoredSession | undefined> {
    if (!validSessionToken(token)) return undefined
    const hash = await tokenHash(token)
    const session = await this.store.findSession(hash)
    if (!session) return undefined
    if (session.tokenHash !== hash || !session.userId || !Number.isSafeInteger(session.expiresAt)) throw new Error('Invalid session store record')
    if (session.expiresAt <= this.now()) { await this.store.deleteSession(hash); return undefined }
    return Object.freeze({ ...session })
  }
  async revoke(token: string | undefined): Promise<void> {
    if (validSessionToken(token)) await this.store.deleteSession(await tokenHash(token))
  }
  revokeAll(userId: string): Promise<void> { return this.store.deleteUserSessions(userId) }
  purgeExpired(): Promise<number> { return this.store.deleteExpiredSessions(this.now()) }
}

import { AuthError } from './credentials.js'
import { tokenHash, validSessionToken } from './sessions.js'
import { sessionControlTime } from './session-control.js'

export type SessionEntry = Readonly<{ id: string; expiresAt: number; current: boolean }>
export type SessionPosition = Readonly<{ owner: string; initiator: string; id: string; expiresAt: number }>
export type StoredSessionPage = Readonly<{ sessions: readonly SessionEntry[]; next: SessionPosition | null }>
export type SessionPage = Readonly<{ sessions: readonly SessionEntry[]; nextCursor: string | null }>
export type SessionRevocation = Readonly<{ revokedSessions: number; current: boolean }>
export interface SessionInventoryStore {
  /** Reauthenticate under ownership, sample now once afterwards, and publish only after commit. */
  list(input: Readonly<{ tokenHash: string; limit: number; after: SessionPosition | null }>, now: () => number): Promise<StoredSessionPage | undefined>
  revoke(input: Readonly<{ tokenHash: string; id: string }>, now: () => number): Promise<SessionRevocation | undefined>
}
export const validSessionReference = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id)
export function validSessionPosition(value: unknown): value is SessionPosition {
  if (!value || typeof value !== 'object') return false
  const row = value as SessionPosition
  return typeof row.owner === 'string' && row.owner.length > 0 && new TextEncoder().encode(row.owner).byteLength <= 256 && validSessionReference(row.initiator) && validSessionReference(row.id) && Number.isSafeInteger(row.expiresAt) && row.expiresAt >= 0
}
function positionAfter(left: Pick<SessionEntry, 'expiresAt' | 'id'>, right: Pick<SessionEntry, 'expiresAt' | 'id'>): boolean {
  return left.expiresAt > right.expiresAt || (left.expiresAt === right.expiresAt && left.id > right.id)
}
function decode(cursor: string | undefined): SessionPosition | null {
  if (cursor === undefined) return null
  try {
    if (!cursor || cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error()
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(cursor.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0)))
    const data: unknown = JSON.parse(text)
    if (!data || typeof data !== 'object' || Object.keys(data).sort().join(',') !== 'expiresAt,id,initiator,owner,v' || (data as { v?: unknown }).v !== 1 || !validSessionPosition(data)) throw new Error()
    return Object.freeze({ owner: data.owner, initiator: data.initiator, id: data.id, expiresAt: data.expiresAt })
  } catch { throw new AuthError('INVALID_INPUT') }
}
function encode(position: SessionPosition): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, owner: position.owner, initiator: position.initiator, id: position.id, expiresAt: position.expiresAt }))
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
/** Optional capability; existing AuthStore, SessionManager and login writers stay unchanged. */
export class SessionInventory {
  private readonly store: SessionInventoryStore
  private readonly clock: () => number
  constructor(store: SessionInventoryStore, options: { clock?: () => number } = {}) {
    if (typeof store?.list !== 'function' || typeof store.revoke !== 'function' || (options.clock !== undefined && typeof options.clock !== 'function')) throw new Error('Session inventory requires a store and trusted clock')
    this.store = { list: store.list.bind(store), revoke: store.revoke.bind(store) }; this.clock = options.clock ?? Date.now
  }
  private observation() {
    let sampled: number | undefined
    return { now: () => { if (sampled !== undefined) throw new Error('Session inventory clock sampled twice'); return sampled = sessionControlTime(this.clock()) }, sampled: () => sampled }
  }
  async list(token: string | undefined, options: { limit?: number; cursor?: string } = {}): Promise<SessionPage> {
    if (!validSessionToken(token)) throw new AuthError('INVALID_CREDENTIALS')
    const limit = options.limit ?? 10, after = decode(options.cursor)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new AuthError('INVALID_INPUT')
    const clock = this.observation(), input = Object.freeze({ tokenHash: await tokenHash(token), limit, after })
    const page = await this.store.list(input, clock.now)
    if (page === undefined) throw new AuthError('INVALID_CREDENTIALS')
    const time = clock.sampled()
    if (time === undefined || !Array.isArray(page.sessions) || page.sessions.length > limit || (page.next !== null && !validSessionPosition(page.next))) throw new Error('Invalid session inventory page')
    const seen = new Set<string>(); let previous: Pick<SessionEntry, 'id' | 'expiresAt'> | null = after, current = 0
    const sessions = page.sessions.map(value => {
      if (!value || !validSessionReference(value.id) || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= time || typeof value.current !== 'boolean' || seen.has(value.id) || (previous && !positionAfter(value, previous))) throw new Error('Invalid session inventory entry')
      seen.add(value.id); previous = value; if (value.current) current++
      return Object.freeze({ id: value.id, expiresAt: value.expiresAt, current: value.current })
    })
    if (current > 1 || (page.next && (sessions.length !== limit || page.next.id !== sessions.at(-1)?.id || page.next.expiresAt !== sessions.at(-1)?.expiresAt || (after && (page.next.owner !== after.owner || page.next.initiator !== after.initiator))))) throw new Error('Invalid session inventory continuation')
    return Object.freeze({ sessions: Object.freeze(sessions), nextCursor: page.next ? encode(page.next) : null })
  }
  async revoke(token: string | undefined, id: string): Promise<SessionRevocation> {
    if (!validSessionToken(token)) throw new AuthError('INVALID_CREDENTIALS')
    if (!validSessionReference(id)) throw new AuthError('INVALID_INPUT')
    const clock = this.observation(), result = await this.store.revoke(Object.freeze({ tokenHash: await tokenHash(token), id }), clock.now)
    if (result === undefined) throw new AuthError('INVALID_CREDENTIALS')
    if (clock.sampled() === undefined || ![0, 1].includes(result.revokedSessions) || typeof result.current !== 'boolean' || (result.current && result.revokedSessions !== 1)) throw new Error('Invalid session inventory revocation')
    return Object.freeze({ revokedSessions: result.revokedSessions, current: result.current })
  }
}

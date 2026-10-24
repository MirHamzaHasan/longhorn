import type { PasswordChangeInput, PasswordSessionInput } from './types.js'

const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0
export function passwordTimestamp(value: unknown): number {
  const number = typeof value === 'bigint' ? Number(value) : value
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0) throw new Error('Invalid password operation timestamp')
  return number
}
export function snapshotPasswordSession(input: PasswordSessionInput): PasswordSessionInput {
  const { tokenHash, userId, expiresAt } = input.session
  const { previousHash, expectedPasswordHash, attemptKey } = input
  if (!digest(tokenHash) || !text(userId) || !text(expectedPasswordHash) || !digest(attemptKey)
    || (previousHash !== undefined && !digest(previousHash))) throw new Error('Invalid password session input')
  return Object.freeze({ session: Object.freeze({ tokenHash, userId, expiresAt: passwordTimestamp(expiresAt) }),
    expectedPasswordHash, attemptKey, ...(previousHash === undefined ? {} : { previousHash }) })
}
export function snapshotPasswordChange(input: PasswordChangeInput): PasswordChangeInput {
  const { userId, tokenHash, expectedPasswordHash, nextPasswordHash, attemptKey } = input
  if (!text(userId) || !digest(tokenHash) || !text(expectedPasswordHash) || !text(nextPasswordHash) || !digest(attemptKey)) throw new Error('Invalid password change input')
  return Object.freeze({ userId, tokenHash, expectedPasswordHash, nextPasswordHash, attemptKey })
}

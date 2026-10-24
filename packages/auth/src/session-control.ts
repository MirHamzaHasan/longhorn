import type { SessionControlInput } from './types.js'

export function sessionControlTime(value: unknown): number {
  const result = typeof value === 'bigint' ? Number(value) : value
  if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 0) throw new Error('Invalid session control timestamp')
  return result
}
export function snapshotSessionControl(input: SessionControlInput): SessionControlInput {
  const { tokenHash, scope } = input
  if (typeof tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(tokenHash) || (scope !== 'others' && scope !== 'all')) throw new Error('Invalid session control input')
  return Object.freeze({ tokenHash, scope })
}

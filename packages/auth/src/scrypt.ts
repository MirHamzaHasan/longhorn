import { AuthError } from './credentials.js'
import type { PasswordHasher } from './types.js'

export type ScryptOptions = { readonly concurrency?: number; readonly maxQueue?: number }
export type ScryptParameters = { readonly N: 131072; readonly r: 8; readonly p: 1; readonly maxmem: 268435456 }
export type ScryptDriver = {
  derive(password: string, salt: Uint8Array, parameters: ScryptParameters): Promise<Uint8Array>
  equal(actual: Uint8Array, expected: Uint8Array): boolean
}
const parameters: ScryptParameters = Object.freeze({ N: 131072, r: 8, p: 1, maxmem: 268435456 })
const format = /^scrypt\$v=1\$n=131072,r=8,p=1\$([a-f0-9]{32})\$([a-f0-9]{128})$/
const encoder = new TextEncoder()
const hex = (bytes: Uint8Array) => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
const bytes = (value: string) => Uint8Array.from(value.match(/../g)!, pair => Number.parseInt(pair, 16))
const failure = () => new Error('Native password operation failed')

/** Shared policy only. Trusted adapters supply native derivation and native equal-length comparison. */
export function createScryptPasswordHasher(driver: ScryptDriver, options: ScryptOptions = {}): PasswordHasher {
  const concurrency = options.concurrency ?? 1, maxQueue = options.maxQueue ?? 8
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4
    || !Number.isInteger(maxQueue) || maxQueue < 0 || maxQueue > 100) throw new Error('Invalid password worker limits')
  if (typeof driver?.derive !== 'function' || typeof driver.equal !== 'function') throw failure()
  const deriveNative = driver.derive.bind(driver), equalNative = driver.equal.bind(driver)
  const dummySalt = crypto.getRandomValues(new Uint8Array(16)), dummyHash = crypto.getRandomValues(new Uint8Array(64))
  let running = 0
  const waiting: (() => void)[] = []
  async function derive(password: string, salt: Uint8Array): Promise<Uint8Array> {
    if (typeof password !== 'string' || password.length > 1024 || encoder.encode(password).byteLength > 1024) throw new AuthError('INVALID_INPUT')
    if (running >= concurrency) {
      if (waiting.length >= maxQueue) throw new AuthError('CAPACITY')
      await new Promise<void>(resolve => waiting.push(resolve))
    } else running++
    try {
      const result = await deriveNative(password, salt, parameters)
      if (!(result instanceof Uint8Array) || result.byteLength !== 64) throw failure()
      return result
    } catch { throw failure() }
    finally { const next = waiting.shift(); if (next) next(); else running-- }
  }
  return {
    async hash(password: string) {
      const salt = crypto.getRandomValues(new Uint8Array(16))
      const result = await derive(password, salt)
      return `scrypt$v=1$n=131072,r=8,p=1$${hex(salt)}$${hex(result)}`
    },
    async verify(password: string, encodedHash: string | undefined) {
      const match = typeof encodedHash === 'string' ? format.exec(encodedHash) : null
      const salt = match ? bytes(match[1]!) : dummySalt, expected = match ? bytes(match[2]!) : dummyHash
      const actual = await derive(password, salt)
      let equal: boolean
      try { equal = equalNative(actual, expected); if (typeof equal !== 'boolean') throw failure() }
      catch { throw failure() }
      return match !== null && equal
    },
  }
}

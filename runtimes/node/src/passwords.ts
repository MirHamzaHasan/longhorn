import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { AuthError } from '@longhorn/auth'
import type { PasswordHasher } from '@longhorn/auth'

const parameters = Object.freeze({ N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 })
const format = /^scrypt\$v=1\$n=131072,r=8,p=1\$([a-f0-9]{32})\$([a-f0-9]{128})$/

/** Native password work stays outside shared auth. Queue bounds limit memory use. */
export function createScryptPasswordHasher(options: { concurrency?: number; maxQueue?: number } = {}): PasswordHasher {
  const concurrency = options.concurrency ?? 1
  const maxQueue = options.maxQueue ?? 8
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4
    || !Number.isInteger(maxQueue) || maxQueue < 0 || maxQueue > 100) throw new Error('Invalid password worker limits')
  const dummySalt = randomBytes(16)
  const dummyHash = randomBytes(64)
  let running = 0
  const waiting: (() => void)[] = []
  async function derive(password: string, salt: Buffer): Promise<Buffer> {
    if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 1024) throw new AuthError('INVALID_INPUT')
    if (running >= concurrency) {
      if (waiting.length >= maxQueue) throw new AuthError('CAPACITY')
      await new Promise<void>((resolve) => waiting.push(resolve))
    } else running++
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        scrypt(password, salt, 64, parameters, (error, hash) => error ? reject(error) : resolve(hash))
      })
    } finally {
      const next = waiting.shift()
      if (next) next()
      else running--
    }
  }
  return {
    async hash(password) {
      const salt = randomBytes(16)
      const hash = await derive(password, salt)
      return `scrypt$v=1$n=131072,r=8,p=1$${salt.toString('hex')}$${hash.toString('hex')}`
    },
    async verify(password, encodedHash) {
      const match = typeof encodedHash === 'string' ? format.exec(encodedHash) : null
      const salt = match ? Buffer.from(match[1]!, 'hex') : dummySalt
      const expected = match ? Buffer.from(match[2]!, 'hex') : dummyHash
      const actual = await derive(password, salt)
      const equal = timingSafeEqual(actual, expected)
      return match !== null && equal
    },
  }
}

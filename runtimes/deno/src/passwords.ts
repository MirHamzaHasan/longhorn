import { scrypt, timingSafeEqual } from 'node:crypto'
import { createScryptPasswordHasher as createPolicy } from '@longhornjs/auth/scrypt'
import type { PasswordHasher } from '@longhornjs/auth'
import type { ScryptOptions } from '@longhornjs/auth/scrypt'

/** Native derivation and comparison; the fixed format/admission policy is shared. */
export function createScryptPasswordHasher(options: ScryptOptions = {}): PasswordHasher {
  if (typeof Deno === 'undefined') throw new Error('The Deno password adapter must run in Deno')
  return createPolicy({
    derive: (password, salt, parameters) => new Promise((resolve, reject) => {
      scrypt(password, salt, 64, parameters, (error, key) => error ? reject(error) : resolve(key))
    }),
    equal: timingSafeEqual,
  }, options)
}

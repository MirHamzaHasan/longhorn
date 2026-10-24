import { createScryptPasswordHasher } from '../../packages/auth/dist/scrypt.js'

// Test-only native-driver replacement: verifies the pure policy/bundle, never real password security.
export default { async fetch() {
  const passwords = createScryptPasswordHasher({ derive: async () => new Uint8Array(64), equal: () => true })
  const hash = await passwords.hash('policy fixture')
  if (!await passwords.verify('policy fixture', hash) || await passwords.verify('policy fixture', undefined)) throw new Error('Portable scrypt policy failed')
  return Response.json({ policy: true, nativePasswordBackend: false })
} }

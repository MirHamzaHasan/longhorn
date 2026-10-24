import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createScryptPasswordHasher as nodePasswords } from '../../runtimes/node/dist/passwords.js'
import { createScryptPasswordHasher as bunPasswords } from '../../runtimes/bun/dist/passwords.js'
import { createScryptPasswordHasher as denoPasswords } from '../../runtimes/deno/dist/passwords.js'

const [runtime, filename, mode] = process.argv.slice(2)
const factory = { node: nodePasswords, bun: bunPasswords, deno: denoPasswords }[runtime]
const input = JSON.parse(await readFile(filename, 'utf8')), passwords = factory()
for (const record of input.records) {
  assert.equal(await passwords.verify(input.password, record.hash), true)
  assert.equal(await passwords.verify(input.password.trim(), record.hash), false)
}
if (mode !== 'verify') {
  let ticks = 0; const timer = setInterval(() => { ticks++ }, 1)
  let hash
  try { hash = await passwords.hash(input.password) } finally { clearInterval(timer) }
  assert.ok(ticks > 0, 'Native derivation must permit event-loop progress')
  assert.match(hash, /^scrypt\$v=1\$n=131072,r=8,p=1\$[a-f0-9]{32}\$[a-f0-9]{128}$/)
  assert.ok(!input.records.some(record => record.hash === hash))
  assert.equal(await passwords.verify(input.password, hash), true)
  await assert.rejects(passwords.hash('é'.repeat(513)), { code: 'INVALID_INPUT' })
  const limited = factory({ concurrency: 1, maxQueue: 0 })
  for (const malformed of [undefined, hash.replace('131072', '999999999')]) {
    const dummy = limited.verify(input.password, malformed)
    await assert.rejects(limited.hash(input.password), { code: 'CAPACITY' })
    assert.equal(await dummy, false)
  }
  const queued = factory({ concurrency: 1, maxQueue: 1 })
  const first = queued.hash(input.password), second = queued.hash(input.password)
  await assert.rejects(queued.hash(input.password), { code: 'CAPACITY' })
  const values = await Promise.all([first, second]); assert.notEqual(values[0], values[1])
  await writeFile(filename, JSON.stringify({ ...input, records: [...input.records, { runtime, hash }] }), { mode: 0o600 })
}
console.log(JSON.stringify({ runtime, verified: input.records.length, native: true, mode: mode ?? 'contract' }))

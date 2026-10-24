import assert from 'node:assert/strict'

const [allowed, outside] = Deno.args
assert.equal(Deno.permissions.querySync({ name: 'read', path: allowed }).state, 'granted')
assert.equal(Deno.permissions.querySync({ name: 'write', path: allowed }).state, 'granted')
assert.equal(Deno.permissions.querySync({ name: 'env', variable: 'PORT' }).state, 'granted')
assert.notEqual(Deno.permissions.querySync({ name: 'run', command: Deno.execPath() }).state, 'granted')
await assert.rejects(Deno.writeTextFile(outside, 'must not be created'), error => error instanceof Deno.errors.NotCapable)
assert.throws(() => Deno.env.get('LONGHORN_UNRELATED'), error => error instanceof Deno.errors.NotCapable)
let listener
try { assert.throws(() => { listener = Deno.listen({ hostname: '127.0.0.2', port: 0 }) }, error => error instanceof Deno.errors.NotCapable) }
finally { listener?.close() }
console.log('Configured Deno policy grants the selected data path and denies outside writes, unrelated environment, subprocesses and another network host.')

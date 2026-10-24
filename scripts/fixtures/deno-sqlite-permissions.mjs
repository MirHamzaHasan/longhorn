import assert from 'node:assert/strict'
import { openSqlite } from '../../runtimes/deno/dist/sqlite.js'

const [mode, filename, denied] = Deno.args
if (mode === 'memory') {
  const db = await openSqlite({ filename: ':memory:' })
  try { assert.equal((await db.execute('SELECT 1 AS n')).rows[0].n, 1n) } finally { await db.close() }
} else if (mode === 'open') {
  await assert.rejects(openSqlite({ filename }), { code: 'open' })
} else if (mode === 'attach') {
  const db = await openSqlite({ filename })
  try {
    await assert.rejects(db.execute({ sql: 'ATTACH DATABASE ? AS forbidden', args: [denied] }), { code: 'storage' })
    await db.execute('CREATE TABLE allowed(v TEXT)')
  } finally { await db.close() }
} else throw new Error('Unknown permission mode')
console.log(JSON.stringify({ permissions: mode, rejected: true }))

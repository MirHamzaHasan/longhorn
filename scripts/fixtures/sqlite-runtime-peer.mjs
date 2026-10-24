import assert from 'node:assert/strict'

const [runtime, filename] = process.argv.slice(2)
const { openSqlite } = runtime === 'node'
  ? await import('../../runtimes/node/dist/sqlite.js')
  : await import('../../runtimes/bun/dist/sqlite.js')
const database = await openSqlite({ filename })
try {
  const count = (await database.execute('SELECT count(*) AS n, max(id) AS maximum FROM tasks')).rows[0]
  let cursor = 0n, seen = 0, first
  while (true) {
    const rows = (await database.execute({ sql: 'SELECT id,title,completed FROM tasks WHERE id>? ORDER BY id LIMIT 100', args: [cursor] })).rows
    if (!rows.length) break
    for (const row of rows) {
      const id = BigInt(row.id); assert.ok(id > cursor); cursor = id; seen++
      assert.equal(typeof row.title, 'string'); assert.ok([0n, 1n, 0, 1].includes(row.completed))
      first ??= row
    }
  }
  assert.equal(String(seen), String(count.n)); assert.equal(String(cursor), String(count.maximum))
  await database.transaction(async tx => { await tx.execute({ sql: 'UPDATE tasks SET title=? WHERE id=1', args: [runtime + ' native peer'] }) })
  console.log(JSON.stringify({ count: String(count.n), maximum: String(count.maximum), previous: first.title }))
} finally { await database.close() }

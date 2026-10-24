const [runtime, filename] = process.argv.slice(2)
const { openSqlite } = runtime === 'node'
  ? await import('../../runtimes/node/dist/sqlite.js')
  : await import('../../runtimes/bun/dist/sqlite.js')
const database = await openSqlite({ filename })
try {
  const count = (await database.execute('SELECT count(*) AS n, max(id) AS maximum FROM tasks')).rows[0]
  const first = (await database.execute('SELECT title FROM tasks WHERE id=1')).rows[0]
  await database.transaction(async tx => { await tx.execute({ sql: 'UPDATE tasks SET title=? WHERE id=1', args: [runtime + ' native peer'] }) })
  console.log(JSON.stringify({ count: String(count.n), maximum: String(count.maximum), previous: first.title }))
} finally { await database.close() }

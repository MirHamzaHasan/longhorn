import { openSqlite } from '../../runtimes/deno/dist/sqlite.js'

const [mode, filename] = process.argv.slice(2)
const database = await openSqlite({ filename, busyTimeoutMs: mode === 'contend' ? 100 : 5000 })
const report = value => console.log(JSON.stringify(value))
const forever = async () => { while (true) await new Promise(resolve => setTimeout(resolve, 60_000)) }
try {
  if (mode === 'init') {
    await database.execute('CREATE TABLE effects(label TEXT PRIMARY KEY)')
  } else if (mode === 'wide-task') {
    await database.execute({ sql: 'INSERT INTO tasks(id,title) VALUES(?,?)', args: [9223372036854775807n, 'Wide int64 cursor'] })
  } else if (mode === 'before' || mode === 'hold') {
    await database.transaction(async tx => {
      await tx.execute({ sql: 'INSERT INTO effects VALUES(?)', args: [mode] })
      report({ phase: 'uncommitted' })
      if (mode === 'hold') await new Response(Deno.stdin.readable).text()
      else await forever()
    })
  } else if (mode === 'after') {
    await database.transaction(async tx => { await tx.execute("INSERT INTO effects VALUES('after')") })
    report({ phase: 'committed' })
    await forever()
  } else if (mode === 'contend') {
    try {
      await database.execute("INSERT INTO effects VALUES('contender')")
      report({ unexpected: true })
    } catch (error) { report({ code: error.code, message: error.message }) }
  } else if (mode === 'inspect') {
    report({ labels: (await database.execute('SELECT label FROM effects ORDER BY label')).rows.map(row => row.label), integrity: (await database.execute('PRAGMA integrity_check')).rows[0].integrity_check })
  } else throw new Error('Unknown fixture mode')
} finally { await database.close() }

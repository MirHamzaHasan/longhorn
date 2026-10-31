import type { Database } from './index.js'

export type Migration = { readonly id: string; readonly statements: readonly string[] }

async function checksum(statements: readonly string[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(statements))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Ordered, forward-only migrations. The adapter must supply a write transaction. */
export async function migrate(database: Database, migrations: readonly Migration[]): Promise<readonly string[]> {
  if (database.dialect === 'postgres') throw new Error('Use migratePostgres from @longhornjs/database/postgres for PostgreSQL')
  const ids = new Set<string>()
  for (const migration of migrations) {
    if (!migration.id.trim() || ids.has(migration.id)) throw new Error('Migration IDs must be nonempty and unique')
    ids.add(migration.id)
  }
  const checksums = await Promise.all(migrations.map((migration) => checksum(migration.statements)))

  return database.transaction(async (tx) => {
    await tx.execute(`CREATE TABLE IF NOT EXISTS longhorn_migrations (
      position INTEGER NOT NULL UNIQUE,
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`)
    const applied = (await tx.execute('SELECT position, id, checksum FROM longhorn_migrations ORDER BY position')).rows
    if (applied.length > migrations.length) throw new Error('Database contains migrations unavailable to this application')
    for (let index = 0; index < applied.length; index++) {
      const row = applied[index]!
      if (row.id !== migrations[index]!.id || Number(row.position) !== index) {
        throw new Error('Applied migrations must remain an ordered prefix of the migration list')
      }
      if (row.checksum !== checksums[index]) throw new Error(`Applied migration changed: ${migrations[index]!.id}`)
    }

    const added: string[] = []
    for (let index = applied.length; index < migrations.length; index++) {
      const migration = migrations[index]!
      for (const statement of migration.statements) await tx.execute(statement)
      await tx.execute({
        sql: 'INSERT INTO longhorn_migrations (position, id, checksum, applied_at) VALUES (?, ?, ?, ?)',
        args: [index, migration.id, checksums[index]!, new Date().toISOString()],
      })
      added.push(migration.id)
    }
    return added
  })
}

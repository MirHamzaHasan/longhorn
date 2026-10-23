import type { Database, Migration } from './index.js'

function schemaName(value: string): string {
  if (typeof value !== 'string' || !/^[a-z_][a-z0-9_]{0,62}$/.test(value) || value.startsWith('pg_') || value === 'information_schema') throw new Error('Invalid migration schema')
  return `"${value}"`
}
async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** PostgreSQL transactional migrations; one immutable ordered history per explicit schema. */
export async function migratePostgres(database: Database, migrations: readonly Migration[], options: { schema?: string } = {}): Promise<readonly string[]> {
  if (database.dialect !== undefined && database.dialect !== 'postgres') throw new Error('PostgreSQL migrations require a PostgreSQL database')
  const schema = options.schema ?? 'longhorn', quoted = schemaName(schema)
  const snapshot = migrations.map((migration) => ({ id: migration.id, statements: [...migration.statements] }))
  const ids = new Set<string>()
  for (const migration of snapshot) {
    if (typeof migration.id !== 'string' || !migration.id.trim() || ids.has(migration.id) || migration.statements.some((sql) => typeof sql !== 'string' || !sql.trim())) throw new Error('Migrations require unique nonempty IDs and SQL statements')
    ids.add(migration.id)
  }
  const checksums = await Promise.all(snapshot.map((migration) => hash(JSON.stringify(migration.statements))))
  const key = BigInt.asIntN(64, BigInt(`0x${(await hash(`longhorn:migrations:${schema}`)).slice(0, 16)}`))
  return database.transaction(async (tx) => {
    // Lock before schema/table creation, including the first concurrent application startup.
    await tx.execute({ sql: 'SELECT pg_catalog.pg_advisory_xact_lock($1::bigint)', args: [key] })
    await tx.execute(`CREATE SCHEMA IF NOT EXISTS ${quoted}`)
    await tx.execute(`CREATE TABLE IF NOT EXISTS ${quoted}.longhorn_migrations (
      position integer NOT NULL UNIQUE CHECK (position >= 0), id text PRIMARY KEY,
      checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
    )`)
    const applied = (await tx.execute(`SELECT position, id, checksum FROM ${quoted}.longhorn_migrations ORDER BY position`)).rows
    if (applied.length > snapshot.length) throw new Error('Database contains migrations unavailable to this application')
    for (let index = 0; index < applied.length; index++) {
      const row = applied[index]!
      if (row.id !== snapshot[index]!.id || Number(row.position) !== index) throw new Error('Applied migrations must remain an ordered prefix of the migration list')
      if (row.checksum !== checksums[index]) throw new Error(`Applied migration changed: ${snapshot[index]!.id}`)
    }
    const added: string[] = []
    for (let index = applied.length; index < snapshot.length; index++) {
      const migration = snapshot[index]!
      for (const statement of migration.statements) await tx.execute(statement)
      await tx.execute({ sql: `INSERT INTO ${quoted}.longhorn_migrations (position,id,checksum) VALUES ($1,$2,$3)`, args: [index, migration.id, checksums[index]!] })
      added.push(migration.id)
    }
    return added
  })
}

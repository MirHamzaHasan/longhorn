import type { BatchDatabase,Migration,SqlStatement } from './index.js'
export class BatchMigrationError extends Error {
  constructor(readonly operation:'input'|'bootstrap'|'history'|'capacity'|'apply'){super('Batch migration failed: '+operation);this.name='BatchMigrationError'}
}
export type BatchMigrationOptions={readonly maxStatements?:number}
const encoder=new TextEncoder()
async function manifest(migrations:readonly Migration[]){
  try{
    if(!Array.isArray(migrations)||migrations.length>128)throw new Error()
    const ids=new Set<string>();let bytes=0
    const copied=Array.from(migrations,migration=>{
      if(!migration||typeof migration.id!=='string'||!/^[A-Za-z0-9._/-]{1,128}$/.test(migration.id)||ids.has(migration.id)||!Array.isArray(migration.statements)||migration.statements.length>1000)throw new Error()
      ids.add(migration.id)
      const statements=Array.from(migration.statements,sql=>{
        if(typeof sql!=='string'||!sql.trim()||sql.length>65536||sql.includes('\0')||/[\uD800-\uDFFF]/u.test(sql))throw new Error()
        const size=encoder.encode(sql).byteLength;bytes+=size;if(size>65536||bytes>1048576)throw new Error();return sql
      })
      return {id:migration.id,statements}
    })
    return await Promise.all(copied.map(async migration=>{
      const digest=await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(migration.statements)))
      return {...migration,checksum:[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')}
    }))
  }catch{throw new BatchMigrationError('input')}
}
type Manifest=Awaited<ReturnType<typeof manifest>>
async function history(database:BatchDatabase,expected:Manifest,complete=false){
  try{
    const rows=(await database.execute('SELECT position,id,checksum FROM longhorn_batch_migrations ORDER BY position LIMIT 129')).rows
    if(rows.length>expected.length||(complete&&rows.length!==expected.length))throw new Error()
    for(const[index,row]of rows.entries())if(String(row.position)!==String(index)||row.id!==expected[index]!.id||row.checksum!==expected[index]!.checksum)throw new Error()
    return rows.length
  }catch{throw new BatchMigrationError('history')}
}
function sqlite(database:BatchDatabase){if(database.dialect!=='sqlite'||typeof database.batch!=='function')throw new BatchMigrationError('input')}
/** Read-only deployment check. It never creates history or applies schema during HTTP startup. */
export async function verifySqliteBatchMigrations(database:BatchDatabase,migrations:readonly Migration[]):Promise<void>{
  sqlite(database);await history(database,await manifest(migrations),true)
}
/** Plan from a snapshot, then fence that exact prefix and commit the complete suffix in one native batch. */
export async function migrateSqliteBatch(database:BatchDatabase,migrations:readonly Migration[],options:BatchMigrationOptions={}):Promise<readonly string[]>{
  sqlite(database)
  const maximum=options.maxStatements??40
  if(!Number.isSafeInteger(maximum)||maximum<1||maximum>1000)throw new BatchMigrationError('input')
  const expected=await manifest(migrations)
  try{await database.batch([
    `CREATE TABLE IF NOT EXISTS longhorn_batch_migrations(position INTEGER NOT NULL UNIQUE CHECK(position>=0 AND position<128),id TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS longhorn_batch_migration_guard(singleton INTEGER PRIMARY KEY CHECK(singleton=1),valid INTEGER NOT NULL CHECK(valid=1))`,
  ])}catch{throw new BatchMigrationError('bootstrap')}
  const applied=await history(database,expected)
  if(applied===expected.length)return []
  const prefix=expected.slice(0,applied).map((migration,index)=>[index,migration.id,migration.checksum])
  const statements:SqlStatement[]=[{sql:`INSERT INTO longhorn_batch_migration_guard(singleton,valid) VALUES(1,CASE WHEN
    (SELECT COUNT(*) FROM longhorn_batch_migrations)=? AND NOT EXISTS(
      SELECT 1 FROM json_each(?) AS expected LEFT JOIN longhorn_batch_migrations AS actual ON actual.position=json_extract(expected.value,'$[0]')
      WHERE actual.id IS NULL OR actual.id<>json_extract(expected.value,'$[1]') OR actual.checksum<>json_extract(expected.value,'$[2]')
    ) THEN 1 ELSE 0 END) ON CONFLICT(singleton) DO UPDATE SET valid=excluded.valid`,args:[applied,JSON.stringify(prefix)]}]
  const at=new Date().toISOString()
  for(let index=applied;index<expected.length;index++){
    const migration=expected[index]!
    statements.push(...migration.statements,{sql:'INSERT INTO longhorn_batch_migrations(position,id,checksum,applied_at) VALUES(?,?,?,?)',args:[index,migration.id,migration.checksum,at]})
  }
  if(statements.length>maximum)throw new BatchMigrationError('capacity')
  try{await database.batch(statements)}catch{throw new BatchMigrationError('apply')}
  return expected.slice(applied).map(migration=>migration.id)
}

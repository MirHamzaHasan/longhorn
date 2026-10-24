import { expect,it,vi } from 'vitest'
import type { BatchDatabase,QueryResult,SqlStatement } from './index.js'
import { migrateSqliteBatch,verifySqliteBatchMigrations } from './batch.js'
const empty:QueryResult={rows:[],rowsAffected:0,lastInsertId:undefined}
function fixture(){const batch=vi.fn(async(statements:readonly SqlStatement[])=>statements.map(()=>empty)),execute=vi.fn(async()=>empty);return {batch,execute,database:{dialect:'sqlite',batch,execute,close:async()=>{}} as BatchDatabase}}
it('snapshots a bounded manifest and commits guard, all missing DDL and checksum history in one apply batch',async()=>{
  const f=fixture(),statements=['CREATE TABLE one(id INTEGER)'],migrations=[{id:'one/001',statements}]
  const pending=migrateSqliteBatch(f.database,migrations);statements[0]='changed after admission';expect(await pending).toEqual(['one/001'])
  expect(f.batch).toHaveBeenCalledTimes(2);const apply=f.batch.mock.calls[1]![0]
  expect((apply[0] as {readonly args:readonly unknown[]}).args).toEqual([0,'[]'])
  expect(apply[1]).toBe('CREATE TABLE one(id INTEGER)')
  expect((apply[2] as {readonly args:readonly unknown[]}).args[2]).toMatch(/^[0-9a-f]{64}$/)
})
it('keeps verification read-only and rejects unavailable, reordered or modified history',async()=>{
  const f=fixture();await expect(verifySqliteBatchMigrations(f.database,[{id:'one',statements:[]}])).rejects.toMatchObject({operation:'history'});expect(f.batch).not.toHaveBeenCalled()
  f.execute.mockResolvedValue({rows:[{position:0,id:'different',checksum:'x'}],rowsAffected:0,lastInsertId:undefined})
  await expect(migrateSqliteBatch(f.database,[{id:'one',statements:[]}])).rejects.toMatchObject({operation:'history'})
})
it('rejects oversized suffixes before applying and sanitizes batch failures without retries',async()=>{
  const f=fixture();await expect(migrateSqliteBatch(f.database,[{id:'one',statements:['SELECT 1','SELECT 2']}],{maxStatements:2})).rejects.toMatchObject({operation:'capacity'});expect(f.batch).toHaveBeenCalledTimes(1)
  const other=fixture();other.batch.mockRejectedValueOnce(new Error('private SQL'))
  const error=await migrateSqliteBatch(other.database,[]).catch(error=>error);expect(error.operation).toBe('bootstrap');expect(String(error)+JSON.stringify(error)).not.toContain('private')
})

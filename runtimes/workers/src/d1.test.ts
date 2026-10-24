import { expect,it,vi } from 'vitest'
import type { D1PreparedStatement } from '@cloudflare/workers-types'
import { createD1,D1Error } from './d1.js'
import type { D1Binding } from './d1.js'
const ok=(rows:unknown[]=[],changes=0,id=0)=>({success:true,meta:{changes,last_row_id:id},results:rows})
function fixture(send:(statements:readonly {sql:string;args:unknown[]}[])=>Promise<unknown[]>=async statements=>statements.map(()=>ok())){
  type Prepared={sql:string;args:unknown[];bind(...args:unknown[]):Prepared}
  const prepared=(sql:string,args:unknown[]=[]):Prepared=>({sql,args,bind:(...values)=>prepared(sql,values)})
  const batch=vi.fn(async(statements:D1PreparedStatement[])=>send(statements as unknown as Prepared[]))
  return {batch,binding:{prepare:(sql:string)=>prepared(sql),batch} as unknown as D1Binding}
}
it('snapshots SQL/arguments/blobs, maps booleans/safe bigints and returns isolated typed rows/metadata',async()=>{
  const seen:{sql:string;args:unknown[]}[][]=[],source=new Uint8Array([1,2]),f=fixture(async statements=>{seen.push([...statements]);return [ok([{id:1,body:[0,255],text:'safe',missing:null}],1,1)]})
  const db=createD1(f.binding),input={sql:'INSERT INTO rows(body) VALUES (?) RETURNING *',args:[source]},pending=db.execute(input)
  source[0]=9;input.sql='changed';const result=await pending
  expect(seen[0]![0]!.sql).toContain('INSERT');expect([...new Uint8Array(seen[0]![0]!.args[0] as ArrayBuffer)]).toEqual([1,2])
  expect(result).toMatchObject({rowsAffected:1,lastInsertId:1n,rows:[{id:1,body:new Uint8Array([0,255]),missing:null}]})
  await db.execute({sql:'SELECT ?,?',args:[true,42n]});expect(seen[1]![0]!.args).toEqual([1,42]);await db.close()
})
it('rejects multiple statements, hidden transaction controls and invalid SQL/binds before native admission',async()=>{
  const f=fixture(),db=createD1(f.binding)
  for(const sql of['SELECT 1; SELECT 2',"SELECT 'a;'; COMMIT",'-- prefix\n /*comment*/ BEGIN','SAVEPOINT point','SELECT 1 /*unfinished',"SELECT 'unfinished",'; SELECT 1'])await expect(db.execute(sql)).rejects.toMatchObject({code:'input'})
  for(const value of[Infinity,9007199254740993n,Number.MAX_SAFE_INTEGER+1,undefined,'\ud800'])await expect(db.execute({sql:'SELECT ?',args:[value] as never})).rejects.toMatchObject({code:'input'})
  expect(f.batch).not.toHaveBeenCalled();await db.close()
})
it('accepts real trigger bodies while respecting quoted delimiters, comments and CASE/END',async()=>{
  const f=fixture(),db=createD1(f.binding)
  for(const sql of["SELECT ';' AS \"semi;colon\", '[test]' /* ; */; -- tail",'CREATE TRIGGER sample AFTER INSERT ON source BEGIN INSERT INTO target SELECT CASE WHEN NEW.id=1 THEN 2 ELSE 3 END; UPDATE source SET value=1; END;',"CREATE TEMP TRIGGER sample AFTER UPDATE ON source WHEN CASE WHEN NEW.id=1 THEN 1 ELSE 0 END BEGIN SELECT 'END;'; END"] )await db.execute(sql)
  await expect(db.execute('CREATE TRIGGER t AFTER INSERT ON s BEGIN SELECT 1; END; DELETE FROM s')).rejects.toMatchObject({code:'input'})
  await db.execute('CREATE TRIGGER t AFTER INSERT ON s BEGIN SELECT NEW.end,NEW.case; END;')
  await expect(db.execute('CREATE TRIGGER t AFTER INSERT ON s BEGIN SELECT 1; END SELECT 2')).rejects.toMatchObject({code:'input'})
  expect(f.batch).toHaveBeenCalledTimes(4);await db.close()
})
it('bounds actual pending native work, stops admission at close and never closes the borrowed binding',async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve}),f=fixture(async()=>{await gate;return [ok()]}),db=createD1(f.binding,{maxPending:1})
  const first=db.execute('SELECT 1');await expect(db.execute('SELECT 2')).rejects.toMatchObject({code:'capacity'})
  const closing=db.close();expect(db.close()).toBe(closing);await expect(db.batch([])).rejects.toMatchObject({code:'closed'});expect(db.stats().closed).toBe(false)
  release();await first;await closing;expect(db.stats()).toMatchObject({closed:true,pending:0,operations:1})
  await createD1(f.binding).execute('SELECT 3')
})
it('distinguishes lossy numeric results, malformed responses and post-materialization result limits',async()=>{
  for(const[raw,code]of[[[ok([{n:9007199254740992}])],'precision'],[[ok([{body:[256]}])],'protocol'],[[ok([{a:'x'.repeat(200)}])],'result-limit'],[[],'protocol']] as const){
    const db=createD1(fixture(async()=>[...raw]).binding,{maxResultBytes:128})
    await expect(db.execute('SELECT 1')).rejects.toMatchObject({code});await db.close()
  }
  const db=createD1(fixture(async()=>[ok([{exact:'9223372036854775807'}],1,9223372036854776000)]).binding)
  expect((await db.execute('SELECT CAST(id AS TEXT)')).lastInsertId).toBeUndefined();await db.close()
})
it('sanitizes provider errors, prevalidates whole batches and applies count/byte budgets',async()=>{
  const f=fixture(async()=>{throw new Error('private SQL / bound-secret')}),db=createD1(f.binding,{maxBatchStatements:2,maxSqlBytes:64,maxInputBytes:80,maxResultRows:1})
  const error=await db.execute('SELECT 1').catch(error=>error);expect(error).toBeInstanceOf(D1Error);expect(error.code).toBe('storage');expect(String(error)+JSON.stringify(error)).not.toContain('private')
  await expect(db.batch(['SELECT 1','SELECT 2','SELECT 3'])).rejects.toMatchObject({code:'input'})
  await expect(db.batch(['SELECT 1',{sql:'SELECT ?',args:['a'.repeat(80)]}])).rejects.toMatchObject({code:'input'})
  expect(f.batch).toHaveBeenCalledTimes(1);await db.close()
})

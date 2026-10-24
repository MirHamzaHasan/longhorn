import{expect,it,vi}from'vitest'
import type{BatchDatabase,SqlStatement,QueryResult,SqlRow}from'@longhorn/database'
import{BatchIdempotency}from'./batch-sqlite.js'
const empty:QueryResult={rows:[],rowsAffected:0,lastInsertId:undefined}
const request={scope:'tasks:create:v1',key:'request-1',input:{title:'original'}}
function fixture(fail=false){
  let saved:readonly unknown[]=[],row:(()=>SqlRow|undefined)|undefined
  const batch=vi.fn(async(statements:readonly SqlStatement[])=>{saved=(statements[1] as {args:readonly unknown[]}).args;if(fail)throw new Error('private SQL/credential');return statements.map(()=>empty)})
  const execute=vi.fn(async(_statement:SqlStatement):Promise<QueryResult>=>{const value=row?.();return {...empty,rows:value?[value]:[]}})
  return {batch,execute,setRow:(value:()=>SqlRow|undefined)=>{row=value},saved:()=>saved,database:{dialect:'sqlite',batch,execute,close:async()=>{}} as BatchDatabase}
}
const plan=()=>({statements:[{sql:'INSERT INTO effects(id) VALUES(?)',args:['one']}],result:{id:'one'}})
it('snapshots response, statement and blob arguments before asynchronous preparation',async()=>{
  const f=fixture(),service=new BatchIdempotency({database:f.database,now:()=>1000,retentionMs:10}),blob=new Uint8Array([1,2])
  const original={statements:[{sql:'INSERT INTO effects(body) VALUES(?)',args:[blob]}],result:{id:'one'}},pending=service.run(request,original)
  original.result.id='changed';original.statements[0]!.sql='changed';blob[0]=9
  expect(await pending).toEqual({value:{id:'one'},replayed:false,expiresAt:1010})
  expect(f.batch.mock.calls[0]![0][2]).toEqual({sql:'INSERT INTO effects(body) VALUES(?)',args:[new Uint8Array([1,2])]})
  expect(f.execute).not.toHaveBeenCalled()
})
it('replays positive committed evidence after one failed batch without resubmitting business SQL',async()=>{
  const f=fixture(true),service=new BatchIdempotency({database:f.database,now:()=>1000})
  f.setRow(()=>({fingerprint:f.saved()[2] as string,claim:crypto.randomUUID(),result:'{"id":"saved"}',expires_at:9000}))
  expect(await service.run(request,plan())).toEqual({value:{id:'saved'},replayed:true,expiresAt:9000})
  expect(f.batch).toHaveBeenCalledTimes(1);expect(f.execute).toHaveBeenCalledTimes(1)
})
it('recognizes its own committed generation after acknowledgement or decoder failure',async()=>{
  const f=fixture(true),service=new BatchIdempotency({database:f.database,now:()=>1000,retentionMs:10})
  f.setRow(()=>({fingerprint:f.saved()[2] as string,claim:f.saved()[3] as string,result:f.saved()[4] as string,expires_at:1010n}))
  expect(await service.run(request,plan())).toEqual({value:{id:'one'},replayed:false,expiresAt:1010})
})
it('separates fingerprint conflicts from missing/expired and malformed replay records',async()=>{
  for(const[change,code]of[[{fingerprint:'f'.repeat(64)},'conflict'],[{expires_at:1000},'storage'],[{result:'{broken'},'record'],[{expires_at:9007199254740992},'record'],[{claim:'invalid'},'record']] as const){
    const f=fixture(true),service=new BatchIdempotency({database:f.database,now:()=>1000})
    f.setRow(()=>Object.assign({fingerprint:f.saved()[2] as string,claim:crypto.randomUUID(),result:'null',expires_at:9000},change))
    const error=await service.run(request,plan()).catch(error=>error)
    if(code==='conflict')expect(error.name).toBe('IdempotencyConflictError');else expect(error.code).toBe(code)
    expect(String(error)+JSON.stringify(error)).not.toContain('private');expect(f.batch).toHaveBeenCalledTimes(1)
  }
  const f=fixture(true);await expect(new BatchIdempotency({database:f.database}).run(request,plan())).rejects.toMatchObject({code:'storage'})
})
it('rejects invalid keys, JSON, SQL/argument snapshots and bounded plans before database I/O',async()=>{
  const f=fixture(),service=new BatchIdempotency({database:f.database,maxStatements:1,maxPlanBytes:64,maxResultBytes:32})
  await expect(service.run({...request,key:'bad key'},plan())).rejects.toMatchObject({name:'IdempotencyInputError'})
  await expect(service.run(request,{...plan(),result:{secret:'x'.repeat(40)}})).rejects.toMatchObject({name:'IdempotencyInputError'})
  await expect(service.run(request,{...plan(),statements:['SELECT 1','SELECT 2']})).rejects.toMatchObject({name:'IdempotencyInputError'})
  await expect(service.run(request,{...plan(),statements:[{sql:'SELECT ?',args:[9007199254740993n]}]})).rejects.toMatchObject({name:'IdempotencyInputError'})
  await expect(service.run(request,{...plan(),statements:[{sql:'SELECT ?',args:['😀'.repeat(30)]}]})).rejects.toMatchObject({name:'IdempotencyInputError'})
  await expect(service.run({...request,input:{get secret():string{throw new Error('getter must not run')}}},plan())).rejects.toMatchObject({name:'IdempotencyInputError'})
  expect(f.batch).not.toHaveBeenCalled();expect(f.execute).not.toHaveBeenCalled()
})
it('validates clock/expiry and bounded pruning while sanitizing storage failures',async()=>{
  const f=fixture(),overflow=new BatchIdempotency({database:f.database,now:()=>Number.MAX_SAFE_INTEGER})
  await expect(overflow.run(request,plan())).rejects.toMatchObject({name:'IdempotencyInputError'});expect(f.batch).not.toHaveBeenCalled()
  const service=new BatchIdempotency({database:f.database,now:()=>1000})
  await expect(service.prune(0)).rejects.toMatchObject({name:'IdempotencyInputError'});expect(f.execute).not.toHaveBeenCalled()
  f.execute.mockResolvedValue({...empty,rowsAffected:1});expect(await service.prune(1)).toBe(1)
  expect(f.execute.mock.calls[0]?.[0]).toMatchObject({args:[1000,1]})
  f.execute.mockRejectedValue(new Error('private SQL'));await expect(service.prune()).rejects.toMatchObject({code:'storage'})
})

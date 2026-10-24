import { expect,it } from 'vitest'
import { commandHistoryPosition,commandHistoryQuery,PostgresCommandHistory } from './command-history.js'
import type { Database,SqlStatement } from '@longhorn/database'

const encoded=(value:unknown)=>btoa(JSON.stringify(value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
const valid={v:1,viewer:'alice',scope:'mine',queue:'outbox.command.numbers.v1',before:'9007199254740993'}
it('binds history cursors to principal, scope, queue and version without losing int64 precision',()=>{
  expect(commandHistoryPosition(encoded(valid),'alice','mine')).toBe('9007199254740993')
  expect(commandHistoryPosition(undefined,'alice','mine')).toBeUndefined()
  for(const value of [{...valid,viewer:'bobby'},{...valid,scope:'all'},{...valid,queue:'outbox.other'},{...valid,v:2},{...valid,before:'9223372036854775808'},{...valid,before:'0'},{...valid,extra:'untrusted'}])expect(()=>commandHistoryPosition(encoded(value),'alice','mine')).toThrow('cursor')
  for(const value of ['not-json','!!!!',encoded('not-an-object')])expect(()=>commandHistoryPosition(value,'alice','mine')).toThrow('cursor')
})
it('bounds history queries and rejects owner, queue and invalid state claims',()=>{
  expect(commandHistoryQuery.parse({})).toEqual({scope:'mine',limit:20})
  for(const value of [{limit:'0'},{limit:'101'},{limit:'1e2'},{scope:'admin'},{owner:'bobby'},{queue:'another'},{state:'invalid'},{after:'a'.repeat(2049)}])expect(commandHistoryQuery.safeParse(value).success).toBe(false)
})
it('returns unavailable metadata without inventing delivery success and never selects payloads',async()=>{
  let query!:SqlStatement
  const db={async execute(input:SqlStatement){query=input;return{rows:[{id:'command-one',history_id:9007199254740993n,created_at:null,delivery_id:'retained-id',delivery_state:null},{id:'command-two',history_id:9007199254740992n,created_at:1000n,delivery_id:null,delivery_state:null}],rowsAffected:0}}} as unknown as Database
  const history=new PostgresCommandHistory(db),page=await history.list('alice',{scope:'mine',limit:1})
  expect(page.commands).toEqual([{id:'command-one',createdAt:null,deliveryId:'retained-id',delivery:null}])
  expect(commandHistoryPosition(page.nextCursor!,'alice','mine')).toBe('9007199254740993')
  expect(query).toMatchObject({args:['alice',2]})
  const sql=(query as {sql:string}).sql
  expect(sql).toContain('c.owner_id=$1');expect(sql).not.toMatch(/payload|lease_token|c\.numbers|SELECT\s+\*/i)
  await expect(history.list('alice',{scope:'mine',limit:101})).rejects.toThrow('Invalid command history request')
})

it('binds filtered v2 cursors to their exact status and keeps unfiltered v1 cursors compatible',()=>{
  const filtered={...valid,v:2,state:'failed'}
  expect(commandHistoryPosition(encoded(filtered),'alice','mine','failed')).toBe(valid.before)
  for(const state of ['all','pending','succeeded','unavailable'] as const)expect(()=>commandHistoryPosition(encoded(filtered),'alice','mine',state)).toThrow('cursor')
  expect(()=>commandHistoryPosition(encoded(valid),'alice','mine','failed')).toThrow('cursor')
  expect(commandHistoryPosition(encoded(valid),'alice','mine','all')).toBe(valid.before)
  for(const state of ['all','pending','running','succeeded','failed','unavailable'])expect(commandHistoryQuery.parse({state}).state).toBe(state)
  for(const value of [{...filtered,state:'all'},{...filtered,extra:1},{...filtered,v:3}])expect(()=>commandHistoryPosition(encoded(value),'alice','mine','failed')).toThrow('cursor')
})
it('filters only the fixed-queue live projection and binds status into continued pages without selecting secrets',async()=>{
  const queries:SqlStatement[]=[]
  const db={async execute(input:SqlStatement){queries.push(input);return{rows:[{id:'one',history_id:2n,created_at:null,delivery_id:null,delivery_state:null},{id:'two',history_id:1n,created_at:null,delivery_id:null,delivery_state:null}],rowsAffected:0}}}as unknown as Database
  const history=new PostgresCommandHistory(db),page=await history.list('alice',{scope:'mine',limit:1,state:'unavailable'})
  expect(commandHistoryPosition(page.nextCursor!,'alice','mine','unavailable')).toBe('2')
  expect(queries[0]).toMatchObject({args:['alice',2]});expect((queries[0]as {sql:string}).sql).toContain('q.id IS NULL')
  await history.list('alice',{scope:'mine',limit:1,state:'failed'})
  expect(queries[1]).toMatchObject({args:['alice','failed',2]});expect((queries[1]as {sql:string}).sql).toContain('q.state=$2')
  expect((queries[1]as {sql:string}).sql).toContain("q.queue='outbox.command.numbers.v1'")
  expect((queries[1]as {sql:string}).sql).not.toMatch(/payload|lease_token|c\.numbers|SELECT\s+\*/i)
  const before=queries.length
  await expect(history.list('alice',{scope:'mine',limit:1,state:'failed',after:page.nextCursor!})).rejects.toThrow('cursor')
  expect(queries).toHaveLength(before)
  await expect(history.list('alice',{scope:'mine',limit:1,state:'forged' as 'failed'})).rejects.toThrow('Invalid command history request')
})

it('keeps page boundaries and cursor context stable when a caller mutates its query while the read waits',async()=>{
  let enter!:()=>void,release!:()=>void
  const entered=new Promise<void>(resolve=>{enter=resolve}),gate=new Promise<void>(resolve=>{release=resolve})
  const db={async execute(){enter();await gate;return{rows:[{id:'one',history_id:2n,created_at:null,delivery_id:null,delivery_state:null},{id:'two',history_id:1n,created_at:null,delivery_id:null,delivery_state:null}],rowsAffected:0}}}as unknown as Database
  const input={scope:'mine' as 'mine'|'all',limit:1,state:'unavailable' as 'unavailable'|'failed'},pending=new PostgresCommandHistory(db).list('alice',input)
  await entered;input.scope='all';input.limit=100;input.state='failed';release()
  const page=await pending;expect(page.commands).toHaveLength(1);expect(commandHistoryPosition(page.nextCursor!,'alice','mine','unavailable')).toBe('2')
})

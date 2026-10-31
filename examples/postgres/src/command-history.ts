import type { Database,SqlExecutor,SqlRow,SqlValue } from '@longhornjs/database'
import { assertTransactionExecutor } from '@longhornjs/database/transactions'
import { z } from 'zod'
import { operationTopic } from './operation-contracts.js'

const position=z.string().refine(value=>/^[1-9]\d{0,18}$/.test(value)&&BigInt(value)<=9_223_372_036_854_775_807n,'Expected a positive history position')
export const commandHistoryStates=['all','pending','running','succeeded','failed','unavailable'] as const
const historyState=z.enum(commandHistoryStates),filteredState=z.enum(['pending','running','succeeded','failed','unavailable'])
const searchShape='xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
const searchPrefix=z.string().min(4).max(36).refine(value=>Array.from(value).every((char,index)=>searchShape[index]==='-'?char==='-':/^[0-9a-f]$/.test(char)),'Expected a command ID prefix')
const searchQuery=z.string().max(128).trim().toLowerCase().transform(value=>value||undefined).pipe(searchPrefix.optional())
export type CommandHistoryState=z.output<typeof historyState>
const context={viewer:z.string().min(1).max(200),scope:z.enum(['mine','all']),queue:z.literal('outbox.'+operationTopic),before:position}
const cursor=z.discriminatedUnion('v',[
  z.object({v:z.literal(1),...context}).strict(),
  z.object({v:z.literal(2),...context,state:filteredState}).strict(),
  z.object({v:z.literal(3),...context,state:historyState,q:searchPrefix}).strict(),
])
export const commandHistoryQuery=z.object({scope:z.enum(['mine','all']).default('mine'),limit:z.string().regex(/^\d+$/).default('20').transform(Number).pipe(z.number().int().min(1).max(100)),after:z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/).optional(),state:historyState.optional(),q:searchQuery.optional()}).strict()
export type CommandHistoryQuery=z.output<typeof commandHistoryQuery>
export class CommandHistoryCursorError extends Error { constructor(){super('Invalid command history cursor');this.name='CommandHistoryCursorError'} }
function encode(value:z.output<typeof cursor>):string {
  const bytes=new TextEncoder().encode(JSON.stringify(value))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
}
export function commandHistoryPosition(after:string|undefined,viewer:string,scope:'mine'|'all',state:CommandHistoryState='all',search?:string):string|undefined {
  if(after===undefined)return undefined
  try{
    if(after.length>2048||!(/^[A-Za-z0-9_-]+$/).test(after))throw new Error()
    const bytes=Uint8Array.from(atob(after.replace(/-/g,'+').replace(/_/g,'/')),value=>value.charCodeAt(0))
    const value=cursor.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)))
    if(value.viewer!==viewer || value.scope!==scope || (value.v===1?state!=='all'||search!==undefined:value.v===2?value.state!==state||search!==undefined:value.state!==state||value.q!==search))throw new Error()
    return value.before
  }catch{throw new CommandHistoryCursorError()}
}
const state=z.enum(['pending','running','succeeded','failed']),failure=z.enum(['handler','invalid-payload','lease-expired'])
const deliverySchema=z.object({id:z.string().min(1).max(200),state,attempts:z.number().int().nonnegative(),maxAttempts:z.number().int().min(1).max(100),availableAt:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),updatedAt:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),lastFailure:failure.nullable()})
export type CommandDeliverySummary=z.output<typeof deliverySchema>
export type CommandHistoryItem={readonly id:string;readonly createdAt:number|null;readonly deliveryId:string|null;readonly delivery:CommandDeliverySummary|null}
const columns='c.id,c.history_id,c.created_at,c.delivery_id,q.state AS delivery_state,q.attempts,q.max_attempts,q.available_at,q.updated_at,q.last_failure'
const from="FROM longhorn_pg_example.operator_commands c LEFT JOIN longhorn_queue.jobs q ON q.queue='outbox.command.numbers.v1' AND q.id=c.delivery_id"
const integer=(value:unknown)=>{const number=typeof value==='bigint'?Number(value):value;if(typeof number!=='number'||!Number.isSafeInteger(number)||number<0)throw new Error('Invalid command history integer');return number}
function item(row:SqlRow):CommandHistoryItem {
  if(typeof row.id!=='string'||(row.delivery_id!==null&&typeof row.delivery_id!=='string'))throw new Error('Invalid command history row')
  return{id:row.id,createdAt:row.created_at===null?null:integer(row.created_at),deliveryId:row.delivery_id,
    delivery:row.delivery_state===null?null:deliverySchema.parse({id:row.delivery_id,state:row.delivery_state,attempts:integer(row.attempts),maxAttempts:integer(row.max_attempts),availableAt:integer(row.available_at),updatedAt:integer(row.updated_at),lastFailure:row.last_failure})}
}
/** Borrows the same managed database as the command writer; owns no timer/connection. */
export class PostgresCommandHistory {
  constructor(private readonly database:Database){}
  async get(viewer:string,id:string,scope:'mine'|'all'){
    const args:SqlValue[]=[id]
    if(scope==='mine')args.push(viewer)
    const row=(await this.database.execute({sql:`SELECT ${columns},c.numbers ${from} WHERE c.id=$1 ${scope==='mine'?'AND c.owner_id=$2':''}`,args})).rows[0]
    return row?{command:{id:String(row.id),numbers:JSON.parse(String(row.numbers)) as number[]},history:item(row)}:undefined
  }
  async insertIn(tx:SqlExecutor,input:{id:string;ownerId:string;numbers:readonly number[];deliveryId:string;createdAt:number}):Promise<void>{
    assertTransactionExecutor(tx,this.database)
    await tx.execute({sql:'INSERT INTO longhorn_pg_example.operator_commands(id,owner_id,numbers,delivery_id,created_at) VALUES($1,$2,$3::jsonb,$4,$5)',args:[input.id,input.ownerId,JSON.stringify(input.numbers),input.deliveryId,integer(input.createdAt)]})
  }
  async list(viewer:string,input:CommandHistoryQuery):Promise<{commands:CommandHistoryItem[];nextCursor:string|null}>{
    const {scope,limit,after,q:search}=input,selected=input.state??'all'
    if(search!==undefined&&!searchPrefix.safeParse(search).success || !historyState.safeParse(selected).success || typeof viewer!=='string'||!viewer||viewer.length>200||!['mine','all'].includes(scope)||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('Invalid command history request')
    // Role admission belongs to the HTTP adapter. Owner filtering always comes from its principal.
    const before=commandHistoryPosition(after,viewer,scope,selected,search),args:SqlValue[]=[]
    const clauses:string[]=[]
    if(scope==='mine'){args.push(viewer);clauses.push('c.owner_id=$'+args.length)}
    if(selected==='unavailable')clauses.push('q.id IS NULL')
    else if(selected!=='all'){args.push(selected);clauses.push('q.state=$'+args.length)}
    if(search!==undefined){args.push(search+'%');clauses.push('pg_catalog.lower(c.id) LIKE $'+args.length)}
    if(before!==undefined){args.push(before);clauses.push('c.history_id<$'+args.length+'::bigint')}
    args.push(limit+1)
    const rows=(await this.database.execute({sql:`SELECT ${columns} ${from}
      ${clauses.length?'WHERE '+clauses.join(' AND '):''} ORDER BY c.history_id DESC LIMIT $${args.length}`,args})).rows
    const page=rows.slice(0,limit),last=page.at(-1)
    const next=last?{viewer,scope,queue:'outbox.'+operationTopic,before:position.parse(String(last.history_id))}:undefined
    return{commands:page.map(item),nextCursor:rows.length>limit&&next?encode(search!==undefined?{v:3,...next,state:selected,q:search}:selected==='all'?{v:1,...next}:{v:2,...next,state:selected as z.output<typeof filteredState>}):null}
  }
}

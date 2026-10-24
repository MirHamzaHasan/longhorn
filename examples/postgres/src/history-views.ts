import type { Database,SqlExecutor,SqlRow } from '@longhorn/database'
import { normalizeSavedSelection,normalizeViewName } from './history-view-values.js'
import type { SavedHistoryView,SavedViewSelection } from './history-view-values.js'
export type { SavedHistoryView } from './history-view-values.js'
export class HistoryViewError extends Error {constructor(readonly status:400|401|403|404|409,message:string){super(message);this.name='HistoryViewError'}}
const columns='id,name,scope,state,q,revision,created_at,updated_at',table='longhorn_pg_example.history_views'
const changed=()=>new HistoryViewError(409,'This saved view changed. Refresh views and try again.')
const conflict=()=>new HistoryViewError(409,'A saved view already uses that name or request ID. Refresh views and try again.')
function integer(value:unknown):number{const n=typeof value==='bigint'?Number(value):value;if(typeof n!=='number'||!Number.isSafeInteger(n)||n<0)throw new Error('Invalid saved view integer');return n}
function view(row:SqlRow):SavedHistoryView{
  if(typeof row.id!=='string'||typeof row.name!=='string'||normalizeViewName(row.name)!==row.name)throw new Error('Invalid saved view record')
  const revision=integer(row.revision);if(revision<1)throw new Error('Invalid saved view revision')
  return{id:row.id,name:row.name,selection:normalizeSavedSelection({scope:row.scope,state:row.state,...(row.q===null?{}:{q:row.q})}),revision,createdAt:integer(row.created_at),updatedAt:integer(row.updated_at)}
}
/** Writes borrow the transaction holding the current authenticated user lock. */
export class PostgresHistoryViews {
  constructor(private readonly database:Database,private readonly clock:()=>number=Date.now){}
  async list(owner:string):Promise<readonly SavedHistoryView[]>{return(await this.database.execute({sql:`SELECT ${columns} FROM ${table} WHERE owner_id=$1 ORDER BY name,id LIMIT 20`,args:[owner]})).rows.map(view)}
  async get(owner:string,id:string,tx:SqlExecutor=this.database):Promise<SavedHistoryView|undefined>{const row=(await tx.execute({sql:`SELECT ${columns} FROM ${table} WHERE owner_id=$1 AND id=$2`,args:[owner,id]})).rows[0];return row?view(row):undefined}
  async createIn(tx:SqlExecutor,owner:string,id:string,name:string,selection:SavedViewSelection):Promise<SavedHistoryView>{
    // Authentication uses shared ownership; this independent lock serializes only quota admission.
    await tx.execute({sql:'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',args:['longhorn:history-views:quota:'+owner]})
    const count=(await tx.execute({sql:`SELECT count(*)::integer AS total FROM ${table} WHERE owner_id=$1`,args:[owner]})).rows[0]?.total
    if(integer(count)>=20)throw new HistoryViewError(409,'You can save up to 20 views. Delete one before saving another.')
    const now=integer(this.clock()),row=(await tx.execute({sql:`INSERT INTO ${table}(owner_id,id,name,scope,state,q,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7) ON CONFLICT DO NOTHING RETURNING ${columns}`,args:[owner,id,name,selection.scope,selection.state,selection.q??null,now]})).rows[0]
    if(!row)throw conflict();return view(row)
  }
  async updateIn(tx:SqlExecutor,owner:string,id:string,expected:number,name:string,selection:SavedViewSelection):Promise<SavedHistoryView>{
    const current=await this.get(owner,id,tx);if(!current)throw new HistoryViewError(404,'Saved view not found')
    if(current.revision!==expected)throw changed()
    if(current.name===name&&JSON.stringify(current.selection)===JSON.stringify(selection))return current
    const now=Math.max(integer(this.clock()),current.updatedAt)
    try{
      const row=(await tx.execute({sql:`UPDATE ${table} SET name=$3,scope=$4,state=$5,q=$6,revision=revision+1,updated_at=$7 WHERE owner_id=$1 AND id=$2 AND revision=$8 AND revision<9007199254740991 RETURNING ${columns}`,args:[owner,id,name,selection.scope,selection.state,selection.q??null,now,expected]})).rows[0]
      if(!row)throw changed();return view(row)
    }catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='23505')throw conflict();throw error}
  }
  async deleteIn(tx:SqlExecutor,owner:string,id:string,expected:number):Promise<{deleted:true}>{
    const current=await this.get(owner,id,tx);if(!current)throw new HistoryViewError(404,'Saved view not found')
    if(current.revision!==expected)throw changed()
    const row=(await tx.execute({sql:`DELETE FROM ${table} WHERE owner_id=$1 AND id=$2 AND revision=$3 RETURNING id`,args:[owner,id,expected]})).rows[0]
    if(!row)throw changed();return{deleted:true}
  }
}

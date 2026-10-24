import { collectBoundedExport } from './bounded-export.js'
import type { BoundedExportOptions } from './bounded-export.js'
import { normalizeHistorySearch } from './history-search.js'
export type HistoryExportSelection={readonly scope:string;readonly state:string;readonly q?:string}
export interface HistoryExportOptions extends BoundedExportOptions {readonly selection:HistoryExportSelection}
export class HistoryExportError extends Error {constructor(message:string){super(message);this.name='HistoryExportError'}}
const invalid=()=>new HistoryExportError('History could not be exported. Refresh and try again.')
const record=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();return value as Record<string,unknown>}
const text=(value:unknown):string=>{if(typeof value!=='string'||!value||value.length>200)throw invalid();return value}
const integer=(value:unknown):number=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw invalid();return value}
function command(value:unknown){
  const c=record(value),deliveryId=c.deliveryId===null?null:text(c.deliveryId)
  let delivery=null
  if(c.delivery!==null){
    const d=record(c.delivery),id=text(d.id),state=text(d.state),attempts=integer(d.attempts),maxAttempts=integer(d.maxAttempts),lastFailure=d.lastFailure
    if(id!==deliveryId||!['pending','running','succeeded','failed'].includes(state)||maxAttempts<1||maxAttempts>100||(lastFailure!==null&&(typeof lastFailure!=='string'||!['handler','invalid-payload','lease-expired'].includes(lastFailure))))throw invalid()
    delivery={id,state,attempts,maxAttempts,availableAt:integer(d.availableAt),updatedAt:integer(d.updatedAt),lastFailure:lastFailure as string|null}
  }
  // Copy only the established metadata projection, even if a response contains extra fields.
  return{id:text(c.id),createdAt:c.createdAt===null?null:integer(c.createdAt),deliveryId,delivery}
}
/** Collect a bounded segment; no partial file escapes after a failed or canceled read. */
export async function collectHistoryExport(options:HistoryExportOptions){
  let search:string|undefined;try{search=normalizeHistorySearch(options.selection.q)}catch{throw invalid()}
  const selection={scope:options.selection.scope,state:options.selection.state,...(search?{q:search}:{})}
  if(!['mine','all'].includes(selection.scope)||!['all','pending','running','succeeded','failed','unavailable'].includes(selection.state))throw invalid()
  return collectBoundedExport(options,{
    recordsKey:'commands',project:command,line:command=>({type:'command',command}),
    header:exportedAt=>({type:'longhorn-command-history',version:search?2:1,exportedAt,selection}),invalid,
    tooLarge:()=>new HistoryExportError('This history page is too large to export. Try a narrower delivery filter.'),
    timeout:()=>new HistoryExportError('The export timed out. Try again.'),
  })
}

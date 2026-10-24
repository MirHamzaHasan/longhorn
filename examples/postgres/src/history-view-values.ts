import { normalizeHistorySearch } from './history-search-values.js'
export type SavedViewSelection={scope:'mine'|'all';state:'all'|'pending'|'running'|'succeeded'|'failed'|'unavailable';q?:string}
export type SavedHistoryView={id:string;name:string;selection:SavedViewSelection;revision:number;createdAt:number;updatedAt:number}
export class HistoryViewValueError extends Error {constructor(message:string){super(message);this.name='HistoryViewValueError'}}
/** Pure Web values shared by the account API and console; no SQL or server imports. */
export function normalizeViewName(value:unknown):string{
  if(typeof value!=='string'||value.length>320)throw new HistoryViewValueError('Use 1 to 80 characters for the view name.')
  const name=value.trim().normalize('NFC')
  if(!name||Array.from(name).length>80||/[\u0000-\u001f\u007f-\u009f\u2028\u2029\ud800-\udfff]/u.test(name)||!/[\p{L}\p{N}\p{P}\p{S}]/u.test(name))throw new HistoryViewValueError('Use 1 to 80 visible characters for the view name.')
  return name
}
export function normalizeSavedSelection(value:unknown):SavedViewSelection{
  const invalid=()=>new HistoryViewValueError('Choose a valid command scope, delivery status and ID prefix.')
  if(!value||typeof value!=='object'||Array.isArray(value))throw invalid()
  const input=value as Record<string,unknown>
  if(Object.keys(input).some(key=>!['scope','state','q'].includes(key))||typeof input.scope!=='string'||!['mine','all'].includes(input.scope)||typeof input.state!=='string'||!['all','pending','running','succeeded','failed','unavailable'].includes(input.state))throw invalid()
  let q:string|undefined;try{q=normalizeHistorySearch(input.q)}catch{throw invalid()}
  return{scope:input.scope as SavedViewSelection['scope'],state:input.state as SavedViewSelection['state'],...(q?{q}:{})}
}

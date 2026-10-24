export class HistorySearchError extends Error {constructor(){super('Enter at least 4 characters from the start of a command ID.');this.name='HistorySearchError'}}
/** UUID-prefix search only; no wildcard, number or payload search. */
export function normalizeHistorySearch(value:unknown):string|undefined {
  if(value===undefined)return undefined
  if(typeof value!=='string'||value.length>128)throw new HistorySearchError()
  const query=value.trim().toLowerCase(),shape='xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
  if(!query)return undefined
  if(query.length<4||query.length>36||!Array.from(query).every((char,index)=>shape[index]==='-'?char==='-':/^[0-9a-f]$/.test(char)))throw new HistorySearchError()
  return query
}

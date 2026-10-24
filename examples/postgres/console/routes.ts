export const historyViewStates=['all','pending','running','succeeded','failed','unavailable'] as const
export type HistoryView={readonly scope:'mine'|'all';readonly state:typeof historyViewStates[number]}
export type ConsoleRoute={readonly page:string;readonly id?:string;readonly history?:HistoryView;readonly explicitHistory:boolean}
export class ConsoleRouteError extends Error {
  constructor(readonly kind:'history'|'command'|'page'){super(kind==='history'?'Invalid history link':kind==='command'?'Invalid command link':'Invalid page link');this.name='ConsoleRouteError'}
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Only selector choices enter a saved view; cursors, principals and arbitrary destinations never do. */
export function historyViewHash(view:HistoryView):string {
  if(!['mine','all'].includes(view.scope)||!historyViewStates.includes(view.state))throw new ConsoleRouteError('history')
  const query=new URLSearchParams()
  if(view.scope!=='mine')query.set('scope',view.scope)
  if(view.state!=='all')query.set('state',view.state)
  return '#/commands'+(query.size?'?'+query:'')
}
export function parseConsoleRoute(hash:string):ConsoleRoute {
  const raw=hash.replace(/^#\/?/,''),question=raw.indexOf('?'),path=(question===-1?raw:raw.slice(0,question)).replace(/\/$/,''),parts=path?path.split('/'):['commands']
  const page=parts[0]!,id=parts[1],isHistory=page==='commands'&&id===undefined
  if(hash.length>2048)throw new ConsoleRouteError(isHistory?'history':'page')
  if(parts.length>2||parts.some(part=>!part)||id&&(!['commands','new','deliveries','audit'].includes(page)||!uuid.test(id)))throw new ConsoleRouteError('command')
  if(!isHistory){if(question!==-1)throw new ConsoleRouteError(id?'command':'page');return{page,...(id?{id}:{}),explicitHistory:false}}
  const query=new URLSearchParams(question===-1?'':raw.slice(question+1)),seen=new Set<string>()
  for(const[key]of query){if(!['scope','state'].includes(key)||seen.has(key))throw new ConsoleRouteError('history');seen.add(key)}
  const scope=query.get('scope')??'mine',state=query.get('state')??'all'
  if(!['mine','all'].includes(scope)||!historyViewStates.includes(state as HistoryView['state']))throw new ConsoleRouteError('history')
  return{page,history:{scope:scope as HistoryView['scope'],state:state as HistoryView['state']},explicitHistory:path==='commands'}
}

import { expect,it } from 'vitest'
import { ConsoleRouteError,historyViewHash,historyViewStates,parseConsoleRoute } from './routes.js'

const id='12345678-1234-4123-8123-123456789abc'
it('preserves ordinary and legacy routes while distinguishing explicit saved history',()=>{
  expect(parseConsoleRoute('')).toMatchObject({page:'commands',explicitHistory:false,history:{scope:'mine',state:'all'}})
  expect(parseConsoleRoute('#/')).toMatchObject({page:'commands',explicitHistory:false})
  for(const hash of['#/commands','#commands','#/commands/'])expect(parseConsoleRoute(hash)).toMatchObject({page:'commands',explicitHistory:true,history:{scope:'mine',state:'all'}})
  for(const page of['commands','new','deliveries','audit'])expect(parseConsoleRoute('#/'+page+'/'+id)).toEqual({page,id,explicitHistory:false})
  for(const page of['welcome','login','register','account','unknown'])expect(parseConsoleRoute('#/'+page)).toEqual({page,explicitHistory:false})
})
it('round-trips every scope/status and canonicalizes defaults, order and encoded names',()=>{
  for(const scope of['mine','all']as const)for(const state of historyViewStates){const view={scope,state};expect(parseConsoleRoute(historyViewHash(view)).history).toEqual(view)}
  expect(historyViewHash({scope:'mine',state:'all'})).toBe('#/commands')
  const route=parseConsoleRoute('#commands?%73tate=failed&scope=all');expect(historyViewHash(route.history!)).toBe('#/commands?scope=all&state=failed')
  expect(historyViewHash(parseConsoleRoute('#/commands?state=all&scope=mine').history!)).toBe('#/commands')
})
it('rejects duplicate/unknown claims and does not put cursor, owner or redirects in view links',()=>{
  for(const query of['state=failed&state=pending','%73tate=failed&state=pending','scope=all&scope=mine','owner=another','queue=private','after=cursor','limit=100','returnTo=https://example.com','__proto__=all','state=','scope=','state=FAILED','state=%ZZ','state=failed%23fragment'])expect(()=>parseConsoleRoute('#/commands?'+query)).toThrow('Invalid history link')
})
it('does not allow selector queries on other pages or discard unexpected path segments',()=>{
  for(const hash of['#/account?scope=all','#/login?returnTo=//example.com','#/commands/'+id+'?state=failed','#/new/'+id+'/extra','#/commands/not-a-uuid','#/commands//','#/new/..'])expect(()=>parseConsoleRoute(hash)).toThrow(ConsoleRouteError)
})
it('bounds hashes and rejects invalid constructor choices before constructing an address',()=>{
  expect(()=>parseConsoleRoute('#/commands?state='+'a'.repeat(2048))).toThrow('Invalid history link')
  expect(()=>historyViewHash({scope:'https://example.com' as 'mine',state:'all'})).toThrow(ConsoleRouteError)
  expect(()=>historyViewHash({scope:'mine',state:'arbitrary' as 'all'})).toThrow(ConsoleRouteError)
})

it('retains canonical search through saved views without accepting wildcards or queries on detail routes',()=>{
  const route=parseConsoleRoute('#/commands?q=ABCD1234-AB&state=failed&scope=all')
  expect(route.history).toEqual({scope:'all',state:'failed',q:'abcd1234-ab'})
  expect(historyViewHash(route.history!)).toBe('#/commands?scope=all&state=failed&q=abcd1234-ab')
  expect(historyViewHash(parseConsoleRoute('#/commands?q=%20%20').history!)).toBe('#/commands')
  for(const query of ['q=abc','q=abcd%25','q=abcd&q=abce'])expect(()=>parseConsoleRoute('#/commands?'+query)).toThrow('Invalid history link')
})

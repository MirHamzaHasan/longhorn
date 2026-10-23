import { expect,it,vi } from 'vitest'
import { createJsonClient,JsonClientError,serviceBaseUrl } from './client.js'
const token='a'.repeat(64),options={baseUrl:'https://service.example/internal/',token}
const json=(value:unknown,status=200)=>Response.json(value,{status})
it('requires an exact HTTPS base or explicit loopback and rejects escaping service paths',async()=>{
  for(const value of ['http://service.example/','https://u:p@service.example/','https://service.example/?secret=1','https://service.example/#hash','https://service.example/no-slash'])expect(()=>serviceBaseUrl(value)).toThrow()
  expect(serviceBaseUrl('http://127.0.0.1:3012/',true)).toBe('http://127.0.0.1:3012/')
  expect(()=>createJsonClient({...options,token:'secret'})).toThrow('credential')
  const send=vi.fn(async()=>json({})),client=createJsonClient({...options,fetch:send})
  for(const path of ['../secret','x/../secret','/secret','https://evil.example/','//evil','%2e%2e/x','x?credential=1'])await expect(client.request(path)).rejects.toMatchObject({code:'request'})
  expect(send).not.toHaveBeenCalled()
})
it('uses explicit authorization and fetch isolation with no redirect following',async()=>{
  const send=vi.fn(async()=>json({accepted:true})),client=createJsonClient({...options,fetch:send})
  expect(await client.request('messages',{method:'POST',value:{value:1}})).toEqual({status:200,data:{accepted:true}})
  const [url,init]=send.mock.calls[0] as unknown as [string,RequestInit]
  expect(url).toBe(options.baseUrl+'messages');expect(init).toMatchObject({redirect:'manual',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',body:'{"value":1}'})
  expect(new Headers(init.headers).get('Authorization')).toBe('Bearer '+token)
})
it('bounds encoded request/response bytes and sanitizes protocol/network errors',async()=>{
  const send=vi.fn(async()=>json({value:'123456789'})),client=createJsonClient({...options,fetch:send,maxRequestBytes:4,maxResponseBytes:4})
  await expect(client.request('messages',{method:'POST',value:'😀'})).rejects.toMatchObject({code:'request-too-large'});expect(send).not.toHaveBeenCalled()
  await expect(client.request('health')).rejects.toMatchObject({code:'response-too-large'})
  for(const response of [new Response('secret HTML'),new Response(null,{status:302,headers:{Location:'https://evil.example/'}}),new Response('{broken',{headers:{'Content-Type':'application/json'}})])await expect(createJsonClient({...options,fetch:async()=>response}).request('health')).rejects.toMatchObject({code:'protocol'})
  await expect(createJsonClient({...options,fetch:async()=>{throw new Error(token)}}).request('health')).rejects.toEqual(new JsonClientError('network'))
})
it('retains capacity until an uncooperative fetch settles after timeout',async()=>{
  let release!: (response:Response)=>void
  let calls=0
  const waiting=new Promise<Response>(resolve=>{release=resolve}),client=createJsonClient({...options,fetch:()=>calls++===0?waiting:Promise.resolve(json({ready:true})),timeoutMs:5,maxConcurrent:1})
  const first=client.request('health'),settled=vi.fn();void first.then(settled,settled)
  await new Promise(resolve=>setTimeout(resolve,15));expect(settled).not.toHaveBeenCalled()
  await expect(client.request('health')).rejects.toMatchObject({code:'capacity'})
  release(json({ready:true}));await expect(first).rejects.toMatchObject({code:'timeout'})
  expect((await client.request('health')).status).toBe(200)
})
it('cancels stalled response reads and rejects already cancelled calls without a transport',async()=>{
  const cancellation=vi.fn(),response=new Response(new ReadableStream({cancel:cancellation}),{headers:{'Content-Type':'application/json'}})
  await expect(createJsonClient({...options,timeoutMs:5,fetch:async()=>response}).request('health')).rejects.toMatchObject({code:'timeout'});expect(cancellation).toHaveBeenCalled()
  const controller=new AbortController();controller.abort();const send=vi.fn(async()=>json({}))
  await expect(createJsonClient({...options,fetch:send}).request('health',{signal:controller.signal})).rejects.toMatchObject({code:'cancelled'});expect(send).not.toHaveBeenCalled()
})

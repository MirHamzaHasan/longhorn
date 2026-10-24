import{Longhorn}from'@longhorn/core'
import{loadConfig}from'@longhorn/config'
import{createWorker}from'@longhorn/workers'
import type{D1Binding}from'@longhorn/workers/d1'
import{createD1TasksApp}from'./app.js'
import{configSchema}from'./config.js'
type Bindings={DB:D1Binding;D1_MAX_PENDING?:string;D1_REQUEST_RETENTION_MS?:string}
const applications=new WeakMap<object,Promise<Longhorn>>(),router=new Longhorn<Bindings>()
router.http.all('*',async c=>{
  const binding=c.env.DB
  if(!binding||typeof binding!=='object')return c.json({error:'D1 application unavailable'},503)
  let pending=applications.get(binding)
  if(!pending){pending=loadConfig(configSchema,{D1_MAX_PENDING:c.env.D1_MAX_PENDING,D1_REQUEST_RETENTION_MS:c.env.D1_REQUEST_RETENTION_MS}).then(config=>createD1TasksApp(binding,config));applications.set(binding,pending)}
  try{return await(await pending).fetch(c.req.raw)}catch{
    if(applications.get(binding)===pending)applications.delete(binding)
    try{await(await pending).close()}catch{}
    return c.json({error:'D1 application unavailable; verify deployment'},503)
  }
})
export default createWorker(router)

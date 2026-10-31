import type{BatchDatabase}from'@longhornjs/database'
import{BatchIdempotency}from'./batch-sqlite.js'
declare const database:BatchDatabase
const requests=new BatchIdempotency({database}),request={scope:'tasks:create:v1',key:'one',input:{title:'one'}}
const result=requests.run(request,{statements:[{sql:'INSERT INTO items(id) VALUES(?)',args:['one']}],result:{id:'one'}})
void result.then(value=>{const id:string=value.value.id;void id})
// @ts-expect-error A JavaScript callback is not an atomic predeclared SQL plan.
void requests.run(request,async()=>({id:'one'}))

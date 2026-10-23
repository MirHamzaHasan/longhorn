import { verifyHttpDelivery } from './http-delivery-contract.mjs'
const environment=typeof Deno==='undefined'?process.env:{SERVICE_URL:Deno.env.get('SERVICE_URL'),SERVICE_TOKEN:Deno.env.get('SERVICE_TOKEN')}
console.log(JSON.stringify(await verifyHttpDelivery(environment.SERVICE_URL,environment.SERVICE_TOKEN)))

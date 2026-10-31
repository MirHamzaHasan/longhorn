import { z } from 'zod'
import { redisConnectionUrl } from '@longhornjs/node/redis'
const integer=(fallback:string,min:number,max:number)=>z.string().regex(/^\d+$/).default(fallback).transform(Number).pipe(z.number().int().min(min).max(max))
export const redisLimitsConfig=z.object({
  HOST:z.string().trim().min(1).default('127.0.0.1'),PORT:integer('3028',0,65535),
  LOG_LEVEL:z.enum(['debug','info','warn','error','silent']).default('info'),
  API_TOKEN:z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
  RATE_LIMIT_SUBJECT:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).default('service-client'),
  RATE_LIMIT_REQUESTS:integer('60',1,1000000),RATE_LIMIT_WINDOW_MS:integer('60000',1000,86400000),
  REDIS_URL:z.string().min(1),REDIS_NAMESPACE:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).default('reports'),
  REDIS_ALLOW_INSECURE_LOOPBACK:z.enum(['true','false']).default('false').transform(value=>value==='true'),
  REDIS_CONNECT_TIMEOUT_MS:integer('5000',1,60000),REDIS_COMMAND_TIMEOUT_MS:integer('2000',1,60000),
  REDIS_TLS_CA:z.string().min(1).max(262144).optional(),
}).superRefine((value,context)=>{
  try{const url=redisConnectionUrl(value.REDIS_URL,value.REDIS_ALLOW_INSECURE_LOOPBACK);if(value.REDIS_TLS_CA!==undefined&&!url.startsWith('rediss:'))throw new Error()}
  catch{context.addIssue({code:'custom',path:['REDIS_URL'],message:'Invalid Redis endpoint or transport policy'})}
}).transform(value=>({hostname:value.HOST,port:value.PORT,logLevel:value.LOG_LEVEL,apiToken:value.API_TOKEN,subject:value.RATE_LIMIT_SUBJECT,limit:value.RATE_LIMIT_REQUESTS,windowMs:value.RATE_LIMIT_WINDOW_MS,namespace:value.REDIS_NAMESPACE,
  redis:{url:value.REDIS_URL,allowInsecureLoopback:value.REDIS_ALLOW_INSECURE_LOOPBACK,connectTimeoutMs:value.REDIS_CONNECT_TIMEOUT_MS,commandTimeoutMs:value.REDIS_COMMAND_TIMEOUT_MS,...(value.REDIS_TLS_CA===undefined?{}:{tlsCa:value.REDIS_TLS_CA})},
}))
export type RedisLimitsConfig=Readonly<z.output<typeof redisLimitsConfig>>

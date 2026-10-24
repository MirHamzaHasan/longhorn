import { z } from 'zod'
import { serviceBaseUrl } from '@longhorn/http/client'
import { configInputSchema } from './config.js'

export const operatorConfigSchema=configInputSchema.omit({WORKER_ENABLED:true,SCHEDULER_ENABLED:true}).extend({
  PORT:z.string().trim().regex(/^\d+$/).default('3011').transform(Number).pipe(z.number().int().min(0).max(65535)),
  AUTH_ORIGIN:z.string().default('http://127.0.0.1:3011'),
  MIGRATION_DATABASE_URL:z.never().optional(),
  MESSAGE_SERVICE_URL:z.string().min(1),
  MESSAGE_SERVICE_TOKEN:z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
  MESSAGE_ALLOW_INSECURE_LOOPBACK:z.enum(['true','false']).default('false').transform(value=>value==='true'),
  MESSAGE_HTTP_TIMEOUT_MS:z.string().regex(/^\d+$/).default('2000').transform(Number).pipe(z.number().int().min(1).max(60000)),
  REQUEST_CLEANUP_ENABLED:z.enum(['true','false']).default('false').transform(value=>value==='true'),
  REQUEST_CLEANUP_INTERVAL_MS:z.string().regex(/^\d+$/).default('60000').transform(Number).pipe(z.number().int().min(1000).max(86400000)),
  REQUEST_CLEANUP_LIMIT:z.string().regex(/^\d+$/).default('100').transform(Number).pipe(z.number().int().min(1).max(10000)),
  DISPATCH_ENABLED:z.enum(['true','false']).default('true').transform(value=>value==='true'),
}).superRefine((input,context)=>{
  try{serviceBaseUrl(input.MESSAGE_SERVICE_URL,input.MESSAGE_ALLOW_INSECURE_LOOPBACK)}catch{context.addIssue({code:'custom',path:['MESSAGE_SERVICE_URL'],message:'Invalid service endpoint'})}
  try{
    const url=new URL(input.AUTH_ORIGIN)
    if(url.origin!==input.AUTH_ORIGIN || url.username || url.password || (input.AUTH_COOKIE_SECURE ? url.protocol!=='https:' : url.protocol!=='http:' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error()
  }catch{context.addIssue({code:'custom',path:['AUTH_ORIGIN'],message:'Invalid cookie origin'})}
}).transform(input=>({
  databaseUrl:input.DATABASE_URL,hostname:input.HOST,port:input.PORT,logLevel:input.LOG_LEVEL,maxConnections:input.PG_MAX_CONNECTIONS,
  authOrigin:input.AUTH_ORIGIN,secureCookies:input.AUTH_COOKIE_SECURE,sessionTtlMs:input.SESSION_TTL_SECONDS*1000,
  messageBaseUrl:input.MESSAGE_SERVICE_URL,messageToken:input.MESSAGE_SERVICE_TOKEN,allowInsecureLoopback:input.MESSAGE_ALLOW_INSECURE_LOOPBACK,
  timeoutMs:input.MESSAGE_HTTP_TIMEOUT_MS,dispatchEnabled:input.DISPATCH_ENABLED,
  ...(input.REQUEST_CLEANUP_ENABLED?{requestCleanup:{intervalMs:input.REQUEST_CLEANUP_INTERVAL_MS,limit:input.REQUEST_CLEANUP_LIMIT}}:{}),
}))
export type OperatorConfig=Readonly<z.output<typeof operatorConfigSchema>>

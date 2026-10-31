import { expect,it } from 'vitest'
import { loadConfig } from '@longhornjs/config'
import { operatorConfigSchema } from './operator-config.js'
const environment={DATABASE_URL:'postgres://app:owned-secret@127.0.0.1:5432/app',MESSAGE_SERVICE_URL:'https://receiver.example/',MESSAGE_SERVICE_TOKEN:'a'.repeat(64)}
it('validates a separate runtime profile with explicit transport and cookie settings',async()=>{
  expect(await loadConfig(operatorConfigSchema,environment)).toMatchObject({port:3011,dispatchEnabled:true,secureCookies:false,allowInsecureLoopback:false,timeoutMs:2000})
  expect(await loadConfig(operatorConfigSchema,{...environment,MESSAGE_SERVICE_URL:'http://127.0.0.1:3012/',MESSAGE_ALLOW_INSECURE_LOOPBACK:'true',DISPATCH_ENABLED:'false'})).toMatchObject({dispatchEnabled:false})
  for(const overrides of [{MIGRATION_DATABASE_URL:environment.DATABASE_URL},{MESSAGE_SERVICE_URL:'http://receiver.example/'},{MESSAGE_SERVICE_TOKEN:'short'},{AUTH_ORIGIN:'http://external.example'},{AUTH_COOKIE_SECURE:'true'},{MESSAGE_HTTP_TIMEOUT_MS:'60001'},{DISPATCH_ENABLED:'yes'}])await expect(loadConfig(operatorConfigSchema,{...environment,...overrides})).rejects.toThrow('Invalid configuration')
})
it('keeps request cleanup opt-in with explicit bounded runtime settings',async()=>{
  expect((await loadConfig(operatorConfigSchema,environment)).requestCleanup).toBeUndefined()
  expect((await loadConfig(operatorConfigSchema,{...environment,REQUEST_CLEANUP_ENABLED:'true'})).requestCleanup).toEqual({limit:100,intervalMs:60000})
  expect((await loadConfig(operatorConfigSchema,{...environment,REQUEST_CLEANUP_ENABLED:'true',REQUEST_CLEANUP_LIMIT:'2',REQUEST_CLEANUP_INTERVAL_MS:'1000'})).requestCleanup).toEqual({limit:2,intervalMs:1000})
  for(const overrides of[{REQUEST_CLEANUP_ENABLED:'yes'},{REQUEST_CLEANUP_LIMIT:'0'},{REQUEST_CLEANUP_LIMIT:'10001'},{REQUEST_CLEANUP_INTERVAL_MS:'999'},{REQUEST_CLEANUP_INTERVAL_MS:'86400001'}])await expect(loadConfig(operatorConfigSchema,{...environment,...overrides})).rejects.toThrow('Invalid configuration')
})
it('keeps command attempt limits opt-in and bounds their policy',async()=>{
  expect((await loadConfig(operatorConfigSchema,environment)).commandLimits).toBeUndefined()
  expect((await loadConfig(operatorConfigSchema,{...environment,COMMAND_LIMIT_ENABLED:'true'})).commandLimits).toEqual({limit:60,windowMs:60000})
  expect((await loadConfig(operatorConfigSchema,{...environment,COMMAND_LIMIT_ENABLED:'true',COMMAND_LIMIT_REQUESTS:'2',COMMAND_LIMIT_WINDOW_MS:'1000'})).commandLimits).toEqual({limit:2,windowMs:1000})
  for(const overrides of[{COMMAND_LIMIT_ENABLED:'yes'},{COMMAND_LIMIT_REQUESTS:'0'},{COMMAND_LIMIT_REQUESTS:'1000001'},{COMMAND_LIMIT_REQUESTS:'1.5'},{COMMAND_LIMIT_WINDOW_MS:'999'},{COMMAND_LIMIT_WINDOW_MS:'86400001'}])await expect(loadConfig(operatorConfigSchema,{...environment,...overrides})).rejects.toThrow('Invalid configuration')
})

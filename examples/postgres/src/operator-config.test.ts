import { expect,it } from 'vitest'
import { loadConfig } from '@longhorn/config'
import { operatorConfigSchema } from './operator-config.js'
const environment={DATABASE_URL:'postgres://app:owned-secret@127.0.0.1:5432/app',MESSAGE_SERVICE_URL:'https://receiver.example/',MESSAGE_SERVICE_TOKEN:'a'.repeat(64)}
it('validates a separate runtime profile with explicit transport and cookie settings',async()=>{
  expect(await loadConfig(operatorConfigSchema,environment)).toMatchObject({port:3011,dispatchEnabled:true,secureCookies:false,allowInsecureLoopback:false,timeoutMs:2000})
  expect(await loadConfig(operatorConfigSchema,{...environment,MESSAGE_SERVICE_URL:'http://127.0.0.1:3012/',MESSAGE_ALLOW_INSECURE_LOOPBACK:'true',DISPATCH_ENABLED:'false'})).toMatchObject({dispatchEnabled:false})
  for(const overrides of [{MIGRATION_DATABASE_URL:environment.DATABASE_URL},{MESSAGE_SERVICE_URL:'http://receiver.example/'},{MESSAGE_SERVICE_TOKEN:'short'},{AUTH_ORIGIN:'http://external.example'},{AUTH_COOKIE_SECURE:'true'},{MESSAGE_HTTP_TIMEOUT_MS:'60001'},{DISPATCH_ENABLED:'yes'}])await expect(loadConfig(operatorConfigSchema,{...environment,...overrides})).rejects.toThrow('Invalid configuration')
})

import { expect,it } from 'vitest'
import { loadConfig } from '@longhorn/config'
import { redisLimitsConfig } from './config.js'
const environment={API_TOKEN:'a'.repeat(64),REDIS_URL:'rediss://default:private@redis.example/0'}
it('validates explicit Redis transport, stable subject and bounded request policy',async()=>{
  expect(await loadConfig(redisLimitsConfig,environment)).toMatchObject({port:3028,subject:'service-client',limit:60,windowMs:60000,namespace:'reports',redis:{allowInsecureLoopback:false}})
  expect(await loadConfig(redisLimitsConfig,{...environment,REDIS_URL:'redis://127.0.0.1:6379/0',REDIS_ALLOW_INSECURE_LOOPBACK:'true',RATE_LIMIT_REQUESTS:'2',RATE_LIMIT_WINDOW_MS:'1000'})).toMatchObject({limit:2,windowMs:1000})
  for(const overrides of [{API_TOKEN:'short'},{RATE_LIMIT_SUBJECT:'request:header'},{RATE_LIMIT_REQUESTS:'0'},{RATE_LIMIT_REQUESTS:'1000001'},{RATE_LIMIT_WINDOW_MS:'999'},{RATE_LIMIT_WINDOW_MS:'86400001'},{REDIS_NAMESPACE:'*'},{REDIS_URL:'redis://external.example/0'},{REDIS_URL:'redis://127.0.0.1:6379/0'},{REDIS_ALLOW_INSECURE_LOOPBACK:'yes'},{REDIS_COMMAND_TIMEOUT_MS:'0'},{REDIS_TLS_CA:'certificate',REDIS_URL:'redis://127.0.0.1:6379',REDIS_ALLOW_INSECURE_LOOPBACK:'true'}])await expect(loadConfig(redisLimitsConfig,{...environment,...overrides})).rejects.toThrow('Invalid configuration')
})

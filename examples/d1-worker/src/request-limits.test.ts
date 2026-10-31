import { expect,it } from 'vitest'
import { loadConfig } from '@longhornjs/config'
import { configSchema } from './config.js'
it('keeps D1 task creation limits optional with bounded explicit policy',async()=>{
  expect((await loadConfig(configSchema,{})).createLimits).toBeUndefined()
  expect((await loadConfig(configSchema,{D1_CREATE_LIMIT_ENABLED:'true'})).createLimits).toEqual({limit:60,windowMs:60000})
  expect((await loadConfig(configSchema,{D1_CREATE_LIMIT_ENABLED:'true',D1_CREATE_LIMIT_REQUESTS:'2',D1_CREATE_LIMIT_WINDOW_MS:'1000'})).createLimits).toEqual({limit:2,windowMs:1000})
  for(const overrides of [{D1_CREATE_LIMIT_ENABLED:'yes'},{D1_CREATE_LIMIT_REQUESTS:'0'},{D1_CREATE_LIMIT_REQUESTS:'1000001'},{D1_CREATE_LIMIT_WINDOW_MS:'999'},{D1_CREATE_LIMIT_WINDOW_MS:'86400001'}])await expect(loadConfig(configSchema,overrides)).rejects.toThrow('Invalid configuration')
})

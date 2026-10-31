import { expect,it } from 'vitest'
import { loadConfig } from '@longhornjs/config'
import { parseReportConfig,reportConfigSchema } from './config.js'
it('shares optional bounded submission configuration between host and Object',async()=>{
  expect(await loadConfig(reportConfigSchema,{})).toEqual({});expect(parseReportConfig({})).toEqual({})
  expect(await loadConfig(reportConfigSchema,{REPORT_LIMIT_ENABLED:'true'})).toEqual({requestLimits:{limit:60,windowMs:60000}})
  const input={REPORT_LIMIT_ENABLED:'true',REPORT_LIMIT_REQUESTS:'3',REPORT_LIMIT_WINDOW_MS:'1000'}
  expect(parseReportConfig(input)).toEqual(await loadConfig(reportConfigSchema,input))
})
it('fails configuration privately before resources, including malformed disabled policy',async()=>{
  for(const overrides of [{REPORT_LIMIT_ENABLED:'yes'},{REPORT_LIMIT_REQUESTS:'0'},{REPORT_LIMIT_REQUESTS:'1000001'},{REPORT_LIMIT_REQUESTS:'1.5'},{REPORT_LIMIT_WINDOW_MS:'999'},{REPORT_LIMIT_WINDOW_MS:'86400001'}]){
    expect(parseReportConfig(overrides)).toBeUndefined();await expect(loadConfig(reportConfigSchema,overrides)).rejects.toThrow('Invalid configuration')
  }
})

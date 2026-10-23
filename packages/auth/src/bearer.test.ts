import { expect,it } from 'vitest'
import { createBearerVerifier } from './bearer.js'
it('verifies an explicit capability with native crypto and rejects malformed/changed credentials',async()=>{
  const token='a'.repeat(64),verify=createBearerVerifier(token)
  expect(()=>createBearerVerifier('short')).toThrow('credential')
  for(const value of [undefined,'Basic '+token,'Bearer '+token+' ','Bearer '+token+', Bearer '+token,'Bearer '+'b'.repeat(64)])expect(await verify(value)).toBe(false)
  expect(await verify('Bearer '+token)).toBe(true);expect(await verify('bearer '+token)).toBe(true)
})

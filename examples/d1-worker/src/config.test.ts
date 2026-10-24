import{expect,it}from'vitest'
import{configSchema,cursor,updateSchema,deleteSchema}from'./config.js'
it('keeps cursor positions exact beyond JavaScript integers and rejects noncanonical/out-of-range input',()=>{
  expect(cursor.parse('9007199254740993')).toBe('9007199254740993')
  for(const value of['01','-1','1.0','9223372036854775808','1e3'])expect(cursor.safeParse(value).success).toBe(false)
})
it('requires optimistic revisions and a real update while bounding configuration before storage',()=>{
  expect(configSchema.parse({})).toEqual({maxPending:6});expect(configSchema.safeParse({D1_MAX_PENDING:'0'}).success).toBe(false)
  expect(updateSchema.safeParse({revision:1}).success).toBe(false);expect(updateSchema.safeParse({completed:true}).success).toBe(false)
  expect(updateSchema.parse({revision:1,title:' task '})).toEqual({revision:1,title:'task'})
  expect(deleteSchema.safeParse({revision:0}).success).toBe(false)
})

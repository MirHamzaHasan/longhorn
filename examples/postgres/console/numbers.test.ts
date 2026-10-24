import { expect,it } from 'vitest'
import { CommandCopyError,copyCommandNumbers,parseNumbers } from './numbers.js'

it('accepts the existing numeric input notation and exact command boundaries',()=>{
  expect(parseNumbers(' -1e12, +4 .5\n1e12 ')).toEqual([-1e12,4,.5,1e12])
  expect(parseNumbers(Array(100).fill('1').join(','))).toHaveLength(100)
})
it('rejects invalid, nonfinite, excessive and out-of-policy form input',()=>{
  for(const text of['','   ','NaN','Infinity','1e309','1, words','1000000000001',Array(101).fill('1').join(',')])expect(()=>parseNumbers(text)).toThrow('Enter 1–100 numbers')
})
it('copies validated saved numbers without sharing mutable array state',()=>{
  const original=[4,8,15],copy=copyCommandNumbers(original)
  expect(copy).toEqual(original);expect(copy).not.toBe(original);copy[0]=99;expect(original).toEqual([4,8,15])
  expect(copyCommandNumbers([-1e12,0,.5,1e12])).toEqual([-1e12,0,.5,1e12])
})
it('fails closed on malformed saved JSON instead of coercing strings, sparse entries or nested values',()=>{
  for(const value of[null,{},'1,2',[],['1',2],[1,null],[undefined],[true],[[1]],[Number.NaN],[Infinity],Array(2),Array(101).fill(1),[1e12+1]])expect(()=>copyCommandNumbers(value)).toThrow(CommandCopyError)
})

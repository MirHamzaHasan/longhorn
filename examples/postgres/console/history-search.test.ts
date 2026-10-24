import { expect,it } from 'vitest'
import { normalizeHistorySearch } from './history-search.js'

it('accepts canonical UUID prefixes, folds ASCII case and treats a blank value as clearing search',()=>{
  const id='abcdef12-3456-4789-8abc-def012345678'
  for(let length=4;length<=id.length;length++)expect(normalizeHistorySearch('  '+id.slice(0,length).toUpperCase()+'  ')).toBe(id.slice(0,length))
  expect(normalizeHistorySearch(' ')).toBeUndefined();expect(normalizeHistorySearch(undefined)).toBeUndefined()
})
it('rejects wildcard, misplaced separators, Unicode and unbounded input before a request',()=>{
  for(const value of ['abc','abcd%','abcd_','abcd\\','abcd12345','abcd-','----','🐮🐮','a'.repeat(129),null,123])expect(()=>normalizeHistorySearch(value)).toThrow('command ID')
})
it('does not interpret a URL, number list or query string as a command search',()=>{
  for(const value of ['https://example.com','1, 2, 3','owner=another','abcd&scope=all'])expect(()=>normalizeHistorySearch(value)).toThrow('command ID')
})
